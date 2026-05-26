import type { AviarySettings } from "../../platform/settings";
import { cloneSettings, DEFAULT_SETTINGS, normalizeSettings } from "../../platform/settings";

export type PresetId =
  | "quiet-reader"
  | "media-archivist"
  | "creator"
  | "researcher"
  | "classic"
  | "minimal";

export interface PresetDefinition {
  id: PresetId;
  label: string;
  description: string;
  overrides: PresetOverrides;
}

export type PresetOverrides = Partial<{
  appearance: Partial<AviarySettings["appearance"]>;
  layout: Partial<AviarySettings["layout"]>;
  filter: Partial<AviarySettings["filter"]>;
  media: Partial<AviarySettings["media"]>;
  export: Partial<AviarySettings["export"]>;
  links: Partial<AviarySettings["links"]>;
  composer: Partial<AviarySettings["composer"]>;
  accessibility: Partial<AviarySettings["accessibility"]>;
  jobs: Partial<AviarySettings["jobs"]>;
  privacy: Partial<AviarySettings["privacy"]>;
  diagnostics: Partial<AviarySettings["diagnostics"]>;
  i18n: Partial<AviarySettings["i18n"]>;
}>;

export const PRESETS: PresetDefinition[] = [
  {
    id: "quiet-reader",
    label: "Quiet Reader",
    description: "Hide promoted modules, dim premium posts, strip t.co, dense + dim theme.",
    overrides: {
      appearance: { theme: "dim", denseMode: true, hideBorders: true, hideCounts: true },
      layout: { hideRightSidebar: true, hideTrends: true, hideGrok: true },
      filter: { enabled: true, premiumRule: "dim" },
      links: { expandTco: true, cleanShareButtons: true }
    }
  },
  {
    id: "media-archivist",
    label: "Media Archivist",
    description: "Original-quality downloads, deterministic filenames, dedup history, sensitive blur.",
    overrides: {
      appearance: { theme: "lightsOut" },
      media: {
        buttons: true,
        preferOriginalImages: true,
        downloadHistory: true,
        sensitive: "blur",
        layout: "stacked"
      },
      filter: { enabled: false }
    }
  },
  {
    id: "creator",
    label: "Creator",
    description: "Writer mode, composer snippets enabled, share-button cleanup, layout grid.",
    overrides: {
      appearance: { theme: "midnight" },
      layout: { hideRightSidebar: true, hideTrends: true, hideGrok: true, writerMode: true },
      media: { layout: "grid" },
      links: { cleanShareButtons: true, expandTco: true }
    }
  },
  {
    id: "researcher",
    label: "Researcher",
    description: "Export capture on, JSON+CSV+HTML+MD formats, auto-discover query IDs, raw payloads.",
    overrides: {
      filter: { enabled: false },
      export: {
        enabled: true,
        formats: ["json", "csv", "html", "markdown"],
        preserveRawPayloads: true,
        autoDiscoverQueryIds: true
      },
      media: { sensitive: "default", layout: "default" },
      links: { cleanShareButtons: true }
    }
  },
  {
    id: "classic",
    label: "Classic",
    description: "Restore dim, keep sidebar, hide Grok only, no premium filtering.",
    overrides: {
      appearance: { theme: "dim", denseMode: false },
      layout: {
        hideRightSidebar: false,
        hideTrends: false,
        hideGrok: true,
        writerMode: false
      },
      filter: { enabled: false, premiumRule: "off" }
    }
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Maximum declutter, hide counts, hide trends, hide promoted, big text safe zones.",
    overrides: {
      appearance: { theme: "lightsOut", denseMode: false, hideBorders: true, hideCounts: true },
      layout: { hideRightSidebar: true, hideTrends: true, hideGrok: true },
      filter: { enabled: true, premiumRule: "hide" },
      accessibility: { reduceMotion: "always" }
    }
  }
];

export function listPresets(): PresetDefinition[] {
  return PRESETS.map((preset) => ({ ...preset, overrides: cloneOverrides(preset.overrides) }));
}

export function getPreset(id: PresetId): PresetDefinition | undefined {
  return listPresets().find((preset) => preset.id === id);
}

export function applyPreset(current: AviarySettings, preset: PresetDefinition): AviarySettings {
  const next = cloneSettings(current);
  for (const [section, overrides] of Object.entries(preset.overrides)) {
    if (!overrides) continue;
    const target = (next as unknown as Record<string, Record<string, unknown>>)[section];
    if (!target) continue;
    for (const [key, value] of Object.entries(overrides)) {
      target[key] = value;
    }
  }
  return normalizeSettings(next);
}

export function describePresetDelta(current: AviarySettings, preset: PresetDefinition): string[] {
  const result: string[] = [];
  const next = applyPreset(current, preset);
  for (const section of Object.keys(preset.overrides) as Array<keyof PresetOverrides>) {
    const currentSection = (current as unknown as Record<string, Record<string, unknown>>)[section] ?? {};
    const nextSection = (next as unknown as Record<string, Record<string, unknown>>)[section] ?? {};
    for (const key of Object.keys(preset.overrides[section] ?? {})) {
      const before = JSON.stringify(currentSection[key]);
      const after = JSON.stringify(nextSection[key]);
      if (before !== after) {
        result.push(`${section}.${key}: ${before} → ${after}`);
      }
    }
  }
  return result;
}

export function defaultSnapshotForPreset(preset: PresetDefinition): AviarySettings {
  return applyPreset(DEFAULT_SETTINGS, preset);
}

function cloneOverrides(overrides: PresetOverrides): PresetOverrides {
  return JSON.parse(JSON.stringify(overrides)) as PresetOverrides;
}
