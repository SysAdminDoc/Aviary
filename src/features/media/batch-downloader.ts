import { renderFilename } from "./template";
import { extractTweet, mediaIdentity, type ExtractedTweet, type ExtractedMedia } from "./extract";
import { sharedDownloadWatcher } from "./download-watch";
import {
  createDownloader,
  DownloadPermissionError,
  fingerprintMediaDownload,
  requestDownloadPermissionSurface,
  type Downloader,
  type DownloaderResult
} from "./downloader";
import { mediaIdentityHash, type MediaFingerprint } from "../export/assets";
import { getMediaHistory, getMediaQueue } from "./media-buttons";
import { isSaveableVariantUrl } from "./video-extract";
import type { DownloadJob } from "./queue";
import type { FeatureContext } from "../registry";

export interface BatchOptions {
  surface?: string;
  maxItems?: number;
  filterKind?: "photo" | "video" | "thumbnail" | "all";
}

export interface BatchProgress {
  total: number;
  enqueued: number;
  downloaded: number;
  duplicate: number;
  failed: number;
}

export interface BatchResult extends BatchProgress {
  jobIds: string[];
  cancelled: boolean;
  /** Set when the batch stopped early because the browser download permission is missing. */
  needsDownloadPermission?: boolean;
}

export interface MediaBatchStatus extends BatchProgress {
  id: string;
  status: "running" | "paused" | "cancelling";
}

export interface BatchActionResult {
  ok: boolean;
  error?: string;
}

type ResolvedTarget = {
  url: string;
  fallbackUrls?: string[];
  mediaId: string | null;
  ext: string;
};

interface ActiveBatch {
  id: string;
  status: "running" | "paused" | "cancelling";
  cancelled: boolean;
  waiters: Set<() => void>;
  progress: BatchProgress;
}

let activeBatch: ActiveBatch | undefined;
let batchSequence = 0;

export function getMediaBatchStatus(): MediaBatchStatus | undefined {
  if (!activeBatch) {
    return undefined;
  }
  const { id, status } = activeBatch;
  const { total, enqueued, downloaded, duplicate, failed } = activeBatch.progress;
  return { id, status, total, enqueued, downloaded, duplicate, failed };
}

export function pauseMediaBatch(): BatchActionResult {
  if (!activeBatch) {
    return { ok: false, error: "No media batch is running" };
  }
  if (activeBatch.status === "running") {
    activeBatch.status = "paused";
  }
  return { ok: true };
}

export function resumeMediaBatch(): BatchActionResult {
  if (!activeBatch) {
    return { ok: false, error: "No media batch is running" };
  }
  if (activeBatch.status === "paused") {
    activeBatch.status = "running";
    wakeBatch(activeBatch);
  }
  return { ok: true };
}

export function cancelMediaBatch(): BatchActionResult {
  if (!activeBatch) {
    return { ok: false, error: "No media batch is running" };
  }
  activeBatch.status = "cancelling";
  activeBatch.cancelled = true;
  wakeBatch(activeBatch);
  return { ok: true };
}

export async function runMediaBatch(
  ctx: FeatureContext,
  options: BatchOptions = {}
): Promise<BatchResult> {
  const queue = getMediaQueue();
  const history = getMediaHistory();
  const downloader: Downloader = createDownloader({
    integrations: ctx.settings.integrations,
    onWarn: (message, details) => ctx.diagnostics.warn(message, details)
  });
  const concurrency = Math.max(1, Math.min(ctx.settings.jobs.concurrentDownloads, 6));
  const max = Math.max(1, options.maxItems ?? 200);
  const filterKind = options.filterKind ?? "all";

  const tweets = collectArticles(document, options.surface, {
    preferOriginalImages: ctx.settings.media.preferOriginalImages
  });
  const tasks: Array<{ media: ExtractedMedia; tweet: ExtractedTweet; index: number; target: ResolvedTarget }> = [];

  for (const tweet of tweets) {
    tweet.media.forEach((media, index) => {
      if (filterKind !== "all" && media.kind !== filterKind) return;
      const target = resolveTarget(media);
      if (!target) return;
      tasks.push({ media, tweet, index, target });
    });
    // Stop collecting once the cap is reached; the single exit below keeps the configured
    // concurrency applied on every path.
    if (tasks.length >= max) {
      break;
    }
  }

  return runTasks(ctx, downloader, queue, history, tasks.slice(0, max), concurrency);
}

