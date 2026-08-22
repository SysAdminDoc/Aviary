import type { FeatureContext, FeatureModule } from "../registry.ts";

const PROCESSED_ATTR = "data-av-perf-video";
const PAUSED_ATTR = "data-av-perf-paused";

/**
 * Pauses `<video>` elements that leave the viewport and resumes the ones this feature paused
 * when they come back.
 *
 * X keeps decoding autoplayed timeline video well past the point where anyone can see it, which
 * is the single cheapest runtime cost to reclaim. Everything here is reversible: the only state
 * written to the page is two `data-av-*` attributes and the element's own paused flag.
 */
export class OffscreenVideoPauser {
  #observer: IntersectionObserver | null = null;
  readonly #tracked = new Set<HTMLVideoElement>();

  /**
   * Videos this feature paused and intends to resume, and how many `pause` events each one still
   * owes us. `HTMLMediaElement.pause()` dispatches its event on a queued task rather than
   * synchronously, so a plain "am I pausing right now" boolean would already be false by the time
   * the handler ran. Counting instead survives the async dispatch and lets a *user* pause -- one
   * that arrives with no debt outstanding -- cancel the pending resume.
   */
  readonly #resumable = new Map<HTMLVideoElement, number>();
  readonly #listeners = new WeakMap<HTMLVideoElement, () => void>();

  get trackedCount(): number {
    return this.#tracked.size;
  }

  get pausedCount(): number {
    return this.#resumable.size;
  }

  start(view: Window & typeof globalThis): boolean {
    if (this.#observer) {
      return true;
    }
    const Observer = view.IntersectionObserver;
    if (typeof Observer !== "function") {
      return false;
    }
    this.#observer = new Observer((entries) => {
      for (const entry of entries) {
        this.#handle(entry.target as HTMLVideoElement, entry.isIntersecting);
      }
    });
    return true;
  }

  /**
   * Drops videos X's virtualizer has already torn out of the document.
   *
   * `#tracked` and `#resumable` hold strong references, and nothing removed an entry until
   * `stop()`, so an infinite-scrolled timeline retained every `<video>` it had ever shown --
   * detached media elements, their decoders, and a `pause` listener each, for the whole session.
   * Reconciling on scan keeps the cost proportional to what is actually on the page.
   */
  #pruneDetached(): void {
    for (const video of [...this.#tracked]) {
      if (video.isConnected) {
        continue;
      }
      const listener = this.#listeners.get(video);
      if (listener) {
        video.removeEventListener("pause", listener);
        this.#listeners.delete(video);
      }
      this.#observer?.unobserve(video);
      this.#tracked.delete(video);
      this.#resumable.delete(video);
    }
  }

  scan(root: ParentNode | Element): void {
    if (!this.#observer) {
      return;
    }
    this.#pruneDetached();
    // Matched on tag name rather than `instanceof HTMLVideoElement`: a node handed over from
    // another realm is a video without being an instance of *this* realm's constructor.
    const videos: HTMLVideoElement[] = isVideo(root)
      ? [root]
      : Array.from(root.querySelectorAll<HTMLVideoElement>("video"));

    for (const video of videos) {
      if (video.getAttribute(PROCESSED_ATTR) === "1") {
        continue;
      }
      video.setAttribute(PROCESSED_ATTR, "1");
      const onPause = () => {
        this.#onPauseEvent(video);
      };
      video.addEventListener("pause", onPause);
      this.#listeners.set(video, onPause);
      this.#tracked.add(video);
      this.#observer.observe(video);
    }
  }

  stop(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    for (const video of this.#tracked) {
      const listener = this.#listeners.get(video);
      if (listener) {
        video.removeEventListener("pause", listener);
        this.#listeners.delete(video);
      }
      video.removeAttribute(PROCESSED_ATTR);
      video.removeAttribute(PAUSED_ATTR);
    }
    this.#tracked.clear();
    this.#resumable.clear();
  }

  #handle(video: HTMLVideoElement, visible: boolean): void {
    if (!visible) {
      if (video.paused || video.ended) {
        return;
      }
      this.#resumable.set(video, (this.#resumable.get(video) ?? 0) + 1);
      video.setAttribute(PAUSED_ATTR, "1");
      video.pause();
      return;
    }

    if (!this.#resumable.has(video)) {
      return;
    }
    this.#resumable.delete(video);
    video.removeAttribute(PAUSED_ATTR);
    // Autoplay policy can still refuse; a rejected promise here is not an error worth surfacing.
    void video.play()?.catch(() => undefined);
  }

  #onPauseEvent(video: HTMLVideoElement): void {
    const owed = this.#resumable.get(video);
    if (owed === undefined) {
      return;
    }
    if (owed > 0) {
      this.#resumable.set(video, owed - 1);
      return;
    }
    // No pause of ours outstanding, so this one is the viewer's. Honour it: drop the resume.
    this.#resumable.delete(video);
    video.removeAttribute(PAUSED_ATTR);
  }
}

function isVideo(node: ParentNode | Element): node is HTMLVideoElement {
  return (node as Element).tagName === "VIDEO";
}

const pauser = new OffscreenVideoPauser();
let available = true;

export const pauseOffscreenVideoFeature: FeatureModule = {
  id: "performance.pauseOffscreenVideo",
  title: "Pause offscreen video",
  category: "media",

  init(ctx: FeatureContext) {
    if (!ctx.settings.performance.pauseOffscreenVideo) {
      return;
    }
    available = pauser.start(window);
    if (!available) {
      ctx.diagnostics.error("Offscreen video pausing unavailable: no IntersectionObserver");
      return;
    }
    pauser.scan(document);
    ctx.diagnostics.info("Offscreen video pausing initialized");
  },

  apply(ctx: FeatureContext, root: ParentNode, addedNodes?: Element[]) {
    if (!ctx.settings.performance.pauseOffscreenVideo) {
      // Settings changes must be reversible without waiting for Aviary teardown. Stopping the
      // pauser removes the observer, listener and both attributes it owns from every video.
      pauser.stop();
      return;
    }
    available = pauser.start(window);
    if (!available) {
      return;
    }
    if (!addedNodes || addedNodes.length === 0) {
      pauser.scan(root);
      return;
    }
    for (const node of addedNodes) {
      pauser.scan(node);
    }
  },

  destroy(ctx: FeatureContext) {
    // Deliberately does not resume: an offscreen video that starts playing because a setting was
    // turned off is a worse surprise than one left paused, and the viewer can always press play.
    pauser.stop();
    ctx.diagnostics.info("Offscreen video pausing destroyed");
  },

  getStatus() {
    if (!available) {
      return {
        ok: false,
        message: "IntersectionObserver is unavailable in this browser"
      };
    }
    return {
      ok: true,
      message: `${pauser.trackedCount} videos watched, ${pauser.pausedCount} paused offscreen`,
      details: {
        tracked: pauser.trackedCount,
        paused: pauser.pausedCount
      }
    };
  }
};
