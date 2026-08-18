import {
  isDownloadStateMessage,
  type DownloadTerminalState
} from "../../extension/download-state";

/**
 * Waits for a browser download to actually finish.
 *
 * The extension's background answers a download request as soon as the browser accepts it, which
 * is a handoff and not a saved file. This is the other half: the background reports the terminal
 * state to the tab, and this resolves whoever is waiting on that id.
 *
 * Two ordering problems have to be handled, and both are ordinary rather than rare. A small file
 * completes before the caller has finished awaiting the handoff response, so terminal states that
 * nobody is waiting for yet are buffered. And a transfer can outlive any reasonable wait, so the
 * wait times out into `"pending"` -- reported to the user as Started, never as Saved.
 */
export type DownloadWatchOutcome = DownloadTerminalState | "pending";

/** Long enough for a large video on a slow connection; short enough not to be forever. */
export const DOWNLOAD_TERMINAL_TIMEOUT_MS = 300_000;

/** Bounded: one entry per download the page started and has not asked about yet. */
const MAX_BUFFERED = 64;

interface Waiter {
  resolve(outcome: DownloadWatchOutcome): void;
  timer: ReturnType<typeof setTimeout>;
}

export class DownloadWatcher {
  readonly #waiting = new Map<number, Waiter>();
  readonly #settled = new Map<number, DownloadTerminalState>();
  #listener: ((message: unknown) => void) | undefined;

  start(): void {
    if (this.#listener) {
      return;
    }
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.onMessage?.addListener) {
      return;
    }
    this.#listener = (message: unknown) => {
      if (isDownloadStateMessage(message)) {
        this.settle(message.id, message.state);
      }
    };
    runtime.onMessage.addListener(this.#listener);
  }

  stop(): void {
    const runtime = globalThis.chrome?.runtime;
    if (this.#listener && runtime?.onMessage?.removeListener) {
      runtime.onMessage.removeListener(this.#listener);
    }
    this.#listener = undefined;
    for (const waiter of this.#waiting.values()) {
      clearTimeout(waiter.timer);
      // Nothing is left to report the outcome, so the honest answer is that it is still going.
      waiter.resolve("pending");
    }
    this.#waiting.clear();
    this.#settled.clear();
  }

  /** Also the entry point the background's message takes; exposed so tests can drive it. */
  settle(id: number, state: DownloadTerminalState): void {
    const waiter = this.#waiting.get(id);
    if (waiter) {
      this.#waiting.delete(id);
      clearTimeout(waiter.timer);
      waiter.resolve(state);
      return;
    }
    if (this.#settled.size >= MAX_BUFFERED) {
      const oldest = this.#settled.keys().next().value;
      if (oldest !== undefined) {
        this.#settled.delete(oldest);
      }
    }
    this.#settled.set(id, state);
  }

  wait(id: number, timeoutMs = DOWNLOAD_TERMINAL_TIMEOUT_MS): Promise<DownloadWatchOutcome> {
    const already = this.#settled.get(id);
    if (already) {
      this.#settled.delete(id);
      return Promise.resolve(already);
    }
    const existing = this.#waiting.get(id);
    if (existing) {
      // Two callers on one id would mean two buttons for one file; the second gets no answer of
      // its own rather than stealing the first one's.
      return Promise.resolve("pending");
    }
    return new Promise<DownloadWatchOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        resolve("pending");
      }, timeoutMs);
      this.#waiting.set(id, { resolve, timer });
    });
  }
}

let shared: DownloadWatcher | undefined;

/**
 * The page's one watcher.
 *
 * Both the on-post controls and the batch downloader wait on the same background messages, and a
 * second listener would mean whichever instance registered first swallowed the state the other
 * was waiting for.
 */
export function sharedDownloadWatcher(): DownloadWatcher {
  shared ??= new DownloadWatcher();
  return shared;
}
