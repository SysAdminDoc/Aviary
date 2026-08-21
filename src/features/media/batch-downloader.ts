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
import type { ExportMedia, ExportRecord } from "../export/types";
import { normalizeImageUrl } from "./urls";
import {
  mediaSidecarRequest,
  saveMediaSidecar,
  type MediaSidecarRequest
} from "./sidecar";

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

interface MediaBatchTask {
  kind: "photo" | "video" | "thumbnail";
  index: number;
  total: number;
  target: ResolvedTarget;
  identity: { handle: string | null; tweetId: string | null; text: string };
  permalink: string | null;
}

interface PreparedMediaBatchTask extends MediaBatchTask {
  filename: string;
  job: DownloadJob | undefined;
  sidecar: MediaSidecarRequest | undefined;
}

const MEDIA_BATCH_LIMIT = 5_000;

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
  const max = Math.max(1, Math.min(MEDIA_BATCH_LIMIT, options.maxItems ?? 200));
  const filterKind = options.filterKind ?? "all";

  const tweets = collectArticles(document, options.surface, {
    preferOriginalImages: ctx.settings.media.preferOriginalImages
  });
  const tasks: MediaBatchTask[] = [];

  for (const tweet of tweets) {
    tweet.media.forEach((media, index) => {
      if (filterKind !== "all" && media.kind !== filterKind) return;
      const target = resolveTarget(media);
      if (!target) return;
      const identity = mediaIdentity(tweet, media);
      tasks.push({
        kind: media.kind,
        index,
        total: tweet.media.length,
        target,
        identity,
        permalink: postPermalink(identity)
      });
    });
    // Stop collecting once the cap is reached; the single exit below keeps the configured
    // concurrency applied on every path.
    if (tasks.length >= max) {
      break;
    }
  }

  return runTasks(ctx, downloader, queue, history, tasks.slice(0, max), concurrency);
}

export function countCapturedMedia(
  records: readonly ExportRecord[],
  preferOriginalImages: boolean,
  filterKind: NonNullable<BatchOptions["filterKind"]> = "all"
): number {
  return capturedMediaTasks(records, preferOriginalImages, filterKind).length;
}

/** Downloads only media URLs already present in local capture records. */
export async function runCapturedMediaBatch(
  ctx: FeatureContext,
  records: readonly ExportRecord[],
  options: Pick<BatchOptions, "maxItems" | "filterKind"> = {}
): Promise<BatchResult> {
  const queue = getMediaQueue();
  const history = getMediaHistory();
  const downloader = createDownloader({
    integrations: ctx.settings.integrations,
    onWarn: (message, details) => ctx.diagnostics.warn(message, details)
  });
  const tasks = capturedMediaTasks(
    records,
    ctx.settings.media.preferOriginalImages,
    options.filterKind ?? "all"
  );
  const max = Math.max(1, Math.min(MEDIA_BATCH_LIMIT, options.maxItems ?? MEDIA_BATCH_LIMIT));
  if (tasks.length > MEDIA_BATCH_LIMIT && (options.maxItems === undefined || options.maxItems > MEDIA_BATCH_LIMIT)) {
    throw new Error(`This collection has more than ${MEDIA_BATCH_LIMIT.toLocaleString()} downloadable items. Narrow the Library search and try again.`);
  }
  const concurrency = Math.max(1, Math.min(ctx.settings.jobs.concurrentDownloads, 6));
  return runTasks(ctx, downloader, queue, history, tasks.slice(0, max), concurrency);
}

