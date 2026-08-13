import { themeFeature } from "./features/appearance/theme";
import { controlCenterFeature } from "./features/core/control-center";
import { selectorHealthFeature } from "./features/core/selector-health";
import { filterEngineFeature } from "./features/filtering/filter-engine";
import { hiddenPostsFeature } from "./features/filtering/hidden-posts-feature";
import { layoutDeclutterFeature } from "./features/layout/declutter";
import { AuditLog } from "./features/core/audit-log";
import { aiCommandMenuFeature } from "./features/ai/command-menu";
import { composerSnippetsFeature } from "./features/composer/composer-snippets";
import { i18nFeature } from "./features/core/i18n-feature";
import { mobileTouchFeature } from "./features/core/mobile-touch";
import { exportFeature } from "./features/export/export-feature";
import { networkCaptureFeature } from "./features/export/network-capture";
import { cleanShareLinksFeature } from "./features/library/clean-share-links";
import { pauseOffscreenVideoFeature } from "./features/performance/pause-offscreen-video";
import { forceFollowingFeature } from "./features/layout/force-following";
import { inlineOriginalImagesFeature } from "./features/media/inline-original-images";
import { linkUnshortenFeature } from "./features/library/link-unshorten";
import { snapshotsFeature } from "./features/library/snapshots-feature";
import { userNotesFeature } from "./features/library/user-notes";
import { bookmarksFeature } from "./features/library/bookmarks-feature";
import { mediaButtonsFeature } from "./features/media/media-buttons";
import { mediaPresentationFeature } from "./features/media/media-presentation";
import { FeatureRegistry, type FeatureContext } from "./features/registry";
import { setLocalOnlyPolicy } from "./features/integrations/network-policy";
import { pageHooksFeature } from "./features/privacy/page-hooks";
import { adProtectionFeature, installEarlyAdShield } from "./features/privacy/ad-protection";
import { Diagnostics } from "./platform/diagnostics";
import { createPageBridge } from "./platform/page-bridge";
import { observeAddedElements } from "./platform/observer";
import { TokenBucket } from "./platform/rate-limit";
import { readRoute, watchRoute } from "./platform/route";
import { cloneSettings, DEFAULT_SETTINGS, normalizeSettings, SETTINGS_KEY } from "./platform/settings";
import { createStorageGateway, setStorageErrorSink } from "./platform/storage";
import { createDurableStorageGateway, DURABLE_STORAGE_KEYS } from "./platform/durable-storage";
import { createProfileStorageGateway, ProfileManager } from "./platform/profile";
import { createTrustedHtmlPolicy } from "./platform/trusted-types";
import { IntegrationUsageLedger } from "./features/integrations/usage";
import { requestExtensionAdRuleSync } from "./extension/ad-rule";

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

  bootingApp = bootInternal(options).finally(() => {
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
  pageBridge.configure({
    blockAds: DEFAULT_SETTINGS.privacy.blockAds,
    blockBeacons: false,
    captureGraphql: false,
    captureMediaMetadata: false,
    forceVideoQuality: false
  });
  const legacyStorage = createStorageGateway("aviary");
  const durableStorage = createDurableStorageGateway(legacyStorage);
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
  const integrationUsage = new IntegrationUsageLedger(storage);
  await integrationUsage.load();
  const settings = normalizeSettings(await storage.get(SETTINGS_KEY, DEFAULT_SETTINGS));
  await reconcileExtensionAdRule(options.source, settings.privacy.blockAds, diagnostics);
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
  registry.register(i18nFeature);
  registry.register(selectorHealthFeature);
  registry.register(adProtectionFeature);
  registry.register(layoutDeclutterFeature);
  registry.register(filterEngineFeature);
  registry.register(hiddenPostsFeature);
  registry.register(mediaButtonsFeature);
  registry.register(mediaPresentationFeature);
  registry.register(exportFeature);
  registry.register(bookmarksFeature);
  registry.register(userNotesFeature);
  registry.register(linkUnshortenFeature);
  registry.register(cleanShareLinksFeature);
  registry.register(pauseOffscreenVideoFeature);
  registry.register(forceFollowingFeature);
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

  const context: FeatureContext = {
    route: readRoute(),
    settings,
    storage,
    integrationUsage,
    profile: profileManager,
    limiter,
    diagnostics,
    auditLog,
    pageBridge,
    async saveSettings() {
      // Normalized here so persistence has one choke point with one guarantee. Panel handlers
      // wrote whatever was in memory while import/preset/locale wrote normalized values.
      await storage.set(SETTINGS_KEY, normalizeSettings(cloneSettings(settings)));
      await reconcileExtensionAdRule(options.source, settings.privacy.blockAds, diagnostics);
      diagnostics.info("Settings saved", { key: SETTINGS_KEY });
    },
    requestApply() {
      reconcileRateLimit();
      void registry.applyAll(context, document);
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
    for (const stop of stops.reverse()) {
      stop();
    }
    await registry.destroyAll(context);
    pageBridge.destroy();
    throw error;
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
