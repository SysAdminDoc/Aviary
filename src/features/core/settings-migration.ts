import {
  cloneSettings,
  normalizeSettings,
  readSettingsEnvelope,
  SETTINGS_SCHEMA_VERSION,
  type AviarySettings
} from "../../platform/settings.ts";

export const SETTINGS_EXPORT_VERSION = 1;

export interface SettingsExportEnvelope {
  generator: "Aviary";
  version: number;
  exportedAt: string;
  /** True when credentials were replaced by {@link REDACTED_SECRET} before writing. */
  secretsRedacted?: boolean;
  settings: AviarySettings;
}

export interface SettingsImportReport {
  applied: boolean;
  errors: string[];
  warnings: string[];
  settings: AviarySettings;
}

export const REDACTED_SECRET = "__aviary_redacted__";

/**
 * Settings files get shared for support and synced through cloud folders, so credentials
 * are replaced with a placeholder. Importing keeps whatever is already stored locally, which
 * makes the file a safe backup of preferences without being a copy of the user's API keys.
 */
const SECRET_PATHS: ReadonlyArray<readonly [keyof AviarySettings["integrations"], string]> = [
  ["aria2", "secret"],
  ["bluesky", "appPassword"],
  ["mastodon", "token"],
  ["ai", "apiKey"],
  ["semanticSearch", "apiKey"]
];

function readSecret(settings: AviarySettings, group: string, key: string): string {
  const record = (settings.integrations as unknown as Record<string, Record<string, unknown>>)[group];
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

function writeSecret(settings: AviarySettings, group: string, key: string, value: string): void {
  const record = (settings.integrations as unknown as Record<string, Record<string, unknown>>)[group];
  if (record) {
    record[key] = value;
  }
}

export interface SettingsExportOptions {
  /** Opt in to writing real credentials — off by default. */
  includeSecrets?: boolean;
}

export function buildSettingsExport(
  settings: AviarySettings,
  options: SettingsExportOptions = {}
): SettingsExportEnvelope {
  const copy = cloneSettings(settings);
  const includeSecrets = options.includeSecrets === true;

  if (!includeSecrets) {
    for (const [group, key] of SECRET_PATHS) {
      if (readSecret(copy, group, key).length > 0) {
        writeSecret(copy, group, key, REDACTED_SECRET);
      }
    }
  }

  return {
    generator: "Aviary",
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    secretsRedacted: !includeSecrets,
    settings: copy
  };
}

export function parseSettingsImport(
  payload: string,
  current?: AviarySettings
): SettingsImportReport {
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
  // Through the schema ladder, not straight to the normalizer. A stored value whose *meaning*
  // changed between schema versions cannot be carried by normalization: v1 read a provider budget
  // of 0 as "no ceiling" and v2 reads it as zero and blocks, so importing a pre-v2 backup used to
  // turn an unlimited budget into a blocked one with nothing said. `version` above is the envelope
  // version, which has not moved across either schema bump, so it can never have caught this.
  const envelope = readSettingsEnvelope(rawSettings);
  const normalized = envelope.settings;
  if (envelope.applied.length > 0) {
    warnings.push(
      `Upgraded settings from schema ${envelope.fromVersion ?? 1} to ${SETTINGS_SCHEMA_VERSION}.`
    );
  }
  if (envelope.fromFuture) {
    warnings.push(
      `These settings were written by a newer Aviary (schema ${envelope.fromVersion}, this build ` +
        `supports ${SETTINGS_SCHEMA_VERSION}); anything it does not understand was dropped.`
    );
  }

  // Redacted placeholders must never be applied as literal credentials; keep what is
  // already configured on this machine instead.
  let restored = 0;
  for (const [group, key] of SECRET_PATHS) {
    if (readSecret(normalized, group, key) === REDACTED_SECRET) {
      writeSecret(normalized, group, key, current ? readSecret(current, group, key) : "");
      restored += 1;
    }
  }
  if (restored > 0) {
    warnings.push(
      `${restored} credential${restored === 1 ? " was" : "s were"} redacted in this file; the ${
        restored === 1 ? "value" : "values"
      } already saved here ${restored === 1 ? "was" : "were"} kept.`
    );
  }

  return { applied: true, errors, warnings, settings: normalized };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
