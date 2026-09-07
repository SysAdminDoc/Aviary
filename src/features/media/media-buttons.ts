import type { FeatureContext, FeatureModule } from "../registry.ts";
import { ft } from "../core/feature-i18n.ts";
import { removeFeatureToast, showFeatureToast } from "../core/feature-toast.ts";
import { Aria2History } from "../integrations/aria2.ts";
import {
  isMediaContextDownloadMessage,
  isMediaContextPermissionDeniedMessage
} from "../../extension/media-context-menu.ts";
import type { CapturedGraphqlPayload } from "../../page/page-agent.ts";
import type { PageBridge } from "../../platform/page-bridge.ts";
import {
  createDownloader,
  DownloadPermissionError,
  fingerprintMediaDownload,
  requestDownloadPermissionSurface,
  type Downloader
} from "./downloader.ts";
import { mediaIdentityHash, type MediaFingerprint } from "../export/assets.ts";
import { extractTweet, mediaIdentity, type ExtractedMedia, type ExtractedTweet } from "./extract.ts";
import { MediaMetadataCache, type CapturedMediaMetadata } from "./media-metadata.ts";
import { sharedDownloadWatcher } from "./download-watch.ts";
import { isSaveableVariantUrl, VIDEO_CONTAINER_SELECTOR } from "./video-extract.ts";
import { MediaHistory, type MediaMatchKind } from "./history.ts";
import { rememberLastDownload } from "./last-download.ts";
import { DownloadQueue } from "./queue.ts";
import { renderFilename } from "./template.ts";
import { mediaSidecarRequest, saveMediaSidecar } from "./sidecar.ts";

const STYLE_ID = "av-media-buttons";
const BUTTON_ATTR = "data-av-media-button";
const ACTION_ATTR = "data-av-media-action";
const ACTION_SLOT_ATTR = "data-av-media-action-slot";
const PROCESSED_ATTR = "data-av-media-processed";
const DOWNLOADED_ATTR = "data-av-downloaded";
const MEDIA_HOST_SELECTOR =
  '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], audio';
const MEDIA_MUTATION_SELECTOR =
  '[data-testid="tweetPhoto"], [data-testid="tweetPhoto"] img, ' +
  '[data-testid="videoPlayer"], [data-testid="videoComponent"], video, source, ' +
  'audio, track, [role="group"], [data-testid="reply"]';
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

interface ResolvedTarget {
  url: string;
  fallbackUrls?: string[];
  mediaId: string | null;
  ext: string;
}

interface PrimaryDownloadAsset {
  media: ExtractedMedia;
  index: number;
  target: ResolvedTarget;
}

let downloader: Downloader | undefined;
/**
 * One per page: the background reports a download's terminal state to the tab, not to a caller,
 * so the listener has to outlive any single click.
 */
const downloadWatcher = sharedDownloadWatcher();
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
const buttonResetTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();

