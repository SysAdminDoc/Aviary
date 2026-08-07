export const SETTINGS_KEY = "aviary.settings.v1";

export type ThemeId = "dim" | "lightsOut" | "graphite" | "plum" | "midnight";
export type RateLimitMode = "conservative" | "balanced";
export type ReduceMotionMode = "system" | "always" | "never";
export type FilterAction = "off" | "hide" | "dim";
export type SensitiveMode = "default" | "reveal" | "blur" | "hide";
export type MediaLayout = "default" | "stacked" | "grid";
export type FilterSurface =
  | "home"
  | "status"
  | "profile"
  | "search"
  | "notifications"
  | "messages";

const THEME_IDS: ThemeId[] = ["dim", "lightsOut", "graphite", "plum", "midnight"];
const RATE_LIMIT_MODES: RateLimitMode[] = ["conservative", "balanced"];
const REDUCE_MOTION_MODES: ReduceMotionMode[] = ["system", "always", "never"];
const FILTER_ACTIONS: FilterAction[] = ["off", "hide", "dim"];
export const FILTER_SURFACES: FilterSurface[] = [
  "home",
  "status",
  "profile",
  "search",
  "notifications",
  "messages"
];
const SENSITIVE_MODES: SensitiveMode[] = ["default", "reveal", "blur", "hide"];
const MEDIA_LAYOUTS: MediaLayout[] = ["default", "stacked", "grid"];
export const FILTER_MEDIA_KEYS = ["photo", "video", "gif"] as const;
export type FilterMediaKey = (typeof FILTER_MEDIA_KEYS)[number];
const EXPORT_FORMATS = ["json", "csv", "html", "markdown", "xlsx"] as const;
const BLOCKED_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export interface IntegrationSettings {
  aria2: {
    enabled: boolean;
    endpoint: string;
    secret: string;
    minBytes: number;
  };
  bluesky: {
    enabled: boolean;
    service: string;
    handle: string;
    appPassword: string;
  };
  mastodon: {
    enabled: boolean;
    instance: string;
    token: string;
    visibility: "public" | "unlisted" | "private" | "direct";
  };
  ai: {
    enabled: boolean;
    provider: "anthropic" | "openai" | "openai-compatible";
    endpoint: string;
    apiKey: string;
    model: string;
  };
  semanticSearch: {
    enabled: boolean;
    endpoint: string;
    apiKey: string;
    model: string;
    autoIndex: boolean;
  };
  crosspost: {
    attachLastDownload: boolean;
  };
}

const AI_PROVIDERS: IntegrationSettings["ai"]["provider"][] = [
  "anthropic",
  "openai",
  "openai-compatible"
];
const MASTODON_VISIBILITIES: IntegrationSettings["mastodon"]["visibility"][] = [
  "public",
  "unlisted",
  "private",
  "direct"
];

export interface AviarySettings {
  appearance: {
    theme: ThemeId;
    denseMode: boolean;
    timelineWidth: "default" | "comfortable" | "wide";
    hideBorders: boolean;
    hideCounts: boolean;
    restoreChirp: boolean;
  };
  layout: {
    hideNavItems: string[];
    hideRightSidebar: boolean;
    hideTrends: boolean;
    hideGrok: boolean;
    writerMode: boolean;
    forceFollowing: boolean;
  };
  filter: {
    enabled: boolean;
    keywordRules: string[];
    regexRules: string[];
    premiumRule: FilterAction;
    blockedAccounts: FilterAction;
    selfRepost: FilterAction;
    whitelist: string[];
    mediaTypes: Record<string, boolean>;
    surfaces: FilterSurface[];
  };
  hidden: {
    enabled: boolean;
    buttons: boolean;
    surfaces: FilterSurface[];
    maxEntries: number;
  };
  media: {
    buttons: boolean;
    preferOriginalImages: boolean;
    inlineOriginalImages: boolean;
    filenameTemplate: string;
    downloadHistory: boolean;
    zipChunkSize: number;
    sensitive: SensitiveMode;
    layout: MediaLayout;
    lastSaveFolder: string;
  };
  jobs: {
    concurrentDownloads: number;
    rateLimitMode: RateLimitMode;
  };
  export: {
    enabled: boolean;
    formats: Array<"json" | "csv" | "html" | "markdown" | "xlsx">;
    preserveRawPayloads: boolean;
    autoDiscoverQueryIds: boolean;
  };
  links: {
    cleanShareButtons: boolean;
    expandTco: boolean;
  };
  performance: {
    pauseOffscreenVideo: boolean;
    forceVideoQuality: boolean;
  };
  composer: {
    snippets: string[];
  };
  privacy: {
    localOnly: boolean;
    telemetry: false;
    blockAnalyticsBeacons: boolean;
    encryptVault: boolean;
    auditLog: boolean;
  };
  accessibility: {
    reduceMotion: ReduceMotionMode;
    highContrast: boolean;
  };
  i18n: {
    locale: string;
  };
  diagnostics: {
    selectorHealth: boolean;
  };
  integrations: IntegrationSettings;
}

