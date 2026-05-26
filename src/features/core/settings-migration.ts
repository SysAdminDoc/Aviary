import { cloneSettings, normalizeSettings, type AviarySettings } from "../../platform/settings";

export const SETTINGS_EXPORT_VERSION = 1;

export interface SettingsExportEnvelope {
  generator: "Aviary";
  version: number;
  exportedAt: string;
  settings: AviarySettings;
}

export interface SettingsImportReport {
  applied: boolean;
  errors: string[];
  warnings: string[];
  settings: AviarySettings;
}

export function buildSettingsExport(settings: AviarySettings): SettingsExportEnvelope {
  return {
    generator: "Aviary",
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: cloneSettings(settings)
  };
}

export function parseSettingsImport(payload: string): SettingsImportReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    errors.push(`Invalid JSON: ${(error as Error).message}`);
    return { applied: false, errors, warnings, settings: normalizeSettings({}) };
  }

  if (!isRecord(parsed)) {
    errors.push("Top-level value must be an object.");
    return { applied: false, errors, warnings, settings: normalizeSettings({}) };
  }

  const generator = parsed.generator;
  if (generator !== "Aviary") {
    warnings.push(`Unknown generator '${String(generator ?? "unset")}'. Continuing best-effort.`);
  }

  const version = parsed.version;
  if (typeof version === "number" && version > SETTINGS_EXPORT_VERSION) {
    warnings.push(
      `Import version ${version} is newer than supported ${SETTINGS_EXPORT_VERSION}; unknown fields are dropped.`
    );
  }

  const rawSettings = isRecord(parsed.settings) ? parsed.settings : parsed;
  const normalized = normalizeSettings(rawSettings);
  return { applied: true, errors, warnings, settings: normalized };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
