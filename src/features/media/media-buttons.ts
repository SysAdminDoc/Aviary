import type { FeatureContext, FeatureModule } from "../registry";
import { Aria2History } from "../integrations/aria2";
import {
  createDownloader,
  DownloadPermissionError,
  requestDownloadPermissionSurface,
  type Downloader
} from "./downloader";
import { extractTweet, type ExtractedMedia, type ExtractedTweet } from "./extract";
import { MediaHistory } from "./history";
import { rememberLastDownload } from "./last-download";
import { DownloadQueue } from "./queue";
import { renderFilename } from "./template";

const STYLE_ID = "av-media-buttons";
const BUTTON_ATTR = "data-av-media-button";
const PROCESSED_ATTR = "data-av-media-processed";

let downloader: Downloader | undefined;
let history: MediaHistory | undefined;
let aria2History: Aria2History | undefined;
let queue: DownloadQueue | undefined;
/** The grant page is opened once per session, never once per failed button. */
let permissionSurfaceOpened = false;

export const mediaButtonsFeature: FeatureModule = {
  id: "media.buttons",
  title: "One-click media",
  category: "media",
  defaultEnabled: true,

  async init(ctx) {
    ensureMediaStyle();
    aria2History = new Aria2History(ctx.storage);
    await aria2History.load();
    if (ctx.settings.integrations.aria2.endpoint) {
      await aria2History.reconcile({
        endpoint: ctx.settings.integrations.aria2.endpoint,
        secret: ctx.settings.integrations.aria2.secret
      });
    }
    downloader = createDownloader({ integrations: ctx.settings.integrations, aria2History });
    queue = new DownloadQueue();
    history = new MediaHistory(ctx.storage, undefined, (error) => {
      ctx.diagnostics.error("Media history failed to save", errorDetails(error));
    });
    try {
      await history.load();
    } catch (error) {
      ctx.diagnostics.warn("Media history failed to load", errorDetails(error));
    }
    applyToggleClass(ctx);
    scanArticles(document, ctx);
    ctx.diagnostics.info("Media buttons initialized", { history: history.size() });
  },

  apply(ctx, root, addedNodes) {
    ensureMediaStyle();
    applyToggleClass(ctx);
    if (!ctx.settings.media.buttons) {
      return;
    }
    if (!addedNodes || addedNodes.length === 0) {
      scanArticles(root, ctx);
      return;
    }
    for (const node of addedNodes) {
      scanArticles(node, ctx);
    }
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.classList.remove("av-media-buttons-enabled");
    for (const article of Array.from(
      document.querySelectorAll(`[${PROCESSED_ATTR}]`)
    )) {
      article.removeAttribute(PROCESSED_ATTR);
    }
    for (const button of Array.from(document.querySelectorAll(`[${BUTTON_ATTR}]`))) {
      button.remove();
    }
    downloader = undefined;
    history = undefined;
    aria2History = undefined;
    queue?.clear();
    queue = undefined;
    ctx.diagnostics.info("Media buttons destroyed");
  },

  getStatus() {
    if (!queue) {
      return { ok: true, message: "Media buttons idle" };
    }
    const snapshot = queue.snapshot();
    return {
      ok: snapshot.failed === 0,
      message: `Downloads: ${snapshot.completed} ok / ${snapshot.duplicate} dup / ${snapshot.failed} fail`,
      details: { ...snapshot }
    };
  }
};

export function getMediaQueue(): DownloadQueue | undefined {
  return queue;
}

export function getMediaHistory(): MediaHistory | undefined {
  return history;
}

function applyToggleClass(ctx: FeatureContext): void {
  document.documentElement.classList.toggle(
    "av-media-buttons-enabled",
    ctx.settings.media.buttons
  );
}