async function runTasks(
  ctx: FeatureContext,
  downloader: Downloader,
  queue: ReturnType<typeof getMediaQueue>,
  history: ReturnType<typeof getMediaHistory>,
  tasks: Array<{ media: ExtractedMedia; tweet: ExtractedTweet; index: number; target: ResolvedTarget }>,
  concurrency = 3
): Promise<BatchResult> {
  const progress: BatchProgress = {
    total: tasks.length,
    enqueued: 0,
    downloaded: 0,
    duplicate: 0,
    failed: 0
  };
  const jobIds: string[] = [];
  const control = beginBatch(tasks.length, progress);

  let cursor = 0;
  let needsDownloadPermission = false;
  const workers: Promise<void>[] = [];

  try {
    const next = async (): Promise<void> => {
      while (true) {
        // A missing download permission fails every remaining task the same way — stop
        // instead of grinding through hundreds of identical failures.
        if (needsDownloadPermission) return;
        if (control.cancelled) return;
        await waitForBatch(control);
        if (needsDownloadPermission) return;
        if (control.cancelled) return;
        const index = cursor++;
        if (index >= tasks.length) return;
        const task = tasks[index]!;
        const identity = mediaIdentity(task.tweet, task.media);
        const filename = renderFilename(ctx.settings.media.filenameTemplate, {
          handle: identity.handle,
          tweetId: identity.tweetId,
          index: task.index,
          total: task.tweet.media.length,
          date: new Date(),
          ext: task.target.ext,
          text: identity.text,
          mediaId: task.target.mediaId
        });

        let fingerprint: MediaFingerprint = {
          identityHash: mediaIdentityHash(
            task.media.kind,
            task.target.url,
            task.target.mediaId
          )
        };
        let historyMatch = ctx.settings.media.downloadHistory
          ? history?.findMatch(fingerprint, false) ?? null
          : null;
        let reservationToken: string | null = null;

        if (historyMatch && history) {
          const reservation = await history.reserve(fingerprint, false);
          historyMatch = reservation.match;
          reservationToken = reservation.token;
        }
        if (historyMatch && history) {
          await history.noteMatch(historyMatch);
          progress.duplicate += 1;
          if (queue) {
            const job = queue.enqueue({ url: task.target.url, filename });
            queue.mark(job.id, "duplicate");
            jobIds.push(job.id);
          }
          continue;
        }

        // `jobs.rateLimitMode` used to change nothing but the bucket's capacity, because no
        // feature ever drew from it. A batch is the one place the pacing matters: it is the
        // only path that fires hundreds of requests at X's media hosts back to back.
        await ctx.limiter.waitForToken();
        if (control.cancelled) {
          if (reservationToken && history) await history.release(reservationToken);
          return;
        }
        await waitForBatch(control);
        if (control.cancelled) {
          if (reservationToken && history) await history.release(reservationToken);
          return;
        }

        if (ctx.settings.media.downloadHistory && history && !reservationToken) {
          fingerprint = await fingerprintMediaDownload({
            kind: task.media.kind,
            url: task.target.url,
            ...(task.target.fallbackUrls
              ? { fallbackUrls: task.target.fallbackUrls }
              : {}),
            mediaId: task.target.mediaId,
            includePerceptual: ctx.settings.media.perceptualDedup
          });
          const reservation = await history.reserve(
            fingerprint,
            ctx.settings.media.perceptualDedup
          );
          historyMatch = reservation.match;
          reservationToken = reservation.token;
          if (historyMatch) {
            await history.noteMatch(historyMatch);
            progress.duplicate += 1;
            if (queue) {
              const duplicate = queue.enqueue({ url: task.target.url, filename });
              queue.mark(duplicate.id, "duplicate");
              jobIds.push(duplicate.id);
            }
            void ctx.auditLog.record("media.download.duplicate", {
              matchKind: historyMatch,
              batch: true
            });
            continue;
          }
        }
        if (control.cancelled) {
          if (reservationToken && history) await history.release(reservationToken);
          return;
        }

        const job = queue?.enqueue({ url: task.target.url, filename });
        if (job) {
          jobIds.push(job.id);
          queue?.mark(job.id, "running");
        }
        progress.enqueued += 1;

        try {
          const result: DownloaderResult = await downloader({
            url: task.target.url,
            ...(task.target.fallbackUrls
              ? { fallbackUrls: task.target.fallbackUrls }
              : {}),
            filename
          });
          if (result.deduplicated) {
            if (reservationToken && history) {
              await history.release(reservationToken);
              reservationToken = null;
            }
            if (job) queue?.mark(job.id, "duplicate");
            progress.duplicate += 1;
            void ctx.auditLog.record("media.download.duplicate", {
              source: "aria2-history",
              batch: true
            });
            continue;
          }
          if (result.pending && result.downloadId !== undefined) {
            // A batch reports handoffs -- waiting for each transfer in turn would turn a
            // two-hundred-file run into a serial one. The queue and the duplicate index still
            // report outcomes: both are settled when the browser says what happened, so an
            // interrupted transfer never becomes a history entry that refuses the retry.
            const jobId = job?.id;
            const activeReservation = reservationToken;
            reservationToken = null;
            void sharedDownloadWatcher()
              .wait(result.downloadId)
              .then(async (terminal) => {
                if (terminal === "complete") {
                  if (jobId) queue?.mark(jobId, "completed");
                  if (ctx.settings.media.downloadHistory && history) {
                    if (activeReservation) await history.commit(activeReservation, fingerprint);
                    else await history.record(fingerprint);
                  }
                  return;
                }
                if (terminal === "interrupted") {
                  if (activeReservation && history) await history.release(activeReservation);
                  if (jobId) queue?.mark(jobId, "failed", "the browser interrupted this transfer");
                  ctx.diagnostics.warn("Batch media transfer was interrupted", {
                    filename,
                    kind: task.media.kind
                  });
                }
              })
              .catch(() => {
                // The wait itself cannot fail meaningfully; the job simply stays running.
              });
          } else {
            if (job) queue?.mark(job.id, "completed");
            if (ctx.settings.media.downloadHistory && history) {
              if (reservationToken) {
                await history.commit(reservationToken, fingerprint);
                reservationToken = null;
              } else {
                await history.record(fingerprint);
              }
            }
          }
          progress.downloaded += 1;
          void ctx.auditLog.record("media.download", { filename, kind: task.media.kind, via: result.via, batch: true });
        } catch (error) {
          if (reservationToken && history) {
            await history.release(reservationToken);
            reservationToken = null;
          }
          if (job) queue?.mark(job.id, "failed", String((error as Error)?.message ?? error));
          progress.failed += 1;
          if (error instanceof DownloadPermissionError) {
            needsDownloadPermission = true;
            void requestDownloadPermissionSurface();
          }
          ctx.diagnostics.error("Batch media download failed", {
            filename,
            kind: task.media.kind,
            error: String((error as Error)?.message ?? error)
          });
          void ctx.auditLog.record("media.download.failed", { filename, kind: task.media.kind, batch: true });
        }
      }
    };

    for (let i = 0; i < concurrency; i++) {
      workers.push(next());
    }
    await Promise.all(workers);

    return {
      ...progress,
      jobIds,
      cancelled: control.cancelled,
      ...(needsDownloadPermission ? { needsDownloadPermission: true } : {})
    };
  } finally {
    finishBatch(control);
  }
}