export const mediaButtonsFeature: FeatureModule = {
  id: "media.buttons",
  title: "One-click media",
  category: "media",

  async init(ctx) {
    if (ctx.settings.media.buttons) {
      subscribeToMediaMetadata(ctx);
    }
    downloadWatcher.start();
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
      unsubscribeFromMediaMetadata();
      // Keep metadata observed during this page session so toggling the controls back on can
      // restore the highest-quality video action without waiting for X to repeat its GraphQL
      // response. The cache is still cleared during destroy, so it never crosses a navigation.
      clearDecorations();
      pendingContextTarget = undefined;
      appliedPreferOriginalImages = undefined;
      appliedMetadataVersion = undefined;
      return;
    }
    subscribeToMediaMetadata(ctx);
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
      if (node.hasAttribute(BUTTON_ATTR) || node.hasAttribute(ACTION_SLOT_ATTR)) {
        continue;
      }
      if (needsMutationReconcile(node)) {
        scanArticles(node, ctx, true);
      }
    }
  },

  async destroy(ctx) {
    uninstallContextDownload();
    downloadWatcher.stop();
    clearDecorations();
    downloader = undefined;
    history = undefined;
    aria2History = undefined;
    await queue?.flush();
    queue = undefined;
    appliedPreferOriginalImages = undefined;
    appliedMetadataVersion = undefined;
    mediaMetadataCache.clear();
    // Same reason as copy-post-link: the toast host is on <html> with a live timer.
    removeFeatureToast();
    unsubscribeFromMediaMetadata();
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

/** Rebuilds visible controls so their completed-history marker matches the current index. */
export function refreshMediaDownloadMarkers(ctx: FeatureContext): void {
  clearDecorations();
  if (!ctx.settings.media.buttons) return;
  ensureMediaStyle();
  scanArticles(document, ctx);
}

/** Exposed for the headed compatibility lane and for the page bridge contract test. */
export function ingestMediaMetadata(payload: CapturedGraphqlPayload | unknown): number {
  return mediaMetadataCache.ingest(payload);
}

export function mediaMetadataCacheSize(): number {
  return mediaMetadataCache.size;
}

/** Gives local export capture access to the same metadata already observed by the media feature. */
export function getCapturedMediaMetadata(args: {
  tweetId: string | null;
  mediaId: string | null;
  poster: string | null;
}): ReturnType<MediaMetadataCache["find"]> {
  return mediaMetadataCache.find(args.tweetId, args.mediaId, args.poster);
}

/** Held so `destroy` can unsubscribe the exact closure this registered. */
let graphqlHandler: ((payload: unknown) => void) | undefined;
let mediaMetadataHandler: ((payload: unknown) => void) | undefined;

function subscribeToMediaMetadata(ctx: FeatureContext): void {
  const bridge = ctx.pageBridge;
  if (!bridge || subscribedBridge === bridge) {
    return;
  }
  unsubscribeFromMediaMetadata();
  subscribedBridge = bridge;
  const onMediaMetadata = (bridge as Partial<PageBridge>).onMediaMetadata;
  const ingest = (payload: unknown): void => {
    const changed = onMediaMetadata
      ? mediaMetadataCache.ingestMetadata([payload as CapturedMediaMetadata])
      : mediaMetadataCache.ingest(payload as CapturedGraphqlPayload);
    if (changed > 0 && ctx.settings.media.buttons) {
      ctx.requestApply();
    }
  };
  if (typeof onMediaMetadata === "function") {
    mediaMetadataHandler = ingest;
    onMediaMetadata.call(bridge, mediaMetadataHandler);
  } else {
    // Compatibility with the small bridge doubles used by older consumers and tests.
    graphqlHandler = ingest;
    bridge.on("graphql", graphqlHandler);
  }
}

/**
 * The bridge has no idea a feature was suspended, so an unsubscribed handler stays live and every
 * later page event is ingested once per accumulated closure.
 */
function unsubscribeFromMediaMetadata(): void {
  if (graphqlHandler) subscribedBridge?.off("graphql", graphqlHandler);
  if (mediaMetadataHandler) subscribedBridge?.offMediaMetadata(mediaMetadataHandler);
  graphqlHandler = undefined;
  mediaMetadataHandler = undefined;
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
  for (const slot of Array.from(document.querySelectorAll(`[${ACTION_SLOT_ATTR}]`))) {
    slot.remove();
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

  extensionMessageListener = (message, sender, sendResponse) => {
    if (isMediaContextPermissionDeniedMessage(message, sender)) {
      showFeatureToast(
        ft(ctx, "Download access was not granted. Open Aviary Options to enable browser downloads."),
        { tone: "error", ctx }
      );
      sendResponse({ ok: false, reason: "permission-denied" });
      return false;
    }
    if (!isMediaContextDownloadMessage(message, sender)) {
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
        (article.querySelector(`[${BUTTON_ATTR}]`) &&
          (article.querySelector(`[${ACTION_ATTR}]`) || !findActionGroup(article))) ||
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
      ((!node.querySelector(`[${BUTTON_ATTR}]`) ||
        (findActionGroup(node) !== null && !node.querySelector(`[${ACTION_ATTR}]`))) &&
        node.querySelector(MEDIA_HOST_SELECTOR) !== null)
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
  decoratePostAction(tweet, ctx);
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

function decoratePostAction(tweet: ExtractedTweet, ctx: FeatureContext): void {
  const group = findActionGroup(tweet.article);
  if (!group || group.querySelector(`[${ACTION_ATTR}]`)) {
    return;
  }

  const assets = primaryDownloadAssets(tweet);
  const hasPendingVideo =
    tweet.media.some((media) => media.kind === "video" && resolveTarget(media) === null) ||
    (tweet.article.querySelector(VIDEO_CONTAINER_SELECTOR) !== null &&
      !tweet.media.some((media) => media.kind === "video"));
  if (assets.length === 0 && !hasPendingVideo) {
    return;
  }

  const slot = document.createElement("div");
  slot.className = "av-media-action-slot";
  slot.setAttribute(ACTION_SLOT_ATTR, "1");
  // Do not silently save only the photos from a mixed post while its direct video is still
  // resolving. Metadata arrival rebuilds this control with the complete primary-asset set.
  const button = buildPostAction(tweet, hasPendingVideo ? [] : assets, ctx);
  slot.append(button);
  group.append(slot);
}

function findActionGroup(article: Element): HTMLElement | null {
  const reply = article.querySelector<HTMLElement>('[data-testid="reply"]');
  const group = reply?.closest<HTMLElement>('[role="group"]') ?? null;
  return group && article.contains(group) ? group : null;
}

/**
 * What the post-level Download action saves: the post's own media, and nothing else.
 *
 * A quoted post's photos and a link card's preview are somebody else's assets sitting inside this
 * article's subtree. Saving them from here is what named another author's media after the account
 * that quoted them. Each still carries its own Save control, attributed correctly.
 */
function primaryDownloadAssets(tweet: ExtractedTweet): PrimaryDownloadAsset[] {
  const assets: PrimaryDownloadAsset[] = [];
  tweet.media.forEach((media, index) => {
    if (
      media.kind !== "photo" &&
      media.kind !== "video" &&
      media.kind !== "audio" &&
      media.kind !== "subtitle"
    ) {
      return;
    }
    if (media.owner.scope !== "post") {
      return;
    }
    const target = resolveTarget(media);
    if (target) {
      assets.push({ media, index, target });
    }
  });
  return assets;
}

function buildPostAction(
  tweet: ExtractedTweet,
  assets: PrimaryDownloadAsset[],
  ctx: FeatureContext
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "av-media-action";
  button.setAttribute(ACTION_ATTR, "1");
  const idleLabel = ft(ctx, "Download");
  // Say so rather than quietly saving fewer files than the post appears to hold. The excluded
  // assets are a quoted post's or a link card's, and each keeps its own Save control.
  const accessibleLabel = tweet.media.some((media) => media.owner.scope !== "post")
    ? ft(ctx, "Download this post's own media. Quoted and card media has its own Download button.")
    : ft(ctx, "Download all media in this post");
  button.dataset.idleLabel = idleLabel;
  button.dataset.baseIdleAriaLabel = accessibleLabel;
  button.dataset.idleAriaLabel = accessibleLabel;
  button.setAttribute("aria-label", accessibleLabel);
  button.setAttribute("aria-live", "polite");
  button.setAttribute("aria-busy", "false");

  const icon = document.createElement("span");
  icon.className = "av-media-action-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "↓ ";
  const label = document.createElement("span");
  label.className = "av-media-action-label";
  label.textContent = idleLabel;
  button.append(icon, label);

  if (assets.length > 0) {
    setDownloadedMarker(
      button,
      assets.every((asset) => wasDownloaded(asset.media.kind, asset.target)),
      ctx
    );
  }

  if (assets.length === 0) {
    button.dataset.pendingVideo = "true";
    button.setAttribute(
      "aria-label",
      ft(ctx, "The direct video is still loading. Try again in a moment.")
    );
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      void handlePendingPostDownload(tweet.article, ctx, button);
    });
    return button;
  }

  const completed = new Set<string>();
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    void handlePostDownload(tweet, assets, completed, ctx, button);
  });
  return button;
}

/**
 * Keeps a late video player actionable while its direct MP4 metadata catches up.
 *
 * X mounts a MediaSource player before the intercepted timeline response has always crossed the
 * page bridge. A disabled Download control looked permanently broken during that gap. The click
 * now waits briefly for the same highest-bitrate metadata used by the normal path, then either
 * starts the save or leaves an explicit retry action.
 */
async function handlePendingPostDownload(
  article: Element,
  ctx: FeatureContext,
  button: HTMLButtonElement
): Promise<void> {
  setButtonFeedback(button, {
    label: ft(ctx, "Downloading…"),
    icon: "↻",
    className: "is-active",
    disabled: true,
    busy: true
  });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const refreshed = extractTweetForContext(article, ctx);
    const assets = primaryDownloadAssets(refreshed);
    const stillWaiting =
      refreshed.media.some((media) => media.kind === "video" && resolveTarget(media) === null) ||
      (article.querySelector(VIDEO_CONTAINER_SELECTOR) !== null &&
        !refreshed.media.some((media) => media.kind === "video"));
    if (assets.length > 0 && !stillWaiting) {
      delete button.dataset.pendingVideo;
      await handlePostDownload(refreshed, assets, new Set<string>(), ctx, button);
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  setButtonFeedback(button, {
    label: ft(ctx, "Retry"),
    icon: "↻",
    className: "is-error"
  });
  button.setAttribute(
    "aria-label",
    ft(ctx, "The direct video is still loading. Try again in a moment.")
  );
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
  if (media.kind === "audio" && media.audio) {
    return media.audio.container;
  }
  if (media.kind === "subtitle" && media.subtitle) {
    return media.subtitle.container;
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
  const idleLabel = ft(ctx, buttonLabel(media));
  button.setAttribute("aria-label", accessibleLabel);
  button.setAttribute("aria-live", "polite");
  button.setAttribute("aria-busy", "false");
  button.dataset.idleLabel = idleLabel;
  button.dataset.baseIdleAriaLabel = accessibleLabel;
  button.dataset.idleAriaLabel = accessibleLabel;
  button.textContent = `↓ ${ft(ctx, buttonLabel(media))}`;

  const icon = document.createElement("span");
  icon.className = "av-media-button-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "↓ ";
  const label = document.createElement("span");
  label.className = "av-media-button-label";
  label.textContent = idleLabel;
  button.replaceChildren(icon, label);

  const target = resolveTarget(media);
  if (target) {
    setDownloadedMarker(button, wasDownloaded(media.kind, target), ctx);
  }

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
  if (media.kind === "audio") return "Audio";
  if (media.kind === "subtitle") return "Captions";
  // Returned as a literal: both call sites wrap this in ft(), and the harvester reads literals.
  return "Download";
}

function buttonAriaLabel(media: ExtractedMedia): string {
  if (media.kind === "thumbnail") {
    return "Download thumbnail";
  }
  if (media.kind === "video") {
    return media.video?.isGif ? "Download GIF" : "Download video";
  }
  if (media.kind === "audio") return "Download audio";
  if (media.kind === "subtitle") return "Download captions";
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
    setButtonFeedback(button, {
      label: ft(ctx, "Unavailable"),
      icon: "!",
      className: "is-error",
      disabled: true
    });
    ctx.diagnostics.warn("Media target unavailable", { kind: media.kind });
    return;
  }
  setButtonFeedback(button, {
    label: ft(ctx, "Downloading…"),
    icon: "↻",
    className: "is-active",
    disabled: true,
    busy: true
  });

  try {
    const outcome = await performMediaDownload(media, index, tweet, target, ctx, () => {
      // Distinct from Saved on purpose: the browser has the request and the file is on its way.
      setButtonFeedback(button, {
        label: ft(ctx, "Started"),
        icon: "↓",
        className: "is-active",
        disabled: true,
        busy: true
      });
    });
    setButtonFeedback(button, {
      label: ft(
        ctx,
        outcome.degraded
          ? "Opened"
          : outcome.status === "aria2-duplicate"
            ? "Queued"
            : outcome.status === "started"
              ? "Started"
              : successLabel(media)
      ),
      icon: outcome.degraded ? "↗" : outcome.status === "started" ? "↓" : "✓",
      className:
        outcome.status === "completed"
          ? "is-success"
          : outcome.status === "opened"
            ? "is-opened"
            : "is-duplicate"
    });
    if (outcome.status === "started") {
      button.setAttribute(
        "aria-label",
        ft(ctx, "The browser is still transferring this file. Check your downloads for the result.")
      );
    }
    if (outcome.matchKind) {
      button.setAttribute("aria-label", duplicateMatchTitle(outcome.matchKind, ctx));
    }
    if (outcome.status === "completed" || outcome.status === "history-duplicate") {
      setDownloadedMarker(button, true, ctx);
    }
    if (outcome.degraded) {
      button.setAttribute(
        "aria-label",
        ft(
          ctx,
          "Your browser opened this file instead of saving it. Grant Aviary the download permission for a real save."
        )
      );
    }
    scheduleButtonRestore(button);
  } catch (error) {
    showDownloadError(button, error, ctx);
  }
}

interface MediaDownloadOutcome {
  /**
   * `started` means the browser took the request and the transfer had not finished by the time
   * the wait gave up. It is deliberately not `completed`: nothing has proved the file is on disk,
   * so it is neither reported as saved nor written to the duplicate history.
   */
  status: "completed" | "started" | "opened" | "history-duplicate" | "aria2-duplicate";
  degraded: boolean;
  matchKind?: MediaMatchKind;
}

async function handlePostDownload(
  tweet: ExtractedTweet,
  assets: PrimaryDownloadAsset[],
  completed: Set<string>,
  ctx: FeatureContext,
  button: HTMLButtonElement
): Promise<void> {
  if (!downloader || !queue || !history) {
    return;
  }
  setButtonFeedback(button, {
    label: ft(ctx, "Downloading…"),
    icon: "↻",
    className: "is-active",
    disabled: true,
    busy: true
  });

  const outcomes: MediaDownloadOutcome[] = [];
  let firstError: unknown;
  for (const asset of assets) {
    const key = primaryAssetKey(asset);
    if (completed.has(key)) {
      continue;
    }
    try {
      outcomes.push(
        await performMediaDownload(asset.media, asset.index, tweet, asset.target, ctx, () => {
          setButtonFeedback(button, {
            label: ft(ctx, "Started"),
            icon: "↓",
            className: "is-active",
            disabled: true,
            busy: true
          });
        })
      );
      completed.add(key);
    } catch (error) {
      firstError ??= error;
      if (error instanceof DownloadPermissionError) {
        break;
      }
    }
  }

  if (firstError) {
    showDownloadError(button, firstError, ctx);
    return;
  }

  completed.clear();
  const degraded = outcomes.some((outcome) => outcome.degraded);
  const aria2Duplicate =
    outcomes.length > 0 && outcomes.every((outcome) => outcome.status === "aria2-duplicate");
  const anyStarted = outcomes.some((outcome) => outcome.status === "started");
  const allDuplicate =
    outcomes.length > 0 && outcomes.every((outcome) => outcome.status !== "completed");
  setButtonFeedback(button, {
    label: ft(
      ctx,
      degraded ? "Opened" : aria2Duplicate ? "Queued" : anyStarted ? "Started" : "Saved"
    ),
    icon: degraded ? "↗" : anyStarted ? "↓" : "✓",
    className: allDuplicate ? "is-duplicate" : "is-success"
  });
  if (degraded) {
    button.setAttribute(
      "aria-label",
      ft(
        ctx,
        "Your browser opened this file instead of saving it. Grant Aviary the download permission for a real save."
      )
    );
  }
  if (
    outcomes.length > 0 &&
    outcomes.every((outcome) =>
      outcome.status === "completed" || outcome.status === "history-duplicate"
    )
  ) {
    setDownloadedMarker(button, true, ctx);
  }
  scheduleButtonRestore(button);
}

function primaryAssetKey(asset: PrimaryDownloadAsset): string {
  return `${asset.index}:${asset.media.kind}:${asset.target.mediaId ?? asset.target.url}`;
}

async function performMediaDownload(
  media: ExtractedMedia,
  index: number,
  tweet: ExtractedTweet,
  target: ResolvedTarget,
  ctx: FeatureContext,
  onStarted?: () => void
): Promise<MediaDownloadOutcome> {
  if (!downloader || !queue || !history) {
    throw new Error("Media downloader is not ready.");
  }
  // `index` and `total` stay article-wide: they describe the position of the asset in the post
  // being looked at, which is what a reader counting thumbnails sees. Only the identity follows
  // the owner.
  const identity = mediaIdentity(tweet, media);
  const filename = renderFilename(ctx.settings.media.filenameTemplate, {
    handle: identity.handle,
    tweetId: identity.tweetId,
    index,
    total: tweet.media.length,
    date: new Date(),
    ext: target.ext,
    text: identity.text,
    mediaId: target.mediaId
  });
  const sidecar = mediaSidecarRequest(ctx.settings.media.sidecarFormat, {
    mediaFilename: filename,
    kind: media.kind,
    handle: identity.handle,
    tweetId: identity.tweetId,
    text: identity.text,
    permalink: identity.tweetId
      ? `https://x.com/${identity.handle ?? "i"}/status/${identity.tweetId}`
      : null,
    queuedAt: new Date().toISOString()
  });
  let fingerprint: MediaFingerprint = {
    identityHash: mediaIdentityHash(media.kind, target.url, target.mediaId)
  };
  let historyMatch: MediaMatchKind | null = null;
  let reservationToken: string | null = null;
  if (ctx.settings.media.downloadHistory) {
    historyMatch = history.findMatch(fingerprint, false);
    if (historyMatch) {
      const reservation = await history.reserve(fingerprint, false);
      historyMatch = reservation.match;
      reservationToken = reservation.token;
    } else {
      fingerprint = await fingerprintMediaDownload({
        kind: media.kind,
        url: target.url,
        ...(target.fallbackUrls ? { fallbackUrls: target.fallbackUrls } : {}),
        mediaId: target.mediaId,
        includePerceptual: ctx.settings.media.perceptualDedup
      });
      const reservation = await history.reserve(
        fingerprint,
        ctx.settings.media.perceptualDedup
      );
      historyMatch = reservation.match;
      reservationToken = reservation.token;
    }
  }

  if (historyMatch) {
    await history.noteMatch(historyMatch);
    const duplicate = queue.enqueue({
      url: target.url,
      ...(target.fallbackUrls ? { fallbackUrls: target.fallbackUrls } : {}),
      filename,
      kind: media.kind,
      mediaId: target.mediaId
    });
    queue.mark(duplicate.id, "duplicate");
    ctx.diagnostics.info("Media skipped because its fingerprint is already in history", {
      matchKind: historyMatch
    });
    void ctx.auditLog.record("media.download.duplicate", { matchKind: historyMatch });
    return { status: "history-duplicate", degraded: false, matchKind: historyMatch };
  }

  const job = queue.enqueue({
    url: target.url,
    ...(target.fallbackUrls ? { fallbackUrls: target.fallbackUrls } : {}),
    filename,
    kind: media.kind,
    mediaId: target.mediaId,
    ...(sidecar ? { sidecar } : {})
  });
  queue.mark(job.id, "running");
  const completeConfirmedSave = async (via: string): Promise<void> => {
    queue!.mark(job.id, "completed");
    await rememberLastDownload(ctx.storage, {
      url: target.url,
      filename,
      kind: media.kind
    });
    if (ctx.settings.media.downloadHistory) {
      if (reservationToken) {
        await history!.commit(reservationToken, fingerprint);
        reservationToken = null;
      } else {
        await history!.record(fingerprint);
      }
    }
    saveSidecarOrWarn(ctx, sidecar, filename);
    ctx.diagnostics.info("Media saved", { filename, kind: media.kind });
    void ctx.auditLog.record("media.download", { filename, kind: media.kind, via });
  };
  const failInterruptedSave = async (): Promise<void> => {
    if (reservationToken) {
      await history!.release(reservationToken);
      reservationToken = null;
    }
    queue!.mark(job.id, "failed", "the browser interrupted this transfer");
    ctx.diagnostics.warn("Media transfer was interrupted", { filename, kind: media.kind });
    void ctx.auditLog.record("media.download.failed", { filename, kind: media.kind });
  };
  try {
    const result = await downloader({
      url: target.url,
      ...(target.fallbackUrls ? { fallbackUrls: target.fallbackUrls } : {}),
      filename
    });
    if (result.deduplicated) {
      if (reservationToken) await history.release(reservationToken);
      queue.mark(job.id, "duplicate");
      ctx.diagnostics.info("Media skipped: already queued in Aria2 history", {
        url: target.url
      });
      void ctx.auditLog.record("media.download.duplicate", {
        source: "aria2-history"
      });
      return { status: "aria2-duplicate", degraded: false };
    }

    if (result.degraded) {
      if (reservationToken) {
        await history.release(reservationToken);
        reservationToken = null;
      }
      queue.mark(job.id, "opened", "the browser opened this URL; a saved file was not confirmed");
      ctx.diagnostics.info("Media opened without a confirmed save", {
        filename,
        kind: media.kind,
        via: result.via
      });
      void ctx.auditLog.record("media.download.opened", {
        filename,
        kind: media.kind,
        via: result.via
      });
      return { status: "opened", degraded: true };
    }

    // The extension build answers when the browser accepts the request, not when the bytes land.
    // Reporting Saved there is what let an interrupted transfer both claim success and write the
    // duplicate-history entry that then refused the retry.
    if (result.pending && result.downloadId !== undefined) {
      queue.trackDownload(job.id, result.downloadId);
      onStarted?.();
      const terminalResult = downloadWatcher.terminal(result.downloadId);
      const terminal = await downloadWatcher.wait(result.downloadId);
      if (terminal === "interrupted") {
        await failInterruptedSave();
        throw new Error("The browser interrupted this transfer before it finished.");
      }
      if (terminal === "pending") {
        // The visible button can stop waiting, but the terminal listener and durable download id
        // stay alive so a large transfer cannot become a permanently running orphan.
        void terminalResult.then(async (eventual) => {
          if (eventual === "complete") {
            await completeConfirmedSave(result.via);
          } else if (eventual === "interrupted") {
            await failInterruptedSave();
          }
        }).catch((error: unknown) => {
          ctx.diagnostics.warn("Could not reconcile media transfer", errorDetails(error));
        });
        ctx.diagnostics.info("Media transfer still running", { filename, kind: media.kind });
        return { status: "started", degraded: false };
      }
    }

    await completeConfirmedSave(result.via);
    return { status: "completed", degraded: false };
  } catch (error) {
    if (reservationToken) {
      await history.release(reservationToken);
      reservationToken = null;
    }
    const needsPermission = error instanceof DownloadPermissionError;
    queue.mark(job.id, "failed", String((error as Error)?.message ?? error));
    ctx.diagnostics.error("Media download failed", errorDetails(error));
    void ctx.auditLog.record("media.download.failed", {
      filename,
      kind: media.kind,
      ...(needsPermission ? { reason: "downloads-permission-missing" } : {})
    });
    throw error;
  }
}

function duplicateMatchTitle(kind: MediaMatchKind, ctx: FeatureContext): string {
  if (kind === "exact") {
    return ft(ctx, "Skipped because the downloaded bytes match an item in history.");
  }
  if (kind === "perceptual") {
    return ft(ctx, "Skipped because the image looks like an item in history.");
  }
  return ft(ctx, "Skipped because this is the same X media asset at another size.");
}

function showDownloadError(
  button: HTMLButtonElement,
  error: unknown,
  ctx: FeatureContext
): void {
  const needsPermission = error instanceof DownloadPermissionError;
  setButtonFeedback(button, {
    label: ft(ctx, needsPermission ? "Allow" : "Retry"),
    icon: needsPermission ? "↗" : "!",
    className: "is-error"
  });
  if (needsPermission) {
    button.setAttribute(
      "aria-label",
      ft(ctx, "Aviary needs the browser download permission. Opening its options page.")
    );
    if (!permissionSurfaceOpened) {
      permissionSurfaceOpened = true;
      void requestDownloadPermissionSurface();
    }
  }
}

interface ButtonFeedback {
  label: string;
  icon: string;
  className: "is-active" | "is-success" | "is-opened" | "is-duplicate" | "is-error";
  disabled?: boolean;
  busy?: boolean;
}

function setButtonFeedback(button: HTMLButtonElement, feedback: ButtonFeedback): void {
  clearButtonRestore(button);
  button.classList.remove("is-active", "is-success", "is-opened", "is-duplicate", "is-error");
  button.classList.add(feedback.className);
  button.dataset.state = feedback.className.slice(3);
  button.disabled = feedback.disabled === true;
  button.setAttribute("aria-busy", String(feedback.busy === true));
  const icon = button.querySelector<HTMLElement>(
    ".av-media-button-icon, .av-media-action-icon"
  );
  const label = button.querySelector<HTMLElement>(
    ".av-media-button-label, .av-media-action-label"
  );
  if (icon) icon.textContent = `${feedback.icon} `;
  if (label) label.textContent = feedback.label;
  button.setAttribute("aria-label", feedback.label);
  button.removeAttribute("title");
}

function scheduleButtonRestore(button: HTMLButtonElement): void {
  clearButtonRestore(button);
  const timer = setTimeout(() => {
    buttonResetTimers.delete(button);
    if (button.isConnected) {
      restoreIdleButton(button);
    }
  }, 2200);
  buttonResetTimers.set(button, timer);
}

function clearButtonRestore(button: HTMLButtonElement): void {
  const timer = buttonResetTimers.get(button);
  if (timer !== undefined) {
    clearTimeout(timer);
    buttonResetTimers.delete(button);
  }
}

function restoreIdleButton(button: HTMLButtonElement): void {
  button.classList.remove("is-active", "is-success", "is-opened", "is-duplicate", "is-error");
  delete button.dataset.state;
  button.disabled = false;
  button.setAttribute("aria-busy", "false");
  const icon = button.querySelector<HTMLElement>(
    ".av-media-button-icon, .av-media-action-icon"
  );
  const label = button.querySelector<HTMLElement>(
    ".av-media-button-label, .av-media-action-label"
  );
  if (icon) icon.textContent = "↓ ";
  if (label) label.textContent = button.dataset.idleLabel ?? "";
  const accessibleLabel = button.dataset.idleAriaLabel ?? button.dataset.idleLabel ?? "";
  button.setAttribute("aria-label", accessibleLabel);
  button.removeAttribute("title");
}

function wasDownloaded(kind: ExtractedMedia["kind"], target: ResolvedTarget): boolean {
  return history?.wasDownloaded({
    identityHash: mediaIdentityHash(kind, target.url, target.mediaId)
  }) === true;
}

function setDownloadedMarker(
  button: HTMLButtonElement,
  downloaded: boolean,
  ctx: FeatureContext
): void {
  if (downloaded) {
    button.setAttribute(DOWNLOADED_ATTR, "true");
  } else {
    button.removeAttribute(DOWNLOADED_ATTR);
  }
  const base = button.dataset.baseIdleAriaLabel ?? button.dataset.idleAriaLabel ?? "";
  const accessibleLabel = downloaded
    ? `${base}. ${ft(ctx, "Previously downloaded")}.`
    : base;
  button.dataset.idleAriaLabel = accessibleLabel;
  if (!button.dataset.state) {
    button.setAttribute("aria-label", accessibleLabel);
    button.removeAttribute("title");
  }
}

function saveSidecarOrWarn(
  ctx: FeatureContext,
  request: ReturnType<typeof mediaSidecarRequest>,
  mediaFilename: string
): void {
  if (!request || saveMediaSidecar(request)) return;
  ctx.diagnostics.warn("Media sidecar could not be saved", { mediaFilename });
}

function resolveTarget(media: ExtractedMedia): ResolvedTarget | null {
  if (media.kind === "video" && media.video?.preferred) {
    const url = media.video.preferred.url;
    if (!isSaveableVariantUrl(url, media.video.preferred.type)) {
      return null;
    }
    return { url, mediaId: mediaIdFromVideo(url), ext: extensionForVideo(media.video.preferred.type, url) };
  }
  if (media.kind === "audio" && media.audio?.preferred) {
    const variant = media.audio.preferred;
    if (!isSaveableVariantUrl(variant.url, variant.type)) return null;
    return {
      url: variant.url,
      mediaId: mediaIdFromVideo(variant.url),
      ext: extensionForAudio(variant.type, variant.url)
    };
  }
  if (media.kind === "subtitle" && media.subtitle?.track) {
    const track = media.subtitle.track;
    if (!isSaveableVariantUrl(track.url, track.type)) return null;
    return {
      url: track.url,
      mediaId: mediaIdFromVideo(track.url),
      ext: extensionForSubtitle(track.type, track.url)
    };
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
  const match = /\/([A-Za-z0-9_-]{6,})\.(mp4|m4s|m3u8|webm|mov|m4a|mp3|ogg|opus|wav|vtt|srt|ttml|dfxp)(?:[?#]|$)/i.exec(url);
  return match?.[1] ?? null;
}

function extensionForVideo(mime: string, url: string): string {
  if (/mp4/i.test(mime) || /\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  if (/webm/i.test(mime) || /\.webm(?:[?#]|$)/i.test(url)) return "webm";
  if (/m3u8/i.test(mime) || /\.m3u8(?:[?#]|$)/i.test(url)) return "m3u8";
  if (/mov/i.test(mime) || /\.mov(?:[?#]|$)/i.test(url)) return "mov";
  return "mp4";
}

function extensionForAudio(mime: string, url: string): string {
  if (/mpeg|mp3/i.test(mime) || /\.mp3(?:[?#]|$)/i.test(url)) return "mp3";
  if (/ogg|opus/i.test(mime) || /\.(?:ogg|opus)(?:[?#]|$)/i.test(url)) return "ogg";
  if (/wav/i.test(mime) || /\.wav(?:[?#]|$)/i.test(url)) return "wav";
  return "m4a";
}

function extensionForSubtitle(mime: string, url: string): string {
  if (/srt/i.test(mime) || /\.srt(?:[?#]|$)/i.test(url)) return "srt";
  if (/ttml|dfxp/i.test(mime) || /\.(?:ttml|dfxp)(?:[?#]|$)/i.test(url)) return "ttml";
  return "vtt";
}

function successLabel(media: ExtractedMedia): string {
  if (media.kind === "thumbnail") return "Got it";
  if (media.kind === "video") return media.video?.isGif ? "GIF saved" : "Saved";
  if (media.kind === "audio") return "Audio saved";
  if (media.kind === "subtitle") return "Captions saved";
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
html:not(.av-media-buttons-enabled) [${BUTTON_ATTR}],
html:not(.av-media-buttons-enabled) [${ACTION_SLOT_ATTR}] {
  display: none !important;
}

[${ACTION_SLOT_ATTR}] {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  min-width: 112px;
  margin-inline-start: 4px;
}

[${ACTION_ATTR}] {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 108px;
  min-height: 40px;
  padding: 7px 12px;
  border: 0;
  border-radius: 8px;
  background: var(--av-accent, rgb(29, 155, 240));
  color: rgb(3, 20, 24);
  cursor: pointer;
  font: 750 13px/1.1 TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap;
  transition: transform 140ms ease, background-color 140ms ease, color 140ms ease;
}

[${ACTION_ATTR}][${DOWNLOADED_ATTR}],
[${BUTTON_ATTR}][${DOWNLOADED_ATTR}] {
  position: relative;
}

[${ACTION_ATTR}][${DOWNLOADED_ATTR}]::after,
[${BUTTON_ATTR}][${DOWNLOADED_ATTR}]::after {
  content: "";
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--av-media-success, rgb(120, 200, 130));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--av-media-success, rgb(120, 200, 130)) 20%, transparent);
}

[${ACTION_ATTR}] .av-media-action-icon {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  font-size: 17px;
  line-height: 1;
}

[${ACTION_ATTR}]:hover:not(:disabled) {
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 86%, white);
  transform: translateY(-1px);
}

[${ACTION_ATTR}]:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 2px;
}

[${ACTION_ATTR}].is-success {
  color: rgb(3, 20, 24);
  background: var(--av-media-success, rgb(120, 200, 130));
}

[${ACTION_ATTR}].is-opened,
[${ACTION_ATTR}].is-duplicate {
  color: var(--av-text, rgb(239, 243, 244));
  background: color-mix(in srgb, var(--av-muted, rgb(132, 139, 145)) 46%, transparent);
}

[${ACTION_ATTR}].is-error {
  color: rgb(28, 8, 8);
  background: var(--av-media-error, rgb(220, 110, 110));
}

[${ACTION_ATTR}].is-active {
  cursor: progress;
}

[${ACTION_ATTR}].is-active .av-media-action-icon {
  animation: av-media-spin 700ms linear infinite;
}

[${ACTION_ATTR}]:disabled {
  cursor: wait;
  opacity: 0.84;
  transform: none;
}

[${BUTTON_ATTR}] {
  position: absolute;
  z-index: 12;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 72px;
  min-height: 38px;
  padding: 6px 11px;
  border: 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(15, 20, 25)) 90%, black);
  color: var(--av-text, rgb(239, 243, 244));
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.38);
  cursor: pointer;
  font: 700 12.5px/1.1 TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  opacity: 1;
  transition: transform 140ms ease, border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

[${BUTTON_ATTR}] .av-media-button-icon {
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 14px;
  font-size: 15px;
  line-height: 1;
}

[${BUTTON_ATTR}] .av-media-button-label {
  min-width: 0;
}

/* Aviary no longer makes X's media containers the positioning context.

   Forcing position:relative onto [data-testid="tweetPhoto"] made a box X keeps at zero height
   -- it is a flex container whose two children are both position:absolute inset:0, with the real
   height carried by an ancestor -- into the containing block for those children. They collapsed
   to zero height, so the photo vanished the moment the Save button was switched on and came back
   the moment it was switched off. positionButton() measures against whatever ancestor X has
   already positioned, which is the same box the photo itself resolves against. */

[${BUTTON_ATTR}]:hover {
  background: color-mix(in srgb, var(--av-surface-raised, rgb(15, 20, 25)) 86%, var(--av-accent, rgb(29, 155, 240)));
  transform: translateY(-1px);
}

[${BUTTON_ATTR}]:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 2px;
}

[${BUTTON_ATTR}].is-success {
  color: var(--av-media-success-text, rgb(206, 240, 210));
}

[${BUTTON_ATTR}].is-opened,
[${BUTTON_ATTR}].is-duplicate {
  color: var(--av-muted, rgb(132, 139, 145));
}

[${BUTTON_ATTR}].is-error {
  color: var(--av-media-error-text, rgb(248, 200, 200));
}

[${BUTTON_ATTR}].is-active {
  cursor: progress;
}

[${BUTTON_ATTR}].is-active .av-media-button-icon {
  animation: av-media-spin 700ms linear infinite;
}

[${BUTTON_ATTR}]:disabled {
  transform: none;
}

[${BUTTON_ATTR}]:disabled:not(.is-active) {
  cursor: default;
  opacity: 0.68;
}

@keyframes av-media-spin {
  to { transform: rotate(360deg); }
}

@media (pointer: coarse) {
  [${ACTION_ATTR}] {
    min-height: 44px;
  }
}

@media (max-width: 520px) {
  article[data-testid="tweet"] [role="group"]:has(> [${ACTION_SLOT_ATTR}]) {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  [${ACTION_SLOT_ATTR}] {
    flex: 1 0 100%;
    width: 100%;
    min-width: 0;
    margin: 4px 0 0;
  }

  [${ACTION_ATTR}] {
    width: 100%;
    min-width: 0;
    min-height: 46px;
    padding-inline: 14px;
  }

  [${ACTION_ATTR}] .av-media-action-label {
    display: inline;
  }

  [${BUTTON_ATTR}] {
    min-width: 44px;
    width: 44px;
    min-height: 44px;
    padding: 8px;
    color: var(--av-accent, rgb(29, 155, 240));
  }

  [${BUTTON_ATTR}] .av-media-button-label {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  [${BUTTON_ATTR}],
  [${ACTION_ATTR}] {
    transition: none;
  }

  [${BUTTON_ATTR}].is-active .av-media-button-icon,
  [${ACTION_ATTR}].is-active .av-media-action-icon {
    animation: none;
  }
}
`;
