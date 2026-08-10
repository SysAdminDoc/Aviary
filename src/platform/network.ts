/** Dead integrations must not be able to hold a user action or background job forever. */
export const NETWORK_TIMEOUTS = {
  aria2: 15_000,
  ai: 30_000,
  semantic: 30_000,
  crosspost: 30_000,
  mediaProbe: 5_000,
  mediaTransfer: 60_000
} as const;

export class NetworkTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Network request timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
    this.name = "NetworkTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Runs a complete request, including response-body parsing, behind one abort deadline. The race
 * also settles if a test double or non-fetch transport ignores AbortSignal; native fetch observes
 * the signal and releases its connection when the deadline fires.
 */
export async function withNetworkTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const deadline = Math.max(1, Math.trunc(timeoutMs));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new NetworkTimeoutError(deadline));
    }, deadline);
  });
  const request = Promise.resolve().then(() => operation(controller.signal));

  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (timedOut) {
      throw new NetworkTimeoutError(deadline);
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (timedOut) controller.abort();
  }
}
