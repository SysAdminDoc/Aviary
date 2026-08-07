import { renderFilename } from "./template";
import { extractTweet } from "./extract";
import {
  createDownloader,
  DownloadPermissionError,
  requestDownloadPermissionSurface,
  type Downloader,
  type DownloaderResult
} from "./downloader";
import { getMediaHistory, getMediaQueue } from "./media-buttons";
import { isSaveableVariantUrl } from "./video-extract";
import type { ExtractedTweet, ExtractedMedia } from "./extract";
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

type ResolvedTarget = { url: string; mediaId: string | null; ext: string };

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

  let cursor = 0;
  let needsDownloadPermission = false;
  const workers: Promise<void>[] = [];

  const next = async (): Promise<void> => {
    while (true) {
      // A missing download permission fails every remaining task the same way — stop
      // instead of grinding through hundreds of identical failures.
      if (needsDownloadPermission) return;
      const index = cursor++;
      if (index >= tasks.length) return;
      const task = tasks[index]!;
      const dedupeKey = `${task.tweet.tweetId ?? "0"}:${task.target.mediaId ?? task.target.url}:${task.index}:${task.media.kind}`;
      const filename = renderFilename(ctx.settings.media.filenameTemplate, {
        handle: task.tweet.handle,
        tweetId: task.tweet.tweetId,
        index: task.index,
        total: task.tweet.media.length,
        date: new Date(),
        ext: task.target.ext,
        text: task.tweet.text,
        mediaId: task.target.mediaId
      });

      if (ctx.settings.media.downloadHistory && history?.has(dedupeKey)) {
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

      const job = queue?.enqueue({ url: task.target.url, filename });
      if (job) {
        jobIds.push(job.id);
        queue?.mark(job.id, "running");
      }
      progress.enqueued += 1;

      try {
        const result: DownloaderResult = await downloader({ url: task.target.url, filename });
        if (job) queue?.mark(job.id, "completed");
        if (ctx.settings.media.downloadHistory && history) {
          await history.record(dedupeKey);
        }
        progress.downloaded += 1;
        void ctx.auditLog.record("media.download", { filename, kind: task.media.kind, via: result.via, batch: true });
      } catch (error) {
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
    cancelled: false,
    ...(needsDownloadPermission ? { needsDownloadPermission: true } : {})
  };
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
    if (!isSaveableVariantUrl(url)) {
      return null;
    }
    return { url, mediaId: mediaIdFromVideo(url), ext: extensionForVideo(media.video.preferred.type, url) };
  }
  if (media.image) {
    return { url: media.image.url, mediaId: media.image.mediaId, ext: media.image.format };
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