function scanArticles(root: ParentNode | Element, ctx: FeatureContext): void {
  if (!ctx.settings.media.buttons) {
    return;
  }
  const articles = collectArticles(root);
  for (const article of articles) {
    if (article.getAttribute(PROCESSED_ATTR) === "1") {
      continue;
    }
    const tweet = extractTweet(article, {
      preferOriginalImages: ctx.settings.media.preferOriginalImages
    });
    if (tweet.media.length === 0) {
      continue;
    }
    decorateArticle(tweet, ctx);
    article.setAttribute(PROCESSED_ATTR, "1");
  }
}

function collectArticles(root: ParentNode | Element): Element[] {
  const found: Element[] = [];
  if (root instanceof Element && root.matches('article[data-testid="tweet"]')) {
    found.push(root);
  }
  if ("querySelectorAll" in root) {
    for (const article of Array.from(
      root.querySelectorAll('article[data-testid="tweet"]')
    )) {
      found.push(article);
    }
  }
  return found;
}

function decorateArticle(tweet: ExtractedTweet, ctx: FeatureContext): void {
  tweet.media.forEach((media, index) => {
    const container = resolveContainer(media);
    if (!container || hasOwnButton(container, media.kind)) {
      return;
    }
    const button = buildButton(media, index, tweet, ctx);
    container.append(button);
  });
}

function resolveContainer(media: ExtractedMedia): Element | null {
  if (media.kind === "video" && media.video) {
    return media.video.container;
  }
  return media.source.closest('[data-testid="tweetPhoto"]') ?? media.source.parentElement;
}

function hasOwnButton(container: Element, kind: ExtractedMedia["kind"]): boolean {
  return container.querySelector(`[${BUTTON_ATTR}="${kind}"]`) !== null;
}

function buildButton(
  media: ExtractedMedia,
  index: number,
  tweet: ExtractedTweet,
  ctx: FeatureContext
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "av-media-button";
  button.setAttribute(BUTTON_ATTR, media.kind);
  button.dataset.kind = media.kind;
  button.setAttribute("aria-label", buttonAriaLabel(media));
  button.textContent = buttonLabel(media);

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    void handleDownload(media, index, tweet, ctx, button);
  });

  return button;
}

function buttonLabel(media: ExtractedMedia): string {
  if (media.kind === "thumbnail") {
    return "Thumb";
  }
  if (media.kind === "video") {
    return media.video?.isGif ? "GIF" : "Video";
  }
  return "Save";
}

function buttonAriaLabel(media: ExtractedMedia): string {
  if (media.kind === "thumbnail") {
    return "Download thumbnail";
  }
  if (media.kind === "video") {
    return media.video?.isGif ? "Download GIF" : "Download video";
  }
  return "Download image";
}

