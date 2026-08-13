import type { PanelContext } from "../panel-context";
export function buildPresetRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
  if (!ctx.options.listPresets || !ctx.options.applyPreset) {
    rows.push(ctx.readonlyRow("Presets", "Preset packs unavailable in this build."));
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
      apply.disabled = true;
      void ctx.options
        .applyPreset!(preset.id)
        .then((result) => {
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
  if (ctx.options.listLocales && ctx.options.setLocale) {
    rows.push(
      ctx.selectRow(
        "Locale",
        ctx.options.settings.i18n.locale,
        ctx.options.listLocales().map((entry) => [entry.code, entry.label] as [string, string]),
        async (value) => {
          await ctx.options.setLocale!(value);
          const entry = ctx.options.listLocales?.().find((locale) => locale.code === value);
          await ctx.save(`Locale set to ${entry?.label ?? value}`);
        },
        "Translates the panel and sets reading direction — right-to-left for Arabic and Hebrew. Trust shows how much of the chosen locale is filled in; anything missing stays English.",
        false
      )
    );
  }
  return rows;
}
