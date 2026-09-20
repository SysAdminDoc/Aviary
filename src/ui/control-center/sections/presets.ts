import type { PanelContext } from "../panel-context.ts";

const COMMON_TASKS = [
  {
    title: "Make X quieter",
    description: "Hide ads, trends, suggestions, and navigation you do not use.",
    section: "layout"
  },
  {
    title: "Hide unwanted posts",
    description: "Filter by words, media, badges, or page.",
    section: "filtering"
  },
  {
    title: "Save photos and videos",
    description: "Choose quality, filenames, duplicate checks, and queue behavior.",
    section: "media"
  },
  {
    title: "Delete account activity",
    description: "Preview and remove posts, replies, reposts, likes, or bookmarks.",
    section: "account"
  }
] as const;

export function buildPresetRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [buildCommonTasks(ctx)];
  if (!ctx.options.listPresets || !ctx.options.applyPreset) {
    rows.push(ctx.readonlyRow("Ready-made setups", "Preset packs unavailable in this build."));
    return rows;
  }
  for (const preset of ctx.options.listPresets()) {
    const row = ctx.el("div", "av-row av-row-stack av-preset-card");
    row.dataset.avPreset = preset.id;
    row.dataset.avLabel = preset.label;
    const cardHeader = ctx.el("div", "av-preset-header");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t(preset.label)),
      ctx.el("span", "av-row-description", ctx.t(preset.description))
    );
    cardHeader.append(ctx.presetIcon(preset.id), copy);

    const highlights = ctx.el("div", "av-preset-highlights");
    for (const highlight of preset.highlights ?? []) {
      const preview = ctx.el("div", "av-preset-highlight");
      preview.append(
        ctx.el("span", "av-preset-highlight-label", ctx.t(highlight.label)),
        ctx.el("span", "av-preset-highlight-value", ctx.t(highlight.value))
      );
      highlights.append(preview);
    }
    const apply = ctx.el("button", "av-button av-button-secondary", ctx.t("Apply")) as HTMLButtonElement;
    apply.type = "button";
    apply.addEventListener("click", () => {
      if (ctx.guardDraft()) return;
      apply.disabled = true;
      void ctx.options
        .applyPreset!(preset.id)
        .then((result) => {
          ctx.render();
          if (result.applied) {
            ctx.setStatusCopy("Preset applied: {preset} ({changes})", {
              preset: ctx.t(preset.label),
              changes: result.changes.length
            });
          } else {
            ctx.setStatusCopy("Preset already applied: {preset}", { preset: ctx.t(preset.label) });
          }
        })
        .catch((error: unknown) => {
          ctx.options.onError("Could not apply preset", error);
          ctx.setStatus("Could not apply preset.");
        })
        .finally(() => {
          apply.disabled = false;
        });
    });
    row.append(cardHeader);
    if (highlights.childElementCount > 0) {
      row.append(highlights);
    }
    row.append(apply);
    rows.push(row);
  }
  if (ctx.options.listLocales) {
    rows.push(
      ctx.selectRow(
        "Locale",
        ctx.options.settings.i18n.locale,
        ctx.options.listLocales().map((entry) => [entry.code, entry.label] as [string, string]),
        async (value) => {
          ctx.options.settings.i18n.locale = value;
          const entry = ctx.options.listLocales?.().find((locale) => locale.code === value);
          await ctx.save(`Locale set to ${entry?.label ?? value}`);
        },
        "Translates the panel and sets reading direction, right-to-left for Arabic and Hebrew. Trust shows how much of the chosen locale is filled in; anything missing stays English.",
        false
      )
    );
  }
  return rows;
}

function buildCommonTasks(ctx: PanelContext): HTMLElement {
  const guide = ctx.el("div", "av-start-guide");
  guide.dataset.avLabel = "Common tasks";

  const note = ctx.el("div", "av-start-note");
  note.setAttribute("role", "note");
  note.append(
    ctx.el("strong", "av-start-note-title", ctx.t("How saving works")),
    ctx.el(
      "span",
      "av-start-note-copy",
      ctx.t("Switches and fields wait for Save. Buttons such as Apply, Export, Preview, and Delete run right away.")
    )
  );

  const cards = ctx.el("div", "av-start-task-grid");
  for (const task of COMMON_TASKS) {
    const card = ctx.el("button", "av-start-task") as HTMLButtonElement;
    card.type = "button";
    card.dataset.avOpenSection = task.section;
    card.append(
      ctx.el("span", "av-start-task-copy"),
      ctx.el("span", "av-start-task-action", ctx.t("Open settings"))
    );
    const copy = card.querySelector<HTMLElement>(".av-start-task-copy")!;
    copy.append(
      ctx.el("strong", "av-start-task-title", ctx.t(task.title)),
      ctx.el("span", "av-start-task-description", ctx.t(task.description))
    );
    card.addEventListener("click", () => ctx.openSection(task.section));
    cards.append(card);
  }

  guide.append(note, cards);
  return guide;
}
