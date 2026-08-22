export class TokenBucket {
  #tokens: number;
  #lastRefill: number;
  capacity: number;
  refillPerSecond: number;

  constructor(
    capacity: number,
    refillPerSecond: number
  ) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.#tokens = capacity;
    this.#lastRefill = Date.now();
  }

  /** Reconcile a live settings change without discarding tokens already earned. */
  configure(capacity: number, refillPerSecond: number): void {
    this.refill();
    this.capacity = Math.max(1, capacity);
    this.refillPerSecond = Math.max(0, refillPerSecond);
    this.#tokens = Math.min(this.#tokens, this.capacity);
  }

  tryRemove(tokens = 1): boolean {
    this.refill();
    if (this.#tokens < tokens) {
      return false;
    }
    this.#tokens -= tokens;
    return true;
  }

  /**
   * Waits until `tokens` are available. Asking for more than the bucket can ever hold used to
   * spin forever, because refill() clamps at capacity and the condition could never become
   * true — a silent hang rather than a visible error.
   */
  async waitForToken(tokens = 1): Promise<void> {
    if (tokens > this.capacity) {
      throw new RangeError(
        `TokenBucket asked for ${tokens} tokens but capacity is ${this.capacity}; this would wait forever.`
      );
    }
    while (!this.tryRemove(tokens)) {
      await delay(250);
    }
  }

  snapshot(): { tokens: number; capacity: number; refillPerSecond: number } {
    this.refill();
    return {
      tokens: this.#tokens,
      capacity: this.capacity,
      refillPerSecond: this.refillPerSecond
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.#lastRefill) / 1000;
    this.#tokens = Math.min(this.capacity, this.#tokens + elapsed * this.refillPerSecond);
    this.#lastRefill = now;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
