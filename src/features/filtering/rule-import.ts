import {
  cloneSettings,
  normalizeSettings,
  SETTINGS_KEY,
  type AviarySettings
} from "../../platform/settings.ts";
import type { StorageGateway } from "../../platform/storage.ts";
import { withStorageLock } from "../../platform/storage-lock.ts";
import {
  previewRuleSetImport,
  type RuleSetImportMode,
  type RuleSetImportPlan
} from "./rules.ts";

export interface RuleImportContext {
  settings: AviarySettings;
  storage: StorageGateway;
}

/**
 * Applies a portable rule set against the latest stored settings, not the tab's boot snapshot.
 * The live object changes only after the durable write succeeds.
 */
export async function applyFilterRuleImportAtomic(
  ctx: RuleImportContext,
  payload: string,
  mode: RuleSetImportMode
): Promise<RuleSetImportPlan> {
  return withStorageLock(SETTINGS_KEY, async () => {
    const latest = normalizeSettings(
      await ctx.storage.get<AviarySettings>(SETTINGS_KEY, cloneSettings(ctx.settings))
    );
    const plan = previewRuleSetImport(payload, latest.filter.rules)[mode];
    if (plan.errors.length > 0) return plan;

    const next = cloneSettings(latest);
    next.filter.rules = [...plan.lines];
    const normalized = normalizeSettings(next);
    await ctx.storage.set(SETTINGS_KEY, normalized);
    ctx.settings.filter.rules = [...normalized.filter.rules];
    return plan;
  });
}