export const DEFAULT_SETTINGS: AviarySettings = {
  appearance: {
    theme: "dim",
    denseMode: false,
    timelineWidth: "default",
    hideBorders: false,
    hideCounts: false,
    restoreChirp: false
  },
  layout: {
    hideNavItems: [],
    hideRightSidebar: true,
    hideTrends: true,
    hideGrok: true,
    writerMode: false,
    forceFollowing: false
  },
  filter: {
    enabled: false,
    keywordRules: [],
    regexRules: [],
    premiumRule: "off",
    // "off" until something reads it. F032 needs an authenticated capture containing X's
    // blocked-account markup before a predicate can be written; until then a default of "hide"
    // is a filter the settings claim to apply and the engine never applies.
    blockedAccounts: "off",
    selfRepost: "off",
    whitelist: [],
    mediaTypes: { photo: false, video: false, gif: false },
    surfaces: ["home", "status", "profile", "search"]
  },
  hidden: {
    enabled: true,
    buttons: true,
    surfaces: ["home", "status", "profile", "search", "notifications"],
    maxEntries: 5000
  },
  media: {
    buttons: true,
    preferOriginalImages: true,
    inlineOriginalImages: false,
    filenameTemplate: "{handle}_{tweetId}_{index}",
    downloadHistory: true,
    zipChunkSize: 250,
    sensitive: "default",
    layout: "default",
    lastSaveFolder: ""
  },
  jobs: {
    concurrentDownloads: 3,
    rateLimitMode: "conservative"
  },
  export: {
    enabled: false,
    formats: ["json", "csv", "html"],
    preserveRawPayloads: false,
    autoDiscoverQueryIds: true
  },
  links: {
    cleanShareButtons: true,
    expandTco: false
  },
  performance: {
    pauseOffscreenVideo: true,
    // Off by default: it rewrites the playlist X's player fetches, so it changes how video is
    // delivered rather than how it is displayed. New network-affecting capabilities opt in.
    forceVideoQuality: false
  },
  composer: {
    snippets: []
  },
  privacy: {
    localOnly: true,
    telemetry: false,
    // Off by default. Aviary sends no telemetry of its own either way; this refuses X's, which
    // is a change to how the site behaves and is the user's call to make, not a default.
    blockAnalyticsBeacons: false,
    encryptVault: false,
    auditLog: true
  },
  accessibility: {
    reduceMotion: "system",
    highContrast: false
  },
  i18n: {
    locale: "en"
  },
  diagnostics: {
    selectorHealth: true
  },
  integrations: {
    aria2: { enabled: false, endpoint: "", secret: "", minBytes: 50_000_000 },
    bluesky: { enabled: false, service: "https://bsky.social", handle: "", appPassword: "" },
    mastodon: { enabled: false, instance: "", token: "", visibility: "public" },
    ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
    semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "", autoIndex: false },
    crosspost: { attachLastDownload: false }
  }
};

