import { themeFeature } from "./features/appearance/theme.ts";
import { titleBadgeFeature } from "./features/appearance/title-badge.ts";
import { absoluteTimeFeature } from "./features/appearance/absolute-time.ts";
import { faviconFeature } from "./features/appearance/favicon.ts";
import { customCssFeature } from "./features/appearance/custom-css.ts";
import { controlCenterFeature } from "./features/core/control-center.ts";
import { firstRunFeature } from "./features/core/first-run.ts";
import { selectorHealthFeature } from "./features/core/selector-health.ts";
import { filterEngineFeature } from "./features/filtering/filter-engine.ts";
import { seenPostsFeature } from "./features/filtering/seen-posts-feature.ts";
import { readingMarkerFeature } from "./features/filtering/reading-marker-feature.ts";
import { hiddenPostsFeature } from "./features/filtering/hidden-posts-feature.ts";
import { layoutDeclutterFeature } from "./features/layout/declutter.ts";
import { threadRecommendationsFeature } from "./features/layout/thread-recommendations.ts";
import { focusModeFeature } from "./features/layout/focus-mode.ts";
import { AuditLog } from "./features/core/audit-log.ts";
import { aiCommandMenuFeature } from "./features/ai/command-menu.ts";
import { composerSnippetsFeature } from "./features/composer/composer-snippets.ts";
import { i18nFeature } from "./features/core/i18n-feature.ts";
import { mobileTouchFeature } from "./features/core/mobile-touch.ts";
import { exportFeature } from "./features/export/export-feature.ts";
import { networkCaptureFeature } from "./features/export/network-capture.ts";
import { cleanShareLinksFeature } from "./features/library/clean-share-links.ts";
import { copyPostLinkFeature } from "./features/library/copy-post-link.ts";
import { pauseOffscreenVideoFeature } from "./features/performance/pause-offscreen-video.ts";
import { videoPlaybackFeature } from "./features/performance/video-playback.ts";
import { forceFollowingFeature } from "./features/layout/force-following.ts";
import { timelinePaginationFeature } from "./features/layout/timeline-pagination.ts";
import { inlineOriginalImagesFeature } from "./features/media/inline-original-images.ts";
import { linkUnshortenFeature } from "./features/library/link-unshorten.ts";
import { snapshotsFeature } from "./features/library/snapshots-feature.ts";
import { userNotesFeature } from "./features/library/user-notes.ts";
import { bookmarksFeature } from "./features/library/bookmarks-feature.ts";
import { mediaButtonsFeature } from "./features/media/media-buttons.ts";
import { mediaPresentationFeature } from "./features/media/media-presentation.ts";
import { FeatureRegistry, type FeatureContext } from "./features/registry.ts";
import { setLocalOnlyPolicy } from "./features/integrations/network-policy.ts";
import { pageHooksFeature } from "./features/privacy/page-hooks.ts";
import { adProtectionFeature, installEarlyAdShield } from "./features/privacy/ad-protection.ts";
import { Diagnostics } from "./platform/diagnostics.ts";
import { DiagnosticsStore } from "./platform/diagnostics-store.ts";
import { showBootFailureNotice } from "./platform/boot-notice.ts";
import { createPageBridge, type PageBridge } from "./platform/page-bridge.ts";
import { observeAddedElements } from "./platform/observer.ts";
import { TokenBucket } from "./platform/rate-limit.ts";
import { readRoute, watchRoute } from "./platform/route.ts";
import {
  type AviarySettings,
  cloneSettings,
  DEFAULT_SETTINGS,
  mergeKnownSettings,
  normalizeSettings,
  readSettingsEnvelope,
  SETTINGS_KEY,
  SETTINGS_SCHEMA_VERSION
} from "./platform/settings.ts";
import { createStorageGateway, setStorageErrorSink } from "./platform/storage.ts";
import { createDurableStorageGateway, DURABLE_STORAGE_KEYS } from "./platform/durable-storage.ts";
import { createProfileStorageGateway, ProfileManager } from "./platform/profile.ts";
import { replaceStored } from "./platform/storage-lock.ts";
import { createTrustedHtmlPolicy } from "./platform/trusted-types.ts";
import { IntegrationUsageLedger } from "./features/integrations/usage.ts";
import { requestExtensionAdRuleSync } from "./extension/ad-rule.ts";
import {
  createExtensionDurableStorageBackend,
  migrateLegacyHostDurableStorage
} from "./extension/durable-storage-api.ts";

