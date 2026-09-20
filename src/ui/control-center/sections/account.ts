import {
  ACCOUNT_CLEANUP_CATEGORIES,
  ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS,
  accountCleanupPlansMatch,
  sameAccountCleanupHandle,
  type AccountCleanupCommandResult,
  type AccountCleanupRun,
  type AccountCleanupStartOptions
} from "../../../features/account-cleanup/state.ts";
import type { PanelContext } from "../panel-context.ts";

export function buildAccountCleanupRows(ctx: PanelContext): HTMLElement[] {
  const status = ctx.options.getAccountCleanupStatus?.();
  const run = status?.run ?? null;
  const selectedPlan = ACCOUNT_CLEANUP_CATEGORIES.filter(
    (category) => ctx.state.accountCleanupCategories[category]
  );
  const hasSelection = selectedPlan.length > 0;
  const activeJob = run?.status === "running" || run?.status === "paused" || run?.status === "blocked";
  const previewReady = Boolean(
    run &&
    run.status === "complete" &&
    run.settings.mode === "preview" &&
    sameAccountCleanupHandle(run.account, status?.activeHandle ?? null) &&
    accountCleanupPlansMatch(run.plan, selectedPlan)
  );
  const acknowledgement = status?.activeHandle
    ? `DELETE @${status.activeHandle}`
    : "";
  const acknowledgementMatches = previewReady &&
    ctx.state.accountCleanupAcknowledgement.trim() === acknowledgement;

  return [
    safetyNotice(ctx),
    ctx.dataRow("Signed-in X account", status?.activeHandle ? `@${status.activeHandle}` : "Not detected"),
    ctx.dataRow("Cleanup status", status?.message ?? "Account Cleanup is still loading."),
    ...(run ? [
      ctx.dataRow("Current pass", describePass(run.settings.mode, run.status, run.stepIndex, run.plan.length)),
      ctx.dataRow("Pass totals", describeTotals(run))
    ] : []),
    categoryPicker(ctx, activeJob),
    pacingRow(ctx, activeJob),
    actionLimitRow(ctx, activeJob),
    actionWorkspace(ctx, {
      activeJob,
      acknowledgement,
      acknowledgementMatches,
      hasSelection,
      previewReady,
      runId: run?.id ?? "",
      runStatus: run?.status ?? null
    })
  ];
}

function safetyNotice(ctx: PanelContext): HTMLElement {
  const row = ctx.el("div", "av-cleanup-notice");
  const title = ctx.el("strong", "av-cleanup-notice-title", ctx.t("Preview first. Delete only when the count looks right."));
  const body = ctx.el(
    "span",
    "av-cleanup-notice-copy",
    ctx.t("Deleting posts and replies cannot be undone. Aviary checks the signed-in account before every pass, stops on X challenges, and never stores post text in cleanup history.")
  );
  row.append(title, body);
  return row;
}

function categoryPicker(ctx: PanelContext, disabled: boolean): HTMLElement {
  const fieldset = ctx.el("fieldset", "av-row av-row-stack av-cleanup-categories");
  fieldset.dataset.avLabel = "What to clean";
  const legend = ctx.el("legend", "av-row-label", ctx.t("What to clean"));
  const description = ctx.el(
    "span",
    "av-row-description",
    ctx.t("Run order is bookmarks, likes, reposts, replies, then posts so references are removed before authored content.")
  );
  const choices = ctx.el("div", "av-cleanup-category-grid");
  for (const category of ACCOUNT_CLEANUP_CATEGORIES) {
    const definition = ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS[category];
    const choice = ctx.el("label", "av-cleanup-category");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = ctx.state.accountCleanupCategories[category];
    input.disabled = disabled;
    input.addEventListener("change", () => {
      ctx.state.accountCleanupCategories[category] = input.checked;
      ctx.state.accountCleanupAcknowledgement = "";
      ctx.render();
    });
    const copy = ctx.el("span", "av-cleanup-category-copy");
    copy.append(
      ctx.el("strong", "av-cleanup-category-title", ctx.t(definition.label)),
      ctx.el("span", "av-cleanup-category-description", ctx.t(definition.description))
    );
    choice.append(input, copy);
    choices.append(choice);
  }
  fieldset.append(legend, description, choices);
  return fieldset;
}

