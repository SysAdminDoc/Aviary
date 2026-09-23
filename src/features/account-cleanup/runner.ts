import type { StorageGateway } from "../../platform/storage.ts";
import { mutateStored, withStorageLock } from "../../platform/storage-lock.ts";
import {
  ACCOUNT_CLEANUP_KEY,
  ACCOUNT_CLEANUP_PACING,
  ACCOUNT_CLEANUP_TIMING,
  accountCleanupRouteFor,
  accountCleanupRouteMatches,
  cleanupCopy,
  clearAccountCleanupTransientState,
  createAccountCleanupRun,
  createAccountCleanupToken,
  formatAccountCleanupCopy,
  normalizeAccountCleanupRun,
  readAccountCleanupTabToken,
  readActiveAccountHandle,
  sameAccountCleanupHandle,
  writeAccountCleanupTabToken,
  type AccountCleanupCategory,
  type AccountCleanupCommandResult,
  type AccountCleanupCopy,
  type AccountCleanupMode,
  type AccountCleanupRun,
  type AccountCleanupStartOptions
} from "./state.ts";
import {
  accountCleanupSleep,
  findAccountCleanupTargets,
  isAccountCleanupChallengePresent,
  performAccountCleanupTarget,
  scrollAccountCleanupForMore,
  waitForAccountCleanupValue,
  type AccountCleanupActionOutcome,
  type AccountCleanupTarget
} from "./dom.ts";

export interface AccountCleanupRunnerEvent {
  type: "status" | "progress" | "action" | "navigation" | "complete" | "blocked" | "error";
  run: AccountCleanupRun | null;
  /** English rendering of `copy`; the panel renders `copy` in the reader's language. */
  message: string;
  copy: AccountCleanupCopy;
}

export interface AccountCleanupRunnerDependencies {
  findTargets: typeof findAccountCleanupTargets;
  performTarget: typeof performAccountCleanupTarget;
  scrollForMore: typeof scrollAccountCleanupForMore;
  isChallengePresent: typeof isAccountCleanupChallengePresent;
  sleep: typeof accountCleanupSleep;
  waitForValue: typeof waitForAccountCleanupValue;
  getActiveHandle: typeof readActiveAccountHandle;
}

interface AccountCleanupRunnerOptions {
  storage: StorageGateway;
  documentObject?: Document;
  windowObject?: Window;
  locationObject?: Pick<Location, "pathname" | "assign">;
  sessionStorageObject?: Storage;
  clock?: () => number;
  random?: () => number;
  dependencies?: Partial<AccountCleanupRunnerDependencies>;
  onEvent?: (event: AccountCleanupRunnerEvent) => void;
}

interface StoreStartResult extends AccountCleanupCommandResult {
  run?: AccountCleanupRun;
}

export class AccountCleanupLockLostError extends Error {
  constructor(message = "Another X tab owns this account cleanup") {
    super(message);
    this.name = "AccountCleanupLockLostError";
  }
}

export class AccountCleanupStore {
  readonly #storage: StorageGateway;
  readonly #clock: () => number;

  constructor(storage: StorageGateway, clock: () => number = Date.now) {
    this.#storage = storage;
    this.#clock = clock;
  }

  async load(): Promise<AccountCleanupRun | null> {
    return normalizeAccountCleanupRun(await this.#storage.get<unknown>(ACCOUNT_CLEANUP_KEY, null));
  }

  async start(
    account: string,
    ownerId: string,
    mode: AccountCleanupMode,
    options: AccountCleanupStartOptions
  ): Promise<StoreStartResult> {
    let result: StoreStartResult = { ok: false, reason: "start_failed" };
    await mutateStored<unknown>(this.#storage, ACCOUNT_CLEANUP_KEY, null, (stored) => {
      const current = normalizeAccountCleanupRun(stored);
      const now = this.#clock();
      if (
        current?.status === "running" &&
        current.leaseUntil > now &&
        current.ownerId !== ownerId
      ) {
        result = { ok: false, reason: "active_in_another_tab" };
        return current;
      }

      const candidate = createAccountCleanupRun({ account, ownerId, mode, options, now });
      if (candidate.plan.length === 0) {
        result = { ok: false, reason: "no_categories" };
        return current;
      }
      result = { ok: true, run: candidate };
      return candidate;
    });
    return result;
  }

