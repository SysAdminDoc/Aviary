import type { FeatureContext, FeatureModule } from "../registry";
import { ft } from "../core/feature-i18n";
import { showFeatureToast } from "../core/feature-toast";
import { Aria2History } from "../integrations/aria2";
import {
  isMediaContextDownloadMessage,
  isMediaContextPermissionDeniedMessage
} from "../../extension/media-context-menu";
import type { CapturedGraphqlPayload } from "../../page/page-agent";
import type { PageBridge } from "../../platform/page-bridge";
import {
  createDownloader,
  DownloadPermissionError,
  requestDownloadPermissionSurface,
  type Downloader
} from "./downloader";
import { extractTweet, type ExtractedMedia, type ExtractedTweet } from "./extract";
import { MediaMetadataCache } from "./media-metadata";
import { isSaveableVariantUrl, VIDEO_CONTAINER_SELECTOR } from "./video-extract";
import { MediaHistory } from "./history";
import { rememberLastDownload } from "./last-download";
import { DownloadQueue } from "./queue";
import { renderFilename } from "./template";

const STYLE_ID = "av-media-buttons";
const BUTTON_ATTR = "data-av-media-button";
const PROCESSED_ATTR = "data-av-media-processed";
const MEDIA_HOST_SELECTOR =
  '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]';
const MEDIA_MUTATION_SELECTOR =
  '[data-testid="tweetPhoto"], [data-testid="tweetPhoto"] img, ' +
  '[data-testid="videoPlayer"], [data-testid="videoComponent"], video, source';
const CONTEXT_TARGET_MAX_AGE_MS = 30_000;

type ExtensionMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void
) => boolean | undefined;

interface PendingContextTarget {
  article: Element;
  host: HTMLElement;
  capturedAt: number;
}

let downloader: Downloader | undefined;
let history: MediaHistory | undefined;
let aria2History: Aria2History | undefined;
let queue: DownloadQueue | undefined;
let appliedPreferOriginalImages: boolean | undefined;
let appliedMetadataVersion: number | undefined;
const mediaMetadataCache = new MediaMetadataCache();
let subscribedBridge: PageBridge | undefined;
/** The grant page is opened once per session, never once per failed button. */
let permissionSurfaceOpened = false;
let pendingContextTarget: PendingContextTarget | undefined;
let contextMenuListener: ((event: MouseEvent) => void) | undefined;
let extensionMessageListener: ExtensionMessageListener | undefined;

