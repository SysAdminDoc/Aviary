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
import { linkUnshortenFeature } from "./features/library/link-unshorten";
import { snapshotsFeature } from "./features/library/snapshots-feature";
import { userNotesFeature } from "./features/library/user-notes";
import { mediaButtonsFeature } from "./features/media/media-buttons";
import { mediaPresentationFeature } from "./features/media/media-presentation";
import { FeatureRegistry, type FeatureContext } from "./features/registry";
import { Diagnostics } from "./platform/diagnostics";
import { observeAddedElements } from "./platform/observer";
import { TokenBucket } from "./platform/rate-limit";
import { readRoute, watchRoute } from "./platform/route";
import { cloneSettings, DEFAULT_SETTINGS, normalizeSettings, SETTINGS_KEY } from "./platform/settings";
import { createStorageGateway } from "./platform/storage";
import { createTrustedHtmlPolicy } from "./platform/trusted-types";

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
  document.documentElement.dataset.avTheme = DEFAULT_SETTINGS.appearance.theme;
  document.documentElement.dataset.avReady = "booting";

  const storage = createStorageGateway("aviary");
  const settings = normalizeSettings(await storage.get(SETTINGS_KEY, DEFAULT_SETTINGS));
  const diagnostics = new Diagnostics();
  // Burst covers an ordinary page of media without any wait; the refill rate is what paces a
  // long batch. 0.5/s was low enough that a 200-item batch would have looked hung.
  const limiter =
    settings.jobs.rateLimitMode === "conservative"
      ? new TokenBucket(4, 1)
      : new TokenBucket(8, 4);
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
  registry.register(layoutDeclutterFeature);
  registry.register(filterEngineFeature);
  registry.register(hiddenPostsFeature);
  registry.register(mediaButtonsFeature);
  registry.register(mediaPresentationFeature);
  registry.register(exportFeature);
  registry.register(userNotesFeature);
  registry.register(linkUnshortenFeature);
  registry.register(cleanShareLinksFeature);
  registry.register(snapshotsFeature);
  registry.register(mobileTouchFeature);
  registry.register(composerSnippetsFeature);
  registry.register(networkCaptureFeature);
  registry.register(aiCommandMenuFeature);
  // Registered last so its first paint reads stores that are already loaded — features
  // initialize in registration order, and the panel reports their counts.
  registry.register(controlCenterFeature);

  const context: FeatureContext = {
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
    throw error;
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
