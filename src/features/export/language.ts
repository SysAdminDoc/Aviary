/**
 * Normalize a language tag at the data boundary. `Intl.getCanonicalLocales` gives us the browser's
 * BCP 47 parser and canonical casing, while the short shape guard prevents an implementation from
 * ever copying markup-looking input into an exported `lang` attribute.
 */
export function normalizePostLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 63 || candidate.includes("_")) return null;
  try {
    const canonical = Intl.getCanonicalLocales(candidate)[0];
    return canonical && /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(canonical)
      ? canonical
      : null;
  } catch {
    return null;
  }
}

export function languageAttribute(value: unknown): string {
  const language = normalizePostLanguage(value);
  return language ? ` lang="${language}"` : "";
}