export interface BootOptions {
  source: "userscript" | "extension";
}

export interface AviaryApp {
  context: FeatureContext;
  registry: FeatureRegistry;
  destroy(): Promise<void>;
}

let activeApp: AviaryApp | undefined;
let bootingApp: Promise<AviaryApp | undefined> | undefined;
/**
 * The page bridge, from the moment it is created until boot either finishes or cleans it up.
 *
 * `bootInternal` opens its own guard at the first feature, so everything before that -- storage
 * initialization, the profile load, the settings read, the audit log -- used to reject straight out
 * of `boot()`. Both entrypoints call `boot()` as `void boot(...)`, so the rejection went nowhere: no
 * failure notice, `data-av-ready` stuck on "booting", and this bridge left patching the page's
 * fetch and XHR for the life of the tab. Holding it here is what lets the outer guard finish the
 * teardown the inner one would have done.
 */
let pendingBridge: PageBridge | undefined;

export function boot(options: BootOptions): Promise<AviaryApp | undefined> {
  if (typeof document === "undefined") {
    return Promise.resolve(undefined);
  }

  if (activeApp) {
    return Promise.resolve(activeApp);
  }

  if (bootingApp) {
    return bootingApp;
  }

  bootingApp = bootInternal(options)
    .catch((error: unknown) => {
      // `bootInternal` reports and cleans up anything that fails once features are starting. This
      // covers the awaited prelude before that, which otherwise fails silently.
      if (document.documentElement.dataset.avReady !== "error") {
        document.documentElement.dataset.avReady = "error";
        showBootFailureNotice(error instanceof Error ? error.message : String(error));
      }
      pendingBridge?.destroy();
      pendingBridge = undefined;
      throw error;
    })
    .finally(() => {
      bootingApp = undefined;
    });

  return bootingApp;
}

