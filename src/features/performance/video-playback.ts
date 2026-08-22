import type { FeatureContext, FeatureModule } from "../registry.ts";

const MARKER = "data-av-video-playback";
const LOOP_ORIGINAL = "data-av-loop-original";
const VIDEO_SELECTOR = "video";

let listenersBound = false;
let visibilityBound = false;
/** Videos that were playing when the tab went to the background. */
const pausedByBlur = new WeakSet<HTMLVideoElement>();

/**
 * Two small video annoyances, kept deliberately separate from the offscreen-pause feature.
 *
 * X pauses playback when the tab loses focus, so coming back to a video means finding it stopped
 * where you left it and pressing play again. "Keep playing" only resumes videos that X paused
 * *because of that blur* — it never resumes a video the user paused, and never fights
 * `performance.pauseOffscreenVideo`, which is about scrolling rather than focus.
 *
 * Looping is a plain property flip, restored exactly on Off.
 */
export const videoPlaybackFeature: FeatureModule = {
  id: "performance.videoPlayback",
  title: "Video playback preferences",
  category: "media",

  init(ctx) {
    applyVideoPlayback(ctx, document);
  },

  apply(ctx, root) {
    applyVideoPlayback(ctx, root);
  },

  destroy(ctx) {
    teardown();
    ctx.diagnostics.info("Video playback preferences removed");
  }
};

function applyVideoPlayback(ctx: FeatureContext, root: ParentNode): void {
  const keepPlaying = ctx.settings.performance.keepVideoPlaying;
  const loop = ctx.settings.performance.loopVideos;

  if (!keepPlaying && !loop) {
    teardown();
    return;
  }

  for (const video of collectVideos(root)) {
    if (loop) {
      if (!video.hasAttribute(LOOP_ORIGINAL)) {
        video.setAttribute(LOOP_ORIGINAL, video.loop ? "1" : "0");
      }
      video.loop = true;
    } else if (video.hasAttribute(LOOP_ORIGINAL)) {
      video.loop = video.getAttribute(LOOP_ORIGINAL) === "1";
      video.removeAttribute(LOOP_ORIGINAL);
    }
    video.setAttribute(MARKER, "1");
  }

  if (keepPlaying) {
    bindVisibility();
  } else {
    unbindVisibility();
  }
  listenersBound = keepPlaying || loop;
}

function collectVideos(root: ParentNode): HTMLVideoElement[] {
  const found: HTMLVideoElement[] = [];
  if (root instanceof Element && root.matches(VIDEO_SELECTOR)) {
    found.push(root as HTMLVideoElement);
  }
  if ("querySelectorAll" in root) {
    for (const video of Array.from(root.querySelectorAll<HTMLVideoElement>(VIDEO_SELECTOR))) {
      found.push(video);
    }
  }
  return found;
}

function onVisibilityChange(): void {
  const hidden = document.visibilityState === "hidden";
  for (const video of collectVideos(document)) {
    if (hidden) {
      // Remember only what was actually playing; a video the user had paused stays paused.
      if (!video.paused && !video.ended) {
        pausedByBlur.add(video);
      }
      continue;
    }
    if (pausedByBlur.has(video)) {
      pausedByBlur.delete(video);
      if (video.paused && !video.ended) {
        // A rejected play() is not an error worth surfacing: autoplay policy may refuse it.
        void video.play().catch(() => undefined);
      }
    }
  }
}

function bindVisibility(): void {
  if (visibilityBound) {
    return;
  }
  document.addEventListener("visibilitychange", onVisibilityChange);
  visibilityBound = true;
}

function unbindVisibility(): void {
  if (!visibilityBound) {
    return;
  }
  document.removeEventListener("visibilitychange", onVisibilityChange);
  visibilityBound = false;
}

function teardown(): void {
  unbindVisibility();
  listenersBound = false;
  for (const video of Array.from(document.querySelectorAll<HTMLVideoElement>(`[${MARKER}]`))) {
    if (video.hasAttribute(LOOP_ORIGINAL)) {
      video.loop = video.getAttribute(LOOP_ORIGINAL) === "1";
      video.removeAttribute(LOOP_ORIGINAL);
    }
    video.removeAttribute(MARKER);
  }
}

/** Test seam: module-level listener state must not leak between cases. */
export function resetVideoPlaybackState(): void {
  teardown();
}

export function videoPlaybackBound(): boolean {
  return listenersBound;
}
