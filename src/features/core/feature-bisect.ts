import type { FeatureContext, FeatureRegistry } from "../registry.ts";

/**
 * "Which Aviary feature is breaking this page?"
 *
 * X changes its markup often, and when it does the report that arrives is "something is wrong on
 * Home" -- not which of Aviary's thirty-odd features caused it. Checking them one at a time is a
 * linear hunt through a list most users have never read. A binary search over the features that
 * are actually running answers it in about five rounds.
 *
 * Two properties make this safe to hand to a user mid-session:
 *
 * - It never writes settings. Turning a feature off means calling its own `destroy`, the same
 *   teardown a full unload performs, so a reload restores everything no matter where the user
 *   stops -- including closing the tab in the middle of a round.
 * - The first round turns *everything* off. If the page is still wrong with no Aviary feature
 *   running, there is no culprit to find and the search says so instead of naming whichever
 *   feature the halving happened to end on.
 */

export type BisectVerdict = "still-wrong" | "fixed";

export type BisectPhase = "idle" | "confirming" | "narrowing" | "done";

export type BisectResult =
  | { kind: "culprit"; featureId: string }
  | { kind: "not-aviary" }
  | { kind: "nothing-to-test" }
  | { kind: "abandoned" };

export interface BisectStatus {
  phase: BisectPhase;
  /** Feature ids switched off for the round being asked about. */
  disabled: string[];
  /** Feature ids still under suspicion. */
  remaining: string[];
  /** 1-based; 0 while idle. */
  round: number;
  /** Worst case for the whole search, including the round that turns everything off. */
  totalRounds: number;
  result: BisectResult | null;
}

/**
 * Features the search must not turn off, because the search itself is drawn by them.
 *
 * Suspending the Control Center would tear down the panel holding the "still wrong?" question,
 * and suspending the locale feature would drop the panel back to English mid-round. Neither can
 * therefore be named as the culprit, which is stated in the panel rather than left to be
 * discovered.
 */
export const BISECT_PROTECTED_FEATURES: readonly string[] = ["core.controlCenter", "core.i18n"];

/** The active features a search may turn off, in registration order. */
export function bisectCandidates(registry: FeatureRegistry): string[] {
  const protectedIds = new Set(BISECT_PROTECTED_FEATURES);
  return registry.ids().filter((id) => registry.isActive(id) && !protectedIds.has(id));
}

/**
 * The search itself, with no knowledge of features or the DOM.
 *
 * Kept separate from the runner so the halving can be driven through every branch without a
 * browser: the interesting failures here are off-by-ones that name the wrong feature, and those
 * are only visible when the whole search is played out.
 */
export class BisectSession {
  readonly #candidates: string[];
  #remaining: string[];
  #disabled: string[];
  #phase: BisectPhase;
  #round: number;
  #result: BisectResult | null = null;

  constructor(candidates: Iterable<string>) {
    this.#candidates = [...new Set(candidates)];
    this.#remaining = [...this.#candidates];
    if (this.#candidates.length === 0) {
      this.#disabled = [];
      this.#phase = "done";
      this.#round = 0;
      this.#result = { kind: "nothing-to-test" };
      return;
    }
    this.#disabled = [...this.#candidates];
    this.#phase = "confirming";
    this.#round = 1;
  }

  get phase(): BisectPhase {
    return this.#phase;
  }

  /** What must be off for the question currently being asked. Empty once the search is over. */
  get disabled(): string[] {
    return [...this.#disabled];
  }

  get remaining(): string[] {
    return [...this.#remaining];
  }

  get round(): number {
    return this.#round;
  }

  /** One confirming round, then a halving round per bit of the candidate count. */
  get totalRounds(): number {
    const n = this.#candidates.length;
    return n === 0 ? 0 : 1 + Math.ceil(Math.log2(n));
  }

  get result(): BisectResult | null {
    return this.#result;
  }

  status(): BisectStatus {
    return {
      phase: this.#phase,
      disabled: this.disabled,
      remaining: this.remaining,
      round: this.#round,
      totalRounds: this.totalRounds,
      result: this.#result
    };
  }

  answer(verdict: BisectVerdict): void {
    if (this.#phase === "done" || this.#phase === "idle") {
      return;
    }
    if (this.#phase === "confirming") {
      if (verdict === "still-wrong") {
        // Everything Aviary could turn off is off and the page is still wrong. Naming a feature
        // from here would be naming one at random.
        this.#finish({ kind: "not-aviary" });
        return;
      }
      this.#narrow(this.#candidates);
      return;
    }
    const offThisRound = new Set(this.#disabled);
    this.#narrow(
      verdict === "fixed"
        ? this.#remaining.filter((id) => offThisRound.has(id))
        : this.#remaining.filter((id) => !offThisRound.has(id))
    );
  }

  /** Stops the search where it stands; the runner still puts every feature back. */
  abandon(): void {
    if (this.#phase === "done") {
      return;
    }
    this.#finish({ kind: "abandoned" });
  }

  #narrow(suspects: string[]): void {
    this.#remaining = [...suspects];
    const only = this.#remaining.at(0);
    if (this.#remaining.length === 1 && only !== undefined) {
      this.#finish({ kind: "culprit", featureId: only });
      return;
    }
    if (this.#remaining.length === 0) {
      // Only reachable if the halves were mis-split; a search that has lost its suspect must not
      // report one it never had.
      this.#finish({ kind: "nothing-to-test" });
      return;
    }
    this.#phase = "narrowing";
    this.#round += 1;
    this.#disabled = this.#remaining.slice(0, Math.ceil(this.#remaining.length / 2));
  }

  #finish(result: BisectResult): void {
    this.#phase = "done";
    this.#result = result;
    // Nothing stays off once the answer is known, including the culprit: the user turns that off
    // with its own setting, which is the switch that survives a reload.
    this.#disabled = [];
  }
}