  async claim(ownerId: string, resetActions = false): Promise<StoreStartResult> {
    let result: StoreStartResult = { ok: false, reason: "nothing_to_resume" };
    await mutateStored<unknown>(this.#storage, ACCOUNT_CLEANUP_KEY, null, (stored) => {
      const current = normalizeAccountCleanupRun(stored);
      if (!current || !["running", "paused", "blocked"].includes(current.status)) return stored;
      const now = this.#clock();
      if (current.ownerId !== ownerId && current.leaseUntil > now) {
        result = { ok: false, reason: "active_in_another_tab" };
        return current;
      }
      current.ownerId = ownerId;
      current.status = "running";
      current.phase = "resuming";
      current.reason = null;
      current.finishedAt = null;
      if (resetActions) current.actionsThisSession = 0;
      current.updatedAt = now;
      current.leaseUntil = now + ACCOUNT_CLEANUP_TIMING.leaseMs;
      result = { ok: true, run: current };
      return current;
    });
    return result;
  }

  async save(run: AccountCleanupRun, ownerId: string): Promise<AccountCleanupRun> {
    let saved: AccountCleanupRun | null = null;
    await mutateStored<unknown>(this.#storage, ACCOUNT_CLEANUP_KEY, null, (stored) => {
      const current = normalizeAccountCleanupRun(stored);
      if (!current || current.id !== run.id || current.ownerId !== ownerId) {
        throw new AccountCleanupLockLostError();
      }
      const now = this.#clock();
      run.updatedAt = now;
      if (run.status === "running") run.leaseUntil = now + ACCOUNT_CLEANUP_TIMING.leaseMs;
      saved = normalizeAccountCleanupRun(run);
      return saved ?? current;
    });
    if (!saved) throw new AccountCleanupLockLostError();
    return saved;
  }

  async renew(runId: string, ownerId: string): Promise<AccountCleanupRun> {
    let renewed: AccountCleanupRun | null = null;
    await mutateStored<unknown>(this.#storage, ACCOUNT_CLEANUP_KEY, null, (stored) => {
      const current = normalizeAccountCleanupRun(stored);
      if (!current || current.id !== runId || current.ownerId !== ownerId || current.status !== "running") {
        throw new AccountCleanupLockLostError();
      }
      const now = this.#clock();
      current.leaseUntil = now + ACCOUNT_CLEANUP_TIMING.leaseMs;
      current.updatedAt = now;
      renewed = current;
      return current;
    });
    if (!renewed) throw new AccountCleanupLockLostError();
    return renewed;
  }

  async pause(ownerId: string, reason = "paused_by_user"): Promise<StoreStartResult> {
    let result: StoreStartResult = { ok: false, reason: "nothing_to_pause" };
    await mutateStored<unknown>(this.#storage, ACCOUNT_CLEANUP_KEY, null, (stored) => {
      const current = normalizeAccountCleanupRun(stored);
      if (!current || current.status !== "running") return stored;
      if (current.ownerId !== ownerId && current.leaseUntil > this.#clock()) {
        result = { ok: false, reason: "active_in_another_tab" };
        return current;
      }
      current.status = "paused";
      current.phase = "paused";
      current.reason = reason;
      current.leaseUntil = 0;
      current.updatedAt = this.#clock();
      result = { ok: true, run: current };
      return current;
    });
    return result;
  }

  async stop(ownerId: string): Promise<StoreStartResult> {
    let result: StoreStartResult = { ok: false, reason: "nothing_to_stop" };
    await mutateStored<unknown>(this.#storage, ACCOUNT_CLEANUP_KEY, null, (stored) => {
      const current = normalizeAccountCleanupRun(stored);
      if (!current || current.status === "complete" || current.status === "stopped") return stored;
      if (current.ownerId !== ownerId && current.leaseUntil > this.#clock()) {
        result = { ok: false, reason: "active_in_another_tab" };
        return current;
      }
      current.status = "stopped";
      current.phase = "stopped";
      current.reason = "stopped_by_user";
      current.finishedAt = this.#clock();
      current.updatedAt = this.#clock();
      clearAccountCleanupTransientState(current);
      result = { ok: true, run: current };
      return current;
    });
    return result;
  }

  async clear(): Promise<void> {
    await withStorageLock(ACCOUNT_CLEANUP_KEY, async (fence) => {
      await this.#storage.remove(ACCOUNT_CLEANUP_KEY, fence);
    });
  }
}