export const mediaButtonsFeature: FeatureModule = {
  id: "media.buttons",
  title: "One-click media",
  category: "media",

  async init(ctx) {
    subscribeToMediaMetadata(ctx);
    // Only when the feature is on. This used to run unconditionally, so a user with media
    // buttons disabled still got `position: relative` forced onto every tweetPhoto -- which
    // collapses the image to zero height wherever X anchors it to a taller ancestor.
    if (ctx.settings.media.buttons) {
      ensureMediaStyle();
    }
    aria2History = new Aria2History(ctx.storage);
    await aria2History.load();
    // Gated on `enabled`, not merely on a configured endpoint: turning the integration off left
    // the endpoint string in place, so every boot still called the user's aria2. Wrapped as well
    // because reconciling a history is housekeeping -- it must never be able to take the Save
    // buttons down with it (local-only mode made that reachable).
    if (ctx.settings.integrations.aria2.enabled && ctx.settings.integrations.aria2.endpoint) {
      try {
        await aria2History.reconcile({
          endpoint: ctx.settings.integrations.aria2.endpoint,
          secret: ctx.settings.integrations.aria2.secret
        });
      } catch (error) {
        ctx.diagnostics.warn("Aria2 history reconcile skipped", errorDetails(error));
      }
    }
    downloader = createDownloader({
      integrations: ctx.settings.integrations,
      aria2History,
      onWarn: (message, details) => ctx.diagnostics.warn(message, details)
    });
    queue = new DownloadQueue(ctx.storage, (error) => {
      ctx.diagnostics.error("Media queue failed to save", errorDetails(error));
    });
    await queue.load();
    history = new MediaHistory(ctx.storage, undefined, (error) => {
      ctx.diagnostics.error("Media history failed to save", errorDetails(error));
    });
    try {
      await history.load();
    } catch (error) {
      ctx.diagnostics.warn("Media history failed to load", errorDetails(error));
    }
    installContextDownload(ctx);
    applyToggleClass(ctx);
    appliedPreferOriginalImages = ctx.settings.media.preferOriginalImages;
    appliedMetadataVersion = mediaMetadataCache.version;
    scanArticles(document, ctx);
    ctx.diagnostics.info("Media buttons initialized", { history: history.size() });
  },

  apply(ctx, root, addedNodes) {
    applyToggleClass(ctx);
    if (!ctx.settings.media.buttons) {
      clearDecorations();
      pendingContextTarget = undefined;
      appliedPreferOriginalImages = undefined;
      appliedMetadataVersion = undefined;
      return;
    }
    if (
      appliedPreferOriginalImages !== undefined &&
      appliedPreferOriginalImages !== ctx.settings.media.preferOriginalImages
    ) {
      // The extracted media object is captured by each button's click handler. Rebuild when the
      // preference changes so an already-rendered Save button cannot keep the old URL choice.
      clearDecorations();
    }
    if (
      appliedMetadataVersion !== undefined &&
      appliedMetadataVersion !== mediaMetadataCache.version
    ) {
      // A GraphQL response can arrive after X has mounted a blob-backed player. Re-extract the
      // article so its closures pick up the direct variant and the real poster from the cache.
      clearDecorations();
    }
    appliedPreferOriginalImages = ctx.settings.media.preferOriginalImages;
    appliedMetadataVersion = mediaMetadataCache.version;
    ensureMediaStyle();
    if (!addedNodes || addedNodes.length === 0) {
      scanArticles(root, ctx);
      return;
    }
    for (const node of addedNodes) {
      // Our own button insertion is also observed. Skip that one mutation, but reconcile every
      // X-owned addition: virtualized timeline cells keep the article element while replacing
      // its media subtree, so a once-only processed marker cannot prove controls still exist.
      if (node.hasAttribute(BUTTON_ATTR)) {
        continue;
      }
      if (needsMutationReconcile(node)) {
        scanArticles(node, ctx, true);
      }
    }
  },

  async destroy(ctx) {
    uninstallContextDownload();
    clearDecorations();
    downloader = undefined;
    history = undefined;
    aria2History = undefined;
    await queue?.flush();
    queue = undefined;
    appliedPreferOriginalImages = undefined;
    appliedMetadataVersion = undefined;
    mediaMetadataCache.clear();
    subscribedBridge = undefined;
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

/** Exposed for the headed compatibility lane and for the page bridge contract test. */
export function ingestMediaMetadata(payload: CapturedGraphqlPayload | unknown): number {
  return mediaMetadataCache.ingest(payload);
}

export function mediaMetadataCacheSize(): number {
  return mediaMetadataCache.size;
}

function subscribeToMediaMetadata(ctx: FeatureContext): void {
  const bridge = ctx.pageBridge;
  if (!bridge || subscribedBridge === bridge) {
    return;
  }
  subscribedBridge = bridge;
  bridge.on("graphql", (payload) => {
    const changed = mediaMetadataCache.ingest(payload as CapturedGraphqlPayload);
    if (changed > 0 && ctx.settings.media.buttons) {
      ctx.requestApply();
    }
  });
}

function applyToggleClass(ctx: FeatureContext): void {
  document.documentElement.classList.toggle(
    "av-media-buttons-enabled",
    ctx.settings.media.buttons
  );
}

function clearDecorations(): void {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.classList.remove("av-media-buttons-enabled");
  for (const article of Array.from(document.querySelectorAll(`[${PROCESSED_ATTR}]`))) {
    article.removeAttribute(PROCESSED_ATTR);
  }
  for (const button of Array.from(document.querySelectorAll(`[${BUTTON_ATTR}]`))) {
    button.remove();
  }
}

function installContextDownload(ctx: FeatureContext): void {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.id || !runtime.onMessage || contextMenuListener || extensionMessageListener) {
    return;
  }

  contextMenuListener = (event) => {
    pendingContextTarget = ctx.settings.media.buttons
      ? contextTarget(event.target)
      : undefined;
  };
  document.addEventListener("contextmenu", contextMenuListener, true);

  extensionMessageListener = (message, _sender, sendResponse) => {
    if (isMediaContextPermissionDeniedMessage(message)) {
      showFeatureToast(
        ft(ctx, "Download access was not granted. Open Aviary Options to enable browser downloads."),
        { tone: "error", ctx }
      );
      sendResponse({ ok: false, reason: "permission-denied" });
      return false;
    }
    if (!isMediaContextDownloadMessage(message)) {
      return false;
    }

    void downloadContextTarget(ctx).then(
      (ok) => sendResponse({ ok }),
      (error: unknown) => {
        ctx.diagnostics.error("Context media download failed", errorDetails(error));
        showFeatureToast(ft(ctx, "Media download failed. Try the on-post button again."), {
          tone: "error",
          ctx
        });
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    );
    return true;
  };
  runtime.onMessage.addListener(extensionMessageListener);
}

function uninstallContextDownload(): void {
  if (contextMenuListener) {
    document.removeEventListener("contextmenu", contextMenuListener, true);
    contextMenuListener = undefined;
  }
  const onMessage = globalThis.chrome?.runtime?.onMessage;
  if (extensionMessageListener && onMessage?.removeListener) {
    onMessage.removeListener(extensionMessageListener);
  }
  extensionMessageListener = undefined;
  pendingContextTarget = undefined;
}

function contextTarget(rawTarget: EventTarget | null): PendingContextTarget | undefined {
  if (!(rawTarget instanceof Element)) {
    return undefined;
  }
  // X often places controls over the <video>, so prefer the semantic player ancestor over an
  // inner poster/image wrapper. The native context-menu item is registered for all X contexts;
  // this page-side target is what tells it which actual post media the user right-clicked.
  const host =
    rawTarget.closest<HTMLElement>(VIDEO_CONTAINER_SELECTOR) ??
    rawTarget.closest<HTMLElement>('[data-testid="tweetPhoto"]');
  const article = host?.closest('article[data-testid="tweet"]');
  if (!host || !article) {
    return undefined;
  }
  return { article, host, capturedAt: Date.now() };
}

async function downloadContextTarget(ctx: FeatureContext): Promise<boolean> {
  const pending = pendingContextTarget;
  pendingContextTarget = undefined;
  if (
    !ctx.settings.media.buttons ||
    !pending ||
    !pending.article.isConnected ||
    !pending.host.isConnected ||
    Date.now() - pending.capturedAt > CONTEXT_TARGET_MAX_AGE_MS
  ) {
    showFeatureToast(ft(ctx, "Right-click an image or video first, then choose Aviary download."), {
      tone: "error",
      ctx
    });
    return false;
  }

  const tweet = extractTweetForContext(pending.article, ctx);
  const wantsVideo = pending.host.matches(VIDEO_CONTAINER_SELECTOR);
  const index = tweet.media.findIndex((media) => {
    if (wantsVideo) {
      return (
        media.kind === "video" &&
        media.video?.container === pending.host &&
        resolveTarget(media) !== null
      );
    }
    return (
      media.kind === "photo" &&
      media.source.closest('[data-testid="tweetPhoto"]') === pending.host &&
      resolveTarget(media) !== null
    );
  });
  const media = tweet.media[index];
  if (!media) {
    showFeatureToast(
      ft(
        ctx,
        wantsVideo
          ? "The direct video is still loading. Try again in a moment."
          : "This image is not available to download."
      ),
      { tone: "error", ctx }
    );
    return false;
  }

  const container = resolveContainer(media);
  if (!container) {
    return false;
  }
  let button = container.querySelector<HTMLButtonElement>(
    `[${BUTTON_ATTR}="${media.kind}"]`
  );
  if (!button) {
    button = buildButton(media, index, tweet, ctx);
    container.append(button);
    positionButton(button, container);
  }
  await handleDownload(media, index, tweet, ctx, button);
  return true;
}

function extractTweetForContext(article: Element, ctx: FeatureContext): ExtractedTweet {
  return extractTweet(article, {
    preferOriginalImages: ctx.settings.media.preferOriginalImages,
    mediaMetadata: ({ tweetId, mediaId, poster }) =>
      mediaMetadataCache.find(tweetId, mediaId, poster)
  });
}

function scanArticles(
  root: ParentNode | Element,
  ctx: FeatureContext,
  force = false
): void {
  if (!ctx.settings.media.buttons) {
    return;
  }
  const articles = collectArticles(root);
  for (const article of articles) {
    if (!force && article.getAttribute(PROCESSED_ATTR) === "1") {
      if (
        article.querySelector(`[${BUTTON_ATTR}]`) ||
        !article.querySelector(MEDIA_HOST_SELECTOR)
      ) {
        continue;
      }
    }
    const tweet = extractTweetForContext(article, ctx);
    if (tweet.media.length === 0) {
      // Mark text-only and still-building shells too. A later media-specific mutation forces a
      // reconciliation, while ordinary reply/count/control churn no longer re-extracts a post.
      article.setAttribute(PROCESSED_ATTR, "1");
      continue;
    }
    decorateArticle(tweet, ctx);
    article.setAttribute(PROCESSED_ATTR, "1");
  }
}

function needsMutationReconcile(node: Element): boolean {
  const closestArticle = node.closest('article[data-testid="tweet"]');
  if (closestArticle && closestArticle.getAttribute(PROCESSED_ATTR) !== "1") {
    return true;
  }
  if (node.matches('article[data-testid="tweet"]')) {
    return (
      node.getAttribute(PROCESSED_ATTR) !== "1" ||
      (!node.querySelector(`[${BUTTON_ATTR}]`) && node.querySelector(MEDIA_HOST_SELECTOR) !== null)
    );
  }
  return node.matches(MEDIA_MUTATION_SELECTOR) || node.querySelector(MEDIA_MUTATION_SELECTOR) !== null;
}

function collectArticles(root: ParentNode | Element): Element[] {
  const found = new Set<Element>();
  if (root instanceof Element) {
    const article = root.matches('article[data-testid="tweet"]')
      ? root
      : root.closest('article[data-testid="tweet"]');
    if (article) {
      found.add(article);
    }
  }
  if ("querySelectorAll" in root) {
    for (const article of Array.from(
      root.querySelectorAll('article[data-testid="tweet"]')
    )) {
      found.add(article);
    }
  }
  return [...found];
}

function decorateArticle(tweet: ExtractedTweet, ctx: FeatureContext): void {
  tweet.media.forEach((media, index) => {
    const container = resolveContainer(media);
    if (!container || hasOwnButton(container, media.kind)) {
      return;
    }
    // No button at all when nothing can be saved. X streams timeline video through MediaSource,
    // so the only variant is a `blob:` handle -- offering a control that can never work (and
    // used to report "Saved") is worse than offering none. The poster still gets its Thumb
    // button, so a video post is not left bare.
    if (!resolveTarget(media)) {
      return;
    }
    const button = buildButton(media, index, tweet, ctx);
    container.append(button);
    positionButton(button, container);
  });
}

/**
 * Places the button at the media's top-right without changing any of X's own styles.
 *
 * The button is `position: absolute`, so it resolves against the nearest positioned ancestor --
 * the same one X's own photo resolves against. Offsets are therefore measured relative to that
 * ancestor rather than assumed to be the media box. An absolutely positioned child is out of
 * flow, so inserting it cannot disturb a flex or grid container either.
 */
function positionButton(button: HTMLElement, container: Element): void {
  const anchor = positionedAncestor(container);
  const media = container.getBoundingClientRect();
  const base = anchor?.getBoundingClientRect();
  const siblings = Array.from(container.querySelectorAll(`[${BUTTON_ATTR}]`));
  const slot = Math.max(0, siblings.indexOf(button));
  const topOffset = 8 + slot * 40;

  // Fall back to the media box's own corner when there is nothing to measure against yet, or
  // nothing positioned above. Never remove the button: the article is marked processed once
  // decorated, so a button dropped here would never be offered again.
  if (!anchor || !base || media.width === 0 || media.height === 0) {
    button.style.top = `${topOffset}px`;
    button.style.right = "8px";
    return;
  }
  button.style.top = `${Math.round(media.top - base.top + topOffset)}px`;
  button.style.right = `${Math.round(base.right - media.right + 8)}px`;
}

function positionedAncestor(node: Element): Element | null {
  let current: Element | null = node;
  while (current && current !== document.body) {
    if (getComputedStyle(current).position !== "static") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function resolveContainer(media: ExtractedMedia): Element | null {
  if (media.kind === "video" && media.video) {
    return media.video.container;
  }
  if (
    media.kind === "thumbnail" &&
    (media.source.matches?.('[data-testid="videoPlayer"], [data-testid="videoComponent"]') ??
      false)
  ) {
    return media.source;
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
  const accessibleLabel = ft(ctx, buttonAriaLabel(media));
  button.setAttribute("aria-label", accessibleLabel);
  button.title = accessibleLabel;
  button.textContent = `↓ ${ft(ctx, buttonLabel(media))}`;

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
    button.textContent = ft(ctx, "Unavailable");
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
    button.textContent = ft(ctx, "Saved");
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
      button.textContent = ft(ctx, "Queued");
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
    button.textContent = ft(ctx, result.degraded ? "Opened" : successLabel(media));
    button.classList.remove("is-active");
    button.classList.add("is-success");
    if (result.degraded) {
      button.title = ft(ctx, "Your browser opened this file instead of saving it — grant Aviary the download permission for a real save.");
    }
    ctx.diagnostics.info("Media saved", { filename, kind: media.kind, degraded: result.degraded === true });
    void ctx.auditLog.record("media.download", { filename, kind: media.kind, via: result.via });
  } catch (error) {
    const needsPermission = error instanceof DownloadPermissionError;
    queue.mark(job.id, "failed", String((error as Error)?.message ?? error));
    button.textContent = ft(ctx, needsPermission ? "Allow" : "Retry");
    button.classList.remove("is-active");
    button.classList.add("is-error");
    button.disabled = false;
    if (needsPermission) {
      button.title = ft(ctx, "Aviary needs the browser download permission. Opening its options page.");
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
  z-index: 12;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 82%, white 8%);
  border-radius: 8px;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(15, 20, 25)) 94%, black);
  color: var(--av-text, rgb(239, 243, 244));
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.52);
  cursor: pointer;
  font: 750 12px/1.1 TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  opacity: 1;
  transition: transform 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

/* Aviary no longer makes X's media containers the positioning context.

   Forcing position:relative onto [data-testid="tweetPhoto"] made a box X keeps at zero height
   -- it is a flex container whose two children are both position:absolute inset:0, with the real
   height carried by an ancestor -- into the containing block for those children. They collapsed
   to zero height, so the photo vanished the moment the Save button was switched on and came back
   the moment it was switched off. positionButton() measures against whatever ancestor X has
   already positioned, which is the same box the photo itself resolves against. */

[${BUTTON_ATTR}]:hover {
  border-color: var(--av-accent, rgb(29, 155, 240));
  background: color-mix(in srgb, var(--av-surface-raised, rgb(15, 20, 25)) 86%, var(--av-accent, rgb(29, 155, 240)));
  transform: translateY(-1px);
}

[${BUTTON_ATTR}]:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 2px;
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

[${BUTTON_ATTR}]:disabled {
  cursor: default;
  transform: none;
}
`;