/** Replays jobs left in the durable queue after a restart, only after an explicit user action. */
export async function resumePendingMediaJobs(ctx: FeatureContext): Promise<BatchResult> {
  const queue = getMediaQueue();
  const pending = queue?.pending() ?? [];
  return runPersistedJobs(ctx, queue, pending);
}

/** Marks failed/cancelled queue entries retryable, then runs them through the normal downloader. */
export async function retryFailedMediaJobs(ctx: FeatureContext): Promise<BatchResult> {
  const queue = getMediaQueue();
  const pending = queue?.retryFailed() ?? [];
  return runPersistedJobs(ctx, queue, pending);
}

async function runPersistedJobs(
  ctx: FeatureContext,
  queue: ReturnType<typeof getMediaQueue>,
  jobs: DownloadJob[]
): Promise<BatchResult> {
  const progress: BatchProgress = {
    total: jobs.length,
    enqueued: 0,
    downloaded: 0,
    duplicate: 0,
    failed: 0
  };
  const jobIds = jobs.map((job) => job.id);
  if (!queue || jobs.length === 0) {
    return { ...progress, jobIds, cancelled: false };
  }
  const control = beginBatch(jobs.length, progress);
  const downloader = createDownloader({
    integrations: ctx.settings.integrations,
    onWarn: (message, details) => ctx.diagnostics.warn(message, details)
  });
  let needsDownloadPermission = false;

  try {
    for (const job of jobs) {
      if (control.cancelled || needsDownloadPermission) break;
      await waitForBatch(control);
      if (control.cancelled) break;
      queue.resume(job.id);
      queue.mark(job.id, "running");
      progress.enqueued += 1;
      try {
        await ctx.limiter.waitForToken();
        if (control.cancelled) break;
        const result = await downloader({ url: job.url, filename: job.filename });
        if (result.pending && result.downloadId !== undefined) {
          // Resumed jobs settle the same way a fresh batch does: the queue entry stays running
          // until the browser reports the transfer's terminal state, so a resumed job that fails
          // is retryable rather than marked completed.
          const jobId = job.id;
          void sharedDownloadWatcher()
            .wait(result.downloadId)
            .then((terminal) => {
              if (terminal === "complete") {
                queue.mark(jobId, "completed");
              } else if (terminal === "interrupted") {
                queue.mark(jobId, "failed", "the browser interrupted this transfer");
              }
            })
            .catch(() => {
              // Nothing to report; the job stays running.
            });
        } else {
          queue.mark(job.id, result.deduplicated ? "duplicate" : "completed");
        }
        if (result.deduplicated) {
          progress.duplicate += 1;
        } else {
          progress.downloaded += 1;
        }
        void ctx.auditLog.record(result.deduplicated ? "media.download.duplicate" : "media.download", {
          filename: job.filename,
          batch: true,
          resumed: true,
          via: result.via
        });
      } catch (error) {
        queue.mark(job.id, "failed", String((error as Error)?.message ?? error));
        progress.failed += 1;
        if (error instanceof DownloadPermissionError) {
          needsDownloadPermission = true;
          void requestDownloadPermissionSurface();
        }
        ctx.diagnostics.error("Resumed media download failed", {
          filename: job.filename,
          error: String((error as Error)?.message ?? error)
        });
        void ctx.auditLog.record("media.download.failed", { filename: job.filename, batch: true, resumed: true });
      }
    }
    return {
      ...progress,
      jobIds,
      cancelled: control.cancelled,
      ...(needsDownloadPermission ? { needsDownloadPermission: true } : {})
    };
  } finally {
    finishBatch(control);
  }
}

