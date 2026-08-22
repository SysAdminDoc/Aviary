import { translateText } from "../../platform/i18n.ts";
import type { FeatureContext } from "../registry.ts";

/**
 * Translates a string in a feature that injects into the timeline.
 *
 * The Control Center has been fully localized since v1.8.0 while every control Aviary puts on the
 * page itself stayed English, so an Arabic or Japanese reader got a translated settings panel and
 * an English Hide button next to every post.
 *
 * Keyed on the English source string, like the panel: an edited label simply misses the catalog
 * and renders in English -- wrong but visible -- instead of silently keeping a stale translation.
 * `tools/i18n-extract.mjs` harvests these call sites from source, so a new string reaches the
 * manifest without anyone remembering to add it.
 */
export function ft(ctx: FeatureContext, english: string): string {
  return translateText(ctx.settings.i18n.locale, english);
}