async function bootInternal(options: BootOptions): Promise<AviaryApp | undefined> {
  // Default-on ad protection is the sole visible startup change. Install its structural CSS
  // before the first await so sponsored cells cannot win the first paint.
  installEarlyAdShield();
  // Anti-FOUC only applies when a theme is actually going to be painted. The default is "off",
  // which means Aviary leaves X's appearance alone, so there is nothing to pre-empt.
  if (DEFAULT_SETTINGS.appearance.theme !== "off") {
    document.documentElement.dataset.avTheme = DEFAULT_SETTINGS.appearance.theme;
  }
  document.documentElement.dataset.avReady = "booting";

  const diagnostics = new Diagnostics();
  // Connect while the document is still starting, before storage opens. The page agent itself
  // starts with the same default-on ad guard, then this config is replaced by persisted settings.
  const pageBridge = createPageBridge({ source: options.source, diagnostics });
  pendingBridge = pageBridge;
  pageBridge.configure({
    blockAds: DEFAULT_SETTINGS.privacy.blockAds && DEFAULT_SETTINGS.privacy.networkShield,
    blockBeacons: false,
    captureGraphql: false,
    // Media controls are on by default, so direct video variants must be captured from the first
    // timeline response. Waiting for storage to open misses the response that built the visible
    // MediaSource players; all the DOM can expose afterward is a tab-local `blob:` handle.
    captureMediaMetadata: DEFAULT_SETTINGS.media.buttons,
    forceVideoQuality: false
  });
  const extensionBackend =
    options.source === "extension" ? createExtensionDurableStorageBackend() : null;
  if (options.source === "extension" && globalThis.chrome?.runtime?.id && !extensionBackend) {
    throw new Error("The extension background storage API is unavailable");
  }
  if (extensionBackend) {
    const migration = await migrateLegacyHostDurableStorage(extensionBackend);
    if (migration.databaseFound) {
      diagnostics.info("Legacy host storage migrated", {
        records: migration.recordsCopied,
        deleted: migration.databaseDeleted
      });
    }
  }

  // Production entrypoints are fail-closed: neither an extension nor a userscript may fall
  // through to x.com's localStorage. Test harnesses without an extension id or GM grants retain
  // auto mode so they can exercise feature behavior without pretending to be a packaged build.
  //
  // A *partial* grant is the case worth refusing rather than degrading. A manager that exposes
  // GM_getValue but not GM_listValues fails `hasUserscriptManager`, falls to auto mode, and then
  // still reads and writes through GM -- so nothing looks wrong, while the cross-origin lock
  // register (which enumerates keys) silently has no backend and every x.com/twitter.com pair
  // stops coordinating. Refusing names the missing grant instead.
  const userscriptGrants = {
    GM_getValue: typeof globalThis.GM_getValue === "function",
    GM_setValue: typeof globalThis.GM_setValue === "function",
    GM_deleteValue: typeof globalThis.GM_deleteValue === "function",
    GM_listValues: typeof globalThis.GM_listValues === "function"
  };
  const missingGrants = Object.entries(userscriptGrants)
    .filter(([, granted]) => !granted)
    .map(([grant]) => grant);
  const hasUserscriptManager = missingGrants.length === 0;
  if (
    options.source === "userscript" &&
    !hasUserscriptManager &&
    missingGrants.length < Object.keys(userscriptGrants).length
  ) {
    throw new Error(
      `Aviary cannot start: this userscript manager did not grant ${missingGrants.join(", ")}. ` +
        "Aviary stores your library through the manager and coordinates writes across x.com, " +
        "twitter.com and pro.x.com by listing those keys, so it will not fall back to page storage."
    );
  }
  const storageMode =
    options.source === "extension" && globalThis.chrome?.runtime?.id
      ? "extension"
      : options.source === "userscript" && hasUserscriptManager
        ? "userscript"
        : "auto";
  const legacyStorage = createStorageGateway("aviary", { mode: storageMode });
  const durableStorage = createDurableStorageGateway(legacyStorage, {
    backend: extensionBackend,
    legacyBackend: storageMode === "userscript" ? "userscript-manager" : "legacy"
  });
  // Every failed write reaches diagnostics, including the ones individual stores swallow.
  setStorageErrorSink((key, error, op) => {
    diagnostics.error(
      op === "read" ? `Storage could not read ${key}` : `Storage write failed to save ${key}`,
      errorDetails(error)
    );
  });
  const storageStatus = await durableStorage.initialize(DURABLE_STORAGE_KEYS);
  diagnostics.info("Durable storage initialized", {
    backend: storageStatus.backend,
    schemaVersion: storageStatus.schemaVersion,
    migratedKeys: storageStatus.migratedKeys
  });
  const profileManager = new ProfileManager(durableStorage);
  await profileManager.load();
  const storage = createProfileStorageGateway(durableStorage, profileManager.activeId);
  // Warnings and errors outlive the page from here on; the in-memory ring is lost on reload,
  // which is exactly when a user needs to report what failed.
  const diagnosticsStore = new DiagnosticsStore(storage);
  await diagnosticsStore.load();
  diagnostics.setSink((event) => diagnosticsStore.record(event));
  const integrationUsage = new IntegrationUsageLedger(storage);
  await integrationUsage.load();
  // A profile with no stored settings has never run Aviary. That is what distinguishes a fresh
  // install from an upgrade, and an upgrade must not be shown a "here is what changed" first run.
  const storedSettings = await storage.get<unknown>(SETTINGS_KEY, undefined);
  const freshInstall = storedSettings === undefined;
  const settingsEnvelope = readSettingsEnvelope(storedSettings ?? DEFAULT_SETTINGS);
  const settings = settingsEnvelope.settings;
  if (settingsEnvelope.applied.length > 0) {
    diagnostics.info("Settings schema upgraded", {
      from: settingsEnvelope.fromVersion,
      to: SETTINGS_SCHEMA_VERSION,
      steps: settingsEnvelope.applied
    });
  }
  // Custom CSS is the one setting whose stored value can be refused outright rather than clamped,
  // and normalization happens before any feature runs. Losing a user's rules without a word is not
  // an option, so the drop is reported where the rest of the boot's decisions are.
  reportDroppedCustomCss(storedSettings, settings, diagnostics);
  const futurePayload = settingsEnvelope.future;
  if (settingsEnvelope.fromFuture) {
    // Written by a newer Aviary. Run with normalized values, but never write this build's
    // narrower shape back over settings it cannot represent.
    diagnostics.warn("Settings were written by a newer Aviary", {
      found: settingsEnvelope.fromVersion,
      supported: SETTINGS_SCHEMA_VERSION
    });
  }
  await reconcileExtensionAdRule(options.source, networkShieldActive(settings), diagnostics);
  // Read fresh on every outbound call, so toggling local-only mode applies at once.
  setLocalOnlyPolicy(() => settings.privacy.localOnly);
  // Burst covers an ordinary page of media without any wait; the refill rate is what paces a
  // long batch. 0.5/s was low enough that a 200-item batch would have looked hung.
  const limiter =
    settings.jobs.rateLimitMode === "conservative"
      ? new TokenBucket(4, 1)
      : new TokenBucket(8, 4);
  let appliedRateLimitMode = settings.jobs.rateLimitMode;
  const reconcileRateLimit = (): void => {
    if (settings.jobs.rateLimitMode === appliedRateLimitMode) {
      return;
    }
    const conservative = settings.jobs.rateLimitMode === "conservative";
    limiter.configure(conservative ? 4 : 8, conservative ? 1 : 4);
    appliedRateLimitMode = settings.jobs.rateLimitMode;
    diagnostics.info("Rate limit mode reconciled", { mode: appliedRateLimitMode });
  };
  const registry = new FeatureRegistry();
  const policy = createTrustedHtmlPolicy();
  const auditLog = new AuditLog(
    storage,
    undefined,
    (error) => {
      diagnostics.error("Audit log failed to save", errorDetails(error));
    },
    () => settings.privacy.auditLog
  );
  await auditLog.load();

  registry.register(themeFeature);
  registry.register(titleBadgeFeature);
  registry.register(absoluteTimeFeature);
  registry.register(faviconFeature);
  registry.register(i18nFeature);
  // Ad protection goes first so a diagnostic storage read/write can never delay a placement
  // collapse. Its markers remain in the DOM, so the health sample immediately after still sees
  // the exact structural contracts without retaining any content.
  registry.register(adProtectionFeature);
  registry.register(selectorHealthFeature);
  registry.register(layoutDeclutterFeature);
  registry.register(threadRecommendationsFeature);
  registry.register(focusModeFeature);
  registry.register(filterEngineFeature);
  registry.register(seenPostsFeature);
  registry.register(readingMarkerFeature);
  registry.register(hiddenPostsFeature);
  registry.register(mediaButtonsFeature);
  registry.register(mediaPresentationFeature);
  registry.register(exportFeature);
  registry.register(bookmarksFeature);
  registry.register(userNotesFeature);
  registry.register(linkUnshortenFeature);
  registry.register(cleanShareLinksFeature);
  registry.register(copyPostLinkFeature);
  registry.register(pauseOffscreenVideoFeature);
  registry.register(videoPlaybackFeature);
  registry.register(forceFollowingFeature);
  registry.register(timelinePaginationFeature);
  registry.register(inlineOriginalImagesFeature);
  registry.register(snapshotsFeature);
  registry.register(mobileTouchFeature);
  registry.register(composerSnippetsFeature);
  // Registered before networkCapture: it owns the page-side config that switches capture on.
  registry.register(pageHooksFeature);
  registry.register(networkCaptureFeature);
  registry.register(aiCommandMenuFeature);
  // Registered last so its first paint reads stores that are already loaded — features
  // initialize in registration order, and the panel reports their counts.
  registry.register(controlCenterFeature);
  // Last: the notice points at the navigation row the Control Center feature mounts.
  registry.register(firstRunFeature);
  // Custom CSS is last so a user's scoped declarations win over Aviary's authored styles.
  registry.register(customCssFeature);

  const context: FeatureContext = {
    route: readRoute(),
    settings,
    storage,
    integrationUsage,
    profile: profileManager,
    limiter,
    diagnostics,
    diagnosticsStore,
    freshInstall,
    auditLog,
    pageBridge,
    registry,
    async saveSettings() {
      // Normalized here so persistence has one choke point with one guarantee. Panel handlers
      // wrote whatever was in memory while import/preset/locale wrote normalized values.
      //
      // When the stored payload came from a newer Aviary, this build's shape is merged onto it
      // rather than replacing it: `fromFuture` used to be a diagnostics line and nothing else, so
      // downgrading and toggling any single setting silently deleted every key the newer schema
      // had added.
      await replaceStored(
        storage,
        SETTINGS_KEY,
        futurePayload
          ? mergeKnownSettings(futurePayload, settings)
          : normalizeSettings(cloneSettings(settings))
      );
      await reconcileExtensionAdRule(options.source, networkShieldActive(settings), diagnostics);
      diagnostics.info("Settings saved", { key: SETTINGS_KEY });
    },
    requestApply() {
      reconcileRateLimit();
      return registry.applyAll(context, document);
    }
  };

  const stops: Array<() => void> = [];

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

    pendingBridge = undefined;
    activeApp = {
      context,
      registry,
      async destroy() {
        for (const stop of stops.reverse()) {
          stop();
        }
        await registry.destroyAll(context);
        // After the features, so their `destroy` can still turn their hooks off through it.
        pageBridge.destroy();
        delete document.documentElement.dataset.avReady;
        delete document.documentElement.dataset.avSource;
        activeApp = undefined;
      }
    };

    return activeApp;
  } catch (error) {
    diagnostics.error("Aviary boot failed", errorDetails(error));
    document.documentElement.dataset.avReady = "error";
    showBootFailureNotice(error instanceof Error ? error.message : String(error));
    for (const stop of stops.reverse()) {
      stop();
    }
    await registry.destroyAll(context);
    pageBridge.destroy();
    pendingBridge = undefined;
    throw error;
  }
}