const IDLE: BisectStatus = {
  phase: "idle",
  disabled: [],
  remaining: [],
  round: 0,
  totalRounds: 0,
  result: null
};

/**
 * Drives a `BisectSession` against a live registry.
 *
 * Every state change ends with the running features matching `session.disabled` exactly, computed
 * as a diff so a feature that is off in two consecutive rounds is not torn down and rebuilt
 * between them.
 */
export class FeatureBisect {
  #session: BisectSession | null = null;
  #recorded = false;

  status(): BisectStatus {
    return this.#session ? this.#session.status() : { ...IDLE };
  }

  get running(): boolean {
    return this.#session !== null && this.#session.phase !== "done";
  }

  async start(ctx: FeatureContext): Promise<BisectStatus> {
    const registry = ctx.registry;
    if (!registry) {
      return { ...IDLE };
    }
    if (this.#session) {
      // Restarting mid-search would leave the previous round's features off.
      await this.cancel(ctx);
    }
    this.#session = new BisectSession(bisectCandidates(registry));
    this.#recorded = false;
    void ctx.auditLog.record("bisect.start", { features: this.#session.remaining.length });
    await this.#sync(ctx, registry);
    return this.status();
  }

  async answer(ctx: FeatureContext, verdict: BisectVerdict): Promise<BisectStatus> {
    const registry = ctx.registry;
    if (!this.#session || !registry) {
      return this.status();
    }
    this.#session.answer(verdict);
    await this.#sync(ctx, registry);
    this.#recordResult(ctx);
    return this.status();
  }

  /**
   * Drops the search without touching the registry.
   *
   * For the one case where resuming would be wrong: the whole app is being torn down, so the
   * features this search is holding off are about to be destroyed anyway. Re-initializing them
   * on the way out would leave features running with no registry to destroy them.
   */
  forget(): void {
    this.#session = null;
    this.#recorded = false;
  }

  /** Abandoning is a first-class outcome: the page must come back exactly as it was. */
  async cancel(ctx: FeatureContext): Promise<BisectStatus> {
    const registry = ctx.registry;
    if (!this.#session) {
      return { ...IDLE };
    }
    this.#session.abandon();
    if (registry) {
      await this.#sync(ctx, registry);
    }
    this.#recordResult(ctx);
    const status = this.status();
    this.#session = null;
    return status;
  }

  #recordResult(ctx: FeatureContext): void {
    const result = this.#session?.result;
    // Closing a finished search must not log its outcome a second time.
    if (!result || this.#recorded) {
      return;
    }
    this.#recorded = true;
    void ctx.auditLog.record("bisect.result", {
      outcome: result.kind,
      ...(result.kind === "culprit" ? { feature: result.featureId } : {})
    });
  }

  async #sync(ctx: FeatureContext, registry: FeatureRegistry): Promise<void> {
    const wanted = new Set(this.#session?.disabled ?? []);
    const held = registry.suspendedIds();
    const toResume = held.filter((id) => !wanted.has(id));
    const toSuspend = [...wanted].filter((id) => !held.includes(id));
    if (toSuspend.length > 0) {
      await registry.suspend(ctx, toSuspend);
    }
    if (toResume.length > 0) {
      await registry.resume(ctx, toResume);
    }
    // Resumed features have torn their own state down; only a pass over the document puts their
    // markers back on posts X rendered while they were off.
    await ctx.requestApply();
  }
}

/**
 * The one line a bug report needs.
 *
 * Deliberately content-free: a feature id and a count, never a URL, a handle, or post text.
 */
export function describeBisectResult(status: BisectStatus): string {
  const result = status.result;
  if (!result) {
    return `Bisect in progress: round ${status.round} of ${status.totalRounds}, ${status.remaining.length} feature(s) still suspect.`;
  }
  switch (result.kind) {
    case "culprit":
      return `Bisect result: ${result.featureId} (found in ${status.round} round(s)).`;
    case "not-aviary":
      return "Bisect result: the page was still wrong with every Aviary feature off.";
    case "nothing-to-test":
      return "Bisect result: no features were running to test.";
    case "abandoned":
      return `Bisect abandoned at round ${status.round}; ${status.remaining.length} feature(s) were still suspect.`;
  }
}
