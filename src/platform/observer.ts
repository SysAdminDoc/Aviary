export type AddedNodeHandler = (nodes: Element[], root: ParentNode) => void;

/**
 * X mutates the timeline continuously, and Aviary's own decorations (buttons, badges)
 * are themselves childList mutations. Delivering every batch straight through made each
 * feature re-scan — and the Control Center re-render — many times per second. Batches are
 * coalesced into one delivery per frame window instead.
 */
const FLUSH_DELAY_MS = 120;

/** Ceiling on one coalesced batch; beyond this a full re-scan is cheaper than node bookkeeping. */
const MAX_BATCH_NODES = 400;

export function observeAddedElements(root: Element, onAdded: AddedNodeHandler): () => void {
  let pending = new Set<Element>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let overflowed = false;
  let stopped = false;

  const flush = (): void => {
    timer = undefined;
    if (stopped) {
      return;
    }

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
    if (timer === undefined) {
      timer = setTimeout(flush, FLUSH_DELAY_MS);
    }
  });

  observer.observe(root, {
    childList: true,
    subtree: true
  });

  return () => {
    stopped = true;
    observer.disconnect();
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pending = new Set();
  };
}