async function handleDownload(
  media: ExtractedMedia,
  index: number,
  tweet: ExtractedTweet,
  ctx: FeatureContext,
  button: HTMLButtonElement
): Promise<void> {
  if (!downloader || !queue || !history) {
    return;
  }

  const target = resolveTarget(media);
  if (!target) {
    button.textContent = "Unavailable";
    button.disabled = true;
    button.classList.add("is-error");
    ctx.diagnostics.warn("Media target unavailable", { kind: media.kind });
    return;
  }

  const filename = renderFilename(ctx.settings.media.filenameTemplate, {
    handle: tweet.handle,
    tweetId: tweet.tweetId,
    index,
    total: tweet.media.length,
    date: new Date(),
    ext: target.ext,
    text: tweet.text,
    mediaId: target.mediaId
  });

  const dedupeKey = `${tweet.tweetId ?? "0"}:${target.mediaId ?? target.url}:${index}:${media.kind}`;

  if (ctx.settings.media.downloadHistory && history.has(dedupeKey)) {
    const job = queue.enqueue({ url: target.url, filename });
    queue.mark(job.id, "duplicate");
    button.textContent = "Saved";
    button.classList.add("is-duplicate");
    ctx.diagnostics.info("Media skipped — already in history", { dedupeKey });
    void ctx.auditLog.record("media.download.duplicate", { dedupeKey });
    return;
  }

  const job = queue.enqueue({ url: target.url, filename });
  queue.mark(job.id, "running");
  button.classList.add("is-active");
  button.disabled = true;

  try {
    const result = await downloader({ url: target.url, filename });
    if (result.deduplicated) {
      queue.mark(job.id, "duplicate");
      button.textContent = "Queued";
      button.classList.remove("is-active");
      button.classList.add("is-duplicate");
      ctx.diagnostics.info("Media skipped — already queued in Aria2 history", { url: target.url });
      void ctx.auditLog.record("media.download.duplicate", {
        dedupeKey,
        source: "aria2-history"
      });
      return;
    }
    queue.mark(job.id, "completed");
    await rememberLastDownload(ctx.storage, {
      url: target.url,
      filename,
      kind: media.kind
    });
    if (ctx.settings.media.downloadHistory) {
      await history.record(dedupeKey);
    }
    button.textContent = result.degraded ? "Opened" : successLabel(media);
    button.classList.remove("is-active");
    button.classList.add("is-success");
    if (result.degraded) {
      button.title = "Your browser opened this file instead of saving it — grant Aviary the download permission for a real save.";
    }
    ctx.diagnostics.info("Media saved", { filename, kind: media.kind, degraded: result.degraded === true });
    void ctx.auditLog.record("media.download", { filename, kind: media.kind, via: result.via });
  } catch (error) {
    const needsPermission = error instanceof DownloadPermissionError;
    queue.mark(job.id, "failed", String((error as Error)?.message ?? error));
    button.textContent = needsPermission ? "Allow" : "Retry";
    button.classList.remove("is-active");
    button.classList.add("is-error");
    button.disabled = false;
    if (needsPermission) {
      button.title = "Aviary needs the browser download permission. Opening its options page.";
      if (!permissionSurfaceOpened) {
        permissionSurfaceOpened = true;
        void requestDownloadPermissionSurface();
      }
    }
    ctx.diagnostics.error("Media download failed", errorDetails(error));
    void ctx.auditLog.record("media.download.failed", {
      filename,
      kind: media.kind,
      ...(needsPermission ? { reason: "downloads-permission-missing" } : {})
    });
  }
}

function resolveTarget(
  media: ExtractedMedia
): { url: string; mediaId: string | null; ext: string } | null {
  if (media.kind === "video" && media.video?.preferred) {
    const url = media.video.preferred.url;
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

function successLabel(media: ExtractedMedia): string {
  if (media.kind === "thumbnail") return "Got it";
  if (media.kind === "video") return media.video?.isGif ? "GIF saved" : "Saved";
  return "Saved";
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

function ensureMediaStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = MEDIA_CSS;
  (document.head ?? document.documentElement).append(style);
}

const MEDIA_CSS = `
html:not(.av-media-buttons-enabled) [${BUTTON_ATTR}] {
  display: none !important;
}

[${BUTTON_ATTR}] {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, rgb(0, 0, 0) 60%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
  cursor: pointer;
  font: 700 11px/1.1 TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  opacity: 0;
  transition: opacity 120ms ease, border-color 120ms ease;
}

[data-testid="tweetPhoto"] {
  position: relative;
}

[data-testid="tweetPhoto"]:hover [${BUTTON_ATTR}],
[data-testid="tweetPhoto"]:focus-within [${BUTTON_ATTR}],
[${BUTTON_ATTR}]:focus-visible,
[${BUTTON_ATTR}].is-active,
[${BUTTON_ATTR}].is-success,
[${BUTTON_ATTR}].is-error,
[${BUTTON_ATTR}].is-duplicate {
  opacity: 1;
}

[${BUTTON_ATTR}].is-success {
  border-color: rgb(120, 200, 130);
  color: rgb(206, 240, 210);
}

[${BUTTON_ATTR}].is-duplicate {
  border-color: var(--av-muted, rgb(113, 118, 123));
  color: var(--av-muted, rgb(113, 118, 123));
}

[${BUTTON_ATTR}].is-error {
  border-color: rgb(220, 110, 110);
  color: rgb(248, 200, 200);
}

[${BUTTON_ATTR}][data-kind="thumbnail"] {
  top: 8px;
  right: 76px;
}
`;