export class AccountCleanupRunner {
  readonly #store: AccountCleanupStore;
  readonly #document: Document;
  readonly #window: Window;
  readonly #location: Pick<Location, "pathname" | "assign">;
  readonly #sessionStorage: Storage | undefined;
  readonly #clock: () => number;
  readonly #random: () => number;
  readonly #dependencies: AccountCleanupRunnerDependencies;
  readonly #onEvent: (event: AccountCleanupRunnerEvent) => void;
  #abortController: AbortController | null = null;
  #renewTimer: ReturnType<typeof setInterval> | null = null;
  #runningPromise: Promise<void> | null = null;
  #ownerId: string | null = null;
  #runId: string | null = null;

  constructor(options: AccountCleanupRunnerOptions) {
    this.#clock = options.clock ?? Date.now;
    this.#store = new AccountCleanupStore(options.storage, this.#clock);
    this.#document = options.documentObject ?? document;
    this.#window = options.windowObject ?? window;
    this.#location = options.locationObject ?? location;
    this.#sessionStorage = options.sessionStorageObject;
    this.#random = options.random ?? Math.random;
    this.#dependencies = {
      findTargets: findAccountCleanupTargets,
      performTarget: performAccountCleanupTarget,
      scrollForMore: scrollAccountCleanupForMore,
      isChallengePresent: isAccountCleanupChallengePresent,
      sleep: accountCleanupSleep,
      waitForValue: waitForAccountCleanupValue,
      getActiveHandle: readActiveAccountHandle,
      ...options.dependencies
    };
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  get isRunning(): boolean {
    return this.#runningPromise !== null;
  }

  async load(): Promise<AccountCleanupRun | null> {
    return this.#store.load();
  }

