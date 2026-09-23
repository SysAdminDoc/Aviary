import type { FeatureContext, FeatureModule, FeatureStatus } from "../registry.ts";
import { AccountCleanupRunner, type AccountCleanupRunnerEvent } from "./runner.ts";
import {
  ACCOUNT_CLEANUP_CATEGORIES,
  cleanupCopy,
  formatAccountCleanupCopy,
  readAccountCleanupTabToken,
  readActiveAccountHandle,
  sameAccountCleanupHandle,
  type AccountCleanupCommandResult,
  type AccountCleanupCopy,
  type AccountCleanupRun,
  type AccountCleanupStartOptions,
  type AccountCleanupStatus
} from "./state.ts";

const EMPTY_STATUS: AccountCleanupStatus = {
  activeHandle: null,
  run: null,
  runningInThisTab: false,
  message: "Ready.",
  copy: cleanupCopy("Ready.")
};

class AccountCleanupController {
  readonly #ctx: FeatureContext;
  readonly #runner: AccountCleanupRunner;
  #run: AccountCleanupRun | null = null;
  #copy: AccountCleanupCopy = EMPTY_STATUS.copy;

  constructor(ctx: FeatureContext) {
    this.#ctx = ctx;
    this.#runner = new AccountCleanupRunner({
      storage: ctx.storage,
      onEvent: (event) => this.#handleEvent(event)
    });
  }

  async init(): Promise<void> {
    this.#run = await this.#runner.load();
    this.#copy = describeRun(this.#run);
    if (
      this.#run?.status === "running" &&
      readAccountCleanupTabToken() === this.#run.ownerId
    ) {
      const result = await this.#runner.resume({ automatic: true });
      if (!result.ok) this.#copy = commandFailureMessage(result.reason);
    }
  }

  status(): AccountCleanupStatus {
    const activeHandle = readActiveAccountHandle();
    return {
      activeHandle,
      run: this.#run,
      runningInThisTab: this.#runner.isRunning,
      message: formatAccountCleanupCopy(this.#copy),
      copy: this.#copy
    };
  }

  async cleanup(options: AccountCleanupStartOptions): Promise<AccountCleanupCommandResult> {
    const account = readActiveAccountHandle();
    if (!account) return this.#fail("login_required");
    const result = await this.#runner.start("cleanup", account, options);
    await this.#afterCommand(result);
    if (result.ok) {
      void this.#ctx.auditLog.record("account.cleanup.start", {
        account,
        categories: selectedCategories(options),
        pacing: options.pacing,
        maxActions: options.maxActions
      });
    }
    return result;
  }

  async pause(): Promise<AccountCleanupCommandResult> {
    const result = await this.#runner.pause();
    await this.#afterCommand(result);
    return result;
  }

  async resume(): Promise<AccountCleanupCommandResult> {
    const result = await this.#runner.resume();
    await this.#afterCommand(result);
    if (result.ok) void this.#ctx.auditLog.record("account.cleanup.resume");
    return result;
  }

  async stop(): Promise<AccountCleanupCommandResult> {
    const result = await this.#runner.stop();
    await this.#afterCommand(result);
    if (result.ok) void this.#ctx.auditLog.record("account.cleanup.stop");
    return result;
  }

  destroy(): void {
    this.#runner.teardown();
  }

  #fail(reason: string): AccountCleanupCommandResult {
    this.#copy = commandFailureMessage(reason);
    this.#ctx.refreshControlCenter?.();
    return { ok: false, reason };
  }

  async #afterCommand(result: AccountCleanupCommandResult): Promise<void> {
    this.#run = await this.#runner.load();
    if (!result.ok) this.#copy = commandFailureMessage(result.reason);
    else if (this.#run) this.#copy = describeRun(this.#run);
    this.#ctx.refreshControlCenter?.();
  }

  #handleEvent(event: AccountCleanupRunnerEvent): void {
    this.#run = event.run;
    this.#copy = event.copy;
    if (event.type === "blocked" || event.type === "error") {
      this.#ctx.diagnostics.warn("Account cleanup paused", {
        reason: event.run?.reason ?? "runner_error"
      });
    }
    if (event.type === "complete" && event.run) {
      const totals = Object.fromEntries(
        ACCOUNT_CLEANUP_CATEGORIES.map((category) => {
          const stats = event.run?.stats[category];
          return [category, event.run?.settings.mode === "preview"
            ? stats?.previewed ?? 0
            : stats?.completed ?? 0];
        })
      );
      void this.#ctx.auditLog.record(
        event.run.settings.mode === "preview"
          ? "account.cleanup.preview.complete"
          : "account.cleanup.complete",
        { account: event.run.account, totals }
      );
    }
    this.#ctx.refreshControlCenter?.();
  }
}

