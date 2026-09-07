/**
 * Small extension-side locale adapter. The full translated panel catalog lives in the panel
 * chunk, so document-start features use English until that chunk is requested. Direction metadata
 * stays here because it is tiny and is needed by page-level controls.
 */

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

export function translateText(_locale: string, english: string): string {
  return english;
}

export function hasTranslation(_locale: string, english: string): boolean {
  return english.length > 0;
}

export function panelCoverage(_locale: string) {
  return { translated: 0, total: 0, percent: 0 };
}

export function localeDirection(locale: string): "ltr" | "rtl" {
  return LOCALES.find((entry) => entry.code === locale)?.direction ?? "ltr";
}

export function supportedLocales(): LocaleEntry[] {
  return LOCALES.map((entry) => ({ ...entry }));
}