  async start(
    mode: AccountCleanupMode,
    account: string,
    options: AccountCleanupStartOptions
  ): Promise<AccountCleanupCommandResult> {
    if (this.isRunning) return { ok: false, reason: "already_running" };
    const ownerId = createAccountCleanupToken();
    const result = await this.#store.start(account, ownerId, mode, options);
    if (!result.ok || !result.run) return commandResult(false, result.reason);
    this.#ownerId = ownerId;
    this.#runId = result.run.id;
    writeAccountCleanupTabToken(ownerId, this.#sessionStorage);
    this.#launch(result.run);
    return { ok: true };
  }

  async resume(options: { automatic?: boolean } = {}): Promise<AccountCleanupCommandResult> {
    if (this.isRunning) return { ok: false, reason: "already_running" };
    const current = await this.#store.load();
    if (!current || !["running", "paused", "blocked"].includes(current.status)) {
      return { ok: false, reason: "nothing_to_resume" };
    }
    const tabToken = readAccountCleanupTabToken(this.#sessionStorage);
    if (options.automatic && tabToken !== current.ownerId) {
      return { ok: false, reason: "owned_by_another_tab" };
    }
    const ownerId = tabToken === current.ownerId ? current.ownerId : createAccountCleanupToken();
    const result = await this.#store.claim(ownerId, !options.automatic);
    if (!result.ok || !result.run) return commandResult(false, result.reason);
    this.#ownerId = ownerId;
    this.#runId = result.run.id;
    writeAccountCleanupTabToken(ownerId, this.#sessionStorage);
    this.#launch(result.run);
    return { ok: true };
  }

  async pause(): Promise<AccountCleanupCommandResult> {
    const current = await this.#store.load();
    if (!current) return { ok: false, reason: "nothing_to_pause" };
    const ownerId = this.#ownerId ?? readAccountCleanupTabToken(this.#sessionStorage) ?? "";
    this.#abortController?.abort();
    const result = await this.#store.pause(ownerId);
    if (result.ok) {
      this.#stopRenewal();
      this.#emit("status", result.run ?? null, cleanupCopy("Account cleanup paused."));
    }
    return commandResult(result.ok, result.reason);
  }

  async stop(): Promise<AccountCleanupCommandResult> {
    const current = await this.#store.load();
    if (!current) return { ok: false, reason: "nothing_to_stop" };
    const ownerId = this.#ownerId ?? readAccountCleanupTabToken(this.#sessionStorage) ?? "";
    this.#abortController?.abort();
    const result = await this.#store.stop(ownerId);
    if (result.ok) {
      this.#stopRenewal();
      writeAccountCleanupTabToken(null, this.#sessionStorage);
      this.#emit("status", result.run ?? null, cleanupCopy("Account cleanup stopped."));
    }
    return commandResult(result.ok, result.reason);
  }

  async clear(): Promise<AccountCleanupCommandResult> {
    if (this.isRunning) return { ok: false, reason: "already_running" };
    await this.#store.clear();
    writeAccountCleanupTabToken(null, this.#sessionStorage);
    this.#emit("status", null, cleanupCopy("Account cleanup record cleared."));
    return { ok: true };
  }

  teardown(): void {
    this.#abortController?.abort();
    this.#abortController = null;
    this.#stopRenewal();
    this.#runningPromise = null;
  }

  #launch(run: AccountCleanupRun): void {
    this.#abortController = new AbortController();
    this.#startRenewal();
    const signal = this.#abortController.signal;
    this.#runningPromise = this.#runLoop(run, signal)
      .catch(async (error: unknown) => {
        if (isAbortError(error)) return;
        if (error instanceof AccountCleanupLockLostError) {
          this.#emit("error", await this.#store.load(), cleanupCopy("This cleanup moved to another X tab."));
          return;
        }
        await this.#blockRun("unexpected_error");
      })
      .finally(() => {
        this.#runningPromise = null;
        this.#abortController = null;
        this.#stopRenewal();
      });
  }

  async #runLoop(initialRun: AccountCleanupRun, signal: AbortSignal): Promise<void> {
    let run = initialRun;
    const activeHandle = await this.#dependencies.waitForValue(
      () => this.#dependencies.getActiveHandle(this.#document),
      { timeoutMs: 12_000, intervalMs: 250, signal }
    );
    if (!activeHandle) {
      await this.#blockRun("login_required");
      return;
    }
    if (!sameAccountCleanupHandle(activeHandle, run.account)) {
      await this.#blockRun("account_changed");
      return;
    }

    while (run.stepIndex < run.plan.length) {
      throwIfAborted(signal);
      const category = run.plan[run.stepIndex];
      if (!category) break;
      if (!accountCleanupRouteMatches(category, run.account, this.#location.pathname)) {
        run.phase = "navigating";
        run.reason = category;
        await this.#save(run);
        const nextUrl = new URL(accountCleanupRouteFor(category, run.account), "https://x.com").href;
        this.#emit(
          "navigation",
          run,
          cleanupCopy("Opening {category}.", { category })
        );
        this.#stopRenewal();
        this.#location.assign(nextUrl);
        return;
      }

      run.phase = "scanning";
      run.reason = category;
      await this.#save(run);
      this.#emit(
        "status",
        run,
        run.settings.mode === "preview"
          ? cleanupCopy("Previewing {category}.", { category })
          : cleanupCopy("Cleaning {category}.", { category })
      );
      const result = await this.#processCategory(run, category, signal);
      if (result !== "complete") return;
      const stored = await this.#store.load();
      if (!stored) throw new AccountCleanupLockLostError();
      run = stored;
      run.stepIndex += 1;
      run.phase = "category_complete";
      run.reason = category;
      await this.#save(run);
    }

    run.status = "complete";
    run.phase = "complete";
    run.reason = null;
    run.finishedAt = this.#clock();
    clearAccountCleanupTransientState(run);
    await this.#save(run);
    writeAccountCleanupTabToken(null, this.#sessionStorage);
    this.#emit(
      "complete",
      run,
      run.settings.mode === "preview"
        ? cleanupCopy("Preview complete. No X account data was changed.")
        : cleanupCopy("Selected account cleanup passes are complete.")
    );
  }

  async #processCategory(
    run: AccountCleanupRun,
    category: AccountCleanupCategory,
    signal: AbortSignal
  ): Promise<"complete" | "paused" | "blocked" | "navigating"> {
    const pacing = ACCOUNT_CLEANUP_PACING[run.settings.pacing];
    const processed = new Set(run.processed[category]);
    let idleScrolls = 0;
    let scrollsSinceAction = 0;
    let consecutiveFailures = 0;
    let handleMissingSince: number | null = null;
    const staleStreaks = new Map<string, number>();
    let actionsInBatch = run.stats[category].completed % pacing.batchSize;

    while (
      idleScrolls < ACCOUNT_CLEANUP_TIMING.idleScrollLimit &&
      scrollsSinceAction < ACCOUNT_CLEANUP_TIMING.maxScrollsWithoutAction
    ) {
      throwIfAborted(signal);
      if (this.#dependencies.isChallengePresent(this.#document, this.#location)) {
        await this.#blockRun("challenge_detected");
        return "blocked";
      }
      const activeHandle = this.#dependencies.getActiveHandle(this.#document);
      if (!activeHandle) {
        // Nothing is deleted while the account can't be read. A brief re-render recovers; a
        // handle that stays gone means the session or X's navigation changed under the run.
        handleMissingSince ??= this.#clock();
        if (this.#clock() - handleMissingSince >= ACCOUNT_CLEANUP_TIMING.missingHandleLimitMs) {
          await this.#blockRun("login_required");
          return "blocked";
        }
        await this.#dependencies.sleep(ACCOUNT_CLEANUP_TIMING.missingHandlePollMs, signal);
        continue;
      }
      handleMissingSince = null;
      if (!sameAccountCleanupHandle(activeHandle, run.account)) {
        await this.#blockRun("account_changed");
        return "blocked";
      }

      const visibleTargets = this.#dependencies.findTargets(category, run.account, this.#document);
      const targets = visibleTargets.filter((target) => !processed.has(target.id));

      if (targets.length === 0) {
        run.phase = "loading_more";
        this.#emit("progress", run, cleanupCopy("Loading more {categoryLower}.", { categoryLower: category }));
        const scrollResult = await this.#dependencies.scrollForMore({
          documentObject: this.#document,
          windowObject: this.#window,
          signal
        });
        scrollsSinceAction += 1;
        const after = this.#dependencies.findTargets(category, run.account, this.#document)
          .filter((target) => !processed.has(target.id));
        if (after.length > 0) {
          idleScrolls = 0;
          this.#emit("progress", run, cleanupCopy("{count} more {categoryLower} loaded.", { count: after.length, categoryLower: category }));
        } else if (scrollResult.changed) {
          idleScrolls = 0;
          this.#emit("progress", run, cleanupCopy("X is still loading older {categoryLower}.", { categoryLower: category }));
        } else {
          idleScrolls += 1;
          this.#emit(
            "progress",
            run,
            cleanupCopy("Checking for more {categoryLower} ({checks}/{limit}).", {
              categoryLower: category,
              checks: idleScrolls,
              limit: ACCOUNT_CLEANUP_TIMING.idleScrollLimit
            })
          );
        }
        continue;
      }

      idleScrolls = 0;
      const target = targets[0];
      if (!target) continue;
      if (
        run.settings.maxActions > 0 &&
        run.actionsThisSession >= run.settings.maxActions
      ) {
        run.status = "paused";
        run.phase = "paused";
        run.reason = "action_limit_reached";
        run.leaseUntil = 0;
        await this.#save(run);
        this.#emit("status", run, cleanupCopy("The action limit was reached. Resume to run another batch."));
        return "paused";
      }

      if (run.settings.mode === "preview") {
        processed.add(target.id);
        run.processed[category] = boundedIds(processed);
        run.stats[category].previewed += 1;
        run.actionsThisSession += 1;
        run.phase = "previewing";
        scrollsSinceAction = 0;
        await this.#save(run);
        this.#emit(
          "action",
          run,
          cleanupCopy("{category}: {count} found.", { category, count: run.stats[category].previewed })
        );
        await this.#dependencies.sleep(35, signal);
        continue;
      }

      if (category === "likes" && await this.#waitForLikeRateWindow(run, signal)) {
        return "navigating";
      }

      const delay = randomBetween(pacing.minDelayMs, pacing.maxDelayMs, this.#random);
      run.phase = "waiting";
      await this.#save(run);
      await this.#dependencies.sleep(delay, signal);
      // The pacing wait is seconds long, so the account and challenge checks at the top of the
      // loop are stale by now. Look again right before acting; a change sends the loop back to
      // those checks, which block or wait as appropriate.
      if (this.#dependencies.isChallengePresent(this.#document, this.#location)) {
        await this.#blockRun("challenge_detected");
        return "blocked";
      }
      const handleBeforeAction = this.#dependencies.getActiveHandle(this.#document);
      if (!handleBeforeAction || !sameAccountCleanupHandle(handleBeforeAction, run.account)) continue;
      run.phase = "acting";
      await this.#save(run);

      const outcome = await this.#performTarget(target, signal);
      if (outcome.status === "success") {
        processed.add(target.id);
        run.processed[category] = boundedIds(processed);
        run.stats[category].completed += 1;
        run.actionsThisSession += 1;
        if (category === "likes") {
          if (run.pageRecoveryAttempts > 0) {
            run.likeRateWindowStartedAt = null;
            run.likeRateWindowActions = 0;
          }
          this.#recordLikeRateWindowAction(run);
        }
        delete run.failures[`${category}:${target.id}`];
        run.pageRecoveryAttempts = 0;
        run.categoryVerificationPasses = 0;
        consecutiveFailures = 0;
        actionsInBatch += 1;
        scrollsSinceAction = 0;
        await this.#save(run);
        this.#emit(
          "action",
          run,
          cleanupCopy("{category}: {count} removed.", { category, count: run.stats[category].completed })
        );
        if (actionsInBatch >= pacing.batchSize) {
          actionsInBatch = 0;
          run.phase = "batch_pause";
          await this.#save(run);
          this.#emit(
            "status",
            run,
            cleanupCopy(
              "Resting for {seconds} seconds after {count} actions. Deletion continues automatically.",
              { seconds: Math.ceil(pacing.batchPauseMs / 1_000), count: pacing.batchSize }
            )
          );
          await this.#dependencies.sleep(pacing.batchPauseMs, signal);
          run.phase = "scanning";
          await this.#save(run);
          this.#emit("status", run, cleanupCopy("Continuing {category}.", { category }));
        }
        continue;
      }

      if (outcome.status === "stale") {
        // A control that detaches once is X re-rendering; the same one every time never resolves,
        // and retrying it forever at pacing speed looks like progress while nothing happens.
        const streak = (staleStreaks.get(target.id) ?? 0) + 1;
        if (streak < ACCOUNT_CLEANUP_TIMING.staleRetryLimit) {
          staleStreaks.set(target.id, streak);
          continue;
        }
      }
      staleStreaks.delete(target.id);
      if (outcome.status === "skipped") {
        processed.add(target.id);
        run.processed[category] = boundedIds(processed);
        run.stats[category].skipped += 1;
        run.pageRecoveryAttempts = 0;
        scrollsSinceAction = 0;
        await this.#save(run);
        this.#emit("action", run, cleanupCopy("One item was skipped because its expected control was missing."));
        continue;
      }

      const failureKey = `${category}:${target.id}`;
      const attempts = (run.failures[failureKey] ?? 0) + 1;
      run.failures[failureKey] = attempts;
      run.stats[category].failed += 1;
      consecutiveFailures += 1;
      await this.#save(run);
      this.#emit("action", run, cleanupCopy("An account action didn't take effect. Aviary will try it again."));
      if (consecutiveFailures >= ACCOUNT_CLEANUP_TIMING.recoveryFailureThreshold) {
        if (await this.#recoverPage(run, category, signal)) return "navigating";
        await this.#blockRun("repeated_action_failures");
        return "blocked";
      }
      await this.#dependencies.sleep(exponentialBackoff(
        consecutiveFailures,
        ACCOUNT_CLEANUP_TIMING.failureBackoffBaseMs,
        ACCOUNT_CLEANUP_TIMING.failureBackoffMaxMs
      ), signal);
    }
    if (
      run.settings.mode === "cleanup" &&
      run.categoryVerificationPasses < ACCOUNT_CLEANUP_TIMING.requiredEmptyVerificationPasses
    ) {
      run.categoryVerificationPasses += 1;
      run.processed[category] = [];
      run.pageRecoveryAttempts = 0;
      run.phase = "verification_reload";
      run.reason = category;
      await this.#save(run);
      this.#emit(
        "navigation",
        run,
        cleanupCopy("Reloading {category} from the top to verify that nothing was missed.", { category })
      );
      this.#stopRenewal();
      this.#location.assign(new URL(accountCleanupRouteFor(category, run.account), "https://x.com").href);
      return "navigating";
    }

    run.phase = "category_complete";
    run.reason = category;
    run.pageRecoveryAttempts = 0;
    run.categoryVerificationPasses = 0;
    await this.#save(run);
    this.#emit(
      "progress",
      run,
      run.settings.mode === "cleanup"
        ? cleanupCopy("Fresh verification found no more {categoryLower}.", { categoryLower: category })
        : cleanupCopy("No more {categoryLower} found.", { categoryLower: category })
    );
    return "complete";
  }

  #recordLikeRateWindowAction(run: AccountCleanupRun): void {
    const now = this.#clock();
    const startedAt = run.likeRateWindowStartedAt;
    if (startedAt === null || now >= startedAt + ACCOUNT_CLEANUP_TIMING.likeRateWindowMs) {
      run.likeRateWindowStartedAt = now;
      run.likeRateWindowActions = 0;
    }
    run.likeRateWindowActions += 1;
  }

  async #waitForLikeRateWindow(
    run: AccountCleanupRun,
    signal: AbortSignal
  ): Promise<boolean> {
    const startedAt = run.likeRateWindowStartedAt;
    if (
      startedAt === null ||
      run.likeRateWindowActions < ACCOUNT_CLEANUP_TIMING.likeRateWindowActionLimit
    ) {
      return false;
    }

    const remainingMs = startedAt + ACCOUNT_CLEANUP_TIMING.likeRateWindowMs - this.#clock();
    if (remainingMs <= 0) {
      run.likeRateWindowStartedAt = null;
      run.likeRateWindowActions = 0;
      await this.#save(run);
      return false;
    }

    const waitMs = remainingMs + ACCOUNT_CLEANUP_TIMING.rateWindowGraceMs;
    run.phase = "rate_limit_wait";
    run.reason = "likes";
    await this.#save(run);
    this.#emit(
      "status",
      run,
      likeWindowCopy(remainingMs)
    );
    await this.#dependencies.sleep(waitMs, signal);
    run.likeRateWindowStartedAt = null;
    run.likeRateWindowActions = 0;
    run.phase = "recovering";
    await this.#save(run);
    this.#emit("navigation", run, cleanupCopy("Reloading Likes for the next X rate window."));
    this.#stopRenewal();
    this.#location.assign(new URL(this.#location.pathname, "https://x.com").href);
    return true;
  }

  async #recoverPage(
    run: AccountCleanupRun,
    category: AccountCleanupCategory,
    signal: AbortSignal
  ): Promise<boolean> {
    if (run.pageRecoveryAttempts >= ACCOUNT_CLEANUP_TIMING.maxPageRecoveryAttempts) return false;
    run.pageRecoveryAttempts += 1;
    run.phase = "recovery_wait";
    run.reason = category;
    await this.#save(run);
    const waitMs = exponentialBackoff(
      run.pageRecoveryAttempts,
      ACCOUNT_CLEANUP_TIMING.recoveryPauseBaseMs,
      ACCOUNT_CLEANUP_TIMING.recoveryPauseMaxMs
    );
    this.#emit(
      "status",
      run,
      cleanupCopy(
        "X did not apply the action twice. Waiting {seconds} seconds before reloading {category} ({attempt}/{max}).",
        {
          seconds: Math.ceil(waitMs / 1_000),
          category,
          attempt: run.pageRecoveryAttempts,
          max: ACCOUNT_CLEANUP_TIMING.maxPageRecoveryAttempts
        }
      )
    );
    await this.#dependencies.sleep(waitMs, signal);
    run.phase = "recovering";
    await this.#save(run);
    this.#emit(
      "navigation",
      run,
      cleanupCopy("Reloading {category} now. Deletion continues automatically.", { category })
    );
    this.#stopRenewal();
    this.#location.assign(new URL(this.#location.pathname, "https://x.com").href);
    return true;
  }

  async #performTarget(
    target: AccountCleanupTarget,
    signal: AbortSignal
  ): Promise<AccountCleanupActionOutcome> {
    try {
      return await this.#dependencies.performTarget(target, {
        documentObject: this.#document,
        windowObject: this.#window,
        signal
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        status: "failed",
        reason: error instanceof Error ? error.message.slice(0, 120) : "unknown_error"
      };
    }
  }

  async #blockRun(reason: string): Promise<void> {
    const run = await this.#store.load();
    if (!run || !this.#ownerId) return;
    run.status = "blocked";
    run.phase = "blocked";
    run.reason = reason;
    run.leaseUntil = 0;
    try {
      await this.#save(run);
    } catch (error) {
      if (!(error instanceof AccountCleanupLockLostError)) throw error;
    }
    this.#stopRenewal();
    this.#emit("blocked", run, blockMessage(reason));
  }

  async #save(run: AccountCleanupRun): Promise<AccountCleanupRun> {
    if (!this.#ownerId) throw new AccountCleanupLockLostError();
    return this.#store.save(run, this.#ownerId);
  }

  #startRenewal(): void {
    this.#stopRenewal();
    this.#renewTimer = globalThis.setInterval(() => {
      if (!this.#runId || !this.#ownerId) return;
      void this.#store.renew(this.#runId, this.#ownerId).catch(async (error: unknown) => {
        this.#abortController?.abort();
        this.#emit(
          "error",
          await this.#store.load(),
          error instanceof AccountCleanupLockLostError
            ? cleanupCopy("This cleanup moved to another X tab.")
            : cleanupCopy("The account cleanup lock could not be renewed.")
        );
      });
    }, ACCOUNT_CLEANUP_TIMING.leaseRenewMs);
  }

  #stopRenewal(): void {
    if (this.#renewTimer !== null) globalThis.clearInterval(this.#renewTimer);
    this.#renewTimer = null;
  }

  #emit(
    type: AccountCleanupRunnerEvent["type"],
    run: AccountCleanupRun | null,
    copy: AccountCleanupCopy
  ): void {
    this.#onEvent({ type, run, message: formatAccountCleanupCopy(copy), copy });
  }
}

