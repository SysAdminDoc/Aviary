import {
  ACCOUNT_CLEANUP_CATEGORIES,
  ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS,
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

  return [
    categoryPicker(ctx, activeJob),
    actionWorkspace(ctx, {
      activeJob,
      activeHandle: status?.activeHandle ?? null,
      hasSelection,
      run,
      runStatus: run?.status ?? null,
      statusMessage: status?.message ?? "Delete X activity is still loading."
    }),
    advancedOptions(ctx, activeJob)
  ];
}

function categoryPicker(ctx: PanelContext, disabled: boolean): HTMLElement {
  const fieldset = ctx.el("fieldset", "av-row av-row-stack av-cleanup-categories");
  fieldset.dataset.avLabel = "What to delete";
  const legend = ctx.el("legend", "av-row-label", ctx.t("What to delete"));
  const description = ctx.el(
    "span",
    "av-row-description",
    ctx.t("Selected activity is removed in this order: bookmarks, likes, reposts, replies, posts.")
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
    "Speed",
    ctx.state.accountCleanupPacing,
    [
      ["careful", "Careful"],
      ["balanced", "Balanced"],
      ["brisk", "Brisk"]
    ],
    async (value) => {
      if (value === "careful" || value === "balanced" || value === "brisk") {
        ctx.state.accountCleanupPacing = value;
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
  });
  row.append(copy, input);
  return row;
}

function advancedOptions(ctx: PanelContext, disabled: boolean): HTMLElement {
  const details = ctx.el("details", "av-cleanup-advanced");
  details.dataset.avLabel = "Advanced options";
  const summary = ctx.el("summary", "av-cleanup-advanced-summary");
  const copy = ctx.el("span", "av-cleanup-advanced-copy");
  copy.append(
    ctx.el("strong", "av-cleanup-advanced-title", ctx.t("Advanced options")),
    ctx.el(
      "span",
      "av-cleanup-advanced-description",
      ctx.t("Change deletion speed or pause after a set number of actions.")
    )
  );
  summary.append(copy);
  const body = ctx.el("div", "av-cleanup-advanced-body");
  body.append(pacingRow(ctx, disabled), actionLimitRow(ctx, disabled));
  details.append(summary, body);
  return details;
}

function actionWorkspace(ctx: PanelContext, input: {
  activeJob: boolean;
  activeHandle: string | null;
  hasSelection: boolean;
  run: AccountCleanupRun | null;
  runStatus: "running" | "paused" | "blocked" | "complete" | "stopped" | null;
  statusMessage: string;
}): HTMLElement {
  const workspace = ctx.el("div", "av-cleanup-workspace");
  workspace.dataset.avLabel = "Run";

  const status = input.run
    ? `${input.statusMessage} ${describeTotals(input.run)}`
    : input.activeHandle
      ? ctx.localizedCopy("Ready to run on @{handle}.", { handle: input.activeHandle })
      : ctx.t("Sign in to X before running.");
  const needsSelection = !input.activeJob && !input.hasSelection;
  // "Ready to run" beside a disabled Run contradicts the hint below it, so it waits for a choice.
  if (!(needsSelection && !input.run && input.activeHandle)) {
    workspace.append(ctx.el("span", "av-cleanup-guidance", status));
  }
  if (needsSelection) {
    const hint = ctx.el(
      "span",
      "av-cleanup-guidance av-cleanup-selection-hint",
      ctx.t("Select at least one kind of activity to enable Run.")
    );
    hint.id = "av-cleanup-selection-hint";
    workspace.append(hint);
  }

  const controls = ctx.el("div", "av-cleanup-buttons");
  if (input.runStatus === "running") {
    const pause = ctx.button("Pause", "av-button av-button-secondary");
    pause.type = "button";
    pause.disabled = !ctx.options.pauseAccountCleanup;
    pause.addEventListener("click", () => {
      void runCommand(ctx, "Pausing deletion…", () => invoke(ctx.options.pauseAccountCleanup));
    });
    controls.append(pause);
  }
  if (input.runStatus === "paused" || input.runStatus === "blocked") {
    const resume = ctx.button("Resume", "av-button av-button-secondary");
    resume.type = "button";
    resume.disabled = !ctx.options.resumeAccountCleanup;
    resume.addEventListener("click", () => {
      void runCommand(ctx, "Resuming deletion…", () => invoke(ctx.options.resumeAccountCleanup));
    });
    controls.append(resume);
  }
  if (input.activeJob) {
    const stop = ctx.button("Stop", "av-button av-button-secondary");
    stop.type = "button";
    stop.disabled = !ctx.options.stopAccountCleanup;
    stop.addEventListener("click", () => {
      void runCommand(ctx, "Stopping deletion…", () => invoke(ctx.options.stopAccountCleanup));
    });
    controls.append(stop);
  }

  if (input.activeJob) {
    workspace.append(controls);
    return workspace;
  }

  const run = ctx.button("Run", "av-button av-button-danger av-cleanup-primary-action");
  run.type = "button";
  run.dataset.avCleanupPrimary = "1";
  run.disabled = !input.activeHandle || !input.hasSelection || !ctx.options.startAccountCleanup;
  if (needsSelection) run.setAttribute("aria-describedby", "av-cleanup-selection-hint");
  run.addEventListener("click", () => {
    setPendingButton(run, ctx.t("Starting deletion…"));
    void runCommand(ctx, "Starting deletion…", async () => {
      const result = await ctx.options.startAccountCleanup?.(startOptions(ctx));
      return result ?? { ok: false, reason: "not_ready" };
    });
  });
  controls.append(run);
  workspace.append(controls);
  return workspace;
}

function setPendingButton(button: HTMLButtonElement, label: string): void {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = label;
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
    ctx.setStatus(status?.message ?? (result.ok ? "Deletion updated." : "Deletion command failed."));
    ctx.render();
  } catch (error) {
    ctx.options.onError("Deletion command failed", error);
    ctx.setStatus("Deletion command failed.");
    ctx.render();
  }
}

function invoke(
  command: (() => Promise<AccountCleanupCommandResult>) | undefined
): Promise<AccountCleanupCommandResult> {
  return command?.() ?? Promise.resolve({ ok: false, reason: "not_ready" });
}

function describeTotals(run: AccountCleanupRun): string {
  return run.plan.map((category) => {
    const stats = run.stats[category];
    const count = run.settings.mode === "preview" ? stats.previewed : stats.completed;
    return `${ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS[category].label} ${count}`;
  }).join(" · ");
}