function beginBatch(total: number, progress: BatchProgress): ActiveBatch {
  if (activeBatch) {
    throw new Error("A media batch is already running");
  }
  const control: ActiveBatch = {
    id: `media-${Date.now()}-${++batchSequence}`,
    status: "running",
    cancelled: false,
    waiters: new Set(),
    progress
  };
  activeBatch = control;
  return control;
}

async function waitForBatch(control: ActiveBatch): Promise<void> {
  while (control.status === "paused" && !control.cancelled) {
    await new Promise<void>((resolve) => {
      control.waiters.add(resolve);
    });
  }
}

function wakeBatch(control: ActiveBatch): void {
  for (const resolve of control.waiters) {
    resolve();
  }
  control.waiters.clear();
}

function finishBatch(control: ActiveBatch): void {
  wakeBatch(control);
  if (activeBatch === control) {
    activeBatch = undefined;
  }
}

function collectArticles(
  root: ParentNode,
  surface = "active",
  extractOptions: { preferOriginalImages?: boolean } = {}
): ExtractedTweet[] {
  const articles =
    root instanceof Element && root.matches('article[data-testid="tweet"]')
      ? [root]
      : Array.from(root.querySelectorAll<Element>('article[data-testid="tweet"]'));
  const seen = new Set<string>();
  const tweets: ExtractedTweet[] = [];
  for (const article of articles) {
    const tweet = extractTweet(article, extractOptions);
    const key = `${tweet.tweetId ?? "noid"}:${tweet.handle ?? "noh"}`;
    if (seen.has(key) || tweet.media.length === 0) continue;
    seen.add(key);
    tweets.push(tweet);
  }
  return tweets.map((tweet) => ({ ...tweet, surface }));
}

export function resolveTarget(media: ExtractedMedia): ResolvedTarget | null {
  if (media.kind === "video" && media.video?.preferred) {
    const url = media.video.preferred.url;
    // A MediaSource blob cannot be handed to any downloader; skipping it keeps the batch
    // counters honest instead of recording saves that never happened.
    if (!isSaveableVariantUrl(url, media.video.preferred.type)) {
      return null;
    }
    return { url, mediaId: mediaIdFromVideo(url), ext: extensionForVideo(media.video.preferred.type, url) };
  }
  if (media.image) {
    return {
      url: media.image.url,
      fallbackUrls: media.image.fallbackUrls,
      mediaId: media.image.mediaId,
      ext: media.image.format
    };
  }
  return null;
}

function mediaIdFromVideo(url: string): string | null {
  const match = /\/([A-Za-z0-9_-]{6,})\.(mp4|m4s|m3u8|webm|mov)(?:[?#]|$)/i.exec(url);
  return match?.[1] ?? null;
}

function extensionForVideo(mime: string, url: string): string {
  if (/mp4/i.test(mime) || /\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  if (/webm/i.test(mime) || /\.webm(?:[?#]|$)/i.test(url)) return "webm";
  if (/m3u8/i.test(mime) || /\.m3u8(?:[?#]|$)/i.test(url)) return "m3u8";
  if (/mov/i.test(mime) || /\.mov(?:[?#]|$)/i.test(url)) return "mov";
  return "mp4";
}
