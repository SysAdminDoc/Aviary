export class TokenBucket {
  #tokens: number;
  #lastRefill: number;

  constructor(
    readonly capacity: number,
    readonly refillPerSecond: number
  ) {
    this.#tokens = capacity;
    this.#lastRefill = Date.now();
  }

  tryRemove(tokens = 1): boolean {
    this.refill();
    if (this.#tokens < tokens) {
      return false;
    }
    this.#tokens -= tokens;
    return true;
  }

  async waitForToken(tokens = 1): Promise<void> {
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