function pacingRow(ctx: PanelContext, disabled: boolean): HTMLElement {
  const row = ctx.selectRow(
    "Cleanup pacing",
    ctx.state.accountCleanupPacing,
    [
      ["careful", "Careful"],
      ["balanced", "Balanced"],
      ["brisk", "Brisk"]
    ],
    async (value) => {
      if (value === "careful" || value === "balanced" || value === "brisk") {
        ctx.state.accountCleanupPacing = value;
        ctx.state.accountCleanupAcknowledgement = "";
      }
    },
    "Adds a randomized delay between account actions and longer rests after each batch.",
    true,
    "action"
  );
  const select = row.querySelector<HTMLSelectElement>("select");
  if (select) select.disabled = disabled;
  return row;
}

function actionLimitRow(ctx: PanelContext, disabled: boolean): HTMLElement {
  const row = ctx.el("label", "av-row");
  row.dataset.avLabel = "Actions per batch";
  const copy = ctx.el("span", "av-row-copy");
  copy.append(
    ctx.el("span", "av-row-label", ctx.t("Actions per batch")),
    ctx.el("span", "av-row-description", ctx.t("Pause after this many matches. Use 0 for no limit. Resume starts a fresh batch."))
  );
  const input = document.createElement("input");
  input.type = "number";
  input.className = "av-cleanup-number";
  input.min = "0";
  input.max = "100000";
  input.step = "1";
  input.value = String(ctx.state.accountCleanupMaxActions);
  input.disabled = disabled;
  input.setAttribute("aria-label", ctx.t("Actions per batch"));
  input.addEventListener("input", () => {
    const numeric = Number(input.value);
    ctx.state.accountCleanupMaxActions = Number.isFinite(numeric)
      ? Math.min(100_000, Math.max(0, Math.trunc(numeric)))
      : 0;
    ctx.state.accountCleanupAcknowledgement = "";
  });
  row.append(copy, input);
  return row;
}

