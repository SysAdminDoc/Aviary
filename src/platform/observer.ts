export type AddedNodeHandler = (nodes: Element[], root: ParentNode) => void;

/**
 * X mutates the timeline continuously, and Aviary's own decorations (buttons, badges)
 * are themselves childList mutations. Delivering every batch straight through made each
 * feature re-scan — and the Control Center re-render — many times per second. A busy page
 * gets at most one delivery per window instead.
 */
const FLUSH_DELAY_MS = 120;

/** Ceiling on one coalesced batch; beyond this a full re-scan is cheaper than node bookkeeping. */
const MAX_BATCH_NODES = 400;

export function observeAddedElements(root: Element, onAdded: AddedNodeHandler): () => void {
  let pending = new Set<Element>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  let overflowed = false;
  let stopped = false;

  const cancelScheduled = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    timer = undefined;
    frame = undefined;
  };

  const flush = (): void => {
    cancelScheduled();
    if (stopped) {
      return;
    }
    lastFlushAt = performance.now();

    const batch = overflowed ? [] : [...pending].filter((node) => node.isConnected);
    const wasOverflowed = overflowed;
    pending = new Set();
    overflowed = false;

    // An overflowed batch degrades to a full re-scan, which every feature already supports
    // when it receives no explicit node list.
    if (wasOverflowed) {
      onAdded([], root);
      return;
    }
    if (batch.length > 0) {
      onAdded(batch, root);
    }
  };

  // The first batch after a quiet spell runs in the next animation frame, which the browser runs
  // before it paints. Holding it for the whole window painted a post X had just rendered at its
  // own 600px and widened it a beat later, every time a post opened. Batches inside the window
  // still wait for it to close, and the timer covers a background tab, which runs no frames.
  const schedule = (): void => {
    if (timer !== undefined || frame !== undefined) {
      return;
    }
    const wait = lastFlushAt + FLUSH_DELAY_MS - performance.now();
    if (wait <= 0 && typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(flush);
    }
    timer = setTimeout(flush, wait > 0 ? wait : FLUSH_DELAY_MS);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof Element)) {
          continue;
        }
        if (pending.size >= MAX_BATCH_NODES) {
          overflowed = true;
          pending.clear();
          break;
        }
        pending.add(node);
      }
    }

    if (pending.size === 0 && !overflowed) {
      return;
    }
    schedule();
  });

  observer.observe(root, {
    childList: true,
    subtree: true
  });

  return () => {
    stopped = true;
    observer.disconnect();
    cancelScheduled();
    pending = new Set();
  };
}