async function runTasks(
  ctx: FeatureContext,
  downloader: Downloader,
  queue: ReturnType<typeof getMediaQueue>,
  history: ReturnType<typeof getMediaHistory>,
  tasks: MediaBatchTask[],
  concurrency = 3
): Promise<BatchResult> {
  const progress: BatchProgress = {
    total: tasks.length,
    enqueued: 0,
    downloaded: 0,
    duplicate: 0,
    failed: 0
  };
  const control = beginBatch(tasks.length, progress);
  let prepared: PreparedMediaBatchTask[] = [];
  let jobIds: string[] = [];
  let cursor = 0;
  let needsDownloadPermission = false;
  const workers: Promise<void>[] = [];

  try {
    prepared = tasks.map((task): PreparedMediaBatchTask => {
      const filename = renderFilename(ctx.settings.media.filenameTemplate, {
        handle: task.identity.handle,
        tweetId: task.identity.tweetId,
        index: task.index,
        total: task.total,
        date: new Date(),
        ext: task.target.ext,
        text: task.identity.text,
        mediaId: task.target.mediaId
      });
      const sidecar = mediaSidecarRequest(ctx.settings.media.sidecarFormat, {
        mediaFilename: filename,
        kind: task.kind,
        handle: task.identity.handle,
        tweetId: task.identity.tweetId,
        text: task.identity.text,
        permalink: task.permalink,
        savedAt: new Date().toISOString()
      });
      const job = queue?.enqueue({
        url: task.target.url,
        ...(task.target.fallbackUrls ? { fallbackUrls: task.target.fallbackUrls } : {}),
        filename,
        kind: task.kind,
        mediaId: task.target.mediaId,
        ...(sidecar ? { sidecar } : {})
      });
      return { ...task, filename, job, sidecar };
    });
    jobIds = prepared.flatMap((task) => task.job ? [task.job.id] : []);
    await queue?.checkpoint();
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
        if (index >= prepared.length) return;
        const task = prepared[index]!;
        const { filename, job } = task;

        let fingerprint: MediaFingerprint = {
          identityHash: mediaIdentityHash(
            task.kind,
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
          if (job) queue?.mark(job.id, "duplicate");
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
            kind: task.kind,
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
            if (job) queue?.mark(job.id, "duplicate");
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

        if (job) {
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
                  saveSidecarOrWarn(ctx, task.sidecar, filename);
                  return;
                }
                if (terminal === "interrupted") {
                  if (activeReservation && history) await history.release(activeReservation);
                  if (jobId) queue?.mark(jobId, "failed", "the browser interrupted this transfer");
                  ctx.diagnostics.warn("Batch media transfer was interrupted", {
                    filename,
                    kind: task.kind
                  });
                }
              })
              .catch(async (error) => {
                if (activeReservation && history) await history.release(activeReservation);
                if (jobId) queue?.mark(jobId, "failed", "the browser result could not be confirmed");
                ctx.diagnostics.warn("Could not confirm batch media transfer", {
                  filename,
                  error: String((error as Error)?.message ?? error)
                });
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
            saveSidecarOrWarn(ctx, task.sidecar, filename);
          }
          progress.downloaded += 1;
          void ctx.auditLog.record("media.download", { filename, kind: task.kind, via: result.via, batch: true });
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
            kind: task.kind,
            error: String((error as Error)?.message ?? error)
          });
          void ctx.auditLog.record("media.download.failed", { filename, kind: task.kind, batch: true });
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
  const history = getMediaHistory();
  let needsDownloadPermission = false;

  try {
    for (const job of jobs) {
      if (control.cancelled || needsDownloadPermission) break;
      await waitForBatch(control);
      if (control.cancelled) break;
      queue.resume(job.id);
      let fingerprint: MediaFingerprint | undefined;
      let reservationToken: string | null = null;
      try {
        await ctx.limiter.waitForToken();
        if (control.cancelled) break;

        if (ctx.settings.media.downloadHistory && history && job.kind) {
          fingerprint = {
            identityHash: mediaIdentityHash(job.kind, job.url, job.mediaId ?? null)
          };
          let historyMatch = history.findMatch(fingerprint, false);
          if (!historyMatch) {
            fingerprint = await fingerprintMediaDownload({
              kind: job.kind,
              url: job.url,
              ...(job.fallbackUrls ? { fallbackUrls: job.fallbackUrls } : {}),
              mediaId: job.mediaId ?? null,
              includePerceptual: ctx.settings.media.perceptualDedup
            });
          }
          const reservation = await history.reserve(
            fingerprint,
            ctx.settings.media.perceptualDedup
          );
          historyMatch = reservation.match;
          reservationToken = reservation.token;
          if (historyMatch) {
            await history.noteMatch(historyMatch);
            queue.mark(job.id, "duplicate");
            progress.duplicate += 1;
            void ctx.auditLog.record("media.download.duplicate", {
              matchKind: historyMatch,
              batch: true,
              resumed: true
            });
            continue;
          }
        }

        queue.mark(job.id, "running");
        progress.enqueued += 1;
        const result = await downloader({
          url: job.url,
          ...(job.fallbackUrls ? { fallbackUrls: job.fallbackUrls } : {}),
          filename: job.filename
        });
        if (result.deduplicated) {
          if (reservationToken && history) {
            await history.release(reservationToken);
            reservationToken = null;
          }
          queue.mark(job.id, "duplicate");
          progress.duplicate += 1;
          void ctx.auditLog.record("media.download.duplicate", {
            filename: job.filename,
            batch: true,
            resumed: true,
            via: result.via
          });
          continue;
        }
        if (result.pending && result.downloadId !== undefined) {
          // Resumed jobs settle the same way a fresh batch does: the queue entry stays running
          // until the browser reports the transfer's terminal state, so a resumed job that fails
          // is retryable rather than marked completed.
          const jobId = job.id;
          const activeReservation = reservationToken;
          const activeFingerprint = fingerprint;
          reservationToken = null;
          void sharedDownloadWatcher()
            .wait(result.downloadId)
            .then(async (terminal) => {
              if (terminal === "complete") {
                queue.mark(jobId, "completed");
                if (ctx.settings.media.downloadHistory && history && activeFingerprint) {
                  if (activeReservation) {
                    await history.commit(activeReservation, activeFingerprint);
                  } else {
                    await history.record(activeFingerprint);
                  }
                }
                saveSidecarOrWarn(ctx, job.sidecar, job.filename);
              } else if (terminal === "interrupted") {
                if (activeReservation && history) await history.release(activeReservation);
                queue.mark(jobId, "failed", "the browser interrupted this transfer");
              }
            })
            .catch(async (error) => {
              if (activeReservation && history) await history.release(activeReservation);
              queue.mark(jobId, "failed", "the browser result could not be confirmed");
              ctx.diagnostics.warn("Could not confirm resumed media transfer", {
                filename: job.filename,
                error: String((error as Error)?.message ?? error)
              });
            });
        } else {
          queue.mark(job.id, "completed");
          if (ctx.settings.media.downloadHistory && history && fingerprint) {
            if (reservationToken) {
              await history.commit(reservationToken, fingerprint);
              reservationToken = null;
            } else {
              await history.record(fingerprint);
            }
          }
          saveSidecarOrWarn(ctx, job.sidecar, job.filename);
        }
        progress.downloaded += 1;
        void ctx.auditLog.record("media.download", {
          filename: job.filename,
          batch: true,
          resumed: true,
          via: result.via
        });
      } catch (error) {
        if (reservationToken && history) {
          await history.release(reservationToken);
          reservationToken = null;
        }
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

function saveSidecarOrWarn(
  ctx: FeatureContext,
  request: MediaSidecarRequest | undefined,
  mediaFilename: string
): void {
  if (!request || saveMediaSidecar(request)) return;
  ctx.diagnostics.warn("Media sidecar could not be saved", { mediaFilename });
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

function capturedMediaTasks(
  records: readonly ExportRecord[],
  preferOriginalImages: boolean,
  filterKind: NonNullable<BatchOptions["filterKind"]>
): MediaBatchTask[] {
  const tasks: MediaBatchTask[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    record.media.forEach((media, index) => {
      if (filterKind !== "all" && media.kind !== filterKind) return;
      const target = resolveCapturedTarget(media, preferOriginalImages);
      if (!target) return;
      const key = `${media.kind}:${target.mediaId ?? target.url}`;
      if (seen.has(key)) return;
      seen.add(key);
      const attributed = media.attribution;
      const handle = attributed?.handle ?? record.handle;
      const text = attributed?.scope === "quote" ? record.quote?.text ?? record.text : record.text;
      tasks.push({
        kind: media.kind,
        index,
        total: record.media.length,
        target,
        identity: { handle, tweetId: record.tweetId, text },
        permalink: record.permalink
      });
    });
  }
  return tasks;
}

function resolveCapturedTarget(
  media: ExportMedia,
  preferOriginalImages: boolean
): ResolvedTarget | null {
  const url = (media.url || media.sourceUrl || "").trim();
  if (media.kind === "photo" || media.kind === "thumbnail") {
    const image = normalizeImageUrl(url, { preferOriginal: preferOriginalImages });
    return image
      ? {
          url: image.url,
          fallbackUrls: image.fallbackUrls,
          mediaId: image.mediaId,
          ext: image.format
        }
      : null;
  }
  const type = media.type ?? "video/mp4";
  if (!isSaveableVariantUrl(url, type)) return null;
  return {
    url,
    mediaId: mediaIdFromVideo(url),
    ext: extensionForVideo(type, url)
  };
}

function postPermalink(identity: MediaBatchTask["identity"]): string | null {
  if (!identity.tweetId) return null;
  return `https://x.com/${identity.handle ?? "i"}/status/${identity.tweetId}`;
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