export function normalizeSettings(input: unknown): AviarySettings {
  const record = asRecord(input);
  const appearance = asRecord(record.appearance);
  const layout = asRecord(record.layout);
  const filter = asRecord(record.filter);
  const hidden = asRecord(record.hidden);
  const media = asRecord(record.media);
  const jobs = asRecord(record.jobs);
  const exportSettings = asRecord(record.export);
  const links = asRecord(record.links);
  const performance = asRecord(record.performance);
  const composer = asRecord(record.composer);
  const privacy = asRecord(record.privacy);
  const accessibility = asRecord(record.accessibility);
  const i18n = asRecord(record.i18n);
  const diagnostics = asRecord(record.diagnostics);
  const integrations = asRecord(record.integrations);
  const integrationsAria = asRecord(integrations.aria2);
  const integrationsBluesky = asRecord(integrations.bluesky);
  const integrationsMastodon = asRecord(integrations.mastodon);
  const integrationsAi = asRecord(integrations.ai);
  const integrationsSemantic = asRecord(integrations.semanticSearch);
  const integrationsCrosspost = asRecord(integrations.crosspost);

  // Local-only mode became a real gate in v1.8.0. Anyone who had already configured an
  // integration was, by enabling it, opting into those requests -- so honour that rather than
  // silently breaking a working setup on upgrade. New installs keep the local-only default,
  // because every integration ships disabled.
  const anyIntegrationEnabled = [
    integrationsAria,
    integrationsBluesky,
    integrationsMastodon,
    integrationsAi,
    integrationsSemantic
  ].some((entry) => entry.enabled === true);

  return {
    appearance: {
      theme: enumValue(appearance.theme, THEME_IDS, DEFAULT_SETTINGS.appearance.theme),
      denseMode: booleanValue(appearance.denseMode, DEFAULT_SETTINGS.appearance.denseMode),
      timelineWidth: enumValue(
        appearance.timelineWidth,
        ["default", "comfortable", "wide"],
        DEFAULT_SETTINGS.appearance.timelineWidth
      ),
      hideBorders: booleanValue(appearance.hideBorders, DEFAULT_SETTINGS.appearance.hideBorders),
      hideCounts: booleanValue(appearance.hideCounts, DEFAULT_SETTINGS.appearance.hideCounts),
      restoreChirp: booleanValue(appearance.restoreChirp, DEFAULT_SETTINGS.appearance.restoreChirp)
    },
    layout: {
      hideNavItems: stringArray(layout.hideNavItems, { maxItems: 24, maxLength: 48 }),
      hideRightSidebar: booleanValue(layout.hideRightSidebar, DEFAULT_SETTINGS.layout.hideRightSidebar),
      hideTrends: booleanValue(layout.hideTrends, DEFAULT_SETTINGS.layout.hideTrends),
      hideGrok: booleanValue(layout.hideGrok, DEFAULT_SETTINGS.layout.hideGrok),
      writerMode: booleanValue(layout.writerMode, DEFAULT_SETTINGS.layout.writerMode),
      forceFollowing: booleanValue(layout.forceFollowing, DEFAULT_SETTINGS.layout.forceFollowing)
    },
    filter: {
      enabled: booleanValue(filter.enabled, DEFAULT_SETTINGS.filter.enabled),
      keywordRules: stringArray(filter.keywordRules, { maxItems: 200, maxLength: 180 }),
      regexRules: stringArray(filter.regexRules, { maxItems: 100, maxLength: 240 }),
      premiumRule: enumValue(filter.premiumRule, FILTER_ACTIONS, DEFAULT_SETTINGS.filter.premiumRule),
      blockedAccounts: enumValue(
        filter.blockedAccounts,
        FILTER_ACTIONS,
        DEFAULT_SETTINGS.filter.blockedAccounts
      ),
      selfRepost: enumValue(filter.selfRepost, FILTER_ACTIONS, DEFAULT_SETTINGS.filter.selfRepost),
      whitelist: stringArray(filter.whitelist, { maxItems: 200, maxLength: 80 }),
      mediaTypes: mediaTypeRecord(filter.mediaTypes),
      surfaces: surfaceArray(filter.surfaces)
    },
    hidden: {
      enabled: booleanValue(hidden.enabled, DEFAULT_SETTINGS.hidden.enabled),
      buttons: booleanValue(hidden.buttons, DEFAULT_SETTINGS.hidden.buttons),
      surfaces: surfaceArray(hidden.surfaces, DEFAULT_SETTINGS.hidden.surfaces),
      maxEntries: integerValue(hidden.maxEntries, DEFAULT_SETTINGS.hidden.maxEntries, 100, 50_000)
    },
    media: {
      buttons: booleanValue(media.buttons, DEFAULT_SETTINGS.media.buttons),
      preferOriginalImages: booleanValue(media.preferOriginalImages, DEFAULT_SETTINGS.media.preferOriginalImages),
      inlineOriginalImages: booleanValue(media.inlineOriginalImages, DEFAULT_SETTINGS.media.inlineOriginalImages),
      filenameTemplate: stringValue(media.filenameTemplate, DEFAULT_SETTINGS.media.filenameTemplate, 160),
      downloadHistory: booleanValue(media.downloadHistory, DEFAULT_SETTINGS.media.downloadHistory),
      zipChunkSize: integerValue(media.zipChunkSize, DEFAULT_SETTINGS.media.zipChunkSize, 25, 1000),
      sensitive: enumValue(media.sensitive, SENSITIVE_MODES, DEFAULT_SETTINGS.media.sensitive),
      layout: enumValue(media.layout, MEDIA_LAYOUTS, DEFAULT_SETTINGS.media.layout),
      lastSaveFolder: folderHintValue(media.lastSaveFolder, DEFAULT_SETTINGS.media.lastSaveFolder)
    },
    jobs: {
      concurrentDownloads: integerValue(
        jobs.concurrentDownloads,
        DEFAULT_SETTINGS.jobs.concurrentDownloads,
        1,
        6
      ),
      rateLimitMode: enumValue(jobs.rateLimitMode, RATE_LIMIT_MODES, DEFAULT_SETTINGS.jobs.rateLimitMode)
    },
    export: {
      enabled: booleanValue(exportSettings.enabled, DEFAULT_SETTINGS.export.enabled),
      formats: exportFormatArray(exportSettings.formats),
      preserveRawPayloads: booleanValue(
        exportSettings.preserveRawPayloads,
        DEFAULT_SETTINGS.export.preserveRawPayloads
      ),
      autoDiscoverQueryIds: booleanValue(
        exportSettings.autoDiscoverQueryIds,
        DEFAULT_SETTINGS.export.autoDiscoverQueryIds
      )
    },
    links: {
      cleanShareButtons: booleanValue(links.cleanShareButtons, DEFAULT_SETTINGS.links.cleanShareButtons),
      expandTco: booleanValue(links.expandTco, DEFAULT_SETTINGS.links.expandTco)
    },
    performance: {
      pauseOffscreenVideo: booleanValue(
        performance.pauseOffscreenVideo,
        DEFAULT_SETTINGS.performance.pauseOffscreenVideo
      ),
      forceVideoQuality: booleanValue(
        performance.forceVideoQuality,
        DEFAULT_SETTINGS.performance.forceVideoQuality
      )
    },
    composer: {
      snippets: stringArray(composer.snippets, { maxItems: 100, maxLength: 500 })
    },
    privacy: {
      localOnly: anyIntegrationEnabled
        ? false
        : booleanValue(privacy.localOnly, DEFAULT_SETTINGS.privacy.localOnly),
      telemetry: false,
      blockAnalyticsBeacons: booleanValue(
        privacy.blockAnalyticsBeacons,
        DEFAULT_SETTINGS.privacy.blockAnalyticsBeacons
      ),
      encryptVault: booleanValue(privacy.encryptVault, DEFAULT_SETTINGS.privacy.encryptVault),
      auditLog: booleanValue(privacy.auditLog, DEFAULT_SETTINGS.privacy.auditLog)
    },
    accessibility: {
      reduceMotion: enumValue(
        accessibility.reduceMotion,
        REDUCE_MOTION_MODES,
        DEFAULT_SETTINGS.accessibility.reduceMotion
      ),
      highContrast: booleanValue(accessibility.highContrast, DEFAULT_SETTINGS.accessibility.highContrast)
    },
    i18n: {
      locale: localeValue(i18n.locale, DEFAULT_SETTINGS.i18n.locale)
    },
    diagnostics: {
      selectorHealth: booleanValue(diagnostics.selectorHealth, DEFAULT_SETTINGS.diagnostics.selectorHealth)
    },
    integrations: {
      aria2: {
        enabled: booleanValue(integrationsAria.enabled, DEFAULT_SETTINGS.integrations.aria2.enabled),
        endpoint: urlValue(integrationsAria.endpoint, DEFAULT_SETTINGS.integrations.aria2.endpoint),
        secret: secretValue(integrationsAria.secret, DEFAULT_SETTINGS.integrations.aria2.secret),
        minBytes: integerValue(
          integrationsAria.minBytes,
          DEFAULT_SETTINGS.integrations.aria2.minBytes,
          1_000_000,
          5_000_000_000
        )
      },
      bluesky: {
        enabled: booleanValue(integrationsBluesky.enabled, DEFAULT_SETTINGS.integrations.bluesky.enabled),
        service: urlValue(integrationsBluesky.service, DEFAULT_SETTINGS.integrations.bluesky.service),
        handle: handleOrEmpty(integrationsBluesky.handle),
        appPassword: secretValue(
          integrationsBluesky.appPassword,
          DEFAULT_SETTINGS.integrations.bluesky.appPassword
        )
      },
      mastodon: {
        enabled: booleanValue(
          integrationsMastodon.enabled,
          DEFAULT_SETTINGS.integrations.mastodon.enabled
        ),
        instance: urlValue(
          integrationsMastodon.instance,
          DEFAULT_SETTINGS.integrations.mastodon.instance
        ),
        token: secretValue(integrationsMastodon.token, DEFAULT_SETTINGS.integrations.mastodon.token),
        visibility: enumValue(
          integrationsMastodon.visibility,
          MASTODON_VISIBILITIES,
          DEFAULT_SETTINGS.integrations.mastodon.visibility
        )
      },
      ai: {
        enabled: booleanValue(integrationsAi.enabled, DEFAULT_SETTINGS.integrations.ai.enabled),
        provider: enumValue(integrationsAi.provider, AI_PROVIDERS, DEFAULT_SETTINGS.integrations.ai.provider),
        endpoint: urlValue(integrationsAi.endpoint, DEFAULT_SETTINGS.integrations.ai.endpoint),
        apiKey: secretValue(integrationsAi.apiKey, DEFAULT_SETTINGS.integrations.ai.apiKey),
        model: stringValue(integrationsAi.model, DEFAULT_SETTINGS.integrations.ai.model, 120)
      },
      semanticSearch: {
        enabled: booleanValue(
          integrationsSemantic.enabled,
          DEFAULT_SETTINGS.integrations.semanticSearch.enabled
        ),
        endpoint: urlValue(
          integrationsSemantic.endpoint,
          DEFAULT_SETTINGS.integrations.semanticSearch.endpoint
        ),
        apiKey: secretValue(
          integrationsSemantic.apiKey,
          DEFAULT_SETTINGS.integrations.semanticSearch.apiKey
        ),
        model: stringValue(integrationsSemantic.model, DEFAULT_SETTINGS.integrations.semanticSearch.model, 120),
        autoIndex: booleanValue(
          integrationsSemantic.autoIndex,
          DEFAULT_SETTINGS.integrations.semanticSearch.autoIndex
        )
      },
      crosspost: {
        attachLastDownload: booleanValue(
          integrationsCrosspost.attachLastDownload,
          DEFAULT_SETTINGS.integrations.crosspost.attachLastDownload
        )
      }
    }
  };
}