function actionWorkspace(ctx: PanelContext, input: {
  activeJob: boolean;
  acknowledgement: string;
  acknowledgementMatches: boolean;
  hasSelection: boolean;
  previewReady: boolean;
  runId: string;
  runStatus: "running" | "paused" | "blocked" | "complete" | "stopped" | null;
}): HTMLElement {
  const workspace = ctx.el("div", "av-cleanup-workspace");
  workspace.dataset.avLabel = "Account cleanup controls";

  const preview = ctx.button("Preview selected", "av-button av-button-secondary");
  preview.type = "button";
  preview.disabled = input.activeJob || !input.hasSelection || !ctx.options.startAccountCleanupPreview;
  preview.addEventListener("click", () => {
    void runCommand(ctx, "Starting account preview…", async () => {
      const result = await ctx.options.startAccountCleanupPreview?.(startOptions(ctx));
      return result ?? { ok: false, reason: "not_ready" };
    });
  });

  const controls = ctx.el("div", "av-cleanup-buttons");
  controls.append(preview);
  if (input.runStatus === "running") {
    const pause = ctx.button("Pause", "av-button av-button-secondary");
    pause.type = "button";
    pause.disabled = !ctx.options.pauseAccountCleanup;
    pause.addEventListener("click", () => {
      void runCommand(ctx, "Pausing account cleanup…", () => invoke(ctx.options.pauseAccountCleanup));
    });
    controls.append(pause);
  }
  if (input.runStatus === "paused" || input.runStatus === "blocked") {
    const resume = ctx.button("Resume", "av-button av-button-secondary");
    resume.type = "button";
    resume.disabled = !ctx.options.resumeAccountCleanup;
    resume.addEventListener("click", () => {
      void runCommand(ctx, "Resuming account cleanup…", () => invoke(ctx.options.resumeAccountCleanup));
    });
    controls.append(resume);
  }
  if (input.activeJob) {
    const stop = ctx.button("Stop pass", "av-button av-button-secondary");
    stop.type = "button";
    stop.disabled = !ctx.options.stopAccountCleanup;
    stop.addEventListener("click", () => {
      void runCommand(ctx, "Stopping account cleanup…", () => invoke(ctx.options.stopAccountCleanup));
    });
    controls.append(stop);
  }

  const gate = ctx.el("div", "av-cleanup-gate");
  const gateCopy = input.previewReady
    ? ctx.localizedCopy("Preview is complete for @{handle}. Type {phrase} to enable deletion.", {
        handle: ctx.options.getAccountCleanupStatus?.().activeHandle ?? "",
        phrase: input.acknowledgement
      })
    : ctx.t("Finish a preview with the same categories before deletion is available.");
  gate.append(ctx.el("span", "av-row-description", gateCopy));

  const acknowledgementInput = document.createElement("input");
  acknowledgementInput.type = "text";
  acknowledgementInput.className = "av-text-input av-cleanup-acknowledgement";
  acknowledgementInput.value = ctx.state.accountCleanupAcknowledgement;
  acknowledgementInput.placeholder = input.acknowledgement || ctx.t("Signed-in account required");
  acknowledgementInput.disabled = !input.previewReady || input.activeJob;
  acknowledgementInput.spellcheck = false;
  acknowledgementInput.autocomplete = "off";
  acknowledgementInput.setAttribute("aria-label", ctx.t("Deletion acknowledgement"));

  const cleanup = ctx.button("Delete selected account data", "av-button av-button-danger");
  cleanup.type = "button";
  cleanup.disabled = !input.acknowledgementMatches || input.activeJob || !ctx.options.startAccountCleanup;
  acknowledgementInput.addEventListener("input", () => {
    ctx.state.accountCleanupAcknowledgement = acknowledgementInput.value;
    cleanup.disabled = acknowledgementInput.value.trim() !== input.acknowledgement || input.activeJob;
  });
  cleanup.addEventListener("click", () => {
    void runCommand(ctx, "Starting account cleanup…", async () => {
      const result = await ctx.options.startAccountCleanup?.({
        ...startOptions(ctx),
        previewId: input.runId,
        acknowledgement: ctx.state.accountCleanupAcknowledgement
      });
      return result ?? { ok: false, reason: "not_ready" };
    });
  });
  const destructiveControls = ctx.el("div", "av-cleanup-destructive-controls");
  destructiveControls.append(acknowledgementInput, cleanup);
  gate.append(destructiveControls);

  if (!input.activeJob && input.runStatus !== null) {
    const clear = ctx.button("Clear cleanup record", "av-button av-button-secondary");
    clear.type = "button";
    clear.disabled = !ctx.options.clearAccountCleanupRecord;
    clear.addEventListener("click", () => {
      ctx.state.accountCleanupAcknowledgement = "";
      void runCommand(ctx, "Clearing account cleanup record…", () => invoke(ctx.options.clearAccountCleanupRecord));
    });
    controls.append(clear);
  }

  workspace.append(controls, gate);
  return workspace;
}

function startOptions(ctx: PanelContext): AccountCleanupStartOptions {
  return {
    categories: { ...ctx.state.accountCleanupCategories },
    pacing: ctx.state.accountCleanupPacing,
    maxActions: ctx.state.accountCleanupMaxActions
  };
}

async function runCommand(
  ctx: PanelContext,
  pendingMessage: string,
  command: () => Promise<AccountCleanupCommandResult>
): Promise<void> {
  ctx.setStatus(pendingMessage);
  try {
    const result = await command();
    const status = ctx.options.getAccountCleanupStatus?.();
    ctx.setStatus(status?.message ?? (result.ok ? "Account cleanup updated." : "Account cleanup command failed."));
    ctx.render();
  } catch (error) {
    ctx.options.onError("Account cleanup command failed", error);
    ctx.setStatus("Account cleanup command failed.");
  }
}

function invoke(
  command: (() => Promise<AccountCleanupCommandResult>) | undefined
): Promise<AccountCleanupCommandResult> {
  return command?.() ?? Promise.resolve({ ok: false, reason: "not_ready" });
}

function describePass(
  mode: "preview" | "cleanup",
  status: string,
  stepIndex: number,
  totalSteps: number
): string {
  const label = mode === "preview" ? "Preview" : "Cleanup";
  return `${label} · ${status} · ${Math.min(stepIndex + 1, totalSteps)}/${totalSteps}`;
}

function describeTotals(run: AccountCleanupRun): string {
  return run.plan.map((category) => {
    const stats = run.stats[category];
    const count = run.settings.mode === "preview" ? stats.previewed : stats.completed;
    return `${ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS[category].label} ${count}`;
  }).join(" · ");
}