function boundedIds(ids: Set<string>): string[] {
  return [...ids].slice(-5_000);
}

function randomBetween(minimum: number, maximum: number, random: () => number): number {
  return Math.round(minimum + (maximum - minimum) * random());
}

function exponentialBackoff(attempt: number, base: number, maximum: number): number {
  return Math.min(maximum, base * (2 ** Math.max(0, attempt - 1)));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Account cleanup was interrupted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function blockMessage(reason: string): AccountCleanupCopy {
  switch (reason) {
    case "account_changed":
      return cleanupCopy("The signed-in account changed. No further actions were taken.");
    case "challenge_detected":
      return cleanupCopy("X displayed a login or anti-abuse challenge. Complete it, then resume.");
    case "login_required":
      return cleanupCopy("Sign in to X, then resume.");
    case "repeated_action_failures":
      return cleanupCopy("X did not apply the action after five automatic page reloads. Resume to try again.");
    case "unexpected_error":
      return cleanupCopy("An unexpected error stopped the account cleanup.");
    default:
      return cleanupCopy("The account cleanup is blocked and needs attention.");
  }
}

/** Whole sentences per unit, so a translation never has to assemble a plural from parts. */
function likeWindowCopy(milliseconds: number): AccountCleanupCopy {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1_000));
  if (seconds < 60) {
    return cleanupCopy(
      "X's 500-action Like limit was reached. Waiting {seconds} seconds for the next window. Deletion continues automatically.",
      { seconds }
    );
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1
    ? cleanupCopy("X's 500-action Like limit was reached. Waiting 1 minute for the next window. Deletion continues automatically.")
    : cleanupCopy(
      "X's 500-action Like limit was reached. Waiting {minutes} minutes for the next window. Deletion continues automatically.",
      { minutes }
    );
}

function commandResult(ok: boolean, reason: string | undefined): AccountCleanupCommandResult {
  return reason ? { ok, reason } : { ok };
}
