import { PANEL_STRINGS, panelCatalog } from "./i18n-catalog.ts";

export type LocaleCode = "en" | "es" | "pt" | "fr" | "de" | "ja" | "ko" | "ar" | "he";

export interface LocaleEntry {
  code: LocaleCode;
  label: string;
  direction: "ltr" | "rtl";
}

export const LOCALES: LocaleEntry[] = [
  { code: "en", label: "English", direction: "ltr" },
  { code: "es", label: "Español", direction: "ltr" },
  { code: "pt", label: "Português", direction: "ltr" },
  { code: "fr", label: "Français", direction: "ltr" },
  { code: "de", label: "Deutsch", direction: "ltr" },
  { code: "ja", label: "日本語", direction: "ltr" },
  { code: "ko", label: "한국어", direction: "ltr" },
  { code: "ar", label: "العربية", direction: "rtl" },
  { code: "he", label: "עברית", direction: "rtl" }
];

/**
 * Render-time lookup for panel copy. Unknown strings return themselves, so an untranslated
 * or freshly-edited label degrades to English instead of to an empty box or a key name.
 */
export function translateText(locale: string, english: string): string {
  if (locale === "en") {
    return english;
  }
  return panelCatalog()[locale as LocaleCode]?.[english] ?? english;
}

/** True when the catalog actually carries this string — not "the output differs". */
export function hasTranslation(locale: string, english: string): boolean {
  if (locale === "en") {
    return true;
  }
  return panelCatalog()[locale as LocaleCode]?.[english] !== undefined;
}

export interface LocaleCoverage {
  translated: number;
  total: number;
  percent: number;
}

/**
 * Coverage of a locale against the generated `PANEL_STRINGS` manifest. English is trivially
 * complete. This is the denominator the test suite asserts on; the panel itself reports the
 * narrower number it measured from the render it just performed.
 */
export function panelCoverage(locale: string): LocaleCoverage {
  const total = PANEL_STRINGS.length;
  if (locale === "en") {
    return { translated: total, total, percent: 100 };
  }
  const bundle = panelCatalog()[locale as LocaleCode];
  let translated = 0;
  for (const source of PANEL_STRINGS) {
    if (bundle?.[source] !== undefined) {
      translated += 1;
    }
  }
  return { translated, total, percent: Math.round((translated / total) * 100) };
}

export function localeDirection(locale: string): "ltr" | "rtl" {
  return LOCALES.find((entry) => entry.code === locale)?.direction ?? "ltr";
}

export function supportedLocales(): LocaleEntry[] {
  return LOCALES.map((entry) => ({ ...entry }));
}
