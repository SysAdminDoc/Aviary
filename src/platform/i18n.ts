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

export type StringKey =
  | "ui.aviary"
  | "ui.close"
  | "ui.savedLocally"
  | "ui.savingEllipsis"
  | "ui.save"
  | "ui.saveList"
  | "ui.exportVisible"
  | "ui.copyDiagnostics"
  | "section.appearance"
  | "section.layout"
  | "section.filtering"
  | "section.media"
  | "section.export"
  | "section.library"
  | "section.snapshots"
  | "section.backupAudit"
  | "section.trust"
  | "section.presets"
  | "preset.apply"
  | "preset.deltaLabel"
  | "filters.enable"
  | "filters.master"
  | "filters.activeOn"
  | "media.buttons"
  | "media.original"
  | "settings.exported"
  | "settings.imported"
  | "settings.cleared"
  | "snapshot.captured"
  | "snapshot.empty"
  | "snapshot.cleared"
  | "report.downloaded";

const FALLBACK: Record<StringKey, string> = {
  "ui.aviary": "Aviary",
  "ui.close": "Close",
  "ui.savedLocally": "Saved locally",
  "ui.savingEllipsis": "Saving…",
  "ui.save": "Save",
  "ui.saveList": "Save list",
  "ui.exportVisible": "Export visible tweets",
  "ui.copyDiagnostics": "Copy diagnostics",
  "section.appearance": "Appearance",
  "section.layout": "Layout",
  "section.filtering": "Filtering",
  "section.media": "Media",
  "section.export": "Export",
  "section.library": "Library",
  "section.snapshots": "Snapshots & Archive",
  "section.backupAudit": "Backup & Audit",
  "section.trust": "Trust",
  "section.presets": "Presets",
  "preset.apply": "Apply preset",
  "preset.deltaLabel": "Will change",
  "filters.enable": "Enable filters",
  "filters.master": "Master switch for keyword, regex, premium, and media filters.",
  "filters.activeOn": "Active on",
  "media.buttons": "Show download buttons",
  "media.original": "Prefer original quality",
  "settings.exported": "Settings exported.",
  "settings.imported": "Settings imported.",
  "settings.cleared": "Settings cleared.",
  "snapshot.captured": "Snapshot captured.",
  "snapshot.empty": "No UserCell rows found.",
  "snapshot.cleared": "Snapshots cleared.",
  "report.downloaded": "Report downloaded."
};

const PARTIAL_BUNDLES: Partial<Record<LocaleCode, Partial<Record<StringKey, string>>>> = {
  es: {
    "ui.close": "Cerrar",
    "ui.savedLocally": "Guardado localmente",
    "ui.savingEllipsis": "Guardando…",
    "ui.save": "Guardar",
    "section.appearance": "Apariencia",
    "section.layout": "Diseño",
    "section.filtering": "Filtros",
    "section.media": "Multimedia",
    "section.library": "Biblioteca",
    "section.backupAudit": "Copia y auditoría",
    "section.trust": "Privacidad",
    "filters.enable": "Activar filtros"
  },
  fr: {
    "ui.close": "Fermer",
    "ui.savedLocally": "Enregistré localement",
    "ui.savingEllipsis": "Enregistrement…",
    "ui.save": "Enregistrer",
    "section.appearance": "Apparence",
    "section.layout": "Mise en page",
    "section.filtering": "Filtres",
    "section.media": "Médias",
    "section.export": "Export",
    "section.library": "Bibliothèque",
    "filters.enable": "Activer les filtres"
  },
  de: {
    "ui.close": "Schließen",
    "ui.savedLocally": "Lokal gespeichert",
    "ui.savingEllipsis": "Speichern…",
    "section.appearance": "Darstellung",
    "section.layout": "Layout",
    "section.filtering": "Filter",
    "section.media": "Medien",
    "section.library": "Bibliothek",
    "filters.enable": "Filter aktivieren"
  },
  ja: {
    "ui.close": "閉じる",
    "ui.savedLocally": "ローカルに保存しました",
    "section.appearance": "外観",
    "section.layout": "レイアウト",
    "section.filtering": "フィルタ",
    "section.media": "メディア",
    "filters.enable": "フィルタを有効にする"
  },
  ar: {
    "ui.close": "إغلاق",
    "ui.savedLocally": "تم الحفظ محليًا",
    "section.appearance": "المظهر",
    "section.layout": "التخطيط",
    "section.filtering": "التصفية",
    "section.media": "الوسائط",
    "filters.enable": "تفعيل الفلاتر"
  },
  he: {
    "ui.close": "סגירה",
    "ui.savedLocally": "נשמר מקומית",
    "section.appearance": "מראה",
    "section.layout": "פריסה",
    "section.filtering": "סינון",
    "section.media": "מדיה",
    "filters.enable": "הפעלת מסננים"
  }
};

export function translate(locale: string, key: StringKey): string {
  const bundle = PARTIAL_BUNDLES[locale as LocaleCode];
  return bundle?.[key] ?? FALLBACK[key];
}

export function localeDirection(locale: string): "ltr" | "rtl" {
  return LOCALES.find((entry) => entry.code === locale)?.direction ?? "ltr";
}

export function supportedLocales(): LocaleEntry[] {
  return LOCALES.map((entry) => ({ ...entry }));
}
