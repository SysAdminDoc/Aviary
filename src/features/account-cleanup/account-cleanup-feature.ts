import type { FeatureContext, FeatureModule, FeatureStatus } from "../registry.ts";
import { AccountCleanupRunner, type AccountCleanupRunnerEvent } from "./runner.ts";
import {
  ACCOUNT_CLEANUP_CATEGORIES,
  readAccountCleanupTabToken,
  readActiveAccountHandle,
  sameAccountCleanupHandle,
  type AccountCleanupCommandResult,
  type AccountCleanupRun,
  type AccountCleanupStartOptions,
  type AccountCleanupStatus
} from "./state.ts";

interface AccountCleanupDestructiveStartOptions extends AccountCleanupStartOptions {
  previewId: string;
  acknowledgement: string;
}

const EMPTY_STATUS: AccountCleanupStatus = {
  activeHandle: null,
  run: null,
  runningInThisTab: false,
  message: "No account cleanup has run."
};

class AccountCleanupController {
  readonly #ctx: FeatureContext;
  readonly #runner: AccountCleanupRunner;
  #run: AccountCleanupRun | null = null;
  #message = EMPTY_STATUS.message;

  constructor(ctx: FeatureContext) {
    this.#ctx = ctx;
    this.#runner = new AccountCleanupRunner({
      storage: ctx.storage,
      onEvent: (event) => this.#handleEvent(event)
    });
  }

  async init(): Promise<void> {
    this.#run = await this.#runner.load();
    this.#message = describeRun(this.#run);
    if (
      this.#run?.status === "running" &&
      readAccountCleanupTabToken() === this.#run.ownerId
    ) {
      const result = await this.#runner.resume({ automatic: true });
      if (!result.ok) this.#message = commandFailureMessage(result.reason);
    }
  }

  status(): AccountCleanupStatus {
    const activeHandle = readActiveAccountHandle();
    return {
      activeHandle,
      run: this.#run,
      runningInThisTab: this.#runner.isRunning,
      message: this.#message
    };
  }

  async preview(options: AccountCleanupStartOptions): Promise<AccountCleanupCommandResult> {
    const account = readActiveAccountHandle();
    if (!account) return this.#fail("login_required");
    const result = await this.#runner.start("preview", account, options);
    await this.#afterCommand(result);
    if (result.ok) {
      void this.#ctx.auditLog.record("account.cleanup.preview", {
        account,
        categories: selectedCategories(options),
        maxActions: options.maxActions
      });
    }
    return result;
  }

  async cleanup(options: AccountCleanupDestructiveStartOptions): Promise<AccountCleanupCommandResult> {
    const account = readActiveAccountHandle();
    if (!account) return this.#fail("login_required");
    if (options.acknowledgement.trim() !== `DELETE @${account}`) {
      return this.#fail("acknowledgement_mismatch");
    }
    if (!this.#run || !sameAccountCleanupHandle(this.#run.account, account)) {
      return this.#fail("preview_required");
    }
    const result = await this.#runner.start("cleanup", account, options, {
      previewId: options.previewId
    });
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

  async clear(): Promise<AccountCleanupCommandResult> {
    const result = await this.#runner.clear();
    await this.#afterCommand(result);
    return result;
  }

  destroy(): void {
    this.#runner.teardown();
  }

  #fail(reason: string): AccountCleanupCommandResult {
    this.#message = commandFailureMessage(reason);
    this.#ctx.refreshControlCenter?.();
    return { ok: false, reason };
  }

  async #afterCommand(result: AccountCleanupCommandResult): Promise<void> {
    this.#run = await this.#runner.load();
    if (!result.ok) this.#message = commandFailureMessage(result.reason);
    else if (this.#run) this.#message = describeRun(this.#run);
    this.#ctx.refreshControlCenter?.();
  }

  #handleEvent(event: AccountCleanupRunnerEvent): void {
    this.#run = event.run;
    this.#message = event.message;
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

export function startAccountCleanupPreview(
  options: AccountCleanupStartOptions
): Promise<AccountCleanupCommandResult> {
  return controller?.preview(options) ?? Promise.resolve({ ok: false, reason: "not_ready" });
}

export function startAccountCleanup(
  options: AccountCleanupDestructiveStartOptions
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

export function clearAccountCleanupRecord(): Promise<AccountCleanupCommandResult> {
  return controller?.clear() ?? Promise.resolve({ ok: false, reason: "not_ready" });
}

function selectedCategories(options: AccountCleanupStartOptions): string[] {
  return ACCOUNT_CLEANUP_CATEGORIES.filter((category) => options.categories[category]);
}

function describeRun(run: AccountCleanupRun | null): string {
  if (!run) return EMPTY_STATUS.message;
  if (run.status === "complete") {
    return run.settings.mode === "preview"
      ? "Preview complete. No X account data was changed."
      : "Selected account cleanup passes are complete.";
  }
  if (run.status === "paused") {
    return run.reason === "action_limit_reached"
      ? "The action limit was reached. Resume to run another batch."
      : "Account cleanup paused.";
  }
  if (run.status === "blocked") return commandFailureMessage(run.reason);
  if (run.status === "stopped") return "Account cleanup stopped.";
  return run.settings.mode === "preview" ? "Preview is running." : "Account cleanup is running.";
}

function commandFailureMessage(reason: string | undefined | null): string {
  const messages: Record<string, string> = {
    acknowledgement_mismatch: "Type the account-specific acknowledgement exactly as shown.",
    account_changed: "The signed-in account changed. No further actions were taken.",
    active_in_another_tab: "Another X tab is already running this account cleanup.",
    already_running: "This tab is already running an account cleanup.",
    challenge_detected: "X displayed a login or anti-abuse challenge. Complete it, then resume.",
    login_required: "Sign in to X before starting account cleanup.",
    no_categories: "Select at least one account category.",
    nothing_to_pause: "There is no running account cleanup to pause.",
    nothing_to_resume: "There is no paused account cleanup to resume.",
    nothing_to_stop: "There is no account cleanup to stop.",
    not_ready: "Account Cleanup is still loading.",
    owned_by_another_tab: "Resume this cleanup from the X tab that started it.",
    preview_required: "Run and finish a matching preview before deleting account data.",
    repeated_action_failures: "Several actions failed in a row. X may have changed its page controls.",
    unexpected_error: "An unexpected error stopped the account cleanup."
  };
  return messages[reason ?? ""] ?? "The account cleanup command could not be completed.";
}