/**
 * Warns when a stored custom CSS rule was refused by the sanitizer during normalization.
 *
 * The sanitizer's blocklist can tighten between releases -- it did, to close an escape that reached
 * the network -- and `normalizeCustomCss` discards what it refuses with no channel of its own. An
 * upgrading user would otherwise find their rules simply gone.
 */
function reportDroppedCustomCss(
  stored: unknown,
  settings: AviarySettings,
  diagnostics: Diagnostics
): void {
  if (typeof stored !== "object" || stored === null) {
    return;
  }
  const rules = (stored as { appearance?: { customCss?: unknown } }).appearance?.customCss;
  if (typeof rules !== "object" || rules === null) {
    return;
  }
  const dropped: string[] = [];
  for (const [scope, value] of Object.entries(rules as Record<string, unknown>)) {
    const kept = (settings.appearance.customCss as Record<string, string | undefined>)[scope];
    if (typeof value === "string" && value.trim().length > 0 && (kept ?? "") === "") {
      dropped.push(scope);
    }
  }
  if (dropped.length > 0) {
    diagnostics.warn("Stored custom CSS was refused and not applied", {
      scopes: dropped.join(", "),
      reason: "It uses something the current safety rules reject. Re-enter it in Appearance."
    });
  }
}

async function reconcileExtensionAdRule(
  source: BootOptions["source"],
  enabled: boolean,
  diagnostics: Diagnostics
): Promise<void> {
  const result = await requestExtensionAdRuleSync(source, enabled);
  if (!result.ok) {
    diagnostics.warn("Extension ad rule failed to sync", { error: result.error ?? "unknown" });
  }
}

/**
 * Whether Aviary should refuse X's promoted-content logger at the network layer.
 *
 * Structural ad suppression is `privacy.blockAds` alone. This is the separable half that a site
 * can observe, so it carries its own switch: turning it off leaves ads hidden while Aviary stops
 * blocking any request.
 */
function networkShieldActive(settings: { privacy: { blockAds: boolean; networkShield: boolean } }): boolean {
  return settings.privacy.blockAds && settings.privacy.networkShield;
}

function errorDetails(error: unknown): Record<string, unknown> {
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