export function cloneSettings(settings: AviarySettings): AviarySettings {
  return JSON.parse(JSON.stringify(settings)) as AviarySettings;
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEME_IDS.includes(value as ThemeId);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string, maxLength = 500): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function stringArray(
  value: unknown,
  options: { maxItems?: number; maxLength?: number } = {}
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const maxItems = options.maxItems ?? 100;
  const maxLength = options.maxLength ?? 180;
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized = item.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (!BLOCKED_OBJECT_KEYS.has(key) && /^[a-z0-9_-]{1,40}$/i.test(key) && typeof enabled === "boolean") {
      result[key] = enabled;
    }
  }
  return result;
}

function mediaTypeRecord(value: unknown): Record<string, boolean> {
  const record = booleanRecord(value);
  const result: Record<string, boolean> = {};
  for (const key of FILTER_MEDIA_KEYS) {
    result[key] = record[key] ?? DEFAULT_SETTINGS.filter.mediaTypes[key] ?? false;
  }
  for (const [key, enabled] of Object.entries(record)) {
    if (!(key in result)) {
      result[key] = enabled;
    }
  }
  return result;
}

function surfaceArray(
  value: unknown,
  fallback: readonly FilterSurface[] = DEFAULT_SETTINGS.filter.surfaces
): FilterSurface[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const seen = new Set<FilterSurface>();
  for (const item of value) {
    if (typeof item === "string" && FILTER_SURFACES.includes(item as FilterSurface)) {
      seen.add(item as FilterSurface);
    }
  }
  return seen.size > 0 ? [...seen] : [...fallback];
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function exportFormatArray(value: unknown): AviarySettings["export"]["formats"] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_SETTINGS.export.formats];
  }

  const formats = value.filter((item): item is (typeof EXPORT_FORMATS)[number] => {
    return typeof item === "string" && EXPORT_FORMATS.includes(item as (typeof EXPORT_FORMATS)[number]);
  });

  return formats.length > 0 ? [...new Set(formats)] : [...DEFAULT_SETTINGS.export.formats];
}

function urlValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback === "" ? "" : fallback;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function secretValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.length === 0 ? fallback : cleaned.slice(0, 4096);
}

function handleOrEmpty(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/^@/, "").trim();
  if (cleaned.length === 0) return "";
  return /^[A-Za-z0-9._-]{1,253}$/.test(cleaned) ? cleaned : "";
}

function folderHintValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const cleaned = value.replace(/[<>:"|?*\u0000-\u001f]/g, "").trim().slice(0, 120);
  return cleaned;
}

function localeValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(normalized) ? normalized : fallback;
}
