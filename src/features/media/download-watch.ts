import {
  isDownloadStateMessage,
  type DownloadQualityReceipt,
  type DownloadTerminalState
} from "../../extension/download-state.ts";

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

/** Bounded: terminal results stay replayable without allowing an abandoned page to grow forever. */
const MAX_BUFFERED = 64;

interface Waiter {
  promise: Promise<DownloadWatchOutcome>;
  resolve(outcome: DownloadWatchOutcome): void;
}

export class DownloadWatcher {
  readonly #waiting = new Map<number, Waiter>();
  readonly #settled = new Map<number, DownloadTerminalState>();
  readonly #quality = new Map<number, DownloadQualityReceipt>();
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
        this.settle(message.id, message.state, message.quality);
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
      // Nothing is left to report the outcome, so the honest answer is that it is still going.
      waiter.resolve("pending");
    }
    this.#waiting.clear();
    this.#settled.clear();
    this.#quality.clear();
  }

  /** Also the entry point the background's message takes; exposed so tests can drive it. */
  settle(id: number, state: DownloadTerminalState, quality?: DownloadQualityReceipt): void {
    // Chrome can emit the same terminal transition more than once when a worker wakes around an
    // onChanged event. The first terminal state wins, and every consumer sees that same answer.
    if (this.#settled.has(id)) {
      return;
    }
    if (quality) this.#quality.set(id, { ...quality });
    const waiter = this.#waiting.get(id);
    if (waiter) {
      this.#waiting.delete(id);
      this.#rememberSettled(id, state);
      waiter.resolve(state);
      return;
    }
    this.#rememberSettled(id, state);
  }

  /**
   * Drops a terminal result after the caller has finished all work derived from it.
   *
   * Most callers can leave the bounded replay buffer alone. This hook is useful for long-lived
   * pages that explicitly know a download's queue, history, and UI consumers have all settled.
   */
  forget(id: number): void {
    this.#settled.delete(id);
    this.#quality.delete(id);
  }

  /** Quality is available only after a terminal message has proved which candidate completed. */
  receipt(id: number): DownloadQualityReceipt | undefined {
    const quality = this.#quality.get(id);
    return quality ? { ...quality } : undefined;
  }

  #rememberSettled(id: number, state: DownloadTerminalState): void {
    if (this.#settled.size >= MAX_BUFFERED) {
      const oldest = this.#settled.keys().next().value;
      if (oldest !== undefined) {
        this.#settled.delete(oldest);
      }
    }
    this.#settled.set(id, state);
  }

  wait(id: number, timeoutMs = DOWNLOAD_TERMINAL_TIMEOUT_MS): Promise<DownloadWatchOutcome> {
    const terminal = this.terminal(id);
    return new Promise<DownloadWatchOutcome>((resolve) => {
      const timer = setTimeout(() => resolve("pending"), timeoutMs);
      void terminal.then((outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      });
    });
  }

  /**
   * Keeps listening until the browser reports a terminal result or the feature is destroyed.
   * Unlike `wait`, this promise does not disappear when the UI switches from busy to Started.
   */
  terminal(id: number): Promise<DownloadWatchOutcome> {
    const already = this.#settled.get(id);
    if (already) {
      return Promise.resolve(already);
    }
    const existing = this.#waiting.get(id);
    if (existing) {
      return existing.promise;
    }
    let settle!: (outcome: DownloadWatchOutcome) => void;
    const promise = new Promise<DownloadWatchOutcome>((resolve) => {
      settle = resolve;
    });
    this.#waiting.set(id, { promise, resolve: settle });
    return promise;
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
