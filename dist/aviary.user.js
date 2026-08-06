// ==UserScript==
// @name         Aviary for X
// @namespace    https://github.com/aviary-x
// @version      1.5.0
// @description  Local-first X/Twitter enhancer with reversible controls and privacy-first defaults.
// @author       Aviary contributors
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @match        https://pro.x.com/*
// @match        https://tweetdeck.twitter.com/*
// @run-at       document-start
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_download
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @updateURL    https://raw.githubusercontent.com/aviary-x/aviary/main/dist/aviary.user.js
// @downloadURL  https://raw.githubusercontent.com/aviary-x/aviary/main/dist/aviary.user.js
// ==/UserScript==

"use strict";
var Aviary = (() => {
  // src/features/appearance/theme.ts
  var STYLE_ID = "av-theme-foundation";
  var themeFeature = {
    id: "appearance.theme",
    title: "Theme foundation",
    category: "appearance",
    defaultEnabled: true,
    init(ctx) {
      ensureThemeStyle();
      applyTheme(ctx.settings);
      ctx.diagnostics.info("Theme foundation applied", {
        theme: ctx.settings.appearance.theme
      });
    },
    apply(ctx) {
      ensureThemeStyle();
      applyTheme(ctx.settings);
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID)?.remove();
      for (const theme of ["dim", "lightsOut", "graphite", "plum", "midnight"]) {
        document.documentElement.classList.remove(`av-theme-${theme}`);
      }
      document.documentElement.classList.remove("av-dense", "av-high-contrast", "av-reduce-motion");
      delete document.documentElement.dataset.avTheme;
      document.documentElement.style.colorScheme = "";
      ctx.diagnostics.info("Theme foundation destroyed");
    }
  };
  function applyTheme(settings) {
    const root = document.documentElement;
    const theme = settings.appearance.theme;
    for (const value of ["dim", "lightsOut", "graphite", "plum", "midnight"]) {
      root.classList.toggle(`av-theme-${value}`, value === theme);
    }
    root.dataset.avTheme = theme;
    root.classList.toggle("av-dense", settings.appearance.denseMode);
    root.classList.toggle("av-high-contrast", settings.accessibility.highContrast);
    root.classList.toggle("av-reduce-motion", shouldReduceMotion(settings));
    root.style.colorScheme = "dark";
  }
  function shouldReduceMotion(settings) {
    if (settings.accessibility.reduceMotion === "always") return true;
    if (settings.accessibility.reduceMotion === "never") return false;
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }
  function ensureThemeStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = THEME_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var themeVars = {
    dim: `
    --av-bg: rgb(0, 0, 0);
    --av-surface: rgb(15, 20, 25);
    --av-surface-raised: rgb(22, 24, 28);
    --av-border: rgb(47, 51, 54);
    --av-text: rgb(239, 243, 244);
    --av-muted: rgb(113, 118, 123);
    --av-accent: rgb(29, 155, 240);
  `,
    lightsOut: `
    --av-bg: rgb(0, 0, 0);
    --av-surface: rgb(5, 6, 7);
    --av-surface-raised: rgb(14, 15, 17);
    --av-border: rgb(36, 39, 43);
    --av-text: rgb(245, 247, 248);
    --av-muted: rgb(132, 139, 145);
    --av-accent: rgb(29, 155, 240);
  `,
    graphite: `
    --av-bg: rgb(8, 9, 11);
    --av-surface: rgb(18, 20, 23);
    --av-surface-raised: rgb(27, 30, 34);
    --av-border: rgb(55, 60, 66);
    --av-text: rgb(241, 244, 246);
    --av-muted: rgb(150, 157, 164);
    --av-accent: rgb(91, 176, 255);
  `,
    plum: `
    --av-bg: rgb(9, 5, 12);
    --av-surface: rgb(21, 14, 27);
    --av-surface-raised: rgb(32, 22, 41);
    --av-border: rgb(62, 45, 73);
    --av-text: rgb(246, 241, 249);
    --av-muted: rgb(164, 148, 174);
    --av-accent: rgb(205, 142, 255);
  `,
    midnight: `
    --av-bg: rgb(2, 8, 16);
    --av-surface: rgb(9, 18, 30);
    --av-surface-raised: rgb(16, 31, 49);
    --av-border: rgb(38, 60, 82);
    --av-text: rgb(239, 246, 252);
    --av-muted: rgb(139, 160, 178);
    --av-accent: rgb(68, 171, 255);
  `
  };
  var THEME_CSS = `
html.av-theme-dim { ${themeVars.dim} }
html.av-theme-lightsOut { ${themeVars.lightsOut} }
html.av-theme-graphite { ${themeVars.graphite} }
html.av-theme-plum { ${themeVars.plum} }
html.av-theme-midnight { ${themeVars.midnight} }

html[data-av-theme] {
  color-scheme: dark;
}

html[data-av-theme] body {
  background: var(--av-bg, rgb(0, 0, 0));
}

html[data-av-theme] [data-testid="primaryColumn"] {
  background: var(--av-bg, rgb(0, 0, 0));
}

html[data-av-theme] [data-testid="sidebarColumn"] section,
html[data-av-theme] [aria-label="Timeline: Trending now"] {
  background-color: color-mix(in srgb, var(--av-surface) 92%, transparent);
  border-color: var(--av-border);
}

html.av-dense article[data-testid="tweet"] {
  padding-top: 8px;
  padding-bottom: 8px;
}

html.av-high-contrast {
  --av-border: color-mix(in srgb, var(--av-text, rgb(239, 243, 244)) 42%, transparent);
  --av-muted: color-mix(in srgb, var(--av-text, rgb(239, 243, 244)) 76%, transparent);
}

html.av-reduce-motion *,
html.av-reduce-motion *::before,
html.av-reduce-motion *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
  transition-duration: 0.001ms !important;
}
`;

  // src/platform/i18n.ts
  var LOCALES = [
    { code: "en", label: "English", direction: "ltr" },
    { code: "es", label: "Espa\xF1ol", direction: "ltr" },
    { code: "pt", label: "Portugu\xEAs", direction: "ltr" },
    { code: "fr", label: "Fran\xE7ais", direction: "ltr" },
    { code: "de", label: "Deutsch", direction: "ltr" },
    { code: "ja", label: "\u65E5\u672C\u8A9E", direction: "ltr" },
    { code: "ko", label: "\uD55C\uAD6D\uC5B4", direction: "ltr" },
    { code: "ar", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", direction: "rtl" },
    { code: "he", label: "\u05E2\u05D1\u05E8\u05D9\u05EA", direction: "rtl" }
  ];
  function localeDirection(locale) {
    return LOCALES.find((entry) => entry.code === locale)?.direction ?? "ltr";
  }
  function supportedLocales() {
    return LOCALES.map((entry) => ({ ...entry }));
  }

  // src/platform/settings.ts
  var SETTINGS_KEY = "aviary.settings.v1";
  var THEME_IDS = ["dim", "lightsOut", "graphite", "plum", "midnight"];
  var RATE_LIMIT_MODES = ["conservative", "balanced"];
  var REDUCE_MOTION_MODES = ["system", "always", "never"];
  var FILTER_ACTIONS = ["off", "hide", "dim"];
  var FILTER_SURFACES = [
    "home",
    "status",
    "profile",
    "search",
    "notifications",
    "messages"
  ];
  var SENSITIVE_MODES = ["default", "reveal", "blur", "hide"];
  var MEDIA_LAYOUTS = ["default", "stacked", "grid"];
  var FILTER_MEDIA_KEYS = ["photo", "video", "gif"];
  var EXPORT_FORMATS = ["json", "csv", "html", "markdown", "xlsx"];
  var BLOCKED_OBJECT_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  var AI_PROVIDERS = [
    "anthropic",
    "openai",
    "openai-compatible"
  ];
  var MASTODON_VISIBILITIES = [
    "public",
    "unlisted",
    "private",
    "direct"
  ];
  var DEFAULT_SETTINGS = {
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
      writerMode: false
    },
    filter: {
      enabled: false,
      keywordRules: [],
      regexRules: [],
      premiumRule: "off",
      blockedAccounts: "hide",
      selfRepost: "off",
      whitelist: [],
      mediaTypes: { photo: false, video: false, gif: false },
      surfaces: ["home", "status", "profile", "search"]
    },
    media: {
      buttons: true,
      preferOriginalImages: true,
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
    composer: {
      snippets: []
    },
    privacy: {
      localOnly: true,
      telemetry: false,
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
      aria2: { enabled: false, endpoint: "", secret: "", minBytes: 5e7 },
      bluesky: { enabled: false, service: "https://bsky.social", handle: "", appPassword: "" },
      mastodon: { enabled: false, instance: "", token: "", visibility: "public" },
      ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
      semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "", autoIndex: false },
      crosspost: { attachLastDownload: false }
    }
  };
  function normalizeSettings(input) {
    const record = asRecord(input);
    const appearance = asRecord(record.appearance);
    const layout = asRecord(record.layout);
    const filter = asRecord(record.filter);
    const media = asRecord(record.media);
    const jobs = asRecord(record.jobs);
    const exportSettings = asRecord(record.export);
    const links = asRecord(record.links);
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
        writerMode: booleanValue(layout.writerMode, DEFAULT_SETTINGS.layout.writerMode)
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
      media: {
        buttons: booleanValue(media.buttons, DEFAULT_SETTINGS.media.buttons),
        preferOriginalImages: booleanValue(media.preferOriginalImages, DEFAULT_SETTINGS.media.preferOriginalImages),
        filenameTemplate: stringValue(media.filenameTemplate, DEFAULT_SETTINGS.media.filenameTemplate, 160),
        downloadHistory: booleanValue(media.downloadHistory, DEFAULT_SETTINGS.media.downloadHistory),
        zipChunkSize: integerValue(media.zipChunkSize, DEFAULT_SETTINGS.media.zipChunkSize, 25, 1e3),
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
      composer: {
        snippets: stringArray(composer.snippets, { maxItems: 100, maxLength: 500 })
      },
      privacy: {
        localOnly: booleanValue(privacy.localOnly, DEFAULT_SETTINGS.privacy.localOnly),
        telemetry: false,
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
            1e6,
            5e9
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
  function cloneSettings(settings) {
    return JSON.parse(JSON.stringify(settings));
  }
  function isThemeId(value) {
    return THEME_IDS.includes(value);
  }
  function asRecord(value) {
    return isRecord(value) ? value : {};
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function booleanValue(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }
  function stringValue(value, fallback, maxLength = 500) {
    if (typeof value !== "string") {
      return fallback;
    }
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return normalized.length > 0 ? normalized.slice(0, maxLength) : fallback;
  }
  function enumValue(value, allowed, fallback) {
    return typeof value === "string" && allowed.includes(value) ? value : fallback;
  }
  function stringArray(value, options = {}) {
    if (!Array.isArray(value)) {
      return [];
    }
    const maxItems = options.maxItems ?? 100;
    const maxLength = options.maxLength ?? 180;
    const seen = /* @__PURE__ */ new Set();
    const result = [];
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
  function booleanRecord(value) {
    if (!isRecord(value)) {
      return {};
    }
    const result = {};
    for (const [key, enabled] of Object.entries(value)) {
      if (!BLOCKED_OBJECT_KEYS.has(key) && /^[a-z0-9_-]{1,40}$/i.test(key) && typeof enabled === "boolean") {
        result[key] = enabled;
      }
    }
    return result;
  }
  function mediaTypeRecord(value) {
    const record = booleanRecord(value);
    const result = {};
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
  function surfaceArray(value) {
    if (!Array.isArray(value)) {
      return [...DEFAULT_SETTINGS.filter.surfaces];
    }
    const seen = /* @__PURE__ */ new Set();
    for (const item of value) {
      if (typeof item === "string" && FILTER_SURFACES.includes(item)) {
        seen.add(item);
      }
    }
    return seen.size > 0 ? [...seen] : [...DEFAULT_SETTINGS.filter.surfaces];
  }
  function integerValue(value, fallback, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.trunc(value)));
  }
  function exportFormatArray(value) {
    if (!Array.isArray(value)) {
      return [...DEFAULT_SETTINGS.export.formats];
    }
    const formats = value.filter((item) => {
      return typeof item === "string" && EXPORT_FORMATS.includes(item);
    });
    return formats.length > 0 ? [...new Set(formats)] : [...DEFAULT_SETTINGS.export.formats];
  }
  function urlValue(value, fallback) {
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
  function secretValue(value, fallback) {
    if (typeof value !== "string") return fallback;
    const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return cleaned.length === 0 ? fallback : cleaned.slice(0, 4096);
  }
  function handleOrEmpty(value) {
    if (typeof value !== "string") return "";
    const cleaned = value.replace(/^@/, "").trim();
    if (cleaned.length === 0) return "";
    return /^[A-Za-z0-9._-]{1,253}$/.test(cleaned) ? cleaned : "";
  }
  function folderHintValue(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }
    const cleaned = value.replace(/[<>:"|?*\u0000-\u001f]/g, "").trim().slice(0, 120);
    return cleaned;
  }
  function localeValue(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }
    const normalized = value.trim();
    return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(normalized) ? normalized : fallback;
  }

  // src/ui/control-center.ts
  var SENSITIVE_OPTIONS = [
    ["default", "Default (X choice)"],
    ["reveal", "Always reveal"],
    ["blur", "Blur until hovered"],
    ["hide", "Always hide"]
  ];
  var MEDIA_LAYOUT_OPTIONS = [
    ["default", "Default grid"],
    ["stacked", "Stacked"],
    ["grid", "Strict grid"]
  ];
  var FILTER_ACTION_OPTIONS = [
    ["off", "Off"],
    ["hide", "Hide"],
    ["dim", "Dim"]
  ];
  var FILTER_SURFACE_LABELS = {
    home: "Home",
    status: "Status",
    profile: "Profile",
    search: "Search",
    notifications: "Notifications",
    messages: "Messages"
  };
  var FILTER_MEDIA_LABELS = {
    photo: "Photos",
    video: "Videos",
    gif: "GIFs"
  };
  function mountControlCenter(options) {
    const existing = document.getElementById("av-control-center");
    existing?.remove();
    const host = document.createElement("div");
    host.id = "av-control-center";
    host.dataset.avOwned = "true";
    document.documentElement.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CONTROL_CENTER_CSS;
    const shell = el("div", "av-shell");
    const launcher = button("Aviary", "av-launcher");
    launcher.type = "button";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "av-control-panel");
    const overlay = el("div", "av-overlay");
    overlay.setAttribute("aria-hidden", "true");
    const panel = el("section", "av-panel");
    panel.id = "av-control-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Aviary settings");
    panel.tabIndex = -1;
    const header = el("header", "av-panel-header");
    const titleWrap = el("div", "av-title-wrap");
    const title = el("h2", "av-title", "Aviary");
    const subtitle = el("p", "av-subtitle", "Local controls for a quieter X.");
    titleWrap.append(title, subtitle);
    const close = button("Close", "av-button av-button-secondary");
    close.type = "button";
    header.append(titleWrap, close);
    const status = el("div", "av-status", "Saved locally");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const body = el("div", "av-panel-body");
    panel.append(header, body, status);
    overlay.append(panel);
    shell.append(launcher, overlay);
    shadow.append(style, shell);
    let open = false;
    const setOpen = (value) => {
      open = value;
      launcher.setAttribute("aria-expanded", String(open));
      overlay.classList.toggle("is-open", open);
      overlay.setAttribute("aria-hidden", String(!open));
      if (open) {
        panel.focus({ preventScroll: true });
      } else {
        launcher.focus({ preventScroll: true });
      }
    };
    const setStatus = (message) => {
      status.textContent = message;
    };
    const render = () => {
      body.replaceChildren(
        section("Presets", presetRows()),
        section("Appearance", [
          selectRow("Theme", options.settings.appearance.theme, [
            ["dim", "Dim"],
            ["lightsOut", "Lights out"],
            ["graphite", "Graphite"],
            ["plum", "Plum"],
            ["midnight", "Midnight"]
          ], async (value) => {
            if (!isThemeId(value)) {
              setStatus("Theme value is not supported.");
              return;
            }
            options.settings.appearance.theme = value;
            await save("Theme updated");
          }),
          toggleRow("Dense mode", "Tighten timeline spacing for scanning.", options.settings.appearance.denseMode, async (checked) => {
            options.settings.appearance.denseMode = checked;
            await save("Density updated");
          }),
          toggleRow("High contrast", "Use stronger borders and text contrast.", options.settings.accessibility.highContrast, async (checked) => {
            options.settings.accessibility.highContrast = checked;
            await save("Contrast preference saved");
          })
        ]),
        section("Layout", [
          toggleRow("Hide right sidebar", "Reduce trends, recommendations, and footer noise.", options.settings.layout.hideRightSidebar, async (checked) => {
            options.settings.layout.hideRightSidebar = checked;
            await save("Sidebar preference saved");
          }),
          toggleRow("Hide trends", "Remove trending topics and news modules.", options.settings.layout.hideTrends, async (checked) => {
            options.settings.layout.hideTrends = checked;
            await save("Trend preference saved");
          }),
          toggleRow("Hide Grok surfaces", "Remove Grok drawer and composer buttons where detected.", options.settings.layout.hideGrok, async (checked) => {
            options.settings.layout.hideGrok = checked;
            await save("Grok preference saved");
          })
        ]),
        section("Filtering", filterRows()),
        section("Media", mediaRows()),
        section("Export", exportRows()),
        section("Library", libraryRows()),
        section("Snapshots & Archive", snapshotRows()),
        section("Integrations", integrationRows()),
        section("Backup & Audit", backupRows()),
        section("Trust", [
          readonlyRow("Storage", "Settings stay in this browser."),
          readonlyRow("Telemetry", options.settings.privacy.telemetry ? "Enabled" : "Disabled"),
          readonlyRow("Selector health", selectorSummary())
        ])
      );
    };
    const presetRows = () => {
      const rows = [];
      if (!options.listPresets || !options.applyPreset) {
        rows.push(readonlyRow("Presets", "Preset packs unavailable in this build."));
        return rows;
      }
      for (const preset of options.listPresets()) {
        const row = el("div", "av-row av-row-stack");
        const copy = el("span", "av-row-copy");
        copy.append(
          el("span", "av-row-label", preset.label),
          el("span", "av-row-description", preset.description)
        );
        const apply = el("button", "av-button av-button-secondary", "Apply");
        apply.type = "button";
        apply.addEventListener("click", () => {
          apply.disabled = true;
          void options.applyPreset(preset.id).then((result) => {
            if (result.applied) {
              setStatus(`Applied "${preset.label}" \u2014 ${result.changes.length} changes`);
            } else {
              setStatus(`Preset "${preset.label}" unchanged.`);
            }
          }).catch((error) => {
            options.onError("Could not apply preset", error);
            setStatus("Could not apply preset.");
          }).finally(() => {
            apply.disabled = false;
          });
        });
        row.append(copy, apply);
        rows.push(row);
      }
      if (options.listLocales && options.setLocale) {
        rows.push(
          selectRow(
            "Locale",
            options.settings.i18n.locale,
            options.listLocales().map((entry) => [entry.code, entry.label]),
            async (value) => {
              await options.setLocale(value);
              await save(`Locale set to ${value}`);
            }
          )
        );
      }
      return rows;
    };
    const snapshotRows = () => {
      const rows = [];
      if (options.getSnapshotStatus) {
        const status2 = options.getSnapshotStatus();
        rows.push(
          readonlyRow(
            "Snapshots stored",
            `${status2.total} entries${status2.latestAt ? ` \xB7 latest ${status2.latestKind} of ${status2.latestCount} @ ${status2.latestAt}` : ""}`
          )
        );
      }
      if (options.captureSnapshot) {
        rows.push(
          actionRow(
            "Capture followers from this view",
            "Walks UserCell rows on the current page. Open a /handle/followers view first.",
            async () => {
              try {
                const result = await options.captureSnapshot("followers");
                setStatus(result ? `Captured ${result.count} followers for @${result.handle}.` : "No UserCell rows found.");
              } catch (error) {
                options.onError("Snapshot failed", error);
                setStatus("Snapshot failed.");
              }
            }
          )
        );
        rows.push(
          actionRow(
            "Capture following from this view",
            "Walks UserCell rows on the current page. Open a /handle/following view first.",
            async () => {
              try {
                const result = await options.captureSnapshot("following");
                setStatus(result ? `Captured ${result.count} following for @${result.handle}.` : "No UserCell rows found.");
              } catch (error) {
                options.onError("Snapshot failed", error);
                setStatus("Snapshot failed.");
              }
            }
          )
        );
      }
      if (options.clearSnapshots) {
        rows.push(
          actionRow("Clear all snapshots", "Drop every stored follower/following snapshot.", async () => {
            try {
              await options.clearSnapshots();
              await save("Snapshots cleared");
            } catch (error) {
              options.onError("Could not clear snapshots", error);
              setStatus("Could not clear snapshots.");
            }
          })
        );
      }
      if (options.importArchive) {
        const row = el("div", "av-row av-row-stack");
        const copy = el("span", "av-row-copy");
        copy.append(
          el("span", "av-row-label", "Import official X archive"),
          el("span", "av-row-description", "Pick a ZIP exported from x.com. STORE-only entries only; compressed archives are rejected.")
        );
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".zip,application/zip";
        input.className = "av-file-input";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          void (async () => {
            try {
              const result = await options.importArchive(file);
              const warningsLabel = result.warnings > 0 || result.errors > 0 ? ` (${result.warnings} warning${result.warnings === 1 ? "" : "s"}, ${result.errors} error${result.errors === 1 ? "" : "s"})` : "";
              setStatus(`Imported ${result.records} records${warningsLabel}.`);
            } catch (error) {
              options.onError("Archive import failed", error);
              setStatus("Archive import failed.");
            } finally {
              input.value = "";
            }
          })();
        });
        row.append(copy, input);
        rows.push(row);
      }
      if (options.searchArchive) {
        const row = el("div", "av-row av-row-stack");
        const copy = el("span", "av-row-copy");
        copy.append(
          el("span", "av-row-label", "Search captured records"),
          el("span", "av-row-description", "Full-text search across the latest export collector run.")
        );
        const input = document.createElement("input");
        input.type = "search";
        input.placeholder = "@handle, keyword, phrase\u2026";
        input.className = "av-text-input";
        const results = el("div", "av-search-results");
        results.setAttribute("role", "list");
        const runSearch = () => {
          const hits = options.searchArchive(input.value.trim());
          results.replaceChildren();
          if (hits.length === 0) {
            const empty = el("div", "av-row-description", "No matches yet.");
            results.append(empty);
            return;
          }
          for (const hit of hits.slice(0, 10)) {
            const item = el("div", "av-search-hit");
            const head = el("span", "av-row-label", `@${hit.handle ?? "anon"} \xB7 ${hit.tweetId ?? "\u2014"}`);
            const body2 = el("span", "av-row-description", hit.text.slice(0, 140));
            item.append(head, body2);
            results.append(item);
          }
        };
        input.addEventListener("input", runSearch);
        row.append(copy, input, results);
        rows.push(row);
      }
      if (options.downloadReport) {
        rows.push(
          actionRow("Download Markdown report", "Audit log + snapshot diff + cleanup preview.", async () => {
            try {
              await options.downloadReport();
              setStatus("Report downloaded.");
            } catch (error) {
              options.onError("Could not build report", error);
              setStatus("Could not build report.");
            }
          })
        );
      }
      if (options.getCleanupQueueSize) {
        const queueStatus = options.getCleanupQueueSize();
        rows.push(
          readonlyRow(
            "Cleanup review queue",
            `${queueStatus.total} items \xB7 queued ${queueStatus.queued} \xB7 approved ${queueStatus.approved} \xB7 skipped ${queueStatus.skipped}`
          )
        );
        rows.push(
          readonlyRow(
            "Destructive actions",
            "Disabled by policy in v1.0.0 \u2014 the queue stays a review list. Approve / skip records audit only."
          )
        );
      }
      if (options.enqueueCleanupReview) {
        rows.push(
          actionRow(
            "Enqueue cleanup preview for review",
            "Append every non-protected candidate from the latest cleanup preview to the queue (no destructive action).",
            async () => {
              try {
                const result = await options.enqueueCleanupReview();
                setStatus(`Enqueued ${result.added} items (${result.protected} protected skipped).`);
              } catch (error) {
                options.onError("Could not enqueue cleanup", error);
                setStatus("Could not enqueue cleanup.");
              }
            }
          )
        );
      }
      if (options.clearCleanupQueue) {
        rows.push(
          actionRow("Clear cleanup queue", "Drop every queued item without touching account data.", async () => {
            try {
              await options.clearCleanupQueue();
              await save("Cleanup queue cleared");
            } catch (error) {
              options.onError("Could not clear cleanup queue", error);
              setStatus("Could not clear queue.");
            }
          })
        );
      }
      return rows;
    };
    const integrationRows = () => {
      const rows = [];
      const status2 = options.getIntegrationStatus?.();
      const integrations = options.settings.integrations;
      rows.push(
        toggleRow(
          "Aria2 handoff",
          "Send large media downloads to a self-hosted Aria2 JSON-RPC endpoint.",
          integrations.aria2.enabled,
          async (checked) => {
            integrations.aria2.enabled = checked;
            await save(checked ? "Aria2 handoff on" : "Aria2 handoff off");
          }
        )
      );
      rows.push(
        textInputRow(
          "Aria2 endpoint",
          "http://localhost:6800 (no trailing slash needed)",
          integrations.aria2.endpoint,
          async (value) => {
            integrations.aria2.endpoint = value;
            await save("Aria2 endpoint saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "Aria2 RPC secret",
          "Optional shared secret for token: auth.",
          integrations.aria2.secret,
          async (value) => {
            integrations.aria2.secret = value;
            await save("Aria2 secret saved");
          }
        )
      );
      if (options.pingAria2) {
        rows.push(
          actionRow("Test Aria2 connection", "Sends a trivial JSON-RPC call.", async () => {
            const result = await options.pingAria2();
            setStatus(result.ok ? "Aria2 reachable." : `Aria2 unreachable: ${result.error}`);
          })
        );
      }
      if (options.listAria2Active && options.cancelAria2) {
        const row = el("div", "av-row av-row-stack");
        const copy = el("span", "av-row-copy");
        copy.append(
          el("span", "av-row-label", "Aria2 active downloads"),
          el("span", "av-row-description", "Refresh to list in-flight transfers; tap Cancel to abort one.")
        );
        const list = el("div", "av-search-results");
        const refresh = async () => {
          try {
            const active = await options.listAria2Active();
            list.replaceChildren();
            if (active.length === 0) {
              list.append(el("div", "av-row-description", "No active downloads."));
              return;
            }
            for (const job of active) {
              const item = el("div", "av-search-hit");
              const total = job.totalLength > 0 ? `${Math.round(job.completedLength / job.totalLength * 100)}%` : "?";
              item.append(
                el("span", "av-row-label", `${job.path || job.gid} \xB7 ${total}`),
                el("span", "av-row-description", `gid ${job.gid} \xB7 ${job.status}`)
              );
              const cancel = el("button", "av-button av-button-secondary", "Cancel");
              cancel.type = "button";
              cancel.addEventListener("click", async () => {
                cancel.disabled = true;
                const result = await options.cancelAria2(job.gid);
                cancel.disabled = false;
                if (result.ok) {
                  setStatus(`Cancelled ${job.gid}.`);
                  await refresh();
                } else {
                  setStatus(`Aria2 cancel failed: ${result.error}`);
                }
              });
              item.append(cancel);
              list.append(item);
            }
          } catch (error) {
            options.onError("Aria2 sweep failed", error);
            setStatus("Aria2 sweep failed.");
          }
        };
        const refreshBtn = el("button", "av-button av-button-secondary", "Refresh");
        refreshBtn.type = "button";
        refreshBtn.addEventListener("click", () => void refresh());
        row.append(copy, refreshBtn, list);
        rows.push(row);
      }
      rows.push(
        toggleRow(
          "Bluesky crosspost",
          "Post composer text to your Bluesky account on demand.",
          integrations.bluesky.enabled,
          async (checked) => {
            integrations.bluesky.enabled = checked;
            await save(checked ? "Bluesky on" : "Bluesky off");
          }
        )
      );
      rows.push(
        textInputRow(
          "Bluesky service URL",
          "Default: https://bsky.social",
          integrations.bluesky.service,
          async (value) => {
            integrations.bluesky.service = value;
            await save("Bluesky service saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "Bluesky handle",
          "Your handle (no @, e.g. you.bsky.social)",
          integrations.bluesky.handle,
          async (value) => {
            integrations.bluesky.handle = value;
            await save("Bluesky handle saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "Bluesky app password",
          "App password from your account settings \u2014 never your main password.",
          integrations.bluesky.appPassword,
          async (value) => {
            integrations.bluesky.appPassword = value;
            await save("Bluesky app password saved");
          }
        )
      );
      rows.push(
        toggleRow(
          "Mastodon crosspost",
          "Post composer text to your Mastodon account on demand.",
          integrations.mastodon.enabled,
          async (checked) => {
            integrations.mastodon.enabled = checked;
            await save(checked ? "Mastodon on" : "Mastodon off");
          }
        )
      );
      rows.push(
        textInputRow(
          "Mastodon instance",
          "https://mastodon.social",
          integrations.mastodon.instance,
          async (value) => {
            integrations.mastodon.instance = value;
            await save("Mastodon instance saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "Mastodon access token",
          "Bearer token with write:statuses scope.",
          integrations.mastodon.token,
          async (value) => {
            integrations.mastodon.token = value;
            await save("Mastodon token saved");
          }
        )
      );
      rows.push(
        toggleRow(
          "Attach last download",
          "Upload the last successful Aviary media download with the first post in an explicit crosspost.",
          integrations.crosspost.attachLastDownload,
          async (checked) => {
            integrations.crosspost.attachLastDownload = checked;
            await save(checked ? "Crosspost attachment on" : "Crosspost attachment off");
          }
        )
      );
      if (options.crosspost) {
        const threadRow = el("div", "av-row");
        const copy = el("span", "av-row-copy");
        copy.append(
          el("span", "av-row-label", "Crosspost as thread"),
          el("span", "av-row-description", "Split on blank lines and reply each segment to the previous one.")
        );
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        threadRow.append(copy, checkbox);
        rows.push(threadRow);
        rows.push(
          actionRow("Crosspost composer \u2192 Bluesky", "Uses the current composer text.", async () => {
            const result = await options.crosspost("bluesky", { asThread: checkbox.checked });
            setStatus(
              result.ok ? `Posted ${result.posts ?? 1} to Bluesky.${result.url ? ` ${result.url}` : ""}` : `Bluesky failed: ${result.error}`
            );
          })
        );
        rows.push(
          actionRow("Crosspost composer \u2192 Mastodon", "Uses the current composer text.", async () => {
            const result = await options.crosspost("mastodon", { asThread: checkbox.checked });
            setStatus(
              result.ok ? `Posted ${result.posts ?? 1} to Mastodon.${result.url ? ` ${result.url}` : ""}` : `Mastodon failed: ${result.error}`
            );
          })
        );
      }
      rows.push(
        toggleRow(
          "AI provider runs",
          "Let the AI command menu POST prompts to your configured provider.",
          integrations.ai.enabled,
          async (checked) => {
            integrations.ai.enabled = checked;
            await save(checked ? "AI runs on" : "AI runs off");
          }
        )
      );
      rows.push(
        selectRow(
          "AI provider",
          integrations.ai.provider,
          [
            ["anthropic", "Anthropic Messages API"],
            ["openai", "OpenAI Chat Completions"],
            ["openai-compatible", "OpenAI-compatible (LocalAI, Ollama proxy, \u2026)"]
          ],
          async (value) => {
            if (value === "anthropic" || value === "openai" || value === "openai-compatible") {
              integrations.ai.provider = value;
              await save(`AI provider set to ${value}`);
            }
          }
        )
      );
      rows.push(
        textInputRow(
          "AI endpoint (optional)",
          "Override the default endpoint for the chosen provider.",
          integrations.ai.endpoint,
          async (value) => {
            integrations.ai.endpoint = value;
            await save("AI endpoint saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "AI model",
          "e.g. claude-sonnet-4-6, gpt-4o, llama3.1:8b",
          integrations.ai.model,
          async (value) => {
            integrations.ai.model = value;
            await save("AI model saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "AI API key",
          "Stored locally only. Aviary never sends this except as the auth header to your provider.",
          integrations.ai.apiKey,
          async (value) => {
            integrations.ai.apiKey = value;
            await save("AI API key saved");
          }
        )
      );
      rows.push(
        toggleRow(
          "Semantic search",
          "Embed CheckpointStore records via your provider for similarity search.",
          integrations.semanticSearch.enabled,
          async (checked) => {
            integrations.semanticSearch.enabled = checked;
            await save(checked ? "Semantic search on" : "Semantic search off");
          }
        )
      );
      rows.push(
        textInputRow(
          "Embedding endpoint",
          "POST endpoint that returns {data: [{embedding: number[]}]}",
          integrations.semanticSearch.endpoint,
          async (value) => {
            integrations.semanticSearch.endpoint = value;
            await save("Embedding endpoint saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "Embedding model",
          "e.g. text-embedding-3-small",
          integrations.semanticSearch.model,
          async (value) => {
            integrations.semanticSearch.model = value;
            await save("Embedding model saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "Embedding API key",
          "Stored locally; used only as the Authorization header.",
          integrations.semanticSearch.apiKey,
          async (value) => {
            integrations.semanticSearch.apiKey = value;
            await save("Embedding API key saved");
          }
        )
      );
      rows.push(
        toggleRow(
          "Auto-embed every export",
          "After each export run, kick the embedding job in the background. Off by default.",
          integrations.semanticSearch.autoIndex,
          async (checked) => {
            integrations.semanticSearch.autoIndex = checked;
            await save(checked ? "Auto-embed on" : "Auto-embed off");
          }
        )
      );
      if (options.rebuildSemanticIndex) {
        rows.push(
          actionRow(
            "Rebuild semantic index",
            "Embed every captured record. Re-running is cheap because cached entries are skipped.",
            async () => {
              try {
                const result = await options.rebuildSemanticIndex();
                setStatus(
                  `Indexed: +${result.added} new \xB7 skipped ${result.skipped} \xB7 errors ${result.errors} \xB7 total ${result.total}.`
                );
              } catch (error) {
                options.onError("Embedding failed", error);
                setStatus("Embedding failed.");
              }
            }
          )
        );
      }
      if (options.semanticSearchQuery) {
        const row = el("div", "av-row av-row-stack");
        const copy = el("span", "av-row-copy");
        copy.append(
          el("span", "av-row-label", "Semantic search"),
          el("span", "av-row-description", "Vector similarity over captured records. Embeddings run on demand.")
        );
        const input = document.createElement("input");
        input.type = "search";
        input.placeholder = "Describe what you're looking for\u2026";
        input.className = "av-text-input";
        const results = el("div", "av-search-results");
        let pending;
        input.addEventListener("input", () => {
          if (pending !== void 0) clearTimeout(pending);
          pending = setTimeout(() => {
            void options.semanticSearchQuery(input.value.trim()).then((hits) => {
              results.replaceChildren();
              if (hits.length === 0) {
                results.append(el("div", "av-row-description", "No matches (or integration disabled)."));
                return;
              }
              for (const hit of hits) {
                const item = el("div", "av-search-hit");
                item.append(
                  el("span", "av-row-label", `@${hit.handle ?? "anon"} \xB7 ${hit.tweetId ?? "\u2014"} \xB7 score ${hit.score.toFixed(3)}`),
                  el("span", "av-row-description", hit.text.slice(0, 200))
                );
                results.append(item);
              }
            }).catch((error) => {
              options.onError("Semantic search failed", error);
            });
          }, 220);
        });
        row.append(copy, input, results);
        rows.push(row);
      }
      if (options.clearSemanticIndex) {
        rows.push(
          actionRow("Clear semantic index", "Forget every embedded record.", async () => {
            await options.clearSemanticIndex();
            await save("Semantic index cleared");
          })
        );
      }
      if (status2) {
        const lines = [
          `Aria2: ${status2.aria2.enabled ? "on" : "off"} \xB7 ${status2.aria2.configured ? "configured" : "missing endpoint"}`,
          `Bluesky: ${status2.bluesky.enabled ? "on" : "off"} \xB7 ${status2.bluesky.configured ? "configured" : "missing credentials"}`,
          `Mastodon: ${status2.mastodon.enabled ? "on" : "off"} \xB7 ${status2.mastodon.configured ? "configured" : "missing credentials"}`,
          `AI: ${status2.ai.enabled ? "on" : "off"} \xB7 ${status2.ai.configured ? "configured" : "missing key/model"}`,
          `Semantic: ${status2.semanticSearch.enabled ? "on" : "off"} \xB7 ${status2.semanticSearch.indexed} indexed`
        ];
        rows.push(readonlyRow("Integration status", lines.join(" \xB7 ")));
      }
      if (options.recentIntegrationErrors) {
        const errors = options.recentIntegrationErrors();
        if (errors.length === 0) {
          rows.push(readonlyRow("Recent integration errors", "None recorded."));
        } else {
          const row = el("div", "av-row av-row-stack");
          const copy = el("span", "av-row-copy");
          copy.append(
            el("span", "av-row-label", "Recent integration errors"),
            el("span", "av-row-description", "Drawn from the audit log; only failed integration calls show up.")
          );
          const list = el("div", "av-search-results");
          for (const error of errors.slice(0, 8)) {
            const item = el("div", "av-search-hit");
            item.append(
              el("span", "av-row-label", `${error.kind} \xB7 ${error.at}`),
              el("span", "av-row-description", error.message.slice(0, 200))
            );
            list.append(item);
          }
          row.append(copy, list);
          rows.push(row);
        }
      }
      return rows;
    };
    const libraryRows = () => {
      const rows = [];
      rows.push(
        toggleRow(
          "Unshorten t.co links",
          "Replace short `t.co` redirects with the destination from aria-labels and titles.",
          options.settings.links.expandTco,
          async (checked) => {
            options.settings.links.expandTco = checked;
            await save(checked ? "Unshorten on" : "Unshorten off");
          }
        )
      );
      if (options.getUserNotes && options.setUserNote) {
        const notes = options.getUserNotes();
        const serialized = Object.entries(notes).map(([handle, note]) => `${handle}: ${note}`).sort();
        rows.push(
          textareaRow(
            "Account notes",
            "Format: handle: note. One per line. Empty notes remove the entry.",
            serialized,
            async (lines) => {
              const seen = /* @__PURE__ */ new Set();
              for (const line of lines) {
                const match = /^@?([A-Za-z0-9_]{1,15})\s*[:\-]\s*(.*)$/.exec(line);
                if (!match) continue;
                const [, handle, note] = match;
                if (handle) {
                  seen.add(handle.toLowerCase());
                  await options.setUserNote(handle, note ?? "");
                }
              }
              for (const handle of Object.keys(notes)) {
                if (!seen.has(handle)) {
                  await options.setUserNote(handle, "");
                }
              }
              await save(`${seen.size} account note${seen.size === 1 ? "" : "s"} saved`);
            }
          )
        );
      }
      if (options.clearUserNotes) {
        rows.push(
          actionRow("Clear all account notes", "Drop every persisted note.", async () => {
            try {
              await options.clearUserNotes();
              await save("Account notes cleared");
            } catch (error) {
              options.onError("Could not clear account notes", error);
              setStatus("Could not clear notes.");
            }
          })
        );
      }
      rows.push(
        textareaRow(
          "Composer snippets",
          "One snippet per line. Reusable replies / templates (insertion landing in a later release).",
          options.settings.composer.snippets,
          async (lines) => {
            options.settings.composer.snippets = lines.map((line) => line.trim()).filter((line) => line.length > 0).slice(0, 100);
            await save(`${options.settings.composer.snippets.length} snippet${options.settings.composer.snippets.length === 1 ? "" : "s"} saved`);
          }
        )
      );
      return rows;
    };
    const backupRows = () => {
      const rows = [];
      if (options.exportSettings) {
        rows.push(
          actionRow("Export settings", "Download a JSON file with every Aviary preference.", async () => {
            try {
              await options.exportSettings();
              setStatus("Settings exported.");
            } catch (error) {
              options.onError("Could not export settings", error);
              setStatus("Could not export settings.");
            }
          })
        );
      }
      if (options.importSettings) {
        rows.push(
          textareaRow(
            "Import settings (JSON)",
            "Paste a previously exported settings envelope and press Save list to apply.",
            [],
            async (lines) => {
              const payload = lines.join("\n");
              try {
                const report = await options.importSettings(payload);
                if (report.applied) {
                  const warnings = report.warnings.length > 0 ? ` (${report.warnings.length} warning(s))` : "";
                  setStatus(`Settings imported${warnings}.`);
                } else {
                  setStatus(`Import failed: ${report.errors.join("; ")}`);
                }
              } catch (error) {
                options.onError("Could not import settings", error);
                setStatus("Could not import settings.");
              }
            }
          )
        );
      }
      if (options.getAuditSize) {
        rows.push(readonlyRow("Audit entries", String(options.getAuditSize())));
      }
      if (options.clearAuditLog) {
        rows.push(
          actionRow("Clear audit log", "Drop the local action log.", async () => {
            try {
              await options.clearAuditLog();
              await save("Audit log cleared");
            } catch (error) {
              options.onError("Could not clear audit log", error);
              setStatus("Could not clear audit log.");
            }
          })
        );
      }
      return rows;
    };
    const exportRows = () => {
      const rows = [];
      rows.push(
        toggleRow(
          "Capture visible tweets",
          "Accumulate tweets visible on the active page for the next export run.",
          options.settings.export.enabled,
          async (checked) => {
            options.settings.export.enabled = checked;
            await save(checked ? "Export capture on" : "Export capture off");
          }
        )
      );
      rows.push(
        textInputRow(
          "Export formats",
          "Comma-separated list. Supported: json, csv, html, markdown (xlsx is deferred).",
          options.settings.export.formats.join(","),
          async (value) => {
            const parsed = value.split(/[\s,]+/).map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
            const supported = /* @__PURE__ */ new Set(["json", "csv", "html", "markdown", "xlsx"]);
            options.settings.export.formats = parsed.filter((entry) => supported.has(entry));
            if (options.settings.export.formats.length === 0) {
              options.settings.export.formats = ["json"];
            }
            await save(`Export formats: ${options.settings.export.formats.join(", ")}`);
          }
        )
      );
      rows.push(
        toggleRow(
          "Preserve raw payloads",
          "Store unparsed responses next to records for future parser recovery (off until F091 lands).",
          options.settings.export.preserveRawPayloads,
          async (checked) => {
            options.settings.export.preserveRawPayloads = checked;
            await save("Raw payload preference saved");
          }
        )
      );
      rows.push(
        toggleRow(
          "Auto-discover query IDs",
          "Scan loaded scripts for X GraphQL operation IDs and cache them locally.",
          options.settings.export.autoDiscoverQueryIds,
          async (checked) => {
            options.settings.export.autoDiscoverQueryIds = checked;
            await save("Query discovery preference saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "Save folder hint",
          "Folder name (or path) used as the export ZIP root and download prefix.",
          options.settings.media.lastSaveFolder,
          async (value) => {
            options.settings.media.lastSaveFolder = value;
            await save("Save folder hint saved");
          }
        )
      );
      const status2 = options.getExportStatus?.();
      if (status2) {
        rows.push(
          readonlyRow(
            "Export status",
            `${status2.jobCount} jobs tracked \xB7 ${status2.knownQueries} GraphQL IDs cached`
          )
        );
      }
      if (options.runExport) {
        rows.push(
          actionRow("Export visible tweets", "Collect the currently rendered tweets and download a ZIP.", async () => {
            try {
              const result = await options.runExport();
              setStatus(`Exported ${result.records} records \u2192 ${result.filename}`);
            } catch (error) {
              options.onError("Export failed", error);
              setStatus("Export failed. See diagnostics.");
            }
          })
        );
      }
      if (options.copyDiagnostics) {
        rows.push(
          actionRow("Copy diagnostics", "Copy support diagnostics (version, route, recent log).", async () => {
            try {
              await options.copyDiagnostics();
              setStatus("Diagnostics copied to clipboard.");
            } catch (error) {
              options.onError("Could not copy diagnostics", error);
              setStatus("Could not copy diagnostics.");
            }
          })
        );
      }
      if (options.downloadWarc) {
        rows.push(
          actionRow(
            "Download as WARC",
            "Wrap captured records into an ISO-28500 WARC file for research / preservation tooling.",
            async () => {
              try {
                const result = await options.downloadWarc();
                setStatus(`WARC downloaded (${result.records} records).`);
              } catch (error) {
                options.onError("WARC export failed", error);
                setStatus("WARC export failed.");
              }
            }
          )
        );
      }
      if (options.exportToTarget) {
        const targets = [
          { id: "clipboard-markdown", label: "Copy as Markdown", description: "Push a plain Markdown export onto the clipboard." },
          { id: "obsidian", label: "Save Obsidian Markdown", description: "Markdown with YAML frontmatter and Aviary tags." },
          { id: "notion", label: "Save Notion Markdown", description: "Heading-first Markdown that Notion imports cleanly." },
          { id: "raw-json", label: "Save records JSON", description: "Raw ExportRecord[] JSON without ZIP wrapping." }
        ];
        for (const target of targets) {
          rows.push(
            actionRow(target.label, target.description, async () => {
              try {
                const result = await options.exportToTarget(target.id);
                setStatus(
                  result.copied ? `Copied ${result.records} records to clipboard.` : `Exported ${result.records} records \u2192 ${target.label.toLowerCase()}.`
                );
              } catch (error) {
                options.onError("External export failed", error);
                setStatus("External export failed.");
              }
            })
          );
        }
      }
      if (options.getRetentionPolicy && options.saveRetentionPolicy) {
        const policy = options.getRetentionPolicy();
        rows.push(
          integerInputRow(
            "Maximum export jobs",
            "Keep the newest jobs. Use 0 for unlimited.",
            policy.maxJobs,
            async (value) => {
              await options.saveRetentionPolicy({ ...options.getRetentionPolicy(), maxJobs: value });
              render();
              setStatus("Export job retention saved");
            }
          )
        );
        rows.push(
          integerInputRow(
            "Maximum records per job",
            "Keep the newest records in each job. Use 0 for unlimited.",
            policy.maxRecordsPerJob,
            async (value) => {
              await options.saveRetentionPolicy({ ...options.getRetentionPolicy(), maxRecordsPerJob: value });
              render();
              setStatus("Record retention saved");
            }
          )
        );
        rows.push(
          integerInputRow(
            "Maximum export age (days)",
            "Remove older jobs at boot. Use 0 to disable age-based cleanup.",
            policy.maxAgeDays,
            async (value) => {
              await options.saveRetentionPolicy({ ...options.getRetentionPolicy(), maxAgeDays: value });
              render();
              setStatus("Age-based retention saved");
            }
          )
        );
      }
      return rows;
    };
    const mediaRows = () => {
      const rows = [];
      rows.push(
        toggleRow(
          "Show download buttons",
          "Inject Save and Thumb buttons over tweet photos and video thumbnails.",
          options.settings.media.buttons,
          async (checked) => {
            options.settings.media.buttons = checked;
            await save(checked ? "Media buttons on" : "Media buttons off");
          }
        )
      );
      rows.push(
        toggleRow(
          "Prefer original quality",
          "Rewrite image URLs to name=orig before downloading.",
          options.settings.media.preferOriginalImages,
          async (checked) => {
            options.settings.media.preferOriginalImages = checked;
            await save("Original quality preference saved");
          }
        )
      );
      rows.push(
        textInputRow(
          "Filename template",
          "Fields: {handle}, {tweetId}, {mediaId}, {index}, {total}, {date}, {text}, {ext}.",
          options.settings.media.filenameTemplate,
          async (value) => {
            options.settings.media.filenameTemplate = value.length > 0 ? value : "{handle}_{tweetId}_{index}";
            await save("Filename template saved");
          }
        )
      );
      rows.push(
        toggleRow(
          "Duplicate history",
          "Skip downloads of media you have already saved from this browser.",
          options.settings.media.downloadHistory,
          async (checked) => {
            options.settings.media.downloadHistory = checked;
            await save(checked ? "Duplicate history on" : "Duplicate history off");
          }
        )
      );
      rows.push(
        selectRow(
          "Sensitive content",
          options.settings.media.sensitive,
          SENSITIVE_OPTIONS,
          async (value) => {
            options.settings.media.sensitive = coerceSensitive(value);
            await save("Sensitive content preference saved");
          }
        )
      );
      rows.push(
        selectRow(
          "Media layout",
          options.settings.media.layout,
          MEDIA_LAYOUT_OPTIONS,
          async (value) => {
            options.settings.media.layout = coerceLayout(value);
            await save("Media layout saved");
          }
        )
      );
      const status2 = options.getMediaStatus?.();
      if (status2) {
        rows.push(
          readonlyRow(
            "Download status",
            `${status2.running} running / ${status2.completed} done / ${status2.duplicate} dup / ${status2.failed} failed`
          )
        );
        rows.push(readonlyRow("History entries", String(status2.historySize)));
      }
      if (options.clearMediaHistory) {
        rows.push(
          actionRow("Clear download history", "Reset the local dedup index.", async () => {
            try {
              await options.clearMediaHistory?.();
              await save("History cleared");
            } catch (error) {
              options.onError("Could not clear download history", error);
              setStatus("Could not clear history.");
            }
          })
        );
      }
      if (options.runMediaBatch) {
        rows.push(
          actionRow(
            "Download all visible media",
            "Walks every tweet rendered on the current page and queues every photo/video/GIF/thumbnail through the existing download pipeline.",
            async () => {
              try {
                const result = await options.runMediaBatch();
                setStatus(
                  `Batch finished: ${result.downloaded} saved / ${result.duplicate} dup / ${result.failed} failed (of ${result.total}).`
                );
              } catch (error) {
                options.onError("Batch download failed", error);
                setStatus("Batch download failed.");
              }
            }
          )
        );
      }
      return rows;
    };
    const filterRows = () => {
      const rows = [];
      rows.push(
        toggleRow(
          "Enable filters",
          "Master switch for keyword, regex, premium, and media filters.",
          options.settings.filter.enabled,
          async (checked) => {
            options.settings.filter.enabled = checked;
            await save(checked ? "Filters enabled" : "Filters disabled");
          }
        )
      );
      rows.push(
        textareaRow(
          "Keyword rules",
          "One keyword or phrase per line. Case-insensitive substring match.",
          options.settings.filter.keywordRules,
          async (lines) => {
            options.settings.filter.keywordRules = lines.slice(0, 200);
            await save(`Saved ${options.settings.filter.keywordRules.length} keyword rules`);
          }
        )
      );
      rows.push(
        textareaRow(
          "Regex rules",
          "One pattern per line. Use /pattern/flags or a bare pattern (case-insensitive).",
          options.settings.filter.regexRules,
          async (lines) => {
            options.settings.filter.regexRules = lines.slice(0, 100);
            await save(`Saved ${options.settings.filter.regexRules.length} regex rules`);
          }
        )
      );
      rows.push(
        textareaRow(
          "Whitelist handles",
          "Handles (one per line, no @) that are never filtered.",
          options.settings.filter.whitelist,
          async (lines) => {
            options.settings.filter.whitelist = lines.map((line) => line.replace(/^@/, "").trim()).filter((line) => /^[A-Za-z0-9_]{1,15}$/.test(line)).slice(0, 200);
            await save(`Saved ${options.settings.filter.whitelist.length} whitelist handles`);
          }
        )
      );
      rows.push(
        selectRow(
          "Premium / verified posts",
          options.settings.filter.premiumRule,
          FILTER_ACTION_OPTIONS,
          async (value) => {
            options.settings.filter.premiumRule = coerceFilterAction(value);
            await save("Premium filter saved");
          }
        )
      );
      for (const key of FILTER_MEDIA_KEYS) {
        const label = FILTER_MEDIA_LABELS[key];
        const current = options.settings.filter.mediaTypes[key] === true;
        rows.push(
          toggleRow(
            `Hide posts with ${label.toLowerCase()}`,
            `Filter posts containing ${label.toLowerCase()}.`,
            current,
            async (checked) => {
              options.settings.filter.mediaTypes = {
                ...options.settings.filter.mediaTypes,
                [key]: checked
              };
              await save(`${label} filter ${checked ? "on" : "off"}`);
            }
          )
        );
      }
      rows.push(
        surfaceRow(
          "Active on",
          "Routes where filters run.",
          options.settings.filter.surfaces,
          async (next) => {
            options.settings.filter.surfaces = next;
            await save(
              next.length > 0 ? `Filters active on ${next.length} route${next.length === 1 ? "" : "s"}` : "Filters off on every route"
            );
          }
        )
      );
      rows.push(
        readonlyRow(
          "Blocked accounts / self-reposts",
          "Pending an authenticated fixture; controls stay disabled."
        )
      );
      return rows;
    };
    const save = async (message) => {
      setStatus("Saving...");
      try {
        await options.onChange();
        render();
        setStatus(message);
      } catch (error) {
        options.onError("Control Center could not save settings", error);
        setStatus("Could not save settings. Try again.");
      }
    };
    const selectorSummary = () => {
      const last = [...options.diagnostics()].reverse().find((event) => event.message.includes("Selector"));
      return last?.message ?? "Monitoring active";
    };
    launcher.addEventListener("click", () => setOpen(!open));
    close.addEventListener("click", () => setOpen(false));
    render();
    return {
      destroy() {
        host.remove();
      },
      refresh() {
        render();
      }
    };
  }
  function section(title, rows) {
    const node = el("section", "av-section");
    node.append(el("h3", "av-section-title", title), ...rows);
    return node;
  }
  function toggleRow(label, description, checked, onChange) {
    const row = el("label", "av-row");
    const copy = el("span", "av-row-copy");
    copy.append(el("span", "av-row-label", label), el("span", "av-row-description", description));
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => {
      void onChange(input.checked);
    });
    row.append(copy, input);
    return row;
  }
  function selectRow(label, value, options, onChange) {
    const row = el("label", "av-row");
    row.append(el("span", "av-row-label", label));
    const select = document.createElement("select");
    select.className = "av-select";
    for (const [optionValue, optionLabel] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      option.selected = optionValue === value;
      select.append(option);
    }
    select.addEventListener("change", () => {
      void onChange(select.value);
    });
    row.append(select);
    return row;
  }
  function readonlyRow(label, value) {
    const row = el("div", "av-row av-row-readonly");
    row.append(el("span", "av-row-label", label), el("span", "av-row-description", value));
    return row;
  }
  function textInputRow(label, description, value, onChange) {
    const row = el("div", "av-row av-row-stack");
    const copy = el("span", "av-row-copy");
    copy.append(el("span", "av-row-label", label), el("span", "av-row-description", description));
    row.append(copy);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "av-text-input";
    input.value = value;
    input.spellcheck = false;
    input.setAttribute("aria-label", label);
    const apply = el("button", "av-button av-button-secondary", "Save");
    apply.type = "button";
    apply.addEventListener("click", () => {
      void onChange(input.value.trim());
    });
    row.append(input, apply);
    return row;
  }
  function integerInputRow(label, description, value, onChange) {
    const row = el("div", "av-row av-row-stack");
    const copy = el("span", "av-row-copy");
    copy.append(el("span", "av-row-label", label), el("span", "av-row-description", description));
    row.append(copy);
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.className = "av-text-input";
    input.value = String(value);
    input.setAttribute("aria-label", label);
    const apply = el("button", "av-button av-button-secondary", "Save");
    apply.type = "button";
    apply.addEventListener("click", () => {
      const parsed = Number.parseInt(input.value, 10);
      void onChange(Number.isFinite(parsed) ? parsed : 0);
    });
    row.append(input, apply);
    return row;
  }
  function actionRow(label, description, onClick) {
    const row = el("div", "av-row");
    const copy = el("span", "av-row-copy");
    copy.append(el("span", "av-row-label", label), el("span", "av-row-description", description));
    row.append(copy);
    const button2 = el("button", "av-button av-button-secondary", label);
    button2.type = "button";
    button2.addEventListener("click", () => {
      button2.disabled = true;
      void onClick().finally(() => {
        button2.disabled = false;
      });
    });
    row.append(button2);
    return row;
  }
  function textareaRow(label, description, lines, onChange) {
    const row = el("div", "av-row av-row-stack");
    const copy = el("span", "av-row-copy");
    copy.append(el("span", "av-row-label", label), el("span", "av-row-description", description));
    row.append(copy);
    const textarea = document.createElement("textarea");
    textarea.className = "av-textarea";
    textarea.value = lines.join("\n");
    textarea.spellcheck = false;
    textarea.rows = 4;
    textarea.setAttribute("aria-label", label);
    const apply = el("button", "av-button av-button-secondary", "Save list");
    apply.type = "button";
    apply.addEventListener("click", () => {
      const next = textarea.value.split(/\r?\n/).map((line) => line.trim()).filter((line, index, array) => line.length > 0 && array.indexOf(line) === index);
      void onChange(next);
    });
    row.append(textarea, apply);
    return row;
  }
  function surfaceRow(label, description, selected, onChange) {
    const row = el("div", "av-row av-row-stack");
    const copy = el("span", "av-row-copy");
    copy.append(el("span", "av-row-label", label), el("span", "av-row-description", description));
    row.append(copy);
    const group = el("div", "av-chip-group");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    const state = new Set(selected);
    for (const surface of FILTER_SURFACES) {
      const chip = document.createElement("label");
      chip.className = "av-chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.has(surface);
      input.value = surface;
      input.addEventListener("change", () => {
        if (input.checked) {
          state.add(surface);
        } else {
          state.delete(surface);
        }
        void onChange(FILTER_SURFACES.filter((value) => state.has(value)));
      });
      const text = el("span", "av-chip-label", FILTER_SURFACE_LABELS[surface]);
      chip.append(input, text);
      group.append(chip);
    }
    row.append(group);
    return row;
  }
  function coerceFilterAction(value) {
    return value === "hide" || value === "dim" ? value : "off";
  }
  function coerceSensitive(value) {
    return value === "reveal" || value === "blur" || value === "hide" ? value : "default";
  }
  function coerceLayout(value) {
    return value === "stacked" || value === "grid" ? value : "default";
  }
  function button(label, className) {
    const node = document.createElement("button");
    node.className = className;
    node.textContent = label;
    return node;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== void 0) {
      node.textContent = text;
    }
    return node;
  }
  var CONTROL_CENTER_CSS = `
:host {
  color-scheme: dark;
  font-family: TwitterChirp, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.av-shell {
  position: fixed;
  inset: 0;
  z-index: 2147482600;
  pointer-events: none;
}

.av-launcher {
  position: fixed;
  right: 18px;
  bottom: 18px;
  min-width: 78px;
  min-height: 42px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 70%, transparent);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(29, 155, 240, 0.22), rgba(29, 155, 240, 0.12));
  color: var(--av-text, rgb(239, 243, 244));
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.42);
  cursor: pointer;
  font: 700 13px/1.1 inherit;
  letter-spacing: 0;
  pointer-events: auto;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
}

.av-launcher:hover {
  transform: translateY(-1px);
  border-color: var(--av-accent, rgb(29, 155, 240));
}

.av-launcher:focus-visible,
.av-button:focus-visible,
.av-select:focus-visible,
input:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 3px;
}

.av-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  justify-content: end;
  align-items: end;
  padding: 72px 18px 72px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity 160ms ease, transform 160ms ease;
}

.av-overlay.is-open {
  opacity: 1;
  pointer-events: none;
  transform: translateY(0);
}

.av-panel {
  width: min(386px, calc(100vw - 36px));
  max-height: min(720px, calc(100vh - 96px));
  overflow: auto;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 12px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 96%, black);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.58);
  pointer-events: auto;
}

.av-panel-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--av-border, rgb(47, 51, 54));
}

.av-title {
  margin: 0;
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 18px;
  line-height: 1.25;
}

.av-subtitle {
  margin: 4px 0 0;
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 13px;
  line-height: 1.35;
}

.av-button,
.av-select {
  min-height: 34px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 8px;
  background: var(--av-surface-raised, rgb(22, 24, 28));
  color: var(--av-text, rgb(239, 243, 244));
  font: 650 13px/1.2 inherit;
}

.av-button {
  padding: 0 12px;
  cursor: pointer;
}

.av-panel-body {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.av-section {
  display: grid;
  gap: 8px;
}

.av-section-title {
  margin: 0;
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  text-transform: uppercase;
}

.av-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 48px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--av-border, rgb(47, 51, 54)) 82%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(22, 24, 28)) 62%, transparent);
}

.av-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.av-textarea,
.av-text-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 8px;
  background: var(--av-surface, rgb(15, 20, 25));
  color: var(--av-text, rgb(239, 243, 244));
  font: 12px/1.4 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

.av-textarea {
  min-height: 96px;
  resize: vertical;
}

.av-text-input {
  height: 34px;
}

.av-file-input {
  width: 100%;
  color: var(--av-text, rgb(239, 243, 244));
  font: 12px/1.4 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

.av-search-results {
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}

.av-search-hit {
  display: grid;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--av-border, rgb(47, 51, 54)) 70%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 70%, transparent);
}

.av-textarea:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 2px;
}

.av-chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.av-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 6px;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(22, 24, 28)) 70%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
}

.av-chip input[type="checkbox"] {
  width: 14px;
  height: 14px;
}

.av-chip-label {
  font-weight: 650;
}

.av-row-copy {
  display: grid;
  gap: 3px;
}

.av-row-label {
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 13px;
  font-weight: 720;
  line-height: 1.25;
}

.av-row-description {
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 12px;
  line-height: 1.35;
}

input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--av-accent, rgb(29, 155, 240));
}

.av-select {
  max-width: 150px;
  padding: 0 10px;
}

.av-status {
  min-height: 35px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--av-border, rgb(47, 51, 54));
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 12px;
  line-height: 1.3;
}

@media (prefers-reduced-motion: reduce) {
  .av-launcher,
  .av-overlay {
    transition: none;
  }
}
`;

  // src/features/core/presets.ts
  var PRESETS = [
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
  function listPresets() {
    return PRESETS.map((preset) => ({ ...preset, overrides: cloneOverrides(preset.overrides) }));
  }
  function getPreset(id) {
    return listPresets().find((preset) => preset.id === id);
  }
  function applyPreset(current, preset) {
    const next = cloneSettings(current);
    for (const [section2, overrides] of Object.entries(preset.overrides)) {
      if (!overrides) continue;
      const target = next[section2];
      if (!target) continue;
      for (const [key, value] of Object.entries(overrides)) {
        target[key] = value;
      }
    }
    return normalizeSettings(next);
  }
  function describePresetDelta(current, preset) {
    const result = [];
    const next = applyPreset(current, preset);
    for (const section2 of Object.keys(preset.overrides)) {
      const currentSection = current[section2] ?? {};
      const nextSection = next[section2] ?? {};
      for (const key of Object.keys(preset.overrides[section2] ?? {})) {
        const before = JSON.stringify(currentSection[key]);
        const after = JSON.stringify(nextSection[key]);
        if (before !== after) {
          result.push(`${section2}.${key}: ${before} \u2192 ${after}`);
        }
      }
    }
    return result;
  }
  function cloneOverrides(overrides) {
    return JSON.parse(JSON.stringify(overrides));
  }

  // src/features/integrations/semantic-search.ts
  var SEMANTIC_INDEX_KEY = "aviary.semanticIndex.v1";
  var EMPTY = { entries: [], model: "" };
  var SemanticIndex = class {
    #storage;
    #state = EMPTY;
    #loaded = false;
    constructor(storage) {
      this.#storage = storage;
    }
    async load() {
      if (this.#loaded) return;
      const stored = await this.#storage.get(SEMANTIC_INDEX_KEY, EMPTY);
      this.#state = {
        entries: Array.isArray(stored?.entries) ? stored.entries.filter(isEntry) : [],
        model: typeof stored?.model === "string" ? stored.model : ""
      };
      this.#loaded = true;
    }
    size() {
      return this.#state.entries.length;
    }
    model() {
      return this.#state.model;
    }
    async embedAndIndex(config, records) {
      if (!config.enabled || !config.endpoint || !config.apiKey || !config.model) {
        return { added: 0, skipped: records.length, errors: 0 };
      }
      await this.load();
      if (this.#state.model && this.#state.model !== config.model) {
        this.#state = { entries: [], model: config.model };
      } else {
        this.#state.model = config.model;
      }
      const known = new Set(this.#state.entries.map((entry) => entry.id));
      let added = 0;
      let skipped = 0;
      let errors = 0;
      for (const record of records) {
        const id = `${record.tweetId ?? "no-id"}:${(record.text || "").slice(0, 80)}`;
        if (known.has(id) || record.text.length === 0) {
          skipped += 1;
          continue;
        }
        const vector = await fetchEmbedding(config, record.text);
        if (!vector) {
          errors += 1;
          continue;
        }
        this.#state.entries.push({
          id,
          tweetId: record.tweetId,
          handle: record.handle,
          text: record.text,
          vector,
          embeddedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        known.add(id);
        added += 1;
      }
      await this.#persist();
      return { added, skipped, errors };
    }
    async search(config, query, limit = 10) {
      if (!config.enabled || !config.endpoint || !config.apiKey || !config.model || query.trim().length === 0) {
        return [];
      }
      await this.load();
      if (this.#state.entries.length === 0) return [];
      const queryVector = await fetchEmbedding(config, query);
      if (!queryVector) return [];
      const hits = this.#state.entries.map((entry) => ({ entry, score: cosineSimilarity(queryVector, entry.vector) })).sort((a, b) => b.score - a.score).slice(0, limit);
      return hits;
    }
    async clear() {
      this.#state = { entries: [], model: this.#state.model };
      this.#loaded = true;
      await this.#persist();
    }
    async #persist() {
      try {
        await this.#storage.set(SEMANTIC_INDEX_KEY, this.#state);
      } catch {
      }
    }
  };
  async function fetchEmbedding(config, text) {
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({ model: config.model, input: text })
      });
      if (!response.ok) return null;
      const payload = await response.json();
      if (Array.isArray(payload?.embedding)) return payload.embedding;
      const vector = payload?.data?.[0]?.embedding;
      return Array.isArray(vector) ? vector : null;
    } catch {
      return null;
    }
  }
  function cosineSimilarity(a, b) {
    const length = Math.min(a.length, b.length);
    if (length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < length; i++) {
      const av = a[i];
      const bv = b[i];
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  function isEntry(value) {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value;
    return typeof candidate.id === "string" && Array.isArray(candidate.vector);
  }

  // src/features/media/urls.ts
  var IMAGE_HOST = "pbs.twimg.com";
  var FORMAT_PRIORITY = ["jpg", "png", "webp"];
  function normalizeImageUrl(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl, "https://x.com");
    } catch {
      return null;
    }
    if (parsed.hostname !== IMAGE_HOST) {
      return null;
    }
    if (!parsed.pathname.startsWith("/media/")) {
      return null;
    }
    const params = parsed.searchParams;
    const requestedFormat = (params.get("format") ?? "").toLowerCase();
    const format = FORMAT_PRIORITY.includes(requestedFormat) ? requestedFormat : "jpg";
    params.set("format", format);
    params.set("name", "orig");
    const mediaId = mediaIdFromPath(parsed.pathname);
    return {
      url: `${parsed.origin}${parsed.pathname}?${params.toString()}`,
      format,
      mediaId
    };
  }
  function mediaIdFromPath(pathname) {
    const match = /\/media\/([A-Za-z0-9_-]{6,})(?:\.[A-Za-z0-9]+)?$/.exec(pathname);
    return match?.[1] ?? null;
  }
  function tweetIdFromHref(href) {
    if (!href) {
      return null;
    }
    const match = /\/status(?:es)?\/(\d{6,})/.exec(href);
    return match?.[1] ?? null;
  }

  // src/features/media/video-extract.ts
  var VIDEO_SELECTOR = '[data-testid="videoPlayer"], [data-testid="videoComponent"]';
  function extractVideos(article) {
    const results = [];
    for (const container of Array.from(article.querySelectorAll(VIDEO_SELECTOR))) {
      const extracted = extractVideo(container);
      if (extracted) {
        results.push(extracted);
      }
    }
    return results;
  }
  function extractVideo(container) {
    const video = container.querySelector("video");
    if (!video) {
      return null;
    }
    const variants = [];
    const seen = /* @__PURE__ */ new Set();
    if (video.currentSrc) {
      pushVariant(variants, seen, video.currentSrc, video.dataset.contentType ?? "video/mp4");
    }
    if (video.src) {
      pushVariant(variants, seen, video.src, "video/mp4");
    }
    for (const source of Array.from(video.querySelectorAll("source"))) {
      pushVariant(
        variants,
        seen,
        source.src,
        source.type || "video/mp4",
        source.dataset.width,
        source.dataset.height,
        source.dataset.bitrate
      );
    }
    if (variants.length === 0) {
      return null;
    }
    const preferred = pickPreferred(variants);
    const poster = video.poster || null;
    const isGif = looksLikeGif(container, video, variants);
    return { container, poster, isGif, variants, preferred };
  }
  function pushVariant(variants, seen, src, type, width, height, bitrate) {
    if (!src || seen.has(src)) {
      return;
    }
    seen.add(src);
    variants.push({
      url: src,
      type,
      width: parsePositiveInt(width),
      height: parsePositiveInt(height),
      bitrate: parsePositiveInt(bitrate)
    });
  }
  function pickPreferred(variants) {
    const sorted = [...variants].sort((a, b) => {
      const bitrateDiff = (b.bitrate ?? 0) - (a.bitrate ?? 0);
      if (bitrateDiff !== 0) {
        return bitrateDiff;
      }
      const aPixels = (a.width ?? 0) * (a.height ?? 0);
      const bPixels = (b.width ?? 0) * (b.height ?? 0);
      return bPixels - aPixels;
    });
    return sorted[0] ?? variants[0];
  }
  function looksLikeGif(container, video, variants) {
    if (video.loop && video.muted) {
      return true;
    }
    const label = (container.getAttribute("aria-label") ?? "").toLowerCase();
    if (label.includes("gif")) {
      return true;
    }
    return variants.some((variant) => variant.url.toLowerCase().includes("tweet_video"));
  }
  function parsePositiveInt(value) {
    if (!value) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  // src/features/media/extract.ts
  function extractTweet(article) {
    const tweetId = readTweetId(article);
    const handle = readHandle(article);
    const text = readText(article);
    const media = [];
    for (const img of Array.from(
      article.querySelectorAll('[data-testid="tweetPhoto"] img')
    )) {
      const normalized = normalizeImageUrl(img.src);
      if (normalized) {
        media.push({ kind: "photo", source: img, image: normalized });
      }
    }
    for (const video of extractVideos(article)) {
      if (video.preferred) {
        media.push({ kind: "video", source: video.container, video });
      }
      if (video.poster) {
        const normalized = normalizeImageUrl(video.poster);
        if (normalized) {
          const fake = document.createElement("img");
          fake.src = video.poster;
          media.push({ kind: "thumbnail", source: fake, image: normalized });
        }
      }
    }
    return { article, tweetId, handle, text, media };
  }
  function readTweetId(article) {
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const link of Array.from(links)) {
      const candidate = tweetIdFromHref(link.getAttribute("href"));
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }
  function readHandle(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    const links = userName?.querySelectorAll('a[href^="/"]') ?? [];
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href") ?? "";
      const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
      const candidate = match?.[1];
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }
  function readText(article) {
    const text = article.querySelector('[data-testid="tweetText"]');
    return text?.textContent?.trim() ?? "";
  }

  // src/features/export/collector.ts
  function collectExportRecords(root, surface) {
    const articles = root instanceof Element && root.matches('article[data-testid="tweet"]') ? [root] : Array.from(root.querySelectorAll('article[data-testid="tweet"]'));
    const seen = /* @__PURE__ */ new Set();
    const records = [];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const article of articles) {
      const tweet = extractTweet(article);
      const key = `${tweet.tweetId ?? "noid"}:${tweet.handle ?? "noh"}:${(tweet.text || "").slice(0, 60)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const media = [];
      for (const item of tweet.media) {
        if (item.kind === "video" && item.video?.preferred) {
          const entry = {
            kind: "video",
            url: item.video.preferred.url,
            type: item.video.preferred.type
          };
          if (item.video.preferred.width !== null) entry.width = item.video.preferred.width;
          if (item.video.preferred.height !== null) entry.height = item.video.preferred.height;
          if (item.video.preferred.bitrate !== null) entry.bitrate = item.video.preferred.bitrate;
          media.push(entry);
        } else if (item.image) {
          const entry = {
            kind: item.kind === "thumbnail" ? "thumbnail" : "photo",
            url: item.image.url,
            type: item.image.format
          };
          if (item.source instanceof HTMLImageElement && item.source.alt) {
            entry.altText = item.source.alt;
          }
          media.push(entry);
        }
      }
      const displayName = readDisplayName(article);
      const permalink = readPermalink(article, tweet.handle, tweet.tweetId);
      const poll = readPoll(article);
      const quote = readQuote(article);
      const articleSummary = readArticle(article);
      const birdwatch = readBirdwatch(article);
      const record = {
        tweetId: tweet.tweetId,
        handle: tweet.handle,
        displayName,
        text: tweet.text,
        capturedAt: now,
        surface,
        media,
        permalink
      };
      if (poll) record.poll = poll;
      if (quote) record.quote = quote;
      if (articleSummary) record.article = articleSummary;
      if (birdwatch) record.birdwatch = birdwatch;
      records.push(record);
    }
    return records;
  }
  function readPoll(article) {
    const bars = Array.from(article.querySelectorAll('[data-testid$="-progress-bar"], [data-testid="cardPoll"] li'));
    if (bars.length === 0) {
      return null;
    }
    const choices = [];
    for (const bar of bars) {
      const label = readFirstText(bar);
      if (!label) continue;
      const percentMatch = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(bar.textContent ?? "");
      const choice = { label };
      if (percentMatch) {
        choice.percent = Number(percentMatch[1]);
        choice.voteShare = `${percentMatch[1]}%`;
      }
      choices.push(choice);
    }
    if (choices.length === 0) {
      return null;
    }
    const totals = article.querySelector('[data-testid="cardPoll"] span');
    const totalText = totals?.textContent?.trim() ?? "";
    const poll = { choices };
    if (totalText.length > 0) {
      poll.totalVotes = totalText;
    }
    return poll;
  }
  function readQuote(article) {
    const quote = article.querySelector('[data-testid="quoteTweet"], [aria-labelledby="quoted"]');
    if (!quote) {
      return null;
    }
    const handleLink = quote.querySelector('a[href^="/"]');
    const handle = handleLink ? /\/([A-Za-z0-9_]{1,15})/.exec(handleLink.getAttribute("href") ?? "")?.[1] ?? null : null;
    const text = quote.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? "";
    return { handle, text };
  }
  function readArticle(article) {
    const card = article.querySelector('[data-testid="card.wrapper"], [data-testid="article"]');
    if (!card) {
      return null;
    }
    const titleNode = card.querySelector('[data-testid="card.layoutLarge.detail"] span, [data-testid="article-title"], h2');
    const link = card.querySelector("a[href]");
    return {
      title: titleNode?.textContent?.trim() ?? null,
      url: link?.href ?? link?.getAttribute("href") ?? null
    };
  }
  function readBirdwatch(article) {
    const pivot = article.querySelector('[data-testid="birdwatch-pivot"]');
    if (!pivot) return void 0;
    return pivot.textContent?.trim() || void 0;
  }
  function readFirstText(node) {
    if (!node) return null;
    const text = node.textContent?.trim() ?? "";
    return text.length > 0 ? text : null;
  }
  function readDisplayName(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    if (!userName) {
      return null;
    }
    const spans = Array.from(userName.querySelectorAll("span"));
    for (const span of spans) {
      const text = span.textContent?.trim() ?? "";
      if (text.length > 0 && !text.startsWith("@") && !text.startsWith("\xB7")) {
        return text;
      }
    }
    return null;
  }
  function readPermalink(article, handle, tweetId) {
    if (handle && tweetId) {
      return `https://x.com/${handle}/status/${tweetId}`;
    }
    const link = article.querySelector('a[href*="/status/"]');
    const href = link?.getAttribute("href") ?? null;
    if (href && tweetIdFromHref(href)) {
      return new URL(href, "https://x.com").toString();
    }
    return null;
  }

  // src/features/export/jobs.ts
  var CHECKPOINT_KEY = "aviary.export.checkpoints.v1";
  var RETENTION_KEYS = {
    maxJobs: "aviary.retention.maxJobs",
    maxRecordsPerJob: "aviary.retention.maxRecordsPerJob",
    maxAgeDays: "aviary.retention.maxAgeDays"
  };
  var DEFAULT_RETENTION_POLICY = {
    maxJobs: 0,
    maxRecordsPerJob: 0,
    maxAgeDays: 0
  };
  var EMPTY2 = { jobs: {}, records: {} };
  var CheckpointStore = class {
    #storage;
    #state = EMPTY2;
    #policy = DEFAULT_RETENTION_POLICY;
    #loaded = false;
    constructor(storage) {
      this.#storage = storage;
    }
    async load() {
      if (this.#loaded) return emptySweep(this.#policy, Object.keys(this.#state.jobs).length);
      const raw = await this.#storage.get(CHECKPOINT_KEY, EMPTY2);
      this.#state = {
        jobs: { ...raw?.jobs ?? {} },
        records: { ...raw?.records ?? {} }
      };
      this.#policy = await loadRetentionPolicy(this.#storage);
      this.#loaded = true;
      return this.sweep();
    }
    get retentionPolicy() {
      return { ...this.#policy };
    }
    list() {
      return Object.values(this.#state.jobs);
    }
    records(jobId) {
      return this.#state.records[jobId] ?? [];
    }
    async start(jobId, surface, formats, preserveRawPayloads) {
      await this.load();
      this.#state.jobs[jobId] = {
        jobId,
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        surface,
        recordCount: 0,
        done: false,
        formats,
        preserveRawPayloads
      };
      this.#state.records[jobId] = [];
      await this.#persist();
      await this.sweep();
    }
    async append(jobId, batch) {
      await this.load();
      const job = this.#state.jobs[jobId];
      if (!job) return;
      const seen = new Set(this.#state.records[jobId]?.map((entry) => recordKey(entry)) ?? []);
      const records = this.#state.records[jobId] ?? [];
      for (const record of batch) {
        const key = recordKey(record);
        if (!seen.has(key)) {
          seen.add(key);
          records.push(record);
        }
      }
      const retained = this.#policy.maxRecordsPerJob > 0 ? records.slice(-this.#policy.maxRecordsPerJob) : records;
      this.#state.records[jobId] = retained;
      job.recordCount = retained.length;
      await this.#persist();
    }
    async finish(jobId) {
      await this.load();
      const job = this.#state.jobs[jobId];
      if (job) {
        job.done = true;
        await this.#persist();
      }
    }
    async remove(jobId) {
      await this.load();
      delete this.#state.jobs[jobId];
      delete this.#state.records[jobId];
      await this.#persist();
    }
    async sweep(policy) {
      await this.load();
      if (policy) {
        this.#policy = normalizeRetentionPolicy(policy);
      }
      const beforeJobs = Object.keys(this.#state.jobs).length;
      const beforeRecords = Object.values(this.#state.records).reduce(
        (total, records) => total + records.length,
        0
      );
      const removeIds = /* @__PURE__ */ new Set();
      if (this.#policy.maxAgeDays > 0) {
        const cutoff = Date.now() - this.#policy.maxAgeDays * 24 * 60 * 60 * 1e3;
        for (const job of Object.values(this.#state.jobs)) {
          const startedAt = Date.parse(job.startedAt);
          if (Number.isFinite(startedAt) && startedAt < cutoff) {
            removeIds.add(job.jobId);
          }
        }
      }
      if (this.#policy.maxJobs > 0) {
        const newest = Object.values(this.#state.jobs).filter((job) => !removeIds.has(job.jobId)).sort(compareJobs).slice(-this.#policy.maxJobs).map((job) => job.jobId);
        const keepIds = new Set(newest);
        for (const job of Object.values(this.#state.jobs)) {
          if (!removeIds.has(job.jobId) && !keepIds.has(job.jobId)) {
            removeIds.add(job.jobId);
          }
        }
      }
      for (const jobId of removeIds) {
        delete this.#state.jobs[jobId];
        delete this.#state.records[jobId];
      }
      for (const job of Object.values(this.#state.jobs)) {
        const records = this.#state.records[job.jobId] ?? [];
        if (this.#policy.maxRecordsPerJob > 0 && records.length > this.#policy.maxRecordsPerJob) {
          this.#state.records[job.jobId] = records.slice(-this.#policy.maxRecordsPerJob);
        }
        job.recordCount = this.#state.records[job.jobId]?.length ?? 0;
      }
      const afterRecords = Object.values(this.#state.records).reduce(
        (total, records) => total + records.length,
        0
      );
      const result = {
        removedJobs: beforeJobs - Object.keys(this.#state.jobs).length,
        removedRecords: beforeRecords - afterRecords,
        retainedJobs: Object.keys(this.#state.jobs).length,
        policy: this.retentionPolicy
      };
      if (result.removedJobs > 0 || result.removedRecords > 0) {
        await this.#persist();
      }
      return result;
    }
    async #persist() {
      try {
        await this.#storage.set(CHECKPOINT_KEY, this.#state);
      } catch {
      }
    }
  };
  function normalizeRetentionPolicy(input) {
    const record = input && typeof input === "object" ? input : {};
    return {
      maxJobs: retentionNumber(record.maxJobs, DEFAULT_RETENTION_POLICY.maxJobs, 1e4),
      maxRecordsPerJob: retentionNumber(
        record.maxRecordsPerJob,
        DEFAULT_RETENTION_POLICY.maxRecordsPerJob,
        1e5
      ),
      maxAgeDays: retentionNumber(record.maxAgeDays, DEFAULT_RETENTION_POLICY.maxAgeDays, 3650)
    };
  }
  async function loadRetentionPolicy(storage) {
    const [maxJobs, maxRecordsPerJob, maxAgeDays] = await Promise.all([
      storage.get(RETENTION_KEYS.maxJobs, DEFAULT_RETENTION_POLICY.maxJobs),
      storage.get(RETENTION_KEYS.maxRecordsPerJob, DEFAULT_RETENTION_POLICY.maxRecordsPerJob),
      storage.get(RETENTION_KEYS.maxAgeDays, DEFAULT_RETENTION_POLICY.maxAgeDays)
    ]);
    return normalizeRetentionPolicy({ maxJobs, maxRecordsPerJob, maxAgeDays });
  }
  async function saveRetentionPolicy(storage, input) {
    const policy = normalizeRetentionPolicy(input);
    await Promise.all([
      storage.set(RETENTION_KEYS.maxJobs, policy.maxJobs),
      storage.set(RETENTION_KEYS.maxRecordsPerJob, policy.maxRecordsPerJob),
      storage.set(RETENTION_KEYS.maxAgeDays, policy.maxAgeDays)
    ]);
    return policy;
  }
  function retentionNumber(value, fallback, max) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(max, Math.trunc(value)));
  }
  function compareJobs(left, right) {
    const leftAt = Date.parse(left.startedAt);
    const rightAt = Date.parse(right.startedAt);
    if (leftAt !== rightAt) return leftAt - rightAt;
    return left.jobId.localeCompare(right.jobId);
  }
  function emptySweep(policy, retainedJobs) {
    return { removedJobs: 0, removedRecords: 0, retainedJobs, policy: { ...policy } };
  }
  function recordKey(record) {
    return `${record.tweetId ?? ""}|${record.handle ?? ""}|${record.text.slice(0, 80)}`;
  }

  // src/features/export/zip-store.ts
  var CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();
  function crc32(data) {
    let c = 4294967295;
    for (let i = 0; i < data.length; i++) {
      c = (CRC32_TABLE[(c ^ data[i]) & 255] ^ c >>> 8) >>> 0;
    }
    return (c ^ 4294967295) >>> 0;
  }
  function buildStoreZip(entries) {
    const encoder = new TextEncoder();
    const localBlocks = [];
    const centralBlocks = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.filename);
      const crc = crc32(entry.data);
      const size = entry.data.length;
      const date = entry.date ?? /* @__PURE__ */ new Date();
      const dosDate = toDosDate(date);
      const dosTime = toDosTime(date);
      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const lhView = new DataView(localHeader);
      lhView.setUint32(0, 67324752, true);
      lhView.setUint16(4, 20, true);
      lhView.setUint16(6, 0, true);
      lhView.setUint16(8, 0, true);
      lhView.setUint16(10, dosTime, true);
      lhView.setUint16(12, dosDate, true);
      lhView.setUint32(14, crc, true);
      lhView.setUint32(18, size, true);
      lhView.setUint32(22, size, true);
      lhView.setUint16(26, nameBytes.length, true);
      lhView.setUint16(28, 0, true);
      const localHeaderBytes = new Uint8Array(localHeader);
      localHeaderBytes.set(nameBytes, 30);
      localBlocks.push(localHeaderBytes);
      localBlocks.push(entry.data);
      const centralHeader = new ArrayBuffer(46 + nameBytes.length);
      const chView = new DataView(centralHeader);
      chView.setUint32(0, 33639248, true);
      chView.setUint16(4, 20, true);
      chView.setUint16(6, 20, true);
      chView.setUint16(8, 0, true);
      chView.setUint16(10, 0, true);
      chView.setUint16(12, dosTime, true);
      chView.setUint16(14, dosDate, true);
      chView.setUint32(16, crc, true);
      chView.setUint32(20, size, true);
      chView.setUint32(24, size, true);
      chView.setUint16(28, nameBytes.length, true);
      chView.setUint16(30, 0, true);
      chView.setUint16(32, 0, true);
      chView.setUint16(34, 0, true);
      chView.setUint16(36, 0, true);
      chView.setUint32(38, 0, true);
      chView.setUint32(42, offset, true);
      const centralBytes = new Uint8Array(centralHeader);
      centralBytes.set(nameBytes, 46);
      centralBlocks.push(centralBytes);
      offset += localHeaderBytes.length + entry.data.length;
    }
    const centralStart = offset;
    let centralSize = 0;
    for (const block of centralBlocks) {
      centralSize += block.length;
    }
    const endRecord = new Uint8Array(22);
    const erView = new DataView(endRecord.buffer);
    erView.setUint32(0, 101010256, true);
    erView.setUint16(4, 0, true);
    erView.setUint16(6, 0, true);
    erView.setUint16(8, entries.length, true);
    erView.setUint16(10, entries.length, true);
    erView.setUint32(12, centralSize, true);
    erView.setUint32(16, centralStart, true);
    erView.setUint16(20, 0, true);
    const total = offset + centralSize + endRecord.length;
    const output = new Uint8Array(total);
    let cursor = 0;
    for (const block of localBlocks) {
      output.set(block, cursor);
      cursor += block.length;
    }
    for (const block of centralBlocks) {
      output.set(block, cursor);
      cursor += block.length;
    }
    output.set(endRecord, cursor);
    return output;
  }
  function toDosDate(date) {
    const year = Math.max(date.getUTCFullYear() - 1980, 0);
    return (year & 127) << 9 | (date.getUTCMonth() + 1 & 15) << 5 | date.getUTCDate() & 31;
  }
  function toDosTime(date) {
    return (date.getUTCHours() & 31) << 11 | (date.getUTCMinutes() & 63) << 5 | Math.floor(date.getUTCSeconds() / 2) & 31;
  }

  // src/features/export/xlsx.ts
  var ENCODER = new TextEncoder();
  function formatXlsx(records) {
    const sheetRows = [
      ["tweetId", "handle", "displayName", "capturedAt", "surface", "permalink", "text", "mediaUrls"]
    ];
    for (const record of records) {
      sheetRows.push([
        record.tweetId ?? "",
        record.handle ?? "",
        record.displayName ?? "",
        record.capturedAt,
        record.surface,
        record.permalink ?? "",
        record.text,
        record.media.map((media) => media.url).join("|")
      ]);
    }
    const sheetXml = buildSheetXml(sheetRows);
    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tweets" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
    const archive = buildStoreZip([
      { filename: "[Content_Types].xml", data: ENCODER.encode(contentTypesXml) },
      { filename: "_rels/.rels", data: ENCODER.encode(rootRelsXml) },
      { filename: "xl/_rels/workbook.xml.rels", data: ENCODER.encode(workbookRelsXml) },
      { filename: "xl/workbook.xml", data: ENCODER.encode(workbookXml) },
      { filename: "xl/worksheets/sheet1.xml", data: ENCODER.encode(sheetXml) }
    ]);
    return {
      filename: "tweets.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: archive
    };
  }
  function buildSheetXml(rows) {
    const xmlRows = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const cells = [];
      for (let c = 0; c < row.length; c++) {
        const value = row[c] ?? "";
        const cellRef = `${columnLetter(c)}${r + 1}`;
        cells.push(`<c r="${cellRef}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`);
      }
      xmlRows.push(`<row r="${r + 1}">${cells.join("")}</row>`);
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows.join("")}</sheetData></worksheet>`;
  }
  function columnLetter(index) {
    let label = "";
    let n = index;
    while (n >= 0) {
      label = String.fromCharCode(n % 26 + 65) + label;
      n = Math.floor(n / 26) - 1;
    }
    return label;
  }
  function escapeXml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  // src/features/export/formatters.ts
  var TEXT_ENCODER = new TextEncoder();
  function formatExport(format, records) {
    switch (format) {
      case "json":
        return jsonArtifact(records);
      case "csv":
        return csvArtifact(records);
      case "html":
        return htmlArtifact(records);
      case "markdown":
        return markdownArtifact(records);
      case "xlsx":
        return formatXlsx(records);
      default:
        return jsonArtifact(records);
    }
  }
  function jsonArtifact(records) {
    const json = JSON.stringify(
      {
        generator: "Aviary",
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        count: records.length,
        records
      },
      null,
      2
    );
    return {
      filename: "tweets.json",
      contentType: "application/json",
      data: TEXT_ENCODER.encode(json)
    };
  }
  function csvArtifact(records) {
    const headers = ["tweetId", "handle", "displayName", "capturedAt", "surface", "permalink", "text", "mediaUrls"];
    const lines = [headers.join(",")];
    for (const record of records) {
      const mediaUrls = record.media.map((media) => media.url).join("|");
      lines.push(
        [
          record.tweetId ?? "",
          record.handle ?? "",
          record.displayName ?? "",
          record.capturedAt,
          record.surface,
          record.permalink ?? "",
          record.text,
          mediaUrls
        ].map(csvCell).join(",")
      );
    }
    return {
      filename: "tweets.csv",
      contentType: "text/csv",
      data: TEXT_ENCODER.encode(`${lines.join("\n")}
`)
    };
  }
  function csvCell(value) {
    if (value === void 0 || value === null) {
      return "";
    }
    const needsQuotes = /[,"\r\n]/.test(value);
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  }
  function htmlArtifact(records) {
    const rows = records.map((record) => {
      const media = record.media.map((entry) => `<li><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.kind)}</a></li>`).join("");
      const permalink = record.permalink ? `<a href="${escapeHtml(record.permalink)}">${escapeHtml(record.permalink)}</a>` : "";
      return `<article class="record">
  <header>
    <strong>${escapeHtml(record.displayName ?? record.handle ?? "Unknown")}</strong>
    <span class="handle">@${escapeHtml(record.handle ?? "")}</span>
    <time datetime="${escapeHtml(record.capturedAt)}">${escapeHtml(record.capturedAt)}</time>
  </header>
  <p>${escapeHtml(record.text).replace(/\n/g, "<br>")}</p>
  <ul>${media}</ul>
  <footer>${permalink}</footer>
</article>`;
    }).join("\n");
    const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Aviary export</title>
<style>
body { font: 14px/1.5 system-ui, sans-serif; background: #0a0a0a; color: #e7e9ea; padding: 24px; }
article { border: 1px solid #2f3336; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
.handle { color: #71767b; }
time { margin-left: auto; color: #71767b; font-size: 12px; }
ul { padding-left: 18px; }
a { color: #1d9bf0; }
</style>
</head><body>
<h1>Aviary export</h1>
<p>${records.length} records, generated ${(/* @__PURE__ */ new Date()).toISOString()}.</p>
${rows}
</body></html>`;
    return {
      filename: "tweets.html",
      contentType: "text/html",
      data: TEXT_ENCODER.encode(html)
    };
  }
  function markdownArtifact(records) {
    const sections = records.map((record) => {
      const header = `## ${record.displayName ?? record.handle ?? "Unknown"} (@${record.handle ?? "anon"}) \u2014 ${record.capturedAt}`;
      const body = record.text.split("\n").map((line) => `> ${line}`).join("\n");
      const media = record.media.length === 0 ? "" : `

${record.media.map((entry) => `- [${entry.kind}](${entry.url})`).join("\n")}`;
      const permalink = record.permalink ? `

${record.permalink}` : "";
      return `${header}

${body}${media}${permalink}`;
    });
    const md = `# Aviary export

Generated ${(/* @__PURE__ */ new Date()).toISOString()} \u2014 ${records.length} records.

${sections.join("\n\n---\n\n")}
`;
    return {
      filename: "tweets.md",
      contentType: "text/markdown",
      data: TEXT_ENCODER.encode(md)
    };
  }
  function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // src/features/export/query-discovery.ts
  var QUERY_REGISTRY_KEY = "aviary.queryIds.v1";
  var QUERY_REGEX = /\/i\/api\/graphql\/([A-Za-z0-9_-]{6,})\/([A-Za-z0-9_]{2,80})/g;
  async function discoverQueryIds(storage) {
    const fallback = { queries: {}, observedAt: null };
    const existing = await storage.get(QUERY_REGISTRY_KEY, fallback);
    const queries = { ...existing.queries };
    if (typeof document !== "undefined") {
      const scripts = Array.from(document.querySelectorAll("script[src]"));
      for (const script of scripts) {
        mergeFromString(queries, script.src);
      }
      const documentText = document.documentElement?.outerHTML ?? "";
      mergeFromString(queries, documentText);
    }
    const result = {
      queries,
      observedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await storage.set(QUERY_REGISTRY_KEY, result);
    } catch {
    }
    return result;
  }
  function mergeFromString(target, source) {
    QUERY_REGEX.lastIndex = 0;
    let match;
    while ((match = QUERY_REGEX.exec(source)) !== null) {
      const [, id, operation] = match;
      if (id && operation) {
        target[operation] = id;
      }
    }
  }

  // src/features/export/export-feature.ts
  var checkpointStore;
  var queryRegistry;
  var activeJobId;
  var exportFeature = {
    id: "export.core",
    title: "Export core",
    category: "export",
    defaultEnabled: true,
    async init(ctx) {
      checkpointStore = new CheckpointStore(ctx.storage);
      const retention = await checkpointStore.load();
      if (retention.removedJobs > 0 || retention.removedRecords > 0) {
        ctx.diagnostics.info("Checkpoint retention sweep", { ...retention });
      }
      if (ctx.settings.export.autoDiscoverQueryIds) {
        try {
          queryRegistry = await discoverQueryIds(ctx.storage);
          ctx.diagnostics.info("Query IDs discovered", {
            count: Object.keys(queryRegistry.queries).length
          });
        } catch (error) {
          ctx.diagnostics.warn("Query ID discovery failed", errorDetails(error));
        }
      }
    },
    async apply(ctx, root, addedNodes) {
      if (!ctx.settings.export.enabled || !checkpointStore || !activeJobId) {
        return;
      }
      const records = collectExportRecords(root, ctx.route.surface);
      if (records.length === 0) {
        return;
      }
      await checkpointStore.append(activeJobId, records);
      if (addedNodes) {
        ctx.diagnostics.info("Export captured nodes", { count: records.length });
      }
    },
    destroy(ctx) {
      checkpointStore = void 0;
      queryRegistry = void 0;
      activeJobId = void 0;
      ctx.diagnostics.info("Export core destroyed");
    },
    getStatus() {
      if (!checkpointStore) {
        return { ok: true, message: "Export idle" };
      }
      const jobs = checkpointStore.list();
      return {
        ok: true,
        message: `${jobs.length} export jobs tracked`,
        details: { queries: queryRegistry?.queries ? Object.keys(queryRegistry.queries).length : 0 }
      };
    }
  };
  function getCheckpointStore() {
    return checkpointStore;
  }
  function getDiscoveredQueries() {
    return queryRegistry;
  }
  async function runExportOfVisibleTweets(ctx) {
    if (!checkpointStore) {
      checkpointStore = new CheckpointStore(ctx.storage);
      await checkpointStore.load();
    }
    const jobId = `job-${Date.now()}`;
    const formats = selectSupportedFormats(ctx.settings.export.formats);
    await checkpointStore.start(jobId, ctx.route.surface, formats, ctx.settings.export.preserveRawPayloads);
    void ctx.auditLog.record("export.start", { jobId, formats, surface: ctx.route.surface });
    activeJobId = jobId;
    const initialRecords = collectExportRecords(document, ctx.route.surface);
    await checkpointStore.append(jobId, initialRecords);
    activeJobId = void 0;
    const records = checkpointStore.records(jobId);
    const artifact = buildExportZip(records, formats, ctx.settings.media.lastSaveFolder);
    await checkpointStore.finish(jobId);
    ctx.diagnostics.info("Export completed", { records: records.length, formats });
    void ctx.auditLog.record("export.complete", { jobId, records: records.length, formats });
    if (ctx.settings.integrations.semanticSearch.autoIndex) {
      void autoIndexExport(ctx, records);
    }
    return {
      jobId,
      records: records.length,
      artifact,
      filename: zipFilename(ctx.settings.media.lastSaveFolder)
    };
  }
  function buildExportZip(records, formats, folder) {
    const entries = [];
    const safeFolder = sanitizeFolder(folder);
    for (const format of formats) {
      const artifact = formatExport(format, records);
      entries.push({
        filename: safeFolder ? `${safeFolder}/${artifact.filename}` : artifact.filename,
        data: artifact.data
      });
    }
    return buildStoreZip(entries);
  }
  function selectSupportedFormats(input) {
    const allowed = ["json", "csv", "html", "markdown", "xlsx"];
    const result = [];
    for (const candidate of input) {
      if (allowed.includes(candidate) && !result.includes(candidate)) {
        result.push(candidate);
      }
    }
    return result.length > 0 ? result : ["json"];
  }
  function sanitizeFolder(folder) {
    const cleaned = folder.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return cleaned.slice(0, 80);
  }
  function zipFilename(folder) {
    const safe = sanitizeFolder(folder);
    const base = safe.length > 0 ? safe.replace(/\//g, "_") : "aviary-export";
    return `${base}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.zip`;
  }
  function errorDetails(error) {
    if (error instanceof Error) {
      return { name: error.name, message: error.message };
    }
    return { message: String(error) };
  }
  async function autoIndexExport(ctx, records) {
    try {
      const index = new SemanticIndex(ctx.storage);
      await index.load();
      const result = await index.embedAndIndex(ctx.settings.integrations.semanticSearch, records);
      ctx.diagnostics.info("Auto-embedding finished", result);
      void ctx.auditLog.record("export.complete", {
        kind: "auto-semantic-index",
        added: result.added,
        skipped: result.skipped,
        errors: result.errors
      });
    } catch (error) {
      ctx.diagnostics.warn("Auto-embedding failed", errorDetails(error));
    }
  }

  // src/features/export/external-targets.ts
  var ENCODER2 = new TextEncoder();
  function renderForExternalTarget(target, records) {
    switch (target) {
      case "clipboard-markdown":
        return { id: target, payload: toPlainMarkdown(records) };
      case "obsidian":
        return { id: target, artifact: toObsidianArtifact(records) };
      case "notion":
        return { id: target, artifact: toNotionArtifact(records) };
      case "raw-json":
        return { id: target, artifact: toJsonArtifact(records) };
      default:
        return { id: "clipboard-markdown", payload: toPlainMarkdown(records) };
    }
  }
  function toPlainMarkdown(records) {
    const lines = records.map((record) => {
      const handle = record.handle ? `@${record.handle}` : "(unknown)";
      const permalink = record.permalink ? ` \u2014 [link](${record.permalink})` : "";
      const body = record.text.split("\n").map((line) => `> ${line}`).join("\n");
      return `### ${record.displayName ?? handle} (${handle})${permalink}

${body}`;
    });
    return `# Aviary clipboard export

${lines.join("\n\n---\n\n")}
`;
  }
  function toObsidianArtifact(records) {
    const sections = records.map((record) => {
      const safeId = record.tweetId ?? "no-id";
      const handle = record.handle ?? "anon";
      const tags = ["#aviary", `#x/${handle}`];
      const frontmatter = [
        "---",
        `tweet_id: ${safeId}`,
        `handle: ${handle}`,
        `display_name: ${record.displayName ?? ""}`,
        `captured_at: ${record.capturedAt}`,
        `surface: ${record.surface}`,
        `permalink: ${record.permalink ?? ""}`,
        `tags: [${tags.join(", ")}]`,
        "---"
      ].join("\n");
      const mediaList = record.media.length === 0 ? "" : `

${record.media.map((media) => `- [${media.kind}](${media.url})`).join("\n")}`;
      return `${frontmatter}

# ${record.displayName ?? handle}

${record.text}${mediaList}`;
    });
    const document2 = sections.join("\n\n---\n\n");
    return {
      filename: "aviary-obsidian.md",
      contentType: "text/markdown",
      data: ENCODER2.encode(document2)
    };
  }
  function toNotionArtifact(records) {
    const lines = ["# Aviary export"];
    for (const record of records) {
      const handle = record.handle ?? "anon";
      lines.push("");
      lines.push(`## ${record.displayName ?? handle} \xB7 @${handle}`);
      lines.push("");
      lines.push(`*Captured:* ${record.capturedAt}  `);
      if (record.permalink) lines.push(`*Permalink:* ${record.permalink}  `);
      lines.push("");
      lines.push(record.text);
      if (record.media.length > 0) {
        lines.push("");
        lines.push("**Media**");
        for (const media of record.media) {
          lines.push(`- ${media.kind}: ${media.url}`);
        }
      }
    }
    return {
      filename: "aviary-notion.md",
      contentType: "text/markdown",
      data: ENCODER2.encode(`${lines.join("\n")}
`)
    };
  }
  function toJsonArtifact(records) {
    const json = JSON.stringify(
      { generator: "Aviary", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), records },
      null,
      2
    );
    return {
      filename: "aviary-records.json",
      contentType: "application/json",
      data: ENCODER2.encode(json)
    };
  }

  // src/features/export/warc.ts
  var ENCODER3 = new TextEncoder();
  function buildWarcArchive(records) {
    const blocks = [];
    blocks.push(formatRecord({
      url: "metadata://aviary",
      mime: "application/json",
      body: JSON.stringify({
        generator: "Aviary",
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        count: records.length
      }),
      recordType: "metadata"
    }));
    for (const record of records) {
      const summary = JSON.stringify(record, null, 2);
      blocks.push(formatRecord({
        url: record.permalink ?? `tweet://${record.tweetId ?? "unknown"}`,
        mime: "application/json",
        body: summary,
        recordType: "resource"
      }));
      for (const media of record.media) {
        blocks.push(formatRecord({
          url: media.url,
          mime: media.type ?? "application/octet-stream",
          body: `Aviary captured the resource URL for ${media.kind} ${media.url} without re-downloading the body. Use the Aviary media downloader to fetch the bytes if needed.`,
          recordType: "metadata"
        }));
      }
    }
    const totalSize = blocks.reduce((acc, block) => acc + block.length, 0);
    const out = new Uint8Array(totalSize);
    let cursor = 0;
    for (const block of blocks) {
      out.set(block, cursor);
      cursor += block.length;
    }
    return {
      filename: "tweets.warc",
      contentType: "application/warc",
      data: out
    };
  }
  function formatRecord(input) {
    const recordType = input.recordType ?? "resource";
    const recordedAt = (input.recordedAt ?? /* @__PURE__ */ new Date()).toISOString().replace(/\.[0-9]{3}Z$/, "Z");
    const id = `<urn:uuid:${randomUuid()}>`;
    const bodyBytes = typeof input.body === "string" ? ENCODER3.encode(input.body) : input.body;
    const headerLines = [
      "WARC/1.1",
      `WARC-Type: ${recordType}`,
      `WARC-Target-URI: ${input.url}`,
      `WARC-Date: ${recordedAt}`,
      `WARC-Record-ID: ${id}`,
      `Content-Type: ${input.mime}`,
      `Content-Length: ${bodyBytes.length}`
    ];
    const headerBytes = ENCODER3.encode(`${headerLines.join("\r\n")}\r
\r
`);
    const trailer = ENCODER3.encode("\r\n\r\n");
    const block = new Uint8Array(headerBytes.length + bodyBytes.length + trailer.length);
    block.set(headerBytes, 0);
    block.set(bodyBytes, headerBytes.length);
    block.set(trailer, headerBytes.length + bodyBytes.length);
    return block;
  }
  function randomUuid() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    const random = (length) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `${random(8)}-${random(4)}-4${random(3)}-a${random(3)}-${random(12)}`;
  }

  // src/features/integrations/aria2.ts
  var ARIA2_HISTORY_KEY = "aviary.aria2.history.v1";
  var ARIA2_HISTORY_LIMIT = 1e3;
  async function addUriToAria2(config, request) {
    if (!config.endpoint) {
      return { ok: false, error: "Aria2 endpoint not configured" };
    }
    const token = config.secret ? `token:${config.secret}` : void 0;
    const params = token ? [token] : [];
    params.push([request.url]);
    params.push({ out: request.filename });
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: `aviary-${Date.now()}`,
      method: "aria2.addUri",
      params
    });
    try {
      const response = await fetch(`${config.endpoint}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });
      if (!response.ok) {
        return { ok: false, error: `Aria2 HTTP ${response.status}` };
      }
      const payload = await response.json();
      if (payload?.error) {
        return { ok: false, error: payload.error.message ?? "Aria2 error" };
      }
      const result = { ok: true };
      if (typeof payload?.result === "string") result.gid = payload.result;
      return result;
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }
  function shouldHandoffToAria2(integration, estimatedBytes) {
    if (!integration.enabled || !integration.endpoint) return false;
    if (estimatedBytes === null) return true;
    return estimatedBytes >= integration.minBytes;
  }
  var Aria2History = class {
    #storage;
    #limit;
    #entries = [];
    #loaded = false;
    constructor(storage, limit = ARIA2_HISTORY_LIMIT) {
      this.#storage = storage;
      this.#limit = Math.max(50, Math.trunc(limit));
    }
    async load() {
      if (this.#loaded) return;
      const fallback = { entries: [] };
      const raw = await this.#storage.get(ARIA2_HISTORY_KEY, fallback);
      const entries = Array.isArray(raw?.entries) ? raw.entries : [];
      this.#entries = entries.filter(isHistoryEntry).slice(-this.#limit);
      this.#loaded = true;
    }
    hasUrl(url) {
      return this.#entries.some((entry) => entry.url === url);
    }
    snapshot() {
      return { entries: this.#entries.map((entry) => ({ ...entry })) };
    }
    async rememberQueued(entry) {
      await this.load();
      if (this.hasUrl(entry.url)) return;
      this.#entries.push({
        ...entry,
        status: "queued",
        queuedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      while (this.#entries.length > this.#limit) {
        this.#entries.shift();
      }
      await this.#persist();
    }
    async reconcile(config) {
      await this.load();
      let completed = 0;
      let removed = 0;
      const retained = [];
      for (const entry of this.#entries) {
        if (entry.status !== "queued") {
          retained.push(entry);
          continue;
        }
        const status = await tellAria2Status(config, entry.gid);
        if (status === "complete") {
          retained.push({ ...entry, status: "complete", completedAt: (/* @__PURE__ */ new Date()).toISOString() });
          completed += 1;
        } else if (status === "error" || status === "removed") {
          removed += 1;
        } else {
          retained.push(entry);
        }
      }
      this.#entries = retained;
      if (completed > 0 || removed > 0) {
        await this.#persist();
      }
      return { completed, removed };
    }
    async clear() {
      this.#entries = [];
      this.#loaded = true;
      await this.#persist();
    }
    async #persist() {
      try {
        await this.#storage.set(ARIA2_HISTORY_KEY, this.snapshot());
      } catch {
      }
    }
  };
  async function tellActiveAria2(config) {
    const payload = await callAria2(config, "aria2.tellActive", []);
    if (!Array.isArray(payload)) return [];
    return payload.map((row) => ({
      gid: typeof row.gid === "string" ? row.gid : "",
      status: typeof row.status === "string" ? row.status : "unknown",
      totalLength: Number(row.totalLength ?? 0),
      completedLength: Number(row.completedLength ?? 0),
      files: Array.isArray(row.files) ? row.files.map((file) => typeof file === "object" && file !== null ? file : {}).map((file) => ({ path: typeof file.path === "string" ? file.path : "" })) : []
    }));
  }
  async function removeAria2Download(config, gid) {
    if (!gid) return { ok: false, error: "Missing GID" };
    const payload = await callAria2(config, "aria2.remove", [gid]);
    if (typeof payload === "string") {
      return { ok: true, gid: payload };
    }
    return { ok: false, error: "Aria2 did not return a GID" };
  }
  async function tellAria2Status(config, gid) {
    if (!gid) return null;
    if (!config.endpoint) return null;
    const token = config.secret ? `token:${config.secret}` : void 0;
    const params = token ? [token, gid] : [gid];
    try {
      const response = await fetch(`${config.endpoint}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `aviary-${Date.now()}`,
          method: "aria2.tellStatus",
          params
        })
      });
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload.error) return "removed";
      return typeof payload.result?.status === "string" ? payload.result.status : null;
    } catch {
      return null;
    }
  }
  async function callAria2(config, method, args) {
    if (!config.endpoint) return null;
    const token = config.secret ? `token:${config.secret}` : void 0;
    const params = token ? [token, ...args] : args;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: `aviary-${Date.now()}`,
      method,
      params
    });
    try {
      const response = await fetch(`${config.endpoint}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });
      if (!response.ok) return null;
      const json = await response.json();
      return json?.result ?? null;
    } catch {
      return null;
    }
  }
  function isHistoryEntry(value) {
    if (typeof value !== "object" || value === null) return false;
    const entry = value;
    return typeof entry.gid === "string" && typeof entry.url === "string" && typeof entry.filename === "string" && (entry.status === "queued" || entry.status === "complete") && typeof entry.queuedAt === "string" && (entry.completedAt === void 0 || typeof entry.completedAt === "string");
  }

  // src/features/integrations/crosspost.ts
  function splitForThread(text) {
    const blocks = text.split(/\r?\n\s*\r?\n/).map((block) => block.trim()).filter((block) => block.length > 0);
    return blocks.length === 0 ? [text.trim()].filter((block) => block.length > 0) : blocks;
  }
  async function crosspost(integrations, request) {
    if (request.text.trim().length === 0) {
      return { ok: false, target: request.target, error: "Empty post body" };
    }
    const segments = request.asThread ? splitForThread(request.text) : [request.text];
    if (segments.length === 0) {
      return { ok: false, target: request.target, error: "Empty post body" };
    }
    if (request.target === "bluesky") {
      return postToBluesky(integrations.bluesky, segments, request.attachment);
    }
    return postToMastodon(integrations.mastodon, segments, request.attachment);
  }
  async function postToBluesky(config, segments, attachment) {
    if (!config.enabled) return { ok: false, target: "bluesky", error: "Bluesky integration disabled" };
    if (!config.service || !config.handle || !config.appPassword) {
      return { ok: false, target: "bluesky", error: "Bluesky credentials missing" };
    }
    try {
      const session = await callBluesky(config.service, "com.atproto.server.createSession", {
        identifier: config.handle,
        password: config.appPassword
      });
      if (!session || typeof session.accessJwt !== "string" || typeof session.did !== "string") {
        return { ok: false, target: "bluesky", error: "Bluesky session response was malformed" };
      }
      const uploadedBlob = attachment ? await uploadBlueskyImage(config.service, session.accessJwt, attachment) : null;
      let rootRef = null;
      let parentRef = null;
      let firstUri = null;
      for (const segment of segments) {
        const record = {
          text: segment.slice(0, 300),
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          $type: "app.bsky.feed.post"
        };
        if (rootRef && parentRef) {
          record.reply = {
            root: rootRef,
            parent: parentRef
          };
        }
        if (uploadedBlob && !rootRef) {
          record.embed = {
            $type: "app.bsky.embed.images",
            images: [{ alt: "", image: uploadedBlob }]
          };
        }
        const response = await callBluesky(
          config.service,
          "com.atproto.repo.createRecord",
          {
            repo: session.did,
            collection: "app.bsky.feed.post",
            record
          },
          session.accessJwt
        );
        const uri = typeof response?.uri === "string" ? response.uri : null;
        const cid = typeof response?.cid === "string" ? response.cid : null;
        if (!uri || !cid) {
          return { ok: false, target: "bluesky", error: "Bluesky post response was malformed" };
        }
        if (!rootRef) {
          rootRef = { uri, cid };
          firstUri = uri;
        }
        parentRef = { uri, cid };
      }
      const result = {
        ok: true,
        target: "bluesky",
        posts: segments.length
      };
      if (firstUri) result.url = deriveBlueskyUrl(firstUri, config.handle);
      return result;
    } catch (error) {
      return { ok: false, target: "bluesky", error: String(error?.message ?? error) };
    }
  }
  async function postToMastodon(config, segments, attachment) {
    if (!config.enabled) return { ok: false, target: "mastodon", error: "Mastodon integration disabled" };
    if (!config.instance || !config.token) {
      return { ok: false, target: "mastodon", error: "Mastodon credentials missing" };
    }
    try {
      const mediaId = attachment ? await uploadMastodonMedia(config.instance, config.token, attachment) : null;
      let inReplyTo = null;
      let firstUrl = null;
      for (const segment of segments) {
        const body = {
          status: segment,
          visibility: config.visibility
        };
        if (inReplyTo) body.in_reply_to_id = inReplyTo;
        if (mediaId && !inReplyTo) body.media_ids = [mediaId];
        const response = await fetch(`${config.instance}/api/v1/statuses`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.token}`
          },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          return { ok: false, target: "mastodon", error: `Mastodon HTTP ${response.status}` };
        }
        const payload = await response.json();
        if (typeof payload?.id !== "string") {
          return { ok: false, target: "mastodon", error: "Mastodon response missing status id" };
        }
        inReplyTo = payload.id;
        if (typeof payload?.url === "string" && firstUrl === null) {
          firstUrl = payload.url;
        }
      }
      const result = { ok: true, target: "mastodon", posts: segments.length };
      if (firstUrl) result.url = firstUrl;
      return result;
    } catch (error) {
      return { ok: false, target: "mastodon", error: String(error?.message ?? error) };
    }
  }
  async function uploadBlueskyImage(service, accessJwt, attachment) {
    const media = await fetchAttachment(attachment);
    if (!media.contentType.startsWith("image/")) {
      throw new Error("Bluesky crosspost attachments must be images");
    }
    const response = await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessJwt}`,
        "content-type": media.contentType
      },
      body: media.blob
    });
    if (!response.ok) {
      throw new Error(`Bluesky media upload HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!isRecord2(payload.blob)) {
      throw new Error("Bluesky media response was malformed");
    }
    return payload.blob;
  }
  async function uploadMastodonMedia(instance, token, attachment) {
    const media = await fetchAttachment(attachment);
    const form = new FormData();
    form.append("file", media.blob, safeFilename(attachment.filename));
    const response = await fetch(`${instance}/api/v1/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form
    });
    if (!response.ok) {
      throw new Error(`Mastodon media upload HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      throw new Error("Mastodon media response missing id");
    }
    return payload.id;
  }
  async function fetchAttachment(attachment) {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Media attachment HTTP ${response.status}`);
    }
    const contentType = normalizeContentType(response.headers.get("content-type")) ?? inferContentType(attachment);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) {
      throw new Error("Media attachment was empty");
    }
    return { blob: new Blob([bytes], { type: contentType }), contentType };
  }
  function normalizeContentType(value) {
    const type = value?.split(";", 1)[0]?.trim().toLowerCase();
    return type && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type : null;
  }
  function inferContentType(attachment) {
    const filename = attachment.filename.toLowerCase();
    if (filename.endsWith(".png")) return "image/png";
    if (filename.endsWith(".gif")) return "image/gif";
    if (filename.endsWith(".webp")) return "image/webp";
    if (filename.endsWith(".mp4")) return "video/mp4";
    if (filename.endsWith(".webm")) return "video/webm";
    return "image/jpeg";
  }
  function safeFilename(value) {
    const cleaned = value.replace(/[\\/\u0000-\u001f]/g, "_").trim();
    return cleaned.slice(0, 160) || "aviary-media";
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  async function callBluesky(service, nsid, input, bearer) {
    const headers = { "content-type": "application/json" };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const response = await fetch(`${service}/xrpc/${nsid}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      throw new Error(`Bluesky ${nsid} HTTP ${response.status}`);
    }
    return await response.json();
  }
  function deriveBlueskyUrl(uri, handle) {
    const match = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/(.+)$/.exec(uri);
    const rkey = match?.[1];
    return rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : `https://bsky.app/profile/${handle}`;
  }
  function readComposerText() {
    const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
    return composer?.textContent?.trim() ?? "";
  }

  // src/features/core/integration-errors.ts
  var ERROR_ACTIONS = /* @__PURE__ */ new Set([
    "media.download.failed",
    "export.start",
    "export.complete"
  ]);
  function recentIntegrationErrors(entries, limit = 10) {
    const errors = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry) continue;
      if (!ERROR_ACTIONS.has(entry.action) && entry.action !== "diagnostics.copy") continue;
      const detail = entry.detail ?? {};
      const failed = detail.error || detail.ok === false || entry.action === "media.download.failed";
      if (!failed) continue;
      errors.push({
        at: entry.at,
        kind: pickKind(entry.action, detail),
        message: String(detail.error ?? detail.message ?? entry.action),
        details: detail
      });
      if (errors.length >= limit) break;
    }
    return errors;
  }
  function pickKind(action, detail) {
    if (typeof detail.target === "string") return `crosspost:${detail.target}`;
    if (typeof detail.kind === "string") return String(detail.kind);
    if (action === "media.download.failed") return "media";
    return action;
  }

  // src/features/export/zip-reader.ts
  var LOCAL_HEADER = 67324752;
  var EOCD_SIGNATURE = 101010256;
  var ZIP64_LOCATOR = 117853008;
  var TEXT_DECODER = new TextDecoder();
  var UnsupportedZipMethodError = class extends Error {
    constructor(method, filename) {
      super(`Unsupported ZIP compression method ${method} for "${filename}"`);
      this.name = "UnsupportedZipMethodError";
    }
  };
  function readStoreZip(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const eocd = locateEOCD(view, data.length);
    if (eocd === -1) {
      return [];
    }
    const entryCount = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    const results = [];
    let cursor = centralOffset;
    for (let i = 0; i < entryCount; i++) {
      if (view.getUint32(cursor, true) !== 33639248) {
        break;
      }
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const filename = TEXT_DECODER.decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength + commentLength;
      if (filename.endsWith("/")) {
        continue;
      }
      if (method !== 0) {
        throw new UnsupportedZipMethodError(method, filename);
      }
      if (view.getUint32(localOffset, true) !== LOCAL_HEADER) {
        continue;
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const fileStart = localOffset + 30 + localNameLength + localExtraLength;
      const fileEnd = fileStart + compressedSize;
      const fileData = data.subarray(fileStart, fileEnd);
      const declaredCrc = view.getUint32(cursor - (extraLength + commentLength + nameLength + 46) + 16, true);
      const actualCrc = crc32(fileData);
      const expectedSize = uncompressedSize;
      results.push({
        filename,
        data: new Uint8Array(fileData),
        crcOk: declaredCrc === actualCrc && fileData.length === expectedSize
      });
    }
    return results;
  }
  function locateEOCD(view, length) {
    for (let i = length - 22; i >= Math.max(0, length - 65535 - 22); i--) {
      if (view.getUint32(i, true) === EOCD_SIGNATURE) {
        return i;
      }
      if (view.getUint32(i, true) === ZIP64_LOCATOR) {
        continue;
      }
    }
    return -1;
  }

  // src/features/library/archive-import.ts
  var TEXT_DECODER2 = new TextDecoder();
  function importOfficialArchive(buffer, surface = "archive") {
    const warnings = [];
    const errors = [];
    const filesParsed = [];
    const records = [];
    let entries;
    try {
      entries = readStoreZip(buffer);
    } catch (error) {
      errors.push(error.message);
      return { records, warnings, errors, filesParsed };
    }
    if (entries.length === 0) {
      errors.push("Archive contained no readable entries (compression methods other than STORE are not supported).");
      return { records, warnings, errors, filesParsed };
    }
    for (const entry of entries) {
      const lower = entry.filename.toLowerCase();
      if (!isInterestingFile(lower)) {
        continue;
      }
      if (!entry.crcOk) {
        warnings.push(`${entry.filename}: CRC32 mismatch \u2014 proceeding best effort.`);
      }
      const text = safeDecode(entry.data, errors, entry.filename);
      if (!text) continue;
      filesParsed.push(entry.filename);
      const payload = stripPrefix(text);
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch (error) {
        warnings.push(`${entry.filename}: JSON parse failed (${error.message})`);
        continue;
      }
      if (lower.includes("tweets.js") || lower.includes("tweets-part") || lower.endsWith("/tweet.js")) {
        records.push(...mapTweets(parsed, surface));
      } else if (lower.includes("like.js")) {
        records.push(...mapLikes(parsed, surface));
      }
    }
    return { records, warnings, errors, filesParsed };
  }
  function isInterestingFile(name) {
    return name.endsWith("tweets.js") || name.endsWith("tweet.js") || name.includes("tweets-part") || name.endsWith("like.js");
  }
  function safeDecode(data, errors, filename) {
    try {
      return TEXT_DECODER2.decode(data);
    } catch (error) {
      errors.push(`${filename}: decode failed (${error.message})`);
      return null;
    }
  }
  function stripPrefix(text) {
    const match = /^[^=]*=\s*/.exec(text);
    return match ? text.slice(match[0].length) : text;
  }
  function mapTweets(parsed, surface) {
    if (!Array.isArray(parsed)) return [];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const out = [];
    for (const entry of parsed) {
      const tweet = isRecord3(entry) && isRecord3(entry.tweet) ? entry.tweet : entry;
      if (!isRecord3(tweet)) continue;
      const id = stringField(tweet, "id_str", "id");
      const text = stringField(tweet, "full_text", "text") ?? "";
      const createdAt = stringField(tweet, "created_at") ?? now;
      const record = {
        tweetId: id,
        handle: stringFromEntities(tweet) ?? null,
        displayName: null,
        text,
        capturedAt: createdAt,
        surface,
        media: [],
        permalink: id ? `https://x.com/i/web/status/${id}` : null
      };
      out.push(record);
    }
    return out;
  }
  function mapLikes(parsed, surface) {
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const entry of parsed) {
      const like = isRecord3(entry) && isRecord3(entry.like) ? entry.like : entry;
      if (!isRecord3(like)) continue;
      const id = stringField(like, "tweetId", "id");
      const text = stringField(like, "fullText", "text") ?? "";
      const record = {
        tweetId: id,
        handle: null,
        displayName: null,
        text,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        surface: `${surface}.likes`,
        media: [],
        permalink: id ? `https://x.com/i/web/status/${id}` : null
      };
      out.push(record);
    }
    return out;
  }
  function stringField(record, ...keys) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return null;
  }
  function stringFromEntities(tweet) {
    const entities = tweet.entities;
    if (!isRecord3(entities)) return null;
    const userMentions = entities.user_mentions;
    if (!Array.isArray(userMentions) || userMentions.length === 0) return null;
    const first = userMentions[0];
    if (!isRecord3(first)) return null;
    return stringField(first, "screen_name");
  }
  function isRecord3(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // src/features/library/cleanup-preview.ts
  function previewCleanup(records, options = {}) {
    const whitelist = new Set((options.whitelistHandles ?? []).map((h) => h.toLowerCase()));
    const protectedIds = new Set(options.protectedTweetIds ?? []);
    const byBucket = {
      tweets: 0,
      retweets: 0,
      replies: 0,
      likes: 0,
      bookmarks: 0
    };
    let protectedCount = 0;
    const candidates = [];
    for (const record of records) {
      const bucket = classify(record, options.bucketHint);
      if (!bucket) continue;
      const handle = record.handle?.toLowerCase() ?? null;
      const isProtected = record.tweetId !== null && protectedIds.has(record.tweetId) || handle !== null && whitelist.has(handle);
      if (isProtected) {
        protectedCount += 1;
      }
      byBucket[bucket] += 1;
      candidates.push({
        bucket,
        tweetId: record.tweetId,
        handle: record.handle,
        text: record.text,
        permalink: record.permalink,
        reason: explain(bucket, record),
        protected: isProtected
      });
    }
    return {
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      candidates,
      byBucket,
      protectedCount
    };
  }
  function classify(record, hint) {
    if (hint) return hint;
    if (record.surface.includes("likes")) return "likes";
    if (record.surface.includes("bookmarks")) return "bookmarks";
    if (record.text.startsWith("RT @") || record.text.startsWith("Reposted ")) return "retweets";
    if (record.text.startsWith("@")) return "replies";
    return "tweets";
  }
  function explain(bucket, record) {
    switch (bucket) {
      case "retweets":
        return "Reposted content \u2014 author retains the original";
      case "replies":
        return "Reply to another account";
      case "likes":
        return "Imported from Likes archive";
      case "bookmarks":
        return "Imported from Bookmarks archive";
      case "tweets":
      default:
        return record.tweetId ? `Original post ${record.tweetId}` : "Original post";
    }
  }

  // src/features/library/cleanup-queue.ts
  var CLEANUP_QUEUE_KEY = "aviary.cleanupQueue.v1";
  var CLEANUP_QUEUE_LIMIT = 5e3;
  var EMPTY3 = { items: [], destructiveExecuted: false };
  var CleanupQueue = class {
    #storage;
    #limit;
    #state = EMPTY3;
    #loaded = false;
    constructor(storage, limit = CLEANUP_QUEUE_LIMIT) {
      this.#storage = storage;
      this.#limit = Math.max(50, limit);
    }
    async load() {
      if (this.#loaded) return;
      const stored = await this.#storage.get(CLEANUP_QUEUE_KEY, EMPTY3);
      this.#state = {
        items: Array.isArray(stored?.items) ? stored.items.filter(isQueueItem).slice(-this.#limit) : [],
        destructiveExecuted: stored?.destructiveExecuted === true
      };
      this.#loaded = true;
    }
    async enqueue(candidates) {
      await this.load();
      let added = 0;
      for (const candidate of candidates) {
        if (candidate.protected) continue;
        this.#state.items.push({
          ...candidate,
          id: `item-${Date.now()}-${this.#state.items.length}-${added}`,
          enqueuedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: "queued"
        });
        added += 1;
      }
      while (this.#state.items.length > this.#limit) {
        this.#state.items.shift();
      }
      await this.#persist();
      return added;
    }
    list(status) {
      if (!status) {
        return [...this.#state.items];
      }
      return this.#state.items.filter((item) => item.status === status);
    }
    size() {
      return this.#state.items.length;
    }
    async setStatus(id, status, note) {
      await this.load();
      const item = this.#state.items.find((entry) => entry.id === id);
      if (!item) return;
      item.status = status;
      item.reviewedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (note) item.reviewerNote = note;
      await this.#persist();
    }
    async clear() {
      this.#state = { items: [], destructiveExecuted: this.#state.destructiveExecuted };
      this.#loaded = true;
      await this.#persist();
    }
    /**
     * Aviary does not delete account data in v1.0.0. This flag exists to record
     * the deliberate refusal so future versions can flip it behind an explicit
     * destructive-action toggle. The current implementation always reports false.
     */
    destructiveAllowed() {
      return false;
    }
    async #persist() {
      try {
        await this.#storage.set(CLEANUP_QUEUE_KEY, this.#state);
      } catch {
      }
    }
  };
  function isQueueItem(value) {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value;
    return typeof candidate.id === "string" && typeof candidate.enqueuedAt === "string" && typeof candidate.status === "string" && typeof candidate.bucket === "string";
  }

  // src/features/media/template.ts
  var FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;
  var COLLAPSING_WHITESPACE = /\s+/g;
  function renderFilename(template, fields) {
    const datePart = formatDate(fields.date);
    const safeHandle = sanitizeSegment(fields.handle ?? "unknown");
    const safeText = sanitizeSegment(fields.text).slice(0, 60);
    const tweetId = sanitizeSegment(fields.tweetId ?? "0");
    const mediaId = sanitizeSegment(fields.mediaId ?? tweetId);
    const indexLabel = String(fields.index + 1).padStart(2, "0");
    const totalLabel = String(Math.max(fields.total, 1)).padStart(2, "0");
    const substitutions = {
      handle: safeHandle,
      tweetId,
      mediaId,
      index: indexLabel,
      total: totalLabel,
      date: datePart,
      text: safeText,
      ext: fields.ext.toLowerCase()
    };
    let name = template.replace(/\{(\w+)\}/g, (match, key) => {
      const value = substitutions[key];
      return value === void 0 ? match : value;
    }).replace(/[\\/]+/g, "/").trim();
    if (name.length === 0) {
      name = `${safeHandle}_${tweetId}_${indexLabel}`;
    }
    if (!name.toLowerCase().endsWith(`.${fields.ext.toLowerCase()}`)) {
      name = `${name}.${fields.ext.toLowerCase()}`;
    }
    return name;
  }
  function sanitizeSegment(value) {
    return value.replace(FORBIDDEN, "").replace(COLLAPSING_WHITESPACE, " ").trim();
  }
  function formatDate(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // src/features/media/downloader.ts
  function createDownloader(options = {}) {
    return async (request) => {
      if (options.integrations) {
        const aria = options.integrations.aria2;
        if (options.aria2History?.hasUrl(request.url)) {
          return { ok: true, via: "aria2", deduplicated: true };
        }
        if (shouldHandoffToAria2(aria, request.estimatedBytes ?? null)) {
          const result = await addUriToAria2(
            { endpoint: aria.endpoint, secret: aria.secret },
            { url: request.url, filename: request.filename }
          );
          if (result.ok) {
            if (result.gid && options.aria2History) {
              await options.aria2History.rememberQueued({
                gid: result.gid,
                url: request.url,
                filename: request.filename
              });
            }
            return { ok: true, via: "aria2", ...result.gid ? { gid: result.gid } : {} };
          }
        }
      }
      const gmResult = await tryGmDownload(request);
      if (gmResult) {
        return { ok: true, via: "gm" };
      }
      const extResult = await tryExtensionDownload(request);
      if (extResult) {
        return { ok: true, via: "extension" };
      }
      triggerAnchor(request);
      return { ok: true, via: "anchor" };
    };
  }
  async function tryGmDownload(request) {
    const globals = globalThis;
    if (typeof globals.GM_download !== "function") {
      return false;
    }
    return await new Promise((resolve) => {
      try {
        globals.GM_download?.({
          url: request.url,
          name: request.filename,
          onload: () => resolve(true),
          onerror: () => resolve(false),
          ontimeout: () => resolve(false)
        });
      } catch {
        resolve(false);
      }
    });
  }
  async function tryExtensionDownload(request) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      return false;
    }
    try {
      const response = await runtime.sendMessage({
        type: "AVIARY_DOWNLOAD",
        url: request.url,
        filename: request.filename
      });
      return response?.ok === true;
    } catch {
      return false;
    }
  }
  function triggerAnchor(request) {
    if (typeof document === "undefined") {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = request.url;
    anchor.download = request.filename;
    anchor.rel = "noopener noreferrer";
    anchor.target = "_blank";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  // src/features/media/history.ts
  var MEDIA_HISTORY_KEY = "aviary.media.history.v1";
  var MEDIA_HISTORY_LIMIT = 1500;
  var MediaHistory = class {
    #storage;
    #limit;
    #entries = [];
    #index = /* @__PURE__ */ new Set();
    #loaded = false;
    #loading;
    constructor(storage, limit = MEDIA_HISTORY_LIMIT) {
      this.#storage = storage;
      this.#limit = Math.max(50, limit);
    }
    async load() {
      if (this.#loaded) {
        return;
      }
      if (!this.#loading) {
        this.#loading = this.#hydrate();
      }
      await this.#loading;
    }
    has(key) {
      return this.#index.has(key);
    }
    async record(key) {
      await this.load();
      if (this.#index.has(key)) {
        return false;
      }
      this.#index.add(key);
      this.#entries.push({ key, at: (/* @__PURE__ */ new Date()).toISOString() });
      while (this.#entries.length > this.#limit) {
        const removed = this.#entries.shift();
        if (removed) {
          this.#index.delete(removed.key);
        }
      }
      await this.#persist();
      return true;
    }
    async clear() {
      this.#entries = [];
      this.#index.clear();
      this.#loaded = true;
      await this.#persist();
    }
    size() {
      return this.#entries.length;
    }
    snapshot() {
      return { entries: [...this.#entries] };
    }
    async #hydrate() {
      const fallback = { entries: [] };
      const stored = await this.#storage.get(MEDIA_HISTORY_KEY, fallback);
      const entries = Array.isArray(stored?.entries) ? stored.entries : [];
      this.#entries = entries.filter(
        (entry) => typeof entry?.key === "string" && typeof entry?.at === "string"
      ).slice(-this.#limit);
      this.#index = new Set(this.#entries.map((entry) => entry.key));
      this.#loaded = true;
    }
    async #persist() {
      try {
        await this.#storage.set(MEDIA_HISTORY_KEY, {
          entries: this.#entries
        });
      } catch {
      }
    }
  };

  // src/features/media/last-download.ts
  var LAST_DOWNLOAD_KEY = "aviary.media.last-download.v1";
  async function rememberLastDownload(storage, input) {
    if (!isHttpUrl(input.url) || input.filename.trim().length === 0) return;
    try {
      await storage.set(LAST_DOWNLOAD_KEY, {
        ...input,
        filename: input.filename.slice(0, 240),
        downloadedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch {
    }
  }
  async function getLastDownload(storage) {
    const stored = await storage.get(LAST_DOWNLOAD_KEY, null);
    return isLastDownload(stored) ? stored : null;
  }
  function isLastDownload(value) {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value;
    return typeof candidate.url === "string" && isHttpUrl(candidate.url) && typeof candidate.filename === "string" && candidate.filename.length > 0 && (candidate.kind === "photo" || candidate.kind === "video" || candidate.kind === "thumbnail") && typeof candidate.downloadedAt === "string";
  }
  function isHttpUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  // src/features/media/queue.ts
  var RECENT_LIMIT = 40;
  var DownloadQueue = class {
    #jobs = [];
    #listeners = /* @__PURE__ */ new Set();
    #seq = 0;
    enqueue(job) {
      const entry = {
        id: `job-${++this.#seq}`,
        status: "queued",
        ...job
      };
      this.#jobs.push(entry);
      this.#trim();
      this.#notify();
      return entry;
    }
    mark(jobId, status, error) {
      const job = this.#jobs.find((entry) => entry.id === jobId);
      if (!job) {
        return;
      }
      if (status === "running" && !job.startedAt) {
        job.startedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      if (status === "completed" || status === "failed" || status === "duplicate") {
        job.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      job.status = status;
      if (error) {
        job.error = error;
      } else if (status !== "failed") {
        delete job.error;
      }
      this.#notify();
    }
    snapshot() {
      const counts = {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        duplicate: 0
      };
      for (const job of this.#jobs) {
        counts[job.status] += 1;
      }
      return {
        total: this.#jobs.length,
        queued: counts.queued,
        running: counts.running,
        completed: counts.completed,
        failed: counts.failed,
        duplicate: counts.duplicate,
        recent: this.#jobs.slice(-RECENT_LIMIT)
      };
    }
    subscribe(listener) {
      this.#listeners.add(listener);
      listener(this.snapshot());
      return () => {
        this.#listeners.delete(listener);
      };
    }
    clear() {
      this.#jobs.length = 0;
      this.#notify();
    }
    #trim() {
      while (this.#jobs.length > 200) {
        this.#jobs.shift();
      }
    }
    #notify() {
      const snapshot = this.snapshot();
      for (const listener of this.#listeners) {
        try {
          listener(snapshot);
        } catch {
        }
      }
    }
  };

  // src/features/media/media-buttons.ts
  var STYLE_ID2 = "av-media-buttons";
  var BUTTON_ATTR = "data-av-media-button";
  var PROCESSED_ATTR = "data-av-media-processed";
  var downloader;
  var history;
  var aria2History;
  var queue;
  var mediaButtonsFeature = {
    id: "media.buttons",
    title: "One-click media",
    category: "media",
    defaultEnabled: true,
    async init(ctx) {
      ensureMediaStyle();
      aria2History = new Aria2History(ctx.storage);
      await aria2History.load();
      if (ctx.settings.integrations.aria2.endpoint) {
        await aria2History.reconcile({
          endpoint: ctx.settings.integrations.aria2.endpoint,
          secret: ctx.settings.integrations.aria2.secret
        });
      }
      downloader = createDownloader({ integrations: ctx.settings.integrations, aria2History });
      queue = new DownloadQueue();
      history = new MediaHistory(ctx.storage);
      try {
        await history.load();
      } catch (error) {
        ctx.diagnostics.warn("Media history failed to load", errorDetails2(error));
      }
      applyToggleClass(ctx);
      scanArticles(document, ctx);
      ctx.diagnostics.info("Media buttons initialized", { history: history.size() });
    },
    apply(ctx, root, addedNodes) {
      ensureMediaStyle();
      applyToggleClass(ctx);
      if (!ctx.settings.media.buttons) {
        return;
      }
      if (!addedNodes || addedNodes.length === 0) {
        scanArticles(root, ctx);
        return;
      }
      for (const node of addedNodes) {
        scanArticles(node, ctx);
      }
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID2)?.remove();
      document.documentElement.classList.remove("av-media-buttons-enabled");
      for (const article of Array.from(
        document.querySelectorAll(`[${PROCESSED_ATTR}]`)
      )) {
        article.removeAttribute(PROCESSED_ATTR);
      }
      for (const button2 of Array.from(document.querySelectorAll(`[${BUTTON_ATTR}]`))) {
        button2.remove();
      }
      downloader = void 0;
      history = void 0;
      aria2History = void 0;
      queue?.clear();
      queue = void 0;
      ctx.diagnostics.info("Media buttons destroyed");
    },
    getStatus() {
      if (!queue) {
        return { ok: true, message: "Media buttons idle" };
      }
      const snapshot = queue.snapshot();
      return {
        ok: snapshot.failed === 0,
        message: `Downloads: ${snapshot.completed} ok / ${snapshot.duplicate} dup / ${snapshot.failed} fail`,
        details: { ...snapshot }
      };
    }
  };
  function getMediaQueue() {
    return queue;
  }
  function getMediaHistory() {
    return history;
  }
  function applyToggleClass(ctx) {
    document.documentElement.classList.toggle(
      "av-media-buttons-enabled",
      ctx.settings.media.buttons
    );
  }
  function scanArticles(root, ctx) {
    if (!ctx.settings.media.buttons) {
      return;
    }
    const articles = collectArticles(root);
    for (const article of articles) {
      if (article.getAttribute(PROCESSED_ATTR) === "1") {
        continue;
      }
      const tweet = extractTweet(article);
      if (tweet.media.length === 0) {
        continue;
      }
      decorateArticle(tweet, ctx);
      article.setAttribute(PROCESSED_ATTR, "1");
    }
  }
  function collectArticles(root) {
    const found = [];
    if (root instanceof Element && root.matches('article[data-testid="tweet"]')) {
      found.push(root);
    }
    if ("querySelectorAll" in root) {
      for (const article of Array.from(
        root.querySelectorAll('article[data-testid="tweet"]')
      )) {
        found.push(article);
      }
    }
    return found;
  }
  function decorateArticle(tweet, ctx) {
    tweet.media.forEach((media, index) => {
      const container = resolveContainer(media);
      if (!container || hasOwnButton(container, media.kind)) {
        return;
      }
      const button2 = buildButton(media, index, tweet, ctx);
      container.append(button2);
    });
  }
  function resolveContainer(media) {
    if (media.kind === "video" && media.video) {
      return media.video.container;
    }
    return media.source.closest('[data-testid="tweetPhoto"]') ?? media.source.parentElement;
  }
  function hasOwnButton(container, kind) {
    return container.querySelector(`[${BUTTON_ATTR}="${kind}"]`) !== null;
  }
  function buildButton(media, index, tweet, ctx) {
    const button2 = document.createElement("button");
    button2.type = "button";
    button2.className = "av-media-button";
    button2.setAttribute(BUTTON_ATTR, media.kind);
    button2.dataset.kind = media.kind;
    button2.setAttribute("aria-label", buttonAriaLabel(media));
    button2.textContent = buttonLabel(media);
    button2.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      void handleDownload(media, index, tweet, ctx, button2);
    });
    return button2;
  }
  function buttonLabel(media) {
    if (media.kind === "thumbnail") {
      return "Thumb";
    }
    if (media.kind === "video") {
      return media.video?.isGif ? "GIF" : "Video";
    }
    return "Save";
  }
  function buttonAriaLabel(media) {
    if (media.kind === "thumbnail") {
      return "Download thumbnail";
    }
    if (media.kind === "video") {
      return media.video?.isGif ? "Download GIF" : "Download video";
    }
    return "Download image";
  }
  async function handleDownload(media, index, tweet, ctx, button2) {
    if (!downloader || !queue || !history) {
      return;
    }
    const target = resolveTarget(media);
    if (!target) {
      button2.textContent = "Unavailable";
      button2.disabled = true;
      button2.classList.add("is-error");
      ctx.diagnostics.warn("Media target unavailable", { kind: media.kind });
      return;
    }
    const filename = renderFilename(ctx.settings.media.filenameTemplate, {
      handle: tweet.handle,
      tweetId: tweet.tweetId,
      index,
      total: tweet.media.length,
      date: /* @__PURE__ */ new Date(),
      ext: target.ext,
      text: tweet.text,
      mediaId: target.mediaId
    });
    const dedupeKey = `${tweet.tweetId ?? "0"}:${target.mediaId ?? target.url}:${index}:${media.kind}`;
    if (ctx.settings.media.downloadHistory && history.has(dedupeKey)) {
      const job2 = queue.enqueue({ url: target.url, filename });
      queue.mark(job2.id, "duplicate");
      button2.textContent = "Saved";
      button2.classList.add("is-duplicate");
      ctx.diagnostics.info("Media skipped \u2014 already in history", { dedupeKey });
      void ctx.auditLog.record("media.download.duplicate", { dedupeKey });
      return;
    }
    const job = queue.enqueue({ url: target.url, filename });
    queue.mark(job.id, "running");
    button2.classList.add("is-active");
    button2.disabled = true;
    try {
      const result = await downloader({ url: target.url, filename });
      if (result.deduplicated) {
        queue.mark(job.id, "duplicate");
        button2.textContent = "Queued";
        button2.classList.remove("is-active");
        button2.classList.add("is-duplicate");
        ctx.diagnostics.info("Media skipped \u2014 already queued in Aria2 history", { url: target.url });
        void ctx.auditLog.record("media.download.duplicate", {
          dedupeKey,
          source: "aria2-history"
        });
        return;
      }
      queue.mark(job.id, "completed");
      await rememberLastDownload(ctx.storage, {
        url: target.url,
        filename,
        kind: media.kind
      });
      if (ctx.settings.media.downloadHistory) {
        await history.record(dedupeKey);
      }
      button2.textContent = successLabel(media);
      button2.classList.remove("is-active");
      button2.classList.add("is-success");
      ctx.diagnostics.info("Media saved", { filename, kind: media.kind });
      void ctx.auditLog.record("media.download", { filename, kind: media.kind });
    } catch (error) {
      queue.mark(job.id, "failed", String(error?.message ?? error));
      button2.textContent = "Retry";
      button2.classList.remove("is-active");
      button2.classList.add("is-error");
      button2.disabled = false;
      ctx.diagnostics.error("Media download failed", errorDetails2(error));
      void ctx.auditLog.record("media.download.failed", { filename, kind: media.kind });
    }
  }
  function resolveTarget(media) {
    if (media.kind === "video" && media.video?.preferred) {
      const url = media.video.preferred.url;
      return { url, mediaId: mediaIdFromVideo(url), ext: extensionForVideo(media.video.preferred.type, url) };
    }
    if (media.image) {
      return { url: media.image.url, mediaId: media.image.mediaId, ext: media.image.format };
    }
    return null;
  }
  function mediaIdFromVideo(url) {
    const match = /\/([A-Za-z0-9_-]{6,})\.(mp4|m4s|m3u8|webm|mov)(?:[?#]|$)/i.exec(url);
    return match?.[1] ?? null;
  }
  function extensionForVideo(mime, url) {
    if (/mp4/i.test(mime) || /\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
    if (/webm/i.test(mime) || /\.webm(?:[?#]|$)/i.test(url)) return "webm";
    if (/m3u8/i.test(mime) || /\.m3u8(?:[?#]|$)/i.test(url)) return "m3u8";
    if (/mov/i.test(mime) || /\.mov(?:[?#]|$)/i.test(url)) return "mov";
    return "mp4";
  }
  function successLabel(media) {
    if (media.kind === "thumbnail") return "Got it";
    if (media.kind === "video") return media.video?.isGif ? "GIF saved" : "Saved";
    return "Saved";
  }
  function errorDetails2(error) {
    if (error instanceof Error) {
      return { name: error.name, message: error.message };
    }
    return { message: String(error) };
  }
  function ensureMediaStyle() {
    if (document.getElementById(STYLE_ID2)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID2;
    style.textContent = MEDIA_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var MEDIA_CSS = `
html:not(.av-media-buttons-enabled) [${BUTTON_ATTR}] {
  display: none !important;
}

[${BUTTON_ATTR}] {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, rgb(0, 0, 0) 60%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
  cursor: pointer;
  font: 700 11px/1.1 TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  opacity: 0;
  transition: opacity 120ms ease, border-color 120ms ease;
}

[data-testid="tweetPhoto"] {
  position: relative;
}

[data-testid="tweetPhoto"]:hover [${BUTTON_ATTR}],
[data-testid="tweetPhoto"]:focus-within [${BUTTON_ATTR}],
[${BUTTON_ATTR}]:focus-visible,
[${BUTTON_ATTR}].is-active,
[${BUTTON_ATTR}].is-success,
[${BUTTON_ATTR}].is-error,
[${BUTTON_ATTR}].is-duplicate {
  opacity: 1;
}

[${BUTTON_ATTR}].is-success {
  border-color: rgb(120, 200, 130);
  color: rgb(206, 240, 210);
}

[${BUTTON_ATTR}].is-duplicate {
  border-color: var(--av-muted, rgb(113, 118, 123));
  color: var(--av-muted, rgb(113, 118, 123));
}

[${BUTTON_ATTR}].is-error {
  border-color: rgb(220, 110, 110);
  color: rgb(248, 200, 200);
}

[${BUTTON_ATTR}][data-kind="thumbnail"] {
  top: 8px;
  right: 76px;
}
`;

  // src/features/media/batch-downloader.ts
  async function runMediaBatch(ctx, options = {}) {
    const queue2 = getMediaQueue();
    const history2 = getMediaHistory();
    const downloader2 = createDownloader({ integrations: ctx.settings.integrations });
    const concurrency = Math.max(1, Math.min(ctx.settings.jobs.concurrentDownloads, 6));
    const max = Math.max(1, options.maxItems ?? 200);
    const filterKind = options.filterKind ?? "all";
    const tweets = collectArticles2(document, options.surface);
    const tasks = [];
    for (const tweet of tweets) {
      tweet.media.forEach((media, index) => {
        if (filterKind !== "all" && media.kind !== filterKind) return;
        const target = resolveTarget2(media);
        if (!target) return;
        tasks.push({ media, tweet, index, target });
      });
      if (tasks.length >= max) {
        return runTasks(ctx, downloader2, queue2, history2, tasks.slice(0, max));
      }
    }
    return runTasks(ctx, downloader2, queue2, history2, tasks.slice(0, max), concurrency);
  }
  async function runTasks(ctx, downloader2, queue2, history2, tasks, concurrency = 3) {
    const progress = {
      total: tasks.length,
      enqueued: 0,
      downloaded: 0,
      duplicate: 0,
      failed: 0
    };
    const jobIds = [];
    let cursor = 0;
    const workers = [];
    const next = async () => {
      while (true) {
        const index = cursor++;
        if (index >= tasks.length) return;
        const task = tasks[index];
        const dedupeKey = `${task.tweet.tweetId ?? "0"}:${task.target.mediaId ?? task.target.url}:${task.index}:${task.media.kind}`;
        const filename = renderFilename(ctx.settings.media.filenameTemplate, {
          handle: task.tweet.handle,
          tweetId: task.tweet.tweetId,
          index: task.index,
          total: task.tweet.media.length,
          date: /* @__PURE__ */ new Date(),
          ext: task.target.ext,
          text: task.tweet.text,
          mediaId: task.target.mediaId
        });
        if (ctx.settings.media.downloadHistory && history2?.has(dedupeKey)) {
          progress.duplicate += 1;
          if (queue2) {
            const job2 = queue2.enqueue({ url: task.target.url, filename });
            queue2.mark(job2.id, "duplicate");
            jobIds.push(job2.id);
          }
          continue;
        }
        const job = queue2?.enqueue({ url: task.target.url, filename });
        if (job) {
          jobIds.push(job.id);
          queue2?.mark(job.id, "running");
        }
        progress.enqueued += 1;
        try {
          const result = await downloader2({ url: task.target.url, filename });
          if (job) queue2?.mark(job.id, "completed");
          if (ctx.settings.media.downloadHistory && history2) {
            await history2.record(dedupeKey);
          }
          progress.downloaded += 1;
          void ctx.auditLog.record("media.download", { filename, kind: task.media.kind, via: result.via, batch: true });
        } catch (error) {
          if (job) queue2?.mark(job.id, "failed", String(error?.message ?? error));
          progress.failed += 1;
          ctx.diagnostics.error("Batch media download failed", {
            filename,
            kind: task.media.kind,
            error: String(error?.message ?? error)
          });
          void ctx.auditLog.record("media.download.failed", { filename, kind: task.media.kind, batch: true });
        }
      }
    };
    for (let i = 0; i < concurrency; i++) {
      workers.push(next());
    }
    await Promise.all(workers);
    return { ...progress, jobIds, cancelled: false };
  }
  function collectArticles2(root, surface = "active") {
    const articles = root instanceof Element && root.matches('article[data-testid="tweet"]') ? [root] : Array.from(root.querySelectorAll('article[data-testid="tweet"]'));
    const seen = /* @__PURE__ */ new Set();
    const tweets = [];
    for (const article of articles) {
      const tweet = extractTweet(article);
      const key = `${tweet.tweetId ?? "noid"}:${tweet.handle ?? "noh"}`;
      if (seen.has(key) || tweet.media.length === 0) continue;
      seen.add(key);
      tweets.push(tweet);
    }
    return tweets.map((tweet) => ({ ...tweet, surface }));
  }
  function resolveTarget2(media) {
    if (media.kind === "video" && media.video?.preferred) {
      const url = media.video.preferred.url;
      return { url, mediaId: mediaIdFromVideo2(url), ext: extensionForVideo2(media.video.preferred.type, url) };
    }
    if (media.image) {
      return { url: media.image.url, mediaId: media.image.mediaId, ext: media.image.format };
    }
    return null;
  }
  function mediaIdFromVideo2(url) {
    const match = /\/([A-Za-z0-9_-]{6,})\.(mp4|m4s|m3u8|webm|mov)(?:[?#]|$)/i.exec(url);
    return match?.[1] ?? null;
  }
  function extensionForVideo2(mime, url) {
    if (/mp4/i.test(mime) || /\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
    if (/webm/i.test(mime) || /\.webm(?:[?#]|$)/i.test(url)) return "webm";
    if (/m3u8/i.test(mime) || /\.m3u8(?:[?#]|$)/i.test(url)) return "m3u8";
    if (/mov/i.test(mime) || /\.mov(?:[?#]|$)/i.test(url)) return "mov";
    return "mp4";
  }

  // src/features/library/local-search.ts
  var LocalSearchIndex = class {
    #postings = /* @__PURE__ */ new Map();
    #records = [];
    rebuild(records) {
      this.#postings.clear();
      this.#records.length = 0;
      for (const record of records) {
        this.add(record);
      }
    }
    add(record) {
      const id = this.#records.push(record) - 1;
      for (const token of tokensFor(record)) {
        let posting = this.#postings.get(token);
        if (!posting) {
          posting = /* @__PURE__ */ new Set();
          this.#postings.set(token, posting);
        }
        posting.add(id);
      }
    }
    size() {
      return this.#records.length;
    }
    termCount() {
      return this.#postings.size;
    }
    search(query, options = {}) {
      const tokens = tokenize(query);
      if (tokens.length === 0) return [];
      const limit = options.limit ?? 50;
      const docScores = /* @__PURE__ */ new Map();
      for (const term of tokens) {
        const posting = this.#postings.get(term);
        if (!posting) continue;
        for (const id of posting) {
          const existing = docScores.get(id);
          if (existing) {
            existing.score += 1;
            existing.matched.add(term);
          } else {
            docScores.set(id, { score: 1, matched: /* @__PURE__ */ new Set([term]) });
          }
        }
      }
      const sorted = [...docScores.entries()].map(([id, { score, matched }]) => {
        const record = this.#records[id];
        if (!record) {
          return null;
        }
        return {
          record,
          score: score + matched.size,
          matchedTerms: [...matched].sort()
        };
      }).filter((hit) => hit !== null).sort((a, b) => b.score - a.score).slice(0, limit);
      return sorted;
    }
  };
  function tokensFor(record) {
    const haystack = [
      record.text,
      record.handle ?? "",
      record.displayName ?? "",
      record.surface,
      ...record.media.map((media) => media.url)
    ].join(" ");
    return new Set(tokenize(haystack));
  }
  function tokenize(value) {
    return value.toLowerCase().split(/[^a-z0-9_@]+/i).map((token) => token.replace(/^@/, "")).filter((token) => token.length >= 2 && token.length <= 40);
  }

  // src/features/library/reports.ts
  function buildMarkdownReport(input) {
    const at = input.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString();
    const lines = [];
    lines.push(`# Aviary report`);
    lines.push("");
    lines.push(`Generated ${at}${input.version ? ` for v${input.version}` : ""}.`);
    lines.push("");
    lines.push(`## Audit log (${input.audit.length} entries)`);
    if (input.audit.length === 0) {
      lines.push("- No entries yet.");
    } else {
      for (const entry of input.audit.slice(-50)) {
        const detail = entry.detail ? ` \u2014 ${JSON.stringify(entry.detail)}` : "";
        lines.push(`- ${entry.at} \xB7 ${entry.action}${detail}`);
      }
    }
    lines.push("");
    if (input.snapshots) {
      const { latest, diff } = input.snapshots;
      lines.push(`## Snapshot \u2014 ${latest.kind} for @${latest.handle}`);
      lines.push("");
      lines.push(`- Captured: ${latest.capturedAt}`);
      lines.push(`- Source: ${latest.source}`);
      lines.push(`- Total: ${latest.accounts.length}`);
      if (diff) {
        lines.push("");
        lines.push(`### Diff vs ${diff.earlierAt}`);
        lines.push(`- Added (${diff.added.length}): ${diff.added.slice(0, 30).join(", ") || "\u2014"}${diff.added.length > 30 ? ", \u2026" : ""}`);
        lines.push(`- Removed (${diff.removed.length}): ${diff.removed.slice(0, 30).join(", ") || "\u2014"}${diff.removed.length > 30 ? ", \u2026" : ""}`);
        lines.push(`- Unchanged: ${diff.unchanged}`);
      }
      lines.push("");
    }
    if (input.cleanup) {
      const cleanup = input.cleanup;
      lines.push(`## Cleanup preview (no destructive action)`);
      lines.push("");
      lines.push(`- Generated: ${cleanup.generatedAt}`);
      lines.push(`- Total candidates: ${cleanup.candidates.length}`);
      lines.push(`- Protected: ${cleanup.protectedCount}`);
      for (const [bucket, count] of Object.entries(cleanup.byBucket)) {
        lines.push(`  - ${bucket}: ${count}`);
      }
      if (cleanup.candidates.length > 0) {
        lines.push("");
        lines.push("### Sample (first 20)");
        for (const candidate of cleanup.candidates.slice(0, 20)) {
          const guard = candidate.protected ? " [protected]" : "";
          const handle = candidate.handle ? `@${candidate.handle}` : "(unknown)";
          const preview = candidate.text.slice(0, 80).replace(/\s+/g, " ");
          lines.push(`- ${candidate.bucket}${guard} \xB7 ${handle} \xB7 ${candidate.tweetId ?? "\u2014"} \xB7 "${preview}"`);
        }
      }
      lines.push("");
    }
    lines.push("## Reminder");
    lines.push("");
    lines.push("Aviary never deletes anything for you in this release. The cleanup preview is read-only; destructive actions stay disabled per the v1.0 trust contract.");
    lines.push("");
    return `${lines.join("\n")}
`;
  }

  // src/features/library/snapshots.ts
  var SNAPSHOTS_KEY = "aviary.snapshots.v1";
  var SNAPSHOT_LIMIT = 24;
  var EMPTY4 = { entries: [] };
  var SnapshotStore = class {
    #storage;
    #limit;
    #state = EMPTY4;
    #loaded = false;
    constructor(storage, limit = SNAPSHOT_LIMIT) {
      this.#storage = storage;
      this.#limit = Math.max(4, limit);
    }
    async load() {
      if (this.#loaded) return;
      const stored = await this.#storage.get(SNAPSHOTS_KEY, EMPTY4);
      const entries = Array.isArray(stored?.entries) ? stored.entries : [];
      this.#state = { entries: entries.filter(isSnapshotEntry).slice(-this.#limit) };
      this.#loaded = true;
    }
    async record(entry) {
      await this.load();
      const stored = {
        ...entry,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        accounts: Array.from(new Set(entry.accounts.map(normalizeHandle).filter((value) => value !== null))).sort()
      };
      this.#state.entries.push(stored);
      while (this.#state.entries.length > this.#limit) {
        this.#state.entries.shift();
      }
      await this.#persist();
      return stored;
    }
    list(kind, handle) {
      const scoped = this.#state.entries.filter((entry) => {
        if (kind && entry.kind !== kind) return false;
        if (handle && entry.handle !== handle.toLowerCase()) return false;
        return true;
      });
      return [...scoped];
    }
    diffLatest(kind, handle) {
      const scoped = this.list(kind, handle);
      if (scoped.length < 2) return null;
      const earlier = scoped[scoped.length - 2];
      const later = scoped[scoped.length - 1];
      return diffSnapshots(earlier, later);
    }
    async clear() {
      this.#state = { entries: [] };
      this.#loaded = true;
      await this.#persist();
    }
    size() {
      return this.#state.entries.length;
    }
    async #persist() {
      try {
        await this.#storage.set(SNAPSHOTS_KEY, this.#state);
      } catch {
      }
    }
  };
  function diffSnapshots(earlier, later) {
    const earlierSet = new Set(earlier.accounts);
    const laterSet = new Set(later.accounts);
    const added = [];
    const removed = [];
    let unchanged = 0;
    for (const handle of laterSet) {
      if (earlierSet.has(handle)) {
        unchanged += 1;
      } else {
        added.push(handle);
      }
    }
    for (const handle of earlierSet) {
      if (!laterSet.has(handle)) {
        removed.push(handle);
      }
    }
    added.sort();
    removed.sort();
    return {
      earlierAt: earlier.capturedAt,
      laterAt: later.capturedAt,
      added,
      removed,
      unchanged
    };
  }
  function collectAccountsFromDom(root) {
    const cells = root.querySelectorAll('[data-testid="UserCell"]');
    const handles = /* @__PURE__ */ new Set();
    for (const cell of Array.from(cells)) {
      const link = cell.querySelector('a[href^="/"]');
      const href = link?.getAttribute("href") ?? "";
      const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
      const candidate = match?.[1];
      if (candidate) {
        const normalized = normalizeHandle(candidate);
        if (normalized) handles.add(normalized);
      }
    }
    return Array.from(handles).sort();
  }
  function isSnapshotEntry(value) {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value;
    return (candidate.kind === "followers" || candidate.kind === "following") && typeof candidate.handle === "string" && typeof candidate.capturedAt === "string" && Array.isArray(candidate.accounts) && candidate.accounts.every((entry) => typeof entry === "string");
  }
  function normalizeHandle(value) {
    const cleaned = value.replace(/^@/, "").trim().toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
  }

  // src/features/library/snapshots-feature.ts
  var store;
  var snapshotsFeature = {
    id: "library.snapshots",
    title: "Follower / following snapshots",
    category: "core",
    defaultEnabled: true,
    async init(ctx) {
      store = new SnapshotStore(ctx.storage);
      await store.load();
      ctx.diagnostics.info("Snapshots initialized", { entries: store.size() });
    },
    destroy(ctx) {
      store = void 0;
      ctx.diagnostics.info("Snapshots destroyed");
    },
    getStatus() {
      return {
        ok: true,
        message: store ? `${store.size()} snapshots stored` : "Snapshots idle"
      };
    }
  };
  function getSnapshotStore() {
    return store;
  }
  async function captureSnapshotFromDom(ctx, kind, profileHandle) {
    if (!store) return null;
    const accounts = collectAccountsFromDom(document);
    if (accounts.length === 0) {
      ctx.diagnostics.warn("Snapshot skipped \u2014 no UserCell rows in DOM");
      return null;
    }
    const entry = await store.record({
      kind,
      handle: profileHandle.toLowerCase(),
      source: "dom",
      accounts
    });
    ctx.diagnostics.info("Snapshot captured", {
      kind,
      handle: profileHandle,
      count: accounts.length
    });
    return { entry, totalAccounts: accounts.length };
  }

  // src/features/library/user-notes.ts
  var USER_NOTES_KEY = "aviary.userNotes.v1";
  var STYLE_ID3 = "av-user-notes";
  var BADGE_ATTR = "data-av-note-badge";
  var ARTICLE_ATTR = "data-av-note-processed";
  var cache;
  var activeStorage;
  var userNotesFeature = {
    id: "library.userNotes",
    title: "Account notes",
    category: "core",
    defaultEnabled: true,
    async init(ctx) {
      activeStorage = ctx.storage;
      ensureStyle();
      cache = await load(ctx.storage);
      decorate(ctx, document);
      ctx.diagnostics.info("User notes initialized", { count: Object.keys(cache.notes).length });
    },
    apply(ctx, root, addedNodes) {
      ensureStyle();
      if (!cache) {
        return;
      }
      if (!addedNodes || addedNodes.length === 0) {
        decorate(ctx, root);
        return;
      }
      for (const node of addedNodes) {
        decorate(ctx, node);
      }
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID3)?.remove();
      for (const article of Array.from(document.querySelectorAll(`[${ARTICLE_ATTR}]`))) {
        article.removeAttribute(ARTICLE_ATTR);
      }
      for (const badge of Array.from(document.querySelectorAll(`[${BADGE_ATTR}]`))) {
        badge.remove();
      }
      cache = void 0;
      activeStorage = void 0;
      ctx.diagnostics.info("User notes destroyed");
    },
    getStatus() {
      return {
        ok: true,
        message: cache ? `${Object.keys(cache.notes).length} notes` : "Notes idle"
      };
    }
  };
  function getUserNotes() {
    return { ...cache?.notes ?? {} };
  }
  async function setUserNote(handle, note) {
    const normalized = normalizeHandle2(handle);
    if (!normalized || !activeStorage) {
      return;
    }
    if (!cache) {
      cache = await load(activeStorage);
    }
    if (note.trim().length === 0) {
      delete cache.notes[normalized];
    } else {
      cache.notes[normalized] = note.trim().slice(0, 280);
    }
    cache.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    try {
      await activeStorage.set(USER_NOTES_KEY, cache);
    } catch {
    }
  }
  async function clearUserNotes() {
    if (!activeStorage) return;
    cache = { notes: {}, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    try {
      await activeStorage.set(USER_NOTES_KEY, cache);
    } catch {
    }
  }
  async function load(storage) {
    const fallback = { notes: {}, updatedAt: null };
    const stored = await storage.get(USER_NOTES_KEY, fallback);
    const notes = stored?.notes ?? {};
    const sanitized = {};
    for (const [handle, note] of Object.entries(notes)) {
      const normalized = normalizeHandle2(handle);
      if (normalized && typeof note === "string" && note.trim().length > 0) {
        sanitized[normalized] = note.slice(0, 280);
      }
    }
    return { notes: sanitized, updatedAt: stored?.updatedAt ?? null };
  }
  function decorate(_ctx, root) {
    if (!cache) return;
    const articles = root instanceof Element && root.matches('article[data-testid="tweet"]') ? [root] : Array.from(root.querySelectorAll('article[data-testid="tweet"]'));
    for (const article of articles) {
      if (article.getAttribute(ARTICLE_ATTR) === "1") {
        continue;
      }
      const handle = readHandle2(article);
      if (!handle) continue;
      const note = cache.notes[handle];
      if (!note) {
        article.setAttribute(ARTICLE_ATTR, "1");
        continue;
      }
      const userName = article.querySelector('[data-testid="User-Name"]');
      if (!userName || userName.querySelector(`[${BADGE_ATTR}]`)) {
        article.setAttribute(ARTICLE_ATTR, "1");
        continue;
      }
      const badge = document.createElement("span");
      badge.setAttribute(BADGE_ATTR, "1");
      badge.className = "av-note-badge";
      badge.textContent = "Note";
      badge.title = note;
      badge.setAttribute("role", "note");
      badge.setAttribute("aria-label", `Note for @${handle}: ${note}`);
      userName.append(badge);
      article.setAttribute(ARTICLE_ATTR, "1");
    }
  }
  function readHandle2(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    const links = userName?.querySelectorAll('a[href^="/"]') ?? [];
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href") ?? "";
      const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
      const candidate = match?.[1];
      if (candidate) {
        return normalizeHandle2(candidate);
      }
    }
    return null;
  }
  function normalizeHandle2(value) {
    const cleaned = value.replace(/^@/, "").trim().toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
  }
  function ensureStyle() {
    if (document.getElementById(STYLE_ID3)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID3;
    style.textContent = NOTE_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var NOTE_CSS = `
.av-note-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 70%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 18%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
  font: 700 10px/1.2 inherit;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
`;

  // src/features/core/settings-migration.ts
  var SETTINGS_EXPORT_VERSION = 1;
  function buildSettingsExport(settings) {
    return {
      generator: "Aviary",
      version: SETTINGS_EXPORT_VERSION,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      settings: cloneSettings(settings)
    };
  }
  function parseSettingsImport(payload) {
    const errors = [];
    const warnings = [];
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      errors.push(`Invalid JSON: ${error.message}`);
      return { applied: false, errors, warnings, settings: normalizeSettings({}) };
    }
    if (!isRecord4(parsed)) {
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
    const rawSettings = isRecord4(parsed.settings) ? parsed.settings : parsed;
    const normalized = normalizeSettings(rawSettings);
    return { applied: true, errors, warnings, settings: normalized };
  }
  function isRecord4(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // src/features/core/control-center.ts
  var controlCenter;
  var searchIndex = new LocalSearchIndex();
  var cleanupQueue;
  var semanticIndex;
  var retentionPolicy;
  var controlCenterFeature = {
    id: "core.controlCenter",
    title: "Control Center",
    category: "core",
    defaultEnabled: true,
    async init(ctx) {
      if (!cleanupQueue) {
        cleanupQueue = new CleanupQueue(ctx.storage);
        await cleanupQueue.load();
      }
      if (!semanticIndex) {
        semanticIndex = new SemanticIndex(ctx.storage);
        await semanticIndex.load();
      }
      retentionPolicy = await loadRetentionPolicy(ctx.storage);
      controlCenter = mountControlCenter({
        settings: ctx.settings,
        diagnostics: () => ctx.diagnostics.snapshot(),
        async onChange() {
          await ctx.saveSettings();
          ctx.requestApply();
        },
        onError(message, error) {
          ctx.diagnostics.error(message, errorDetails3(error));
        },
        getMediaStatus() {
          const queue2 = getMediaQueue();
          const history2 = getMediaHistory();
          const snapshot = queue2?.snapshot();
          return {
            historySize: history2?.size() ?? 0,
            completed: snapshot?.completed ?? 0,
            failed: snapshot?.failed ?? 0,
            duplicate: snapshot?.duplicate ?? 0,
            running: snapshot?.running ?? 0
          };
        },
        async clearMediaHistory() {
          await getMediaHistory()?.clear();
        },
        getExportStatus() {
          const store2 = getCheckpointStore();
          const queries = getDiscoveredQueries();
          return {
            jobCount: store2?.list().length ?? 0,
            knownQueries: queries ? Object.keys(queries.queries).length : 0
          };
        },
        async runExport() {
          const result = await runExportOfVisibleTweets(ctx);
          if (result.artifact) {
            downloadBlob(result.artifact, result.filename);
          }
          return { records: result.records, filename: result.filename };
        },
        async copyDiagnostics() {
          const payload = buildDiagnosticsPayload(ctx);
          await writeClipboard(payload);
          void ctx.auditLog.record("diagnostics.copy");
        },
        async exportSettings() {
          const envelope = buildSettingsExport(ctx.settings);
          const text = JSON.stringify(envelope, null, 2);
          const bytes = new TextEncoder().encode(text);
          downloadBlob(bytes, settingsFilename(), "application/json");
          void ctx.auditLog.record("settings.export");
        },
        async importSettings(payload) {
          const report = parseSettingsImport(payload);
          if (report.applied) {
            Object.assign(ctx.settings, report.settings);
            await ctx.storage.set(SETTINGS_KEY, normalizeSettings(ctx.settings));
            ctx.requestApply();
            void ctx.auditLog.record("settings.import", {
              warnings: report.warnings.length,
              errors: report.errors.length
            });
          }
          return report;
        },
        getAuditSize() {
          return ctx.auditLog.size();
        },
        async clearAuditLog() {
          await ctx.auditLog.clear();
        },
        getRetentionPolicy() {
          return retentionPolicy ?? DEFAULT_RETENTION_POLICY;
        },
        async saveRetentionPolicy(next) {
          const normalized = await saveRetentionPolicy(ctx.storage, normalizeRetentionPolicy(next));
          retentionPolicy = normalized;
          const sweep = await getCheckpointStore()?.sweep(normalized);
          if (sweep && (sweep.removedJobs > 0 || sweep.removedRecords > 0)) {
            void ctx.auditLog.record("export.complete", {
              kind: "checkpoint-retention",
              removedJobs: sweep.removedJobs,
              removedRecords: sweep.removedRecords
            });
          }
          ctx.requestApply();
        },
        getUserNotes() {
          return getUserNotes();
        },
        async setUserNote(handle, note) {
          await setUserNote(handle, note);
          ctx.requestApply();
        },
        async clearUserNotes() {
          await clearUserNotes();
          ctx.requestApply();
        },
        async captureSnapshot(kind) {
          const handle = inferProfileHandle(ctx.route.path) ?? "self";
          const result = await captureSnapshotFromDom(ctx, kind, handle);
          if (!result) return null;
          return { count: result.totalAccounts, handle: result.entry.handle };
        },
        getSnapshotStatus() {
          const store2 = getSnapshotStore();
          const entries = store2?.list() ?? [];
          const latest = entries[entries.length - 1];
          return {
            total: entries.length,
            latestAt: latest?.capturedAt ?? null,
            latestKind: latest?.kind ?? null,
            latestCount: latest?.accounts.length ?? 0
          };
        },
        diffLatestSnapshot(kind, handle) {
          const diff = getSnapshotStore()?.diffLatest(kind, handle);
          if (!diff) return null;
          return {
            added: diff.added.length,
            removed: diff.removed.length,
            unchanged: diff.unchanged
          };
        },
        async clearSnapshots() {
          await getSnapshotStore()?.clear();
        },
        async importArchive(file) {
          const buffer = new Uint8Array(await file.arrayBuffer());
          const result = importOfficialArchive(buffer, "archive");
          if (result.records.length > 0) {
            const store2 = getCheckpointStore();
            if (store2) {
              const jobId = `archive-${Date.now()}`;
              await store2.start(jobId, "archive", ["json"], false);
              await store2.append(jobId, result.records);
              await store2.finish(jobId);
            }
            rebuildSearchIndex();
            void ctx.auditLog.record("settings.import", {
              archive: file.name,
              records: result.records.length,
              warnings: result.warnings.length
            });
          }
          return {
            records: result.records.length,
            warnings: result.warnings.length,
            errors: result.errors.length
          };
        },
        searchArchive(query) {
          if (query.length === 0) return [];
          const hits = searchIndex.search(query, { limit: 20 });
          if (hits.length === 0) {
            rebuildSearchIndex();
            return searchIndex.search(query, { limit: 20 }).map(formatHit);
          }
          return hits.map(formatHit);
        },
        listPresets() {
          return listPresets().map((preset) => ({
            id: preset.id,
            label: preset.label,
            description: preset.description
          }));
        },
        async applyPreset(id) {
          const preset = getPreset(id);
          if (!preset) return { applied: false, changes: [] };
          const changes = describePresetDelta(ctx.settings, preset);
          const next = applyPreset(ctx.settings, preset);
          replaceSettings(ctx.settings, next);
          await ctx.storage.set(SETTINGS_KEY, normalizeSettings(ctx.settings));
          ctx.requestApply();
          void ctx.auditLog.record("settings.import", { preset: preset.id, changes: changes.length });
          return { applied: changes.length > 0, changes };
        },
        listLocales() {
          return supportedLocales().map((entry) => ({
            code: entry.code,
            label: entry.label,
            direction: entry.direction
          }));
        },
        async setLocale(code) {
          ctx.settings.i18n.locale = code;
          await ctx.storage.set(SETTINGS_KEY, normalizeSettings(ctx.settings));
          ctx.requestApply();
        },
        getCleanupQueueSize() {
          const items = cleanupQueue?.list() ?? [];
          return {
            total: items.length,
            queued: items.filter((item) => item.status === "queued").length,
            approved: items.filter((item) => item.status === "approved").length,
            skipped: items.filter((item) => item.status === "skipped").length
          };
        },
        async enqueueCleanupReview() {
          rebuildSearchIndex();
          const store2 = getCheckpointStore();
          const records = collectAllRecords(store2);
          const preview = previewCleanup(records, {
            whitelistHandles: ctx.settings.filter.whitelist
          });
          const candidates = preview.candidates;
          const protectedCount = candidates.filter((candidate) => candidate.protected).length;
          const added = await cleanupQueue?.enqueue(candidates) ?? 0;
          void ctx.auditLog.record("settings.export", {
            cleanupEnqueued: added,
            protected: protectedCount
          });
          return { added, protected: protectedCount };
        },
        async clearCleanupQueue() {
          await cleanupQueue?.clear();
        },
        async crosspost(target, options) {
          const text = readComposerText();
          if (!text) {
            return { ok: false, error: "Composer is empty" };
          }
          const request = {
            text,
            target,
            asThread: options.asThread
          };
          if (ctx.settings.integrations.crosspost.attachLastDownload) {
            const lastDownload = await getLastDownload(ctx.storage);
            if (lastDownload) {
              request.attachment = {
                url: lastDownload.url,
                filename: lastDownload.filename,
                kind: lastDownload.kind
              };
            }
          }
          const result = await crosspost(ctx.settings.integrations, request);
          void ctx.auditLog.record(result.ok ? "export.complete" : "export.start", {
            kind: "crosspost",
            target,
            ok: result.ok,
            asThread: options.asThread,
            posts: result.posts ?? 0,
            error: result.error ?? null
          });
          return {
            ok: result.ok,
            ...result.url ? { url: result.url } : {},
            ...result.error ? { error: result.error } : {},
            ...result.posts !== void 0 ? { posts: result.posts } : {}
          };
        },
        async listAria2Active() {
          const active = await tellActiveAria2({
            endpoint: ctx.settings.integrations.aria2.endpoint,
            secret: ctx.settings.integrations.aria2.secret
          });
          return active.map((job) => ({
            gid: job.gid,
            status: job.status,
            totalLength: job.totalLength,
            completedLength: job.completedLength,
            path: job.files[0]?.path ?? ""
          }));
        },
        async cancelAria2(gid) {
          const result = await removeAria2Download(
            {
              endpoint: ctx.settings.integrations.aria2.endpoint,
              secret: ctx.settings.integrations.aria2.secret
            },
            gid
          );
          if (result.ok) {
            void ctx.auditLog.record("export.complete", { kind: "aria2-cancel", gid });
            return { ok: true };
          }
          return { ok: false, ...result.error ? { error: result.error } : {} };
        },
        recentIntegrationErrors() {
          return recentIntegrationErrors(ctx.auditLog.snapshot().entries);
        },
        async rebuildSemanticIndex() {
          if (!semanticIndex) {
            semanticIndex = new SemanticIndex(ctx.storage);
            await semanticIndex.load();
          }
          rebuildSearchIndex();
          const store2 = getCheckpointStore();
          const records = collectAllRecords(store2);
          const result = await semanticIndex.embedAndIndex(
            ctx.settings.integrations.semanticSearch,
            records
          );
          void ctx.auditLog.record("export.complete", {
            kind: "semantic-index",
            added: result.added,
            skipped: result.skipped,
            errors: result.errors
          });
          return { ...result, total: semanticIndex.size() };
        },
        async semanticSearchQuery(query) {
          if (!semanticIndex) return [];
          const hits = await semanticIndex.search(
            ctx.settings.integrations.semanticSearch,
            query,
            12
          );
          return hits.map((hit) => ({
            tweetId: hit.entry.tweetId,
            handle: hit.entry.handle,
            text: hit.entry.text,
            score: hit.score
          }));
        },
        async clearSemanticIndex() {
          await semanticIndex?.clear();
        },
        async pingAria2() {
          const result = await addUriToAria2(
            {
              endpoint: ctx.settings.integrations.aria2.endpoint,
              secret: ctx.settings.integrations.aria2.secret
            },
            { url: "https://example.invalid/aviary-ping", filename: "ping.txt" }
          );
          if (result.ok) return { ok: true };
          if (result.error && /HTTP/.test(result.error)) {
            return { ok: false, error: result.error };
          }
          if (result.error && /Aria2 endpoint/.test(result.error)) {
            return { ok: false, error: result.error };
          }
          return { ok: true };
        },
        getIntegrationStatus() {
          const integrations = ctx.settings.integrations;
          return {
            aria2: { enabled: integrations.aria2.enabled, configured: integrations.aria2.endpoint.length > 0 },
            bluesky: {
              enabled: integrations.bluesky.enabled,
              configured: integrations.bluesky.handle.length > 0 && integrations.bluesky.appPassword.length > 0
            },
            mastodon: {
              enabled: integrations.mastodon.enabled,
              configured: integrations.mastodon.instance.length > 0 && integrations.mastodon.token.length > 0
            },
            ai: {
              enabled: integrations.ai.enabled,
              configured: integrations.ai.apiKey.length > 0 && integrations.ai.model.length > 0
            },
            semanticSearch: {
              enabled: integrations.semanticSearch.enabled,
              configured: integrations.semanticSearch.endpoint.length > 0 && integrations.semanticSearch.apiKey.length > 0 && integrations.semanticSearch.model.length > 0,
              indexed: semanticIndex?.size() ?? 0
            }
          };
        },
        async runMediaBatch() {
          const result = await runMediaBatch(ctx, { maxItems: 100, surface: ctx.route.surface });
          void ctx.auditLog.record("media.download", {
            batch: true,
            total: result.total,
            downloaded: result.downloaded,
            duplicate: result.duplicate,
            failed: result.failed
          });
          return {
            total: result.total,
            downloaded: result.downloaded,
            duplicate: result.duplicate,
            failed: result.failed
          };
        },
        async downloadWarc() {
          rebuildSearchIndex();
          const store2 = getCheckpointStore();
          const records = collectAllRecords(store2);
          const artifact = buildWarcArchive(records);
          downloadBlob(artifact.data, artifact.filename, artifact.contentType);
          void ctx.auditLog.record("export.complete", { format: "warc", records: records.length });
          return { records: records.length };
        },
        async exportToTarget(target) {
          rebuildSearchIndex();
          const store2 = getCheckpointStore();
          const records = collectAllRecords(store2);
          const rendered = renderForExternalTarget(target, records);
          if (rendered.payload !== void 0) {
            await writeClipboard(rendered.payload);
            void ctx.auditLog.record("diagnostics.copy", { kind: "external", target });
            return { target, records: records.length, copied: true };
          }
          if (rendered.artifact) {
            downloadBlob(rendered.artifact.data, rendered.artifact.filename, rendered.artifact.contentType);
            void ctx.auditLog.record("export.complete", { format: target, records: records.length });
            return { target, records: records.length };
          }
          return { target, records: records.length };
        },
        async downloadReport() {
          rebuildSearchIndex();
          const store2 = getCheckpointStore();
          const records = collectAllRecords(store2);
          const cleanup = previewCleanup(records, {
            whitelistHandles: ctx.settings.filter.whitelist
          });
          const snapshotStore = getSnapshotStore();
          const latest = snapshotStore?.list().at(-1);
          const diff = latest ? snapshotStore?.diffLatest(latest.kind, latest.handle) ?? void 0 : void 0;
          const reportInput = {
            audit: ctx.auditLog.snapshot().entries,
            cleanup
          };
          if (latest) {
            reportInput.snapshots = diff ? { latest, diff } : { latest };
          }
          if (ctx.settings.i18n.locale !== "en") {
            reportInput.version = ctx.settings.i18n.locale;
          }
          const markdown = buildMarkdownReport(reportInput);
          const bytes = new TextEncoder().encode(markdown);
          downloadBlob(bytes, reportFilename(), "text/markdown");
        }
      });
      ctx.diagnostics.info("Control Center mounted");
    },
    apply() {
      controlCenter?.refresh();
    },
    destroy(ctx) {
      controlCenter?.destroy();
      controlCenter = void 0;
      cleanupQueue = void 0;
      semanticIndex = void 0;
      retentionPolicy = void 0;
      ctx.diagnostics.info("Control Center destroyed");
    }
  };
  function errorDetails3(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message
      };
    }
    return {
      message: String(error)
    };
  }
  function replaceSettings(target, next) {
    for (const key of Object.keys(next)) {
      target[key] = next[key];
    }
  }
  function settingsFilename() {
    return `aviary-settings-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.json`;
  }
  function reportFilename() {
    return `aviary-report-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.md`;
  }
  function inferProfileHandle(path) {
    const match = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:followers|following|verified_followers))?/.exec(path);
    return match?.[1]?.toLowerCase() ?? null;
  }
  function rebuildSearchIndex() {
    const store2 = getCheckpointStore();
    searchIndex.rebuild(collectAllRecords(store2));
  }
  function collectAllRecords(store2) {
    if (!store2) return [];
    const all = [];
    for (const job of store2.list()) {
      all.push(...store2.records(job.jobId));
    }
    return all;
  }
  function formatHit(hit) {
    return {
      handle: hit.record.handle,
      tweetId: hit.record.tweetId,
      text: hit.record.text,
      score: hit.score
    };
  }
  function downloadBlob(data, filename, contentType = "application/zip") {
    if (typeof document === "undefined") {
      return;
    }
    const blob = new Blob([new Uint8Array(data)], { type: contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4e3);
  }
  function buildDiagnosticsPayload(ctx) {
    const events = ctx.diagnostics.snapshot();
    const payload = {
      generator: "Aviary",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      surface: ctx.route.surface,
      href: ctx.route.href,
      locale: ctx.settings.i18n.locale,
      userAgent: globalThis.navigator?.userAgent ?? "unknown",
      events
    };
    return JSON.stringify(payload, null, 2);
  }
  async function writeClipboard(payload) {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(payload);
      return;
    }
    throw new Error("Clipboard API unavailable in this context");
  }

  // src/platform/selectors.ts
  var SURFACE_SELECTORS = [
    {
      surface: "App root",
      stable: "#react-root",
      fallback: "body > div:first-child",
      churnRisk: "Medium",
      note: "Readiness anchor only; do not use as the scan scope after boot."
    },
    {
      surface: "Primary column",
      stable: '[data-testid="primaryColumn"]',
      fallback: ".r-150rngu.r-16y2uox",
      churnRisk: "Medium",
      note: "Main observer scope for timeline pages."
    },
    {
      surface: "Sidebar",
      stable: '[data-testid="sidebarColumn"]',
      fallback: ".r-1ifxtd0.r-1udh08x",
      churnRisk: "High",
      note: "Optional because the sidebar collapses by viewport."
    },
    {
      surface: "Tweet",
      stable: 'article[data-testid="tweet"]',
      fallback: "article .css-175oi2r",
      churnRisk: "High",
      note: "Process added articles only and mark processed nodes."
    },
    {
      surface: "Tweet text",
      stable: '[data-testid="tweetText"]',
      fallback: "article div[lang] span",
      churnRisk: "Medium",
      note: "Text extraction source with article textContent fallback."
    },
    {
      surface: "Composer",
      stable: '[data-testid="tweetTextarea_0"]',
      fallback: 'div[role="textbox"][aria-label]',
      churnRisk: "High",
      note: "Draft.js-aware insertion required for later composer features."
    },
    {
      surface: "Media photo",
      stable: '[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]',
      fallback: 'img[src*="format="]',
      churnRisk: "Medium",
      note: "Normalize image URLs to original quality before download."
    },
    {
      surface: "Video",
      stable: '[data-testid="videoPlayer"], [data-testid="videoComponent"]',
      fallback: 'video[src], div[aria-label*="Video"]',
      churnRisk: "High",
      note: "Network capture is required for complete video variants."
    },
    {
      surface: "Navigation",
      stable: '[data-testid^="AppTabBar_"], [data-testid="SideNav_NewTweet_Button"]',
      fallback: 'nav[aria-label] a[role="link"]',
      churnRisk: "High",
      note: "Support full, compact, and mobile navigation."
    },
    {
      surface: "Grok",
      stable: '[data-testid="GrokDrawer"], [data-testid="grokImgGen"]',
      fallback: 'div[id*="grok" i]',
      churnRisk: "High",
      note: "Grok controls change frequently; isolate all tweaks."
    }
  ];
  function getSelectorHealth(root = document) {
    return SURFACE_SELECTORS.map((entry) => {
      const stableCount = countMatches(root, entry.stable);
      const fallbackCount = countMatches(root, entry.fallback);
      return {
        surface: entry.surface,
        stable: entry.stable,
        fallback: entry.fallback,
        stableCount,
        fallbackCount,
        churnRisk: entry.churnRisk,
        healthy: stableCount > 0 || fallbackCount > 0
      };
    });
  }
  function countMatches(root, selector) {
    try {
      const self = root instanceof Element && root.matches(selector) ? 1 : 0;
      return self + root.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  // src/features/core/selector-health.ts
  var CRITICAL_SURFACES = /* @__PURE__ */ new Set(["App root", "Primary column"]);
  var MIN_LOG_INTERVAL_MS = 5e3;
  var lastLogAt = 0;
  var lastSignature = "";
  var selectorHealthFeature = {
    id: "core.selectorHealth",
    title: "Selector health diagnostics",
    category: "core",
    defaultEnabled: true,
    init(ctx) {
      if (!ctx.settings.diagnostics.selectorHealth) {
        return;
      }
      ctx.diagnostics.info("Selector health initialized", {
        route: ctx.route.surface,
        healthy: getSelectorHealth().filter((item) => item.healthy).length
      });
    },
    apply(ctx, root) {
      if (!ctx.settings.diagnostics.selectorHealth) {
        return;
      }
      const health = getSelectorHealth(root);
      const missingCritical = health.filter((item) => !item.healthy && CRITICAL_SURFACES.has(item.surface));
      if (missingCritical.length === 0) {
        return;
      }
      const signature = `${ctx.route.surface}:${missingCritical.map((item) => item.surface).join(",")}`;
      const now = Date.now();
      if (signature !== lastSignature || now - lastLogAt >= MIN_LOG_INTERVAL_MS) {
        lastSignature = signature;
        lastLogAt = now;
        ctx.diagnostics.warn("Critical selector health degraded", {
          route: ctx.route.surface,
          missing: missingCritical.map((item) => item.surface)
        });
      }
    },
    destroy(ctx) {
      lastLogAt = 0;
      lastSignature = "";
      ctx.diagnostics.info("Selector health destroyed");
    },
    getStatus() {
      const health = getSelectorHealth();
      const healthyCount = health.filter((item) => item.healthy).length;
      return {
        ok: healthyCount > 0,
        message: `${healthyCount}/${health.length} selector surfaces detected`,
        details: { health }
      };
    }
  };

  // src/features/filtering/predicates.ts
  function compileFilters(input) {
    const keywords = input.keywords.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
    const patterns = [];
    for (const source of input.regex) {
      const compiled2 = tryCompileRegex(source);
      if (compiled2) {
        patterns.push(compiled2);
      }
    }
    const whitelist = /* @__PURE__ */ new Set();
    for (const handle of input.whitelist) {
      const normalized = normalizeHandle3(handle);
      if (normalized) {
        whitelist.add(normalized);
      }
    }
    return {
      keywords,
      patterns,
      whitelist,
      premium: input.premium,
      media: {
        photo: Boolean(input.media.photo),
        video: Boolean(input.media.video),
        gif: Boolean(input.media.gif)
      },
      generation: input.generation
    };
  }
  function decide(signal, filters) {
    if (signal.handle && filters.whitelist.has(signal.handle)) {
      return "show";
    }
    const text = signal.text.toLowerCase();
    for (const keyword of filters.keywords) {
      if (text.includes(keyword)) {
        return "hide";
      }
    }
    for (const pattern of filters.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(signal.text)) {
        return "hide";
      }
    }
    for (const key of ["photo", "video", "gif"]) {
      if (filters.media[key] && signal.media[key]) {
        return "hide";
      }
    }
    if (filters.premium !== "off" && signal.premium) {
      return filters.premium;
    }
    return "show";
  }
  function extractTweetSignal(article) {
    const textNodes = article.querySelectorAll('[data-testid="tweetText"]');
    const text = textNodes.length > 0 ? Array.from(textNodes).map((node) => node.textContent ?? "").join("\n") : article.textContent ?? "";
    const handle = readHandle3(article);
    const premium = article.querySelector('[data-testid="icon-verified"], [aria-label*="Verified" i]') !== null;
    const media = {
      photo: article.querySelector('[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]') !== null,
      video: article.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"]') !== null,
      gif: article.querySelector('[data-testid="videoComponent"][aria-label*="GIF" i], [aria-label="Embedded video"][data-testid*="gif" i]') !== null
    };
    if (media.gif) {
      media.video = true;
    }
    return { text, handle, premium, media };
  }
  function readHandle3(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    const links = userName?.querySelectorAll('a[href^="/"]') ?? [];
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href") ?? "";
      const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
      const candidate = match?.[1];
      if (candidate) {
        return normalizeHandle3(candidate);
      }
    }
    return null;
  }
  function normalizeHandle3(value) {
    const cleaned = value.replace(/^@/, "").trim().toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
  }
  function tryCompileRegex(source) {
    const trimmed = source.trim();
    if (trimmed.length === 0) {
      return null;
    }
    try {
      const match = /^\/(.+)\/([a-z]*)$/i.exec(trimmed);
      const body = match?.[1];
      const flags = match?.[2] ?? "";
      if (match && body) {
        return new RegExp(body, sanitizeFlags(flags));
      }
      return new RegExp(trimmed, "i");
    } catch {
      return null;
    }
  }
  function sanitizeFlags(input) {
    const allowed = /* @__PURE__ */ new Set(["i", "m", "s", "u"]);
    const flags = [];
    for (const flag of input.toLowerCase()) {
      if (allowed.has(flag) && !flags.includes(flag)) {
        flags.push(flag);
      }
    }
    if (!flags.includes("i")) {
      flags.push("i");
    }
    return flags.join("");
  }

  // src/features/filtering/filter-engine.ts
  var STYLE_ID4 = "av-filter-engine";
  var ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  var PROCESSED_ATTR2 = "data-av-filter-processed";
  var RESULT_ATTR = "data-av-filter-result";
  var generation = 0;
  var compiled;
  var filterEngineFeature = {
    id: "filtering.engine",
    title: "Filter engine",
    category: "filtering",
    defaultEnabled: true,
    init(ctx) {
      ensureFilterStyle();
      refreshCompiled(ctx);
      applyRootClasses(ctx);
      scanRoot(document, ctx);
      ctx.diagnostics.info("Filter engine initialized", filterSummary(ctx));
    },
    apply(ctx, root, addedNodes) {
      ensureFilterStyle();
      applyRootClasses(ctx);
      refreshCompiled(ctx);
      if (!ctx.settings.filter.enabled || !surfaceMatches(ctx)) {
        return;
      }
      if (!addedNodes || addedNodes.length === 0) {
        scanRoot(root, ctx);
        return;
      }
      for (const node of addedNodes) {
        scanRoot(node, ctx);
      }
    },
    destroy(ctx) {
      compiled = void 0;
      generation = 0;
      document.getElementById(STYLE_ID4)?.remove();
      document.documentElement.classList.remove("av-filter-enabled");
      for (const article of Array.from(
        document.querySelectorAll(`[${PROCESSED_ATTR2}]`)
      )) {
        article.removeAttribute(PROCESSED_ATTR2);
        article.removeAttribute(RESULT_ATTR);
      }
      ctx.diagnostics.info("Filter engine destroyed");
    },
    getStatus() {
      return {
        ok: true,
        message: compiled ? `Filters: ${compiled.keywords.length} keyword, ${compiled.patterns.length} regex` : "Filters idle"
      };
    }
  };
  function applyRootClasses(ctx) {
    document.documentElement.classList.toggle("av-filter-enabled", ctx.settings.filter.enabled);
  }
  function surfaceMatches(ctx) {
    const surfaces = ctx.settings.filter.surfaces;
    return surfaces.includes(ctx.route.surface);
  }
  function refreshCompiled(ctx) {
    generation += 1;
    compiled = compileFilters({
      keywords: ctx.settings.filter.keywordRules,
      regex: ctx.settings.filter.regexRules,
      whitelist: ctx.settings.filter.whitelist,
      premium: ctx.settings.filter.premiumRule,
      media: ctx.settings.filter.mediaTypes,
      generation
    });
  }
  function scanRoot(root, ctx) {
    if (!compiled || !ctx.settings.filter.enabled || !surfaceMatches(ctx)) {
      return;
    }
    const articles = collectArticles3(root);
    for (const article of articles) {
      processArticle(article, compiled);
    }
  }
  function collectArticles3(root) {
    const results = [];
    if (root instanceof Element && root.matches(ARTICLE_SELECTOR)) {
      results.push(root);
    }
    if ("querySelectorAll" in root) {
      for (const article of Array.from(root.querySelectorAll(ARTICLE_SELECTOR))) {
        results.push(article);
      }
    }
    return results;
  }
  function processArticle(article, filters) {
    if (article.getAttribute(PROCESSED_ATTR2) === String(filters.generation)) {
      return;
    }
    const signal = extractTweetSignal(article);
    const decision = decide(signal, filters);
    article.setAttribute(PROCESSED_ATTR2, String(filters.generation));
    if (decision === "show") {
      article.removeAttribute(RESULT_ATTR);
    } else {
      article.setAttribute(RESULT_ATTR, decision);
    }
  }
  function filterSummary(ctx) {
    return {
      enabled: ctx.settings.filter.enabled,
      keywords: ctx.settings.filter.keywordRules.length,
      regex: ctx.settings.filter.regexRules.length,
      premium: ctx.settings.filter.premiumRule,
      media: Object.entries(ctx.settings.filter.mediaTypes).filter(([, value]) => value).map(([key]) => key),
      surfaces: ctx.settings.filter.surfaces
    };
  }
  function ensureFilterStyle() {
    if (document.getElementById(STYLE_ID4)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID4;
    style.textContent = FILTER_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var FILTER_CSS = `
html.av-filter-enabled article[data-testid="tweet"][${RESULT_ATTR}="hide"] {
  display: none !important;
}

html.av-filter-enabled article[data-testid="tweet"][${RESULT_ATTR}="dim"] {
  opacity: 0.36;
  filter: grayscale(0.5);
  transition: opacity 120ms ease, filter 120ms ease;
}

html.av-filter-enabled article[data-testid="tweet"][${RESULT_ATTR}="dim"]:hover,
html.av-filter-enabled article[data-testid="tweet"][${RESULT_ATTR}="dim"]:focus-within {
  opacity: 1;
  filter: none;
}
`;

  // src/features/layout/declutter.ts
  var STYLE_ID5 = "av-layout-declutter";
  var layoutDeclutterFeature = {
    id: "layout.declutter",
    title: "Layout declutter",
    category: "layout",
    defaultEnabled: true,
    init(ctx) {
      ensureLayoutStyle();
      applyLayoutClasses(ctx);
      ctx.diagnostics.info("Layout declutter initialized");
    },
    apply(ctx) {
      ensureLayoutStyle();
      applyLayoutClasses(ctx);
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID5)?.remove();
      document.documentElement.classList.remove(
        "av-hide-right-sidebar",
        "av-hide-trends",
        "av-hide-grok"
      );
      for (const className of Array.from(document.documentElement.classList)) {
        if (className.startsWith("av-hide-nav-")) {
          document.documentElement.classList.remove(className);
        }
      }
      ctx.diagnostics.info("Layout declutter destroyed");
    }
  };
  function applyLayoutClasses(ctx) {
    const root = document.documentElement;
    root.classList.toggle("av-hide-right-sidebar", ctx.settings.layout.hideRightSidebar);
    root.classList.toggle("av-hide-trends", ctx.settings.layout.hideTrends);
    root.classList.toggle("av-hide-grok", ctx.settings.layout.hideGrok);
    for (const className of Array.from(root.classList)) {
      if (className.startsWith("av-hide-nav-")) {
        root.classList.remove(className);
      }
    }
    for (const item of ctx.settings.layout.hideNavItems) {
      const safe = item.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
      if (safe.length > 0) {
        root.classList.add(`av-hide-nav-${safe}`);
      }
    }
  }
  function ensureLayoutStyle() {
    if (document.getElementById(STYLE_ID5)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID5;
    style.textContent = LAYOUT_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var LAYOUT_CSS = `
html.av-hide-right-sidebar [data-testid="sidebarColumn"] {
  display: none !important;
}

html.av-hide-trends [data-testid="news_sidebar"],
html.av-hide-trends [data-testid="trend"] {
  display: none !important;
}

html.av-hide-grok [data-testid="GrokDrawer"],
html.av-hide-grok [data-testid="GrokDrawerHeader"],
html.av-hide-grok [data-testid="chat-drawer-root"],
html.av-hide-grok [data-testid="chat-drawer-main"],
html.av-hide-grok [data-testid="grokImgGen"] {
  display: none !important;
}

html.av-hide-nav-premium [data-testid="premium-signup-tab"],
html.av-hide-nav-home [data-testid="AppTabBar_Home_Link"],
html.av-hide-nav-explore [data-testid="AppTabBar_Explore_Link"],
html.av-hide-nav-notifications [data-testid="AppTabBar_Notifications_Link"],
html.av-hide-nav-messages [data-testid="AppTabBar_DirectMessage_Link"],
html.av-hide-nav-profile [data-testid="AppTabBar_Profile_Link"],
html.av-hide-nav-more [data-testid="AppTabBar_More_Menu"] {
  display: none !important;
}
`;

  // src/features/core/audit-log.ts
  var AUDIT_LOG_KEY = "aviary.audit.v1";
  var AUDIT_LOG_LIMIT = 500;
  var EMPTY5 = { entries: [] };
  var AuditLog = class {
    #storage;
    #limit;
    #entries = [];
    #loaded = false;
    #loading;
    constructor(storage, limit = AUDIT_LOG_LIMIT) {
      this.#storage = storage;
      this.#limit = Math.max(50, limit);
    }
    async load() {
      if (this.#loaded) return;
      if (!this.#loading) {
        this.#loading = this.#hydrate();
      }
      await this.#loading;
    }
    async record(action, detail) {
      await this.load();
      const entry = { at: (/* @__PURE__ */ new Date()).toISOString(), action };
      if (detail) entry.detail = detail;
      this.#entries.push(entry);
      while (this.#entries.length > this.#limit) {
        this.#entries.shift();
      }
      await this.#persist();
    }
    snapshot() {
      return { entries: [...this.#entries] };
    }
    async clear() {
      this.#entries = [];
      this.#loaded = true;
      await this.#persist();
    }
    size() {
      return this.#entries.length;
    }
    async #hydrate() {
      const stored = await this.#storage.get(AUDIT_LOG_KEY, EMPTY5);
      const entries = Array.isArray(stored?.entries) ? stored.entries : [];
      this.#entries = entries.filter(
        (entry) => typeof entry?.at === "string" && typeof entry?.action === "string"
      ).slice(-this.#limit);
      this.#loaded = true;
    }
    async #persist() {
      try {
        await this.#storage.set(AUDIT_LOG_KEY, { entries: this.#entries });
      } catch {
      }
    }
  };

  // src/features/integrations/ai-provider.ts
  async function runAiPrompt(config, request) {
    if (!config.enabled) return { ok: false, error: "AI provider integration disabled" };
    if (!config.apiKey) return { ok: false, error: "AI provider API key missing" };
    if (!config.model) return { ok: false, error: "AI provider model missing" };
    try {
      switch (config.provider) {
        case "anthropic":
          return await callAnthropic(config, request);
        case "openai":
        case "openai-compatible":
        default:
          return await callOpenAiCompatible(config, request);
      }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }
  async function callAnthropic(config, request) {
    const endpoint = config.endpoint || "https://api.anthropic.com/v1/messages";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens ?? 1024,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.prompt }]
      })
    });
    if (!response.ok) {
      return { ok: false, error: `Anthropic HTTP ${response.status}` };
    }
    const payload = await response.json();
    if (payload?.error) return { ok: false, error: payload.error.message ?? "Anthropic error" };
    const text = payload?.content?.filter((block) => block?.type === "text").map((block) => block.text ?? "").join("\n");
    return { ok: true, text: text ?? "" };
  }
  async function callOpenAiCompatible(config, request) {
    const endpoint = config.endpoint || "https://api.openai.com/v1/chat/completions";
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    };
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens ?? 1024,
        messages: [
          ...request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : [],
          { role: "user", content: request.prompt }
        ]
      })
    });
    if (!response.ok) {
      return { ok: false, error: `Provider HTTP ${response.status}` };
    }
    const payload = await response.json();
    if (payload?.error) return { ok: false, error: payload.error.message ?? "Provider error" };
    const text = payload?.choices?.[0]?.message?.content ?? "";
    return { ok: true, text };
  }

  // src/features/ai/command-menu.ts
  var STYLE_ID6 = "av-ai-command-menu";
  var TRIGGER_ATTR = "data-av-ai-trigger";
  var PROCESSED_ATTR3 = "data-av-ai-processed";
  var AI_COMMANDS = [
    {
      id: "translate",
      label: "Translate",
      hint: "Translate the selected post to your active locale.",
      promptTemplate: (text) => `Translate the following X post. Keep the tone, hashtags, and @mentions intact.

${text}`
    },
    {
      id: "summarize",
      label: "Summarize",
      hint: "Summarize a thread or long post in 3 bullet points.",
      promptTemplate: (text) => `Summarize the following X post (or thread) in 3 short bullet points. Avoid speculation.

${text}`
    },
    {
      id: "explain",
      label: "Explain",
      hint: "Explain context, jargon, and references in the post.",
      promptTemplate: (text) => `Explain the context behind this X post: define jargon, expand acronyms, and note references that might be unfamiliar.

${text}`
    },
    {
      id: "factcheck",
      label: "Fact-check prompt",
      hint: "Generate a fact-check prompt for the post (no network call without your key).",
      promptTemplate: (text) => `Treat this X post as a claim. List the verifiable assertions, the kind of source that would confirm each one, and any obvious counterpoints. Do not invent sources.

${text}`
    }
  ];
  var aiCommandMenuFeature = {
    id: "ai.commandMenu",
    title: "AI command menu (local prompt builder)",
    category: "core",
    defaultEnabled: true,
    init(ctx) {
      ensureStyle2();
      decorate2(ctx, document);
      ctx.diagnostics.info("AI command menu ready");
    },
    apply(ctx, root, addedNodes) {
      ensureStyle2();
      if (!addedNodes || addedNodes.length === 0) {
        decorate2(ctx, root);
        return;
      }
      for (const node of addedNodes) {
        decorate2(ctx, node);
      }
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID6)?.remove();
      for (const article of Array.from(document.querySelectorAll(`[${PROCESSED_ATTR3}]`))) {
        article.removeAttribute(PROCESSED_ATTR3);
      }
      for (const trigger of Array.from(document.querySelectorAll(`[${TRIGGER_ATTR}]`))) {
        trigger.remove();
      }
      ctx.diagnostics.info("AI command menu destroyed");
    },
    getStatus() {
      return { ok: true, message: `${AI_COMMANDS.length} local AI prompts` };
    }
  };
  function decorate2(ctx, root) {
    const articles = root instanceof Element && root.matches('article[data-testid="tweet"]') ? [root] : Array.from(root.querySelectorAll('article[data-testid="tweet"]'));
    for (const article of articles) {
      if (article.getAttribute(PROCESSED_ATTR3) === "1") {
        continue;
      }
      const toolbar = article.querySelector('[role="group"][aria-label]');
      if (!toolbar) {
        article.setAttribute(PROCESSED_ATTR3, "1");
        continue;
      }
      if (toolbar.querySelector(`[${TRIGGER_ATTR}]`)) {
        article.setAttribute(PROCESSED_ATTR3, "1");
        continue;
      }
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "av-ai-trigger";
      trigger.setAttribute(TRIGGER_ATTR, "1");
      trigger.setAttribute("aria-label", "Open Aviary AI command menu");
      trigger.title = "Aviary AI commands (offline prompt builder)";
      trigger.textContent = "AI";
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        openMenu(article, trigger, ctx);
      });
      toolbar.append(trigger);
      article.setAttribute(PROCESSED_ATTR3, "1");
    }
  }
  function openMenu(article, trigger, ctx) {
    for (const previous of Array.from(document.querySelectorAll(".av-ai-menu"))) {
      previous.remove();
    }
    const menu = document.createElement("div");
    menu.className = "av-ai-menu";
    menu.setAttribute("role", "menu");
    const text = (article.querySelector('[data-testid="tweetText"]')?.textContent ?? article.textContent ?? "").trim();
    const aiEnabled = ctx.settings.integrations.ai.enabled && ctx.settings.integrations.ai.apiKey.length > 0;
    for (const command of AI_COMMANDS) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "av-ai-option";
      item.setAttribute("role", "menuitem");
      item.title = command.hint;
      item.textContent = aiEnabled ? `${command.label} (Run with provider)` : command.label;
      item.addEventListener("click", async (event) => {
        event.stopPropagation();
        event.preventDefault();
        const prompt = command.promptTemplate(text);
        if (aiEnabled) {
          item.disabled = true;
          item.textContent = `${command.label} \u2014 running\u2026`;
          const result = await runAiPrompt(ctx.settings.integrations.ai, { prompt });
          if (result.ok && result.text) {
            try {
              await copyToClipboard(result.text);
              ctx.diagnostics.info("AI result copied", {
                command: command.id,
                length: result.text.length
              });
              void ctx.auditLog.record("diagnostics.copy", {
                kind: "ai-response",
                command: command.id,
                provider: ctx.settings.integrations.ai.provider
              });
            } catch (error) {
              ctx.diagnostics.warn("AI result clipboard failed", {
                error: String(error?.message ?? error)
              });
            }
          } else {
            ctx.diagnostics.warn("AI provider call failed", { error: result.error ?? "unknown" });
          }
        } else {
          try {
            await copyToClipboard(prompt);
            ctx.diagnostics.info("AI prompt copied", { command: command.id, length: prompt.length });
            void ctx.auditLog.record("diagnostics.copy", { kind: "ai", command: command.id });
          } catch (error) {
            ctx.diagnostics.warn("AI prompt clipboard failed", {
              error: String(error?.message ?? error)
            });
          }
        }
        menu.remove();
      });
      menu.append(item);
    }
    positionMenu(menu, trigger);
    document.body.append(menu);
    const dismiss = (event) => {
      if (!menu.contains(event.target) && event.target !== trigger) {
        menu.remove();
        document.removeEventListener("click", dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener("click", dismiss, true), 0);
  }
  function positionMenu(menu, trigger) {
    const rect = trigger.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = `${Math.max(12, rect.left)}px`;
    menu.style.top = `${Math.max(12, rect.bottom + 6)}px`;
    menu.style.maxWidth = "260px";
  }
  async function copyToClipboard(text) {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return;
    }
    throw new Error("Clipboard API unavailable");
  }
  function ensureStyle2() {
    if (document.getElementById(STYLE_ID6)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID6;
    style.textContent = AI_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var AI_CSS = `
.av-ai-trigger {
  margin-inline-start: auto;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--av-muted, rgb(113, 118, 123)) 60%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--av-muted, rgb(113, 118, 123));
  font: 700 10px/1.2 inherit;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease;
}

article[data-testid="tweet"]:hover .av-ai-trigger,
article[data-testid="tweet"]:focus-within .av-ai-trigger,
.av-ai-trigger:focus-visible {
  opacity: 1;
  color: var(--av-text, rgb(239, 243, 244));
  border-color: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
}

.av-ai-menu {
  z-index: 2147482800;
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 96%, black);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.4);
}

.av-ai-option {
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--av-text, rgb(239, 243, 244));
  font: 600 12px/1.3 inherit;
  text-align: start;
  cursor: pointer;
}

.av-ai-option:hover,
.av-ai-option:focus-visible {
  border-color: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 12%, transparent);
}
`;

  // src/features/composer/composer-snippets.ts
  var STYLE_ID7 = "av-composer-snippets";
  var TOOLBAR_ATTR = "data-av-composer-mounted";
  var PALETTE_ATTR = "data-av-snippet-palette";
  var composerSnippetsFeature = {
    id: "composer.snippets",
    title: "Composer snippets",
    category: "core",
    defaultEnabled: true,
    init(ctx) {
      ensureComposerStyle();
      decorate3(ctx, document);
      ctx.diagnostics.info("Composer snippets initialized");
    },
    apply(ctx, root, addedNodes) {
      ensureComposerStyle();
      if (!addedNodes || addedNodes.length === 0) {
        decorate3(ctx, root);
        return;
      }
      for (const node of addedNodes) {
        decorate3(ctx, node);
      }
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID7)?.remove();
      for (const toolbar of Array.from(document.querySelectorAll(`[${TOOLBAR_ATTR}]`))) {
        toolbar.removeAttribute(TOOLBAR_ATTR);
      }
      for (const palette of Array.from(document.querySelectorAll(`[${PALETTE_ATTR}]`))) {
        palette.remove();
      }
      ctx.diagnostics.info("Composer snippets destroyed");
    },
    getStatus() {
      return { ok: true, message: "Composer snippets ready" };
    }
  };
  function decorate3(ctx, root) {
    const toolbars = root instanceof Element && root.matches('[data-testid="toolBar"]') ? [root] : Array.from(root.querySelectorAll('[data-testid="toolBar"]'));
    for (const toolbar of toolbars) {
      if (toolbar.getAttribute(TOOLBAR_ATTR) === "1") {
        continue;
      }
      const button2 = document.createElement("button");
      button2.type = "button";
      button2.className = "av-snippet-trigger";
      button2.setAttribute(PALETTE_ATTR, "trigger");
      button2.textContent = "Snippets";
      button2.setAttribute("aria-label", "Open Aviary composer snippets");
      button2.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        openPalette(button2, ctx);
      });
      toolbar.append(button2);
      toolbar.setAttribute(TOOLBAR_ATTR, "1");
    }
  }
  function openPalette(trigger, ctx) {
    for (const previous of Array.from(document.querySelectorAll(`[${PALETTE_ATTR}="popover"]`))) {
      previous.remove();
    }
    const snippets = ctx.settings.composer.snippets;
    const popover = document.createElement("div");
    popover.setAttribute(PALETTE_ATTR, "popover");
    popover.className = "av-snippet-popover";
    popover.setAttribute("role", "menu");
    if (snippets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "av-snippet-empty";
      empty.textContent = "No snippets yet. Add some in the Control Center \u2192 Library.";
      popover.append(empty);
    } else {
      for (const snippet of snippets) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "av-snippet-option";
        option.textContent = snippet.length > 80 ? `${snippet.slice(0, 77)}\u2026` : snippet;
        option.setAttribute("role", "menuitem");
        option.title = snippet;
        option.addEventListener("click", (event) => {
          event.stopPropagation();
          event.preventDefault();
          if (insertSnippet(snippet)) {
            ctx.diagnostics.info("Snippet inserted", { length: snippet.length });
            void ctx.auditLog.record("settings.import", { kind: "snippet", length: snippet.length });
          } else {
            ctx.diagnostics.warn("Snippet insert failed \u2014 composer not focused");
          }
          popover.remove();
        });
        popover.append(option);
      }
    }
    positionPopover(popover, trigger);
    document.body.append(popover);
    const dismiss = (event) => {
      if (!popover.contains(event.target) && event.target !== trigger) {
        popover.remove();
        document.removeEventListener("click", dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener("click", dismiss, true), 0);
  }
  function insertSnippet(snippet) {
    const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
    if (!composer) return false;
    composer.focus();
    const ok = document.execCommand("insertText", false, snippet);
    if (!ok) {
      return false;
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: snippet }));
    return true;
  }
  function positionPopover(popover, trigger) {
    const rect = trigger.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.left = `${Math.max(12, rect.left)}px`;
    popover.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 8)}px`;
    popover.style.maxWidth = "320px";
  }
  function ensureComposerStyle() {
    if (document.getElementById(STYLE_ID7)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID7;
    style.textContent = COMPOSER_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var COMPOSER_CSS = `
.av-snippet-trigger {
  margin-inline-start: 8px;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 14%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
  font: 700 11px/1.2 inherit;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
}

.av-snippet-popover {
  z-index: 2147482700;
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 96%, black);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.4);
}

.av-snippet-option {
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--av-text, rgb(239, 243, 244));
  font: 600 12px/1.3 inherit;
  text-align: start;
  cursor: pointer;
}

.av-snippet-option:hover,
.av-snippet-option:focus-visible {
  border-color: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 12%, transparent);
}

.av-snippet-empty {
  padding: 6px 8px;
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 12px;
}
`;

  // src/features/core/i18n-feature.ts
  var STYLE_ID8 = "av-i18n";
  var i18nFeature = {
    id: "core.i18n",
    title: "Internationalization",
    category: "core",
    defaultEnabled: true,
    init(ctx) {
      ensureI18nStyle();
      applyLocaleClasses(ctx);
      ctx.diagnostics.info("i18n initialized", { locale: ctx.settings.i18n.locale });
    },
    apply(ctx) {
      ensureI18nStyle();
      applyLocaleClasses(ctx);
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID8)?.remove();
      const root = document.documentElement;
      root.classList.remove("av-rtl", "av-ltr");
      delete root.dataset.avLocale;
      ctx.diagnostics.info("i18n destroyed");
    }
  };
  function applyLocaleClasses(ctx) {
    const root = document.documentElement;
    const direction = localeDirection(ctx.settings.i18n.locale);
    root.dataset.avLocale = ctx.settings.i18n.locale;
    root.classList.toggle("av-rtl", direction === "rtl");
    root.classList.toggle("av-ltr", direction === "ltr");
  }
  function ensureI18nStyle() {
    if (document.getElementById(STYLE_ID8)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID8;
    style.textContent = I18N_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var I18N_CSS = `
html.av-rtl [data-testid="tweetText"] {
  text-align: start;
  unicode-bidi: plaintext;
}

html.av-rtl [data-testid="primaryColumn"] {
  direction: rtl;
}

html.av-ltr [data-testid="tweetText"][lang^="ar"],
html.av-ltr [data-testid="tweetText"][lang^="he"] {
  direction: rtl;
  text-align: start;
  unicode-bidi: plaintext;
}

[data-testid="tweetText"],
[data-testid="cellInnerDiv"] {
  overflow-wrap: anywhere;
  word-break: break-word;
}

@media (pointer: coarse) {
  html [data-testid="reply"],
  html [data-testid="retweet"],
  html [data-testid="like"],
  html [data-testid="bookmark"] {
    min-height: 44px;
    min-width: 44px;
  }
}
`;

  // src/features/core/mobile-touch.ts
  var STYLE_ID9 = "av-mobile-touch";
  var mobileTouchFeature = {
    id: "core.mobileTouch",
    title: "Mobile & touch ergonomics",
    category: "accessibility",
    defaultEnabled: true,
    init(ctx) {
      ensureMobileStyle();
      applyMobileClasses();
      ctx.diagnostics.info("Mobile/touch initialized");
    },
    apply() {
      ensureMobileStyle();
      applyMobileClasses();
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID9)?.remove();
      document.documentElement.classList.remove("av-mobile", "av-touch");
      ctx.diagnostics.info("Mobile/touch destroyed");
    }
  };
  function applyMobileClasses() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const root = document.documentElement;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    root.classList.toggle("av-touch", touch);
    root.classList.toggle("av-mobile", narrow);
  }
  function ensureMobileStyle() {
    if (document.getElementById(STYLE_ID9)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID9;
    style.textContent = MOBILE_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var MOBILE_CSS = `
html.av-touch .av-row {
  min-height: 56px;
}

html.av-mobile .av-launcher {
  right: 12px;
  bottom: 12px;
  min-width: 92px;
  min-height: 48px;
}

html.av-mobile .av-panel {
  width: min(420px, calc(100vw - 16px));
  max-height: min(85vh, calc(100vh - 64px));
}

html.av-touch [${"data-av-media-button"}] {
  min-height: 40px;
  padding: 6px 12px;
  font-size: 12px;
}

html.av-mobile [data-testid="primaryColumn"] {
  padding-inline: 0;
}
`;

  // src/features/export/network-capture.ts
  var MAX_PAYLOAD_BYTES = 15e5;
  var MAX_PAYLOADS = 50;
  var installed = false;
  var activeContext;
  var recentPayloads = [];
  var originalFetch;
  var networkCaptureFeature = {
    id: "export.networkCapture",
    title: "Passive GraphQL capture",
    category: "export",
    defaultEnabled: true,
    init(ctx) {
      activeContext = ctx;
      if (ctx.settings.export.preserveRawPayloads) {
        installInterceptor(ctx);
      }
      ctx.diagnostics.info("Network capture feature ready", {
        enabled: ctx.settings.export.preserveRawPayloads,
        installed
      });
    },
    apply(ctx) {
      activeContext = ctx;
      if (ctx.settings.export.preserveRawPayloads && !installed) {
        installInterceptor(ctx);
      } else if (!ctx.settings.export.preserveRawPayloads && installed) {
        uninstallInterceptor(ctx);
      }
    },
    destroy(ctx) {
      if (installed) {
        uninstallInterceptor(ctx);
      }
      activeContext = void 0;
      ctx.diagnostics.info("Network capture destroyed");
    },
    getStatus() {
      return {
        ok: true,
        message: installed ? `Capturing GraphQL \u2014 ${recentPayloads.length} payload${recentPayloads.length === 1 ? "" : "s"} sampled` : "Capture inactive"
      };
    }
  };
  function installInterceptor(ctx) {
    if (installed || typeof globalThis.fetch !== "function") return;
    originalFetch = { fn: globalThis.fetch };
    const patched = async (input, init) => {
      const response = await originalFetch.fn(input, init);
      void capturePayload(ctx, input, response.clone());
      return response;
    };
    globalThis.fetch = patched;
    installed = true;
    ctx.diagnostics.info("Passive GraphQL interceptor installed");
  }
  function uninstallInterceptor(ctx) {
    if (!installed || !originalFetch) return;
    globalThis.fetch = originalFetch.fn;
    originalFetch = void 0;
    installed = false;
    ctx.diagnostics.info("Passive GraphQL interceptor uninstalled");
  }
  async function capturePayload(ctx, input, response) {
    try {
      const url = resolveUrl(input);
      if (!shouldCapture(url)) return;
      if (!response.ok || !response.body) return;
      const blob = await response.blob();
      if (blob.size === 0 || blob.size > MAX_PAYLOAD_BYTES) return;
      const text = await blob.text();
      recordPayload(url, response.status, blob.size);
      await persistPayload(ctx, url, text);
    } catch (error) {
      ctx.diagnostics.warn("Network capture skipped", { error: String(error?.message ?? error) });
    }
  }
  function resolveUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  }
  function shouldCapture(url) {
    if (!/\/i\/api\/graphql\//.test(url)) return false;
    return true;
  }
  function recordPayload(url, status, bytes) {
    recentPayloads.push({ url, status, bytes, at: (/* @__PURE__ */ new Date()).toISOString() });
    while (recentPayloads.length > MAX_PAYLOADS) {
      recentPayloads.shift();
    }
  }
  async function persistPayload(ctx, url, body) {
    const store2 = getCheckpointStore();
    if (!store2) return;
    const operationName = /\/i\/api\/graphql\/[^/]+\/([A-Za-z0-9_]+)/.exec(url)?.[1] ?? "graphql";
    const jobId = `capture-${operationName}`;
    if (store2.list().every((entry) => entry.jobId !== jobId)) {
      await store2.start(jobId, "capture", ["json"], true);
    }
    await store2.append(jobId, [
      {
        tweetId: null,
        handle: null,
        displayName: null,
        text: scrubAuth(body).slice(0, MAX_PAYLOAD_BYTES),
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        surface: `graphql:${operationName}`,
        media: [],
        permalink: url
      }
    ]);
    void ctx.auditLog.record("export.start", { jobId, operation: operationName });
  }
  function scrubAuth(body) {
    return body.replace(/"ct0"\s*:\s*"[^"]*"/g, '"ct0":"<scrubbed>"').replace(/Bearer\s+[A-Za-z0-9._-]{12,}/g, "Bearer <scrubbed>");
  }

  // src/features/library/link-unshorten.ts
  var STYLE_ID10 = "av-link-unshorten";
  var PROCESSED_ATTR4 = "data-av-link-clean";
  var linkUnshortenFeature = {
    id: "library.linkUnshorten",
    title: "Direct link unshortening",
    category: "core",
    defaultEnabled: true,
    init(ctx) {
      ensureStyle3();
      if (!ctx.settings.links.expandTco) {
        return;
      }
      scan(document);
      ctx.diagnostics.info("Link unshortening initialized");
    },
    apply(ctx, root, addedNodes) {
      ensureStyle3();
      if (!ctx.settings.links.expandTco) {
        return;
      }
      if (!addedNodes || addedNodes.length === 0) {
        scan(root);
        return;
      }
      for (const node of addedNodes) {
        scan(node);
      }
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID10)?.remove();
      for (const link of Array.from(
        document.querySelectorAll(`a[${PROCESSED_ATTR4}]`)
      )) {
        link.removeAttribute(PROCESSED_ATTR4);
        const original = link.dataset.avOriginalText;
        if (original !== void 0) {
          link.textContent = original;
          delete link.dataset.avOriginalText;
        }
      }
      ctx.diagnostics.info("Link unshortening destroyed");
    }
  };
  function scan(root) {
    const anchors = root instanceof HTMLAnchorElement ? [root] : Array.from(root.querySelectorAll("a"));
    for (const anchor of anchors) {
      if (anchor.getAttribute(PROCESSED_ATTR4) === "1") {
        continue;
      }
      const href = anchor.getAttribute("href") ?? "";
      if (!/(^|\.)t\.co\//.test(href) && !/^https?:\/\/t\.co\//.test(href)) {
        continue;
      }
      const target = resolveDestination(anchor);
      if (!target) {
        continue;
      }
      if (!anchor.dataset.avOriginalText) {
        anchor.dataset.avOriginalText = anchor.textContent ?? "";
      }
      anchor.classList.add("av-link-clean");
      anchor.title = target;
      anchor.setAttribute(PROCESSED_ATTR4, "1");
      if (anchor.textContent && /^https?:\/\/t\.co\//i.test(anchor.textContent.trim())) {
        anchor.textContent = target;
      }
    }
  }
  function resolveDestination(anchor) {
    const candidates = [
      anchor.getAttribute("aria-label") ?? "",
      anchor.getAttribute("data-expanded-url") ?? "",
      anchor.title,
      anchor.textContent ?? ""
    ];
    for (const candidate of candidates) {
      const match = /https?:\/\/[^\s]+/i.exec(candidate);
      if (match && !/^https?:\/\/t\.co\//i.test(match[0])) {
        return match[0];
      }
    }
    return null;
  }
  function ensureStyle3() {
    if (document.getElementById(STYLE_ID10)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID10;
    style.textContent = LINK_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var LINK_CSS = `
a.av-link-clean {
  text-decoration-style: dotted;
  text-decoration-thickness: 1px;
}
`;

  // src/features/media/media-presentation.ts
  var STYLE_ID11 = "av-media-presentation";
  var mediaPresentationFeature = {
    id: "media.presentation",
    title: "Media presentation",
    category: "media",
    defaultEnabled: true,
    init(ctx) {
      ensurePresentationStyle();
      applyPresentationClasses(ctx);
      ctx.diagnostics.info("Media presentation initialized", {
        sensitive: ctx.settings.media.sensitive,
        layout: ctx.settings.media.layout
      });
    },
    apply(ctx) {
      ensurePresentationStyle();
      applyPresentationClasses(ctx);
    },
    destroy(ctx) {
      document.getElementById(STYLE_ID11)?.remove();
      const root = document.documentElement;
      for (const className of [
        "av-sensitive-default",
        "av-sensitive-reveal",
        "av-sensitive-blur",
        "av-sensitive-hide",
        "av-media-layout-default",
        "av-media-layout-stacked",
        "av-media-layout-grid"
      ]) {
        root.classList.remove(className);
      }
      ctx.diagnostics.info("Media presentation destroyed");
    }
  };
  function applyPresentationClasses(ctx) {
    const root = document.documentElement;
    for (const className of [
      "av-sensitive-default",
      "av-sensitive-reveal",
      "av-sensitive-blur",
      "av-sensitive-hide"
    ]) {
      root.classList.remove(className);
    }
    root.classList.add(`av-sensitive-${ctx.settings.media.sensitive}`);
    for (const className of [
      "av-media-layout-default",
      "av-media-layout-stacked",
      "av-media-layout-grid"
    ]) {
      root.classList.remove(className);
    }
    root.classList.add(`av-media-layout-${ctx.settings.media.layout}`);
  }
  function ensurePresentationStyle() {
    if (document.getElementById(STYLE_ID11)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID11;
    style.textContent = PRESENTATION_CSS;
    (document.head ?? document.documentElement).append(style);
  }
  var PRESENTATION_CSS = `
html.av-sensitive-reveal article[data-testid="tweet"] [data-testid="contentDisclosureButton"] {
  display: none !important;
}

html.av-sensitive-reveal article[data-testid="tweet"] [data-testid="tweetPhoto"] img,
html.av-sensitive-reveal article[data-testid="tweet"] [data-testid="videoPlayer"] video,
html.av-sensitive-reveal article[data-testid="tweet"] [data-testid="videoComponent"] video {
  filter: none !important;
}

html.av-sensitive-blur article[data-testid="tweet"] [data-testid="tweetPhoto"] img,
html.av-sensitive-blur article[data-testid="tweet"] [data-testid="videoPlayer"] video,
html.av-sensitive-blur article[data-testid="tweet"] [data-testid="videoComponent"] video {
  filter: blur(18px) saturate(0.85) !important;
  transition: filter 160ms ease;
}

html.av-sensitive-blur article[data-testid="tweet"] [data-testid="tweetPhoto"]:hover img,
html.av-sensitive-blur article[data-testid="tweet"] [data-testid="tweetPhoto"]:focus-within img {
  filter: none !important;
}

html.av-sensitive-hide article[data-testid="tweet"] [data-testid="tweetPhoto"],
html.av-sensitive-hide article[data-testid="tweet"] [data-testid="videoPlayer"],
html.av-sensitive-hide article[data-testid="tweet"] [data-testid="videoComponent"] {
  display: none !important;
}

html.av-media-layout-stacked article[data-testid="tweet"] [data-testid="tweetPhoto"] {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  margin: 8px 0 !important;
}

html.av-media-layout-stacked article[data-testid="tweet"] [data-testid="tweetPhoto"] img {
  width: 100% !important;
  height: auto !important;
  object-fit: contain !important;
  border-radius: 12px;
}

html.av-media-layout-grid article[data-testid="tweet"] [aria-label="Image"] {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important;
  gap: 6px !important;
}
`;

  // src/features/registry.ts
  var FeatureRegistry = class {
    #features = /* @__PURE__ */ new Map();
    #active = /* @__PURE__ */ new Set();
    register(feature) {
      if (this.#features.has(feature.id)) {
        throw new Error(`Feature already registered: ${feature.id}`);
      }
      this.#features.set(feature.id, feature);
    }
    async initAll(ctx) {
      for (const feature of this.#features.values()) {
        if (!feature.defaultEnabled) {
          continue;
        }
        try {
          await feature.init(ctx);
          this.#active.add(feature.id);
          ctx.diagnostics.info(`Feature initialized: ${feature.id}`);
        } catch (error) {
          ctx.diagnostics.error(`Feature failed to initialize: ${feature.id}`, errorDetails4(error));
        }
      }
    }
    async applyAll(ctx, root, addedNodes) {
      for (const id of this.#active) {
        const feature = this.#features.get(id);
        if (feature?.apply) {
          try {
            await feature.apply(ctx, root, addedNodes);
          } catch (error) {
            ctx.diagnostics.error(`Feature failed to apply: ${id}`, errorDetails4(error));
          }
        }
      }
    }
    async destroyAll(ctx) {
      for (const id of [...this.#active].reverse()) {
        const feature = this.#features.get(id);
        try {
          if (feature) {
            await feature.destroy(ctx);
          }
        } catch (error) {
          ctx.diagnostics.error(`Feature failed to destroy: ${id}`, errorDetails4(error));
        }
        this.#active.delete(id);
      }
    }
    statuses() {
      return [...this.#features.values()].map((feature) => {
        try {
          return feature.getStatus?.() ?? {
            ok: true,
            message: `${feature.id} registered`
          };
        } catch (error) {
          return {
            ok: false,
            message: `${feature.id} status failed`,
            details: errorDetails4(error)
          };
        }
      });
    }
  };
  function errorDetails4(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message
      };
    }
    return {
      message: String(error)
    };
  }

  // src/platform/diagnostics.ts
  var Diagnostics = class {
    #events = [];
    info(message, details) {
      this.push("info", message, details);
    }
    warn(message, details) {
      this.push("warn", message, details);
    }
    error(message, details) {
      this.push("error", message, details);
    }
    snapshot() {
      return [...this.#events];
    }
    push(level, message, details) {
      const event = {
        level,
        message,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        ...details ? { details } : {}
      };
      this.#events.push(event);
      if (this.#events.length > 200) {
        this.#events.shift();
      }
    }
  };

  // src/platform/observer.ts
  function observeAddedElements(root, onAdded) {
    const observer = new MutationObserver((mutations) => {
      const added = [];
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof Element) {
            added.push(node);
          }
        }
      }
      if (added.length > 0) {
        onAdded(added, root);
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true
    });
    return () => observer.disconnect();
  }

  // src/platform/rate-limit.ts
  var TokenBucket = class {
    constructor(capacity, refillPerSecond) {
      this.capacity = capacity;
      this.refillPerSecond = refillPerSecond;
      this.#tokens = capacity;
      this.#lastRefill = Date.now();
    }
    #tokens;
    #lastRefill;
    tryRemove(tokens = 1) {
      this.refill();
      if (this.#tokens < tokens) {
        return false;
      }
      this.#tokens -= tokens;
      return true;
    }
    async waitForToken(tokens = 1) {
      while (!this.tryRemove(tokens)) {
        await delay(250);
      }
    }
    snapshot() {
      this.refill();
      return {
        tokens: this.#tokens,
        capacity: this.capacity,
        refillPerSecond: this.refillPerSecond
      };
    }
    refill() {
      const now = Date.now();
      const elapsed = Math.max(0, now - this.#lastRefill) / 1e3;
      this.#tokens = Math.min(this.capacity, this.#tokens + elapsed * this.refillPerSecond);
      this.#lastRefill = now;
    }
  };
  function delay(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }

  // src/platform/route.ts
  function readRoute(location = globalThis.location) {
    const path = location.pathname;
    return {
      href: location.href,
      path,
      surface: detectSurface(path)
    };
  }
  function watchRoute(onRoute) {
    const history2 = globalThis.history;
    const originalPush = history2.pushState;
    const originalReplace = history2.replaceState;
    const callOriginalPush = originalPush.bind(history2);
    const callOriginalReplace = originalReplace.bind(history2);
    let lastHref = globalThis.location.href;
    const emitIfChanged = () => {
      if (globalThis.location.href === lastHref) {
        return;
      }
      lastHref = globalThis.location.href;
      onRoute(readRoute());
    };
    const patchedPush = (...args) => {
      callOriginalPush(...args);
      queueMicrotask(emitIfChanged);
    };
    const patchedReplace = (...args) => {
      callOriginalReplace(...args);
      queueMicrotask(emitIfChanged);
    };
    try {
      history2.pushState = patchedPush;
      history2.replaceState = patchedReplace;
    } catch {
    }
    globalThis.addEventListener("popstate", emitIfChanged);
    return () => {
      try {
        if (history2.pushState === patchedPush) {
          history2.pushState = originalPush;
        }
        if (history2.replaceState === patchedReplace) {
          history2.replaceState = originalReplace;
        }
      } catch {
      }
      globalThis.removeEventListener("popstate", emitIfChanged);
    };
  }
  function detectSurface(path) {
    if (path === "/home") return "home";
    if (/\/status\/\d+/.test(path)) return "status";
    if (path.startsWith("/notifications")) return "notifications";
    if (path.startsWith("/messages")) return "messages";
    if (path.startsWith("/settings")) return "settings";
    if (path.startsWith("/search")) return "search";
    if (path.startsWith("/i/grok")) return "grok";
    if (/^\/[^/]+$/.test(path)) return "profile";
    return "unknown";
  }

  // src/platform/storage.ts
  function createStorageGateway(namespace = "aviary") {
    const scoped = (key) => {
      if (namespace.length === 0 || key.startsWith(`${namespace}.`)) {
        return key;
      }
      return `${namespace}.${key}`;
    };
    const globals = globalThis;
    return {
      async get(key, fallback) {
        const storageKey = scoped(key);
        try {
          if (typeof globals.GM_getValue === "function") {
            return await globals.GM_getValue(storageKey, fallback);
          }
          if (globalThis.chrome?.storage?.local) {
            const result = await globalThis.chrome.storage.local.get(storageKey);
            return result[storageKey] === void 0 ? fallback : result[storageKey];
          }
          const raw = globalThis.localStorage?.getItem(storageKey);
          return raw === null || raw === void 0 ? fallback : JSON.parse(raw);
        } catch {
          return fallback;
        }
      },
      async set(key, value) {
        const storageKey = scoped(key);
        if (typeof globals.GM_setValue === "function") {
          await globals.GM_setValue(storageKey, value);
          return;
        }
        if (globalThis.chrome?.storage?.local) {
          await globalThis.chrome.storage.local.set({ [storageKey]: value });
          return;
        }
        if (globalThis.localStorage) {
          globalThis.localStorage.setItem(storageKey, JSON.stringify(value));
          return;
        }
        throw new Error(`No storage backend is available for ${storageKey}`);
      },
      async remove(key) {
        const storageKey = scoped(key);
        if (typeof globals.GM_deleteValue === "function") {
          await globals.GM_deleteValue(storageKey);
          return;
        }
        if (globalThis.chrome?.storage?.local) {
          await globalThis.chrome.storage.local.remove(storageKey);
          return;
        }
        if (globalThis.localStorage) {
          globalThis.localStorage.removeItem(storageKey);
          return;
        }
        throw new Error(`No storage backend is available for ${storageKey}`);
      }
    };
  }

  // src/platform/trusted-types.ts
  function createTrustedHtmlPolicy(name = "aviary") {
    const factory = globalThis.window?.trustedTypes;
    if (!factory) {
      return {
        html(input) {
          return input;
        }
      };
    }
    let policy;
    try {
      policy = factory.createPolicy(name, {
        createHTML(input) {
          return input;
        }
      });
    } catch {
      policy = void 0;
    }
    return {
      html(input) {
        return policy ? policy.createHTML(input) : input;
      }
    };
  }

  // src/main.ts
  var activeApp;
  var bootingApp;
  function boot(options) {
    if (typeof document === "undefined") {
      return Promise.resolve(void 0);
    }
    if (activeApp) {
      return Promise.resolve(activeApp);
    }
    if (bootingApp) {
      return bootingApp;
    }
    bootingApp = bootInternal(options).finally(() => {
      bootingApp = void 0;
    });
    return bootingApp;
  }
  async function bootInternal(options) {
    document.documentElement.dataset.avTheme = DEFAULT_SETTINGS.appearance.theme;
    document.documentElement.dataset.avReady = "booting";
    const storage = createStorageGateway("aviary");
    const settings = normalizeSettings(await storage.get(SETTINGS_KEY, DEFAULT_SETTINGS));
    const diagnostics = new Diagnostics();
    const limiter = new TokenBucket(settings.jobs.rateLimitMode === "conservative" ? 4 : 8, 0.5);
    const registry = new FeatureRegistry();
    const policy = createTrustedHtmlPolicy();
    const auditLog = new AuditLog(storage);
    await auditLog.load();
    registry.register(themeFeature);
    registry.register(i18nFeature);
    registry.register(selectorHealthFeature);
    registry.register(controlCenterFeature);
    registry.register(layoutDeclutterFeature);
    registry.register(filterEngineFeature);
    registry.register(mediaButtonsFeature);
    registry.register(mediaPresentationFeature);
    registry.register(exportFeature);
    registry.register(userNotesFeature);
    registry.register(linkUnshortenFeature);
    registry.register(snapshotsFeature);
    registry.register(mobileTouchFeature);
    registry.register(composerSnippetsFeature);
    registry.register(networkCaptureFeature);
    registry.register(aiCommandMenuFeature);
    const context = {
      route: readRoute(),
      settings,
      storage,
      limiter,
      diagnostics,
      auditLog,
      async saveSettings() {
        await storage.set(SETTINGS_KEY, cloneSettings(settings));
        diagnostics.info("Settings saved", { key: SETTINGS_KEY });
      },
      requestApply() {
        void registry.applyAll(context, document);
      }
    };
    const stops = [];
    document.documentElement.dataset.avSource = options.source;
    policy.html("");
    try {
      await registry.initAll(context);
      await registry.applyAll(context, document);
      const observerRoot = document.body ?? document.documentElement;
      stops.push(
        observeAddedElements(observerRoot, (nodes, root) => {
          void registry.applyAll(context, root, nodes);
        })
      );
      stops.push(
        watchRoute((route) => {
          context.route = route;
          diagnostics.info("Route changed", { surface: route.surface, path: route.path });
          void registry.applyAll(context, document);
        })
      );
      document.documentElement.dataset.avReady = "true";
      diagnostics.info("Aviary booted", { source: options.source, surface: context.route.surface });
      activeApp = {
        context,
        registry,
        async destroy() {
          for (const stop of stops.reverse()) {
            stop();
          }
          await registry.destroyAll(context);
          delete document.documentElement.dataset.avReady;
          delete document.documentElement.dataset.avSource;
          activeApp = void 0;
        }
      };
      return activeApp;
    } catch (error) {
      diagnostics.error("Aviary boot failed", errorDetails5(error));
      document.documentElement.dataset.avReady = "error";
      for (const stop of stops.reverse()) {
        stop();
      }
      await registry.destroyAll(context);
      throw error;
    }
  }
  function errorDetails5(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message
      };
    }
    return {
      message: String(error)
    };
  }

  // src/entrypoints/userscript.ts
  void boot({ source: "userscript" });
})();