let controller: AccountCleanupController | undefined;

export const accountCleanupFeature: FeatureModule = {
  id: "account.cleanup",
  title: "Account Cleanup",
  category: "privacy",

  async init(ctx) {
    controller?.destroy();
    controller = new AccountCleanupController(ctx);
    await controller.init();
    ctx.diagnostics.info("Account Cleanup initialized");
  },

  destroy(ctx) {
    controller?.destroy();
    controller = undefined;
    ctx.diagnostics.info("Account Cleanup destroyed");
  },

  getStatus(): FeatureStatus {
    const status = controller?.status() ?? EMPTY_STATUS;
    return {
      ok: status.run?.status !== "blocked",
      message: status.message,
      details: {
        status: status.run?.status ?? "idle",
        mode: status.run?.settings.mode ?? null,
        accountMatched: status.run
          ? sameAccountCleanupHandle(status.activeHandle, status.run.account)
          : null
      }
    };
  }
};

export function getAccountCleanupStatus(): AccountCleanupStatus {
  return controller?.status() ?? EMPTY_STATUS;
}

export function startAccountCleanup(
  options: AccountCleanupStartOptions
): Promise<AccountCleanupCommandResult> {
  return controller?.cleanup(options) ?? Promise.resolve({ ok: false, reason: "not_ready" });
}

export function pauseAccountCleanup(): Promise<AccountCleanupCommandResult> {
  return controller?.pause() ?? Promise.resolve({ ok: false, reason: "not_ready" });
}

export function resumeAccountCleanup(): Promise<AccountCleanupCommandResult> {
  return controller?.resume() ?? Promise.resolve({ ok: false, reason: "not_ready" });
}

export function stopAccountCleanup(): Promise<AccountCleanupCommandResult> {
  return controller?.stop() ?? Promise.resolve({ ok: false, reason: "not_ready" });
}

function selectedCategories(options: AccountCleanupStartOptions): string[] {
  return ACCOUNT_CLEANUP_CATEGORIES.filter((category) => options.categories[category]);
}

function describeRun(run: AccountCleanupRun | null): AccountCleanupCopy {
  if (!run) return EMPTY_STATUS.copy;
  if (run.status === "complete") {
    return run.settings.mode === "preview"
      ? cleanupCopy("Preview complete. No X account data was changed.")
      : cleanupCopy("Deletion complete.");
  }
  if (run.status === "paused") {
    return run.reason === "action_limit_reached"
      ? cleanupCopy("The action limit was reached. Resume to run another batch.")
      : cleanupCopy("Deletion paused.");
  }
  if (run.status === "blocked") return commandFailureMessage(run.reason);
  if (run.status === "stopped") return cleanupCopy("Deletion stopped.");
  return run.settings.mode === "preview"
    ? cleanupCopy("Preview is running.")
    : cleanupCopy("Deletion is running.");
}

/** Every literal goes through `cleanupCopy` so the i18n extractor can find and require it. */
function commandFailureMessage(reason: string | undefined | null): AccountCleanupCopy {
  switch (reason) {
    case "account_changed":
      return cleanupCopy("The signed-in account changed. No further actions were taken.");
    case "active_in_another_tab":
      return cleanupCopy("Another X tab is already running this deletion.");
    case "already_running":
      return cleanupCopy("This tab is already running a deletion.");
    case "challenge_detected":
      return cleanupCopy("X displayed a login or anti-abuse challenge. Complete it, then resume.");
    case "login_required":
      return cleanupCopy("Sign in to X before running.");
    case "no_categories":
      return cleanupCopy("Select at least one account category.");
    case "nothing_to_pause":
      return cleanupCopy("There is no running deletion to pause.");
    case "nothing_to_resume":
      return cleanupCopy("There is no paused deletion to resume.");
    case "nothing_to_stop":
      return cleanupCopy("There is no deletion to stop.");
    case "not_ready":
      return cleanupCopy("Delete X activity is still loading.");
    case "owned_by_another_tab":
      return cleanupCopy("Resume this deletion from the X tab that started it.");
    case "repeated_action_failures":
      return cleanupCopy("X did not apply the action after five automatic page reloads. Resume to try again.");
    case "unexpected_error":
      return cleanupCopy("An unexpected error stopped the deletion.");
    default:
      return cleanupCopy("The deletion command could not be completed.");
  }
}
