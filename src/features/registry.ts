import type { AviarySettings } from "../platform/settings.ts";
import type { Diagnostics } from "../platform/diagnostics.ts";
import type { DiagnosticsStore } from "../platform/diagnostics-store.ts";
import type { PageBridge } from "../platform/page-bridge.ts";
import type { RouteState } from "../platform/route.ts";
import type { StorageGateway } from "../platform/storage.ts";
import type { ProfileManager } from "../platform/profile.ts";
import type { TokenBucket } from "../platform/rate-limit.ts";
import type { AuditLog } from "./core/audit-log.ts";
import type { IntegrationUsageLedger } from "./integrations/usage.ts";
import type { SelectorHealthSnapshot } from "./core/selector-health.ts";
import {
  FeaturePerformanceDiagnostics,
  type PerformanceMetricsSnapshot
} from "../platform/performance-diagnostics.ts";

export interface FeatureContext {
  route: RouteState;
  settings: AviarySettings;
  storage: StorageGateway;
  /** Profile-scoped counters and budgets for external AI/embedding calls. */
  integrationUsage?: IntegrationUsageLedger;
  /** Explicit local profile selected by the user; absent in minimal unit-test contexts. */
  profile?: ProfileManager;
  limiter: TokenBucket;
  diagnostics: Diagnostics;
  /** Warnings and errors that survive a reload; absent in minimal unit-test contexts. */
  diagnosticsStore?: DiagnosticsStore;
  /** True when this profile had no stored settings at boot, i.e. Aviary has never run here. */
  freshInstall?: boolean;
  auditLog: AuditLog;
  /**
   * Access to the page's own world. Absent when the host cannot provide it -- an old userscript
   * manager, or a browser that ignores `"world": "MAIN"` -- so every consumer must handle its
   * absence rather than assume the hooks are live.
   */
  pageBridge?: PageBridge;
  /**
   * The registry running this context, so a feature can ask what else is wired up.
   *
   * Only the bisect flow needs it: answering "which feature is breaking this page?" means
   * turning features off and on again, which nothing outside the registry can do. Absent in
   * minimal unit-test contexts, like every other optional field here.
   */
  registry?: FeatureRegistry;
  saveSettings(): Promise<void>;
  /** Request a serialized apply pass. Live boot contexts return its completion promise. */
  requestApply(): void | Promise<void>;
  /** Extension-only hook used by the document-start launcher to fetch the panel chunk. */
  loadControlCenter?: (options?: { focusSelectorHealth?: boolean }) => Promise<void>;
  /** Live state readers stay in the document-start chunk when the panel is lazy-loaded. */
  getPageHookCounters?: () => {
    blockedBeacons: number;
    blockedAdRequests: number;
    rewrittenPlaylists: number;
  };
  getAdProtectionCounters?: () => {
    hiddenPlacements: number;
    suppressedVideoAds: number;
  };
  getSelectorHealth?: () => SelectorHealthSnapshot;
  /** Repaints the mounted Control Center when a first-chunk health sample changes. */
  refreshControlCenter?: () => void;
  clearSelectorAdObservations?: () => Promise<void>;
}

export interface FeatureStatus {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface FeatureModule {
  id: string;
  title: string;
  category: "core" | "appearance" | "layout" | "filtering" | "media" | "export" | "privacy" | "accessibility";
  init(ctx: FeatureContext): void | Promise<void>;
  apply?(ctx: FeatureContext, root: ParentNode, addedNodes?: Element[]): void | Promise<void>;
  destroy(ctx: FeatureContext): void | Promise<void>;
  getStatus?(): FeatureStatus;
}

export class FeatureRegistry {
  readonly #features = new Map<string, FeatureModule>();
  readonly #active = new Set<string>();
  readonly #performance = new FeaturePerformanceDiagnostics();
  /**
   * Features the bisect flow turned off, in the order they were registered.
   *
   * Kept apart from `#active` so an abandoned bisect can put back exactly what it took away and
   * nothing else -- a feature that was already off because its own setting is off must stay off.
   */
  readonly #suspended = new Set<string>();

  register(feature: FeatureModule): void {
    if (this.#features.has(feature.id)) {
      throw new Error(`Feature already registered: ${feature.id}`);
    }
    this.#features.set(feature.id, feature);
  }

  /**
   * Registers a feature after the initial boot pass and initializes it immediately.
   *
   * Extension delivery uses this for the panel chunk. Keeping the operation on the registry
   * means a late-loaded feature still participates in suspend, resume, apply, and teardown in
   * exactly the same way as a feature present in the first chunk.
   */
  async registerAndInit(ctx: FeatureContext, feature: FeatureModule): Promise<void> {
    this.register(feature);
    await this.initFeature(ctx, feature.id);
  }

  /** Initializes one feature that was registered after `initAll` completed. */
  async initFeature(ctx: FeatureContext, id: string): Promise<boolean> {
    if (this.#active.has(id)) {
      return true;
    }
    const feature = this.#features.get(id);
    if (!feature) {
      return false;
    }
    try {
      await feature.init(ctx);
      this.#active.add(id);
      ctx.diagnostics.info(`Feature initialized: ${id}`);
      return true;
    } catch (error) {
      ctx.diagnostics.error(`Feature failed to initialize: ${id}`, errorDetails(error));
      return false;
    }
  }

  /**
   * What is registered, in registration order.
   *
   * `statuses()` reports how each feature is doing but not which feature it is, so nothing could
   * ask the running app what it had actually wired up — the question was answered by grepping
   * `main.ts` for `registry.register(...)` instead, which cannot see a registration that never
   * ran.
   */
  ids(): string[] {
    return [...this.#features.keys()];
  }

  /** A registered feature's human-readable title, for reporting one by id. */
  title(id: string): string | undefined {
    return this.#features.get(id)?.title;
  }

  /** Whether a registered feature's `init` completed without throwing. */
  isActive(id: string): boolean {
    return this.#active.has(id);
  }

  /** Features currently held off by `suspend`, in registration order. */
  suspendedIds(): string[] {
    return this.ids().filter((id) => this.#suspended.has(id));
  }

  /** A bounded, content-free view of feature apply cost for the current page. */
  performanceMetrics(): PerformanceMetricsSnapshot {
    return this.#performance.snapshot();
  }

  /** Clears the local apply timing aggregate without changing feature state. */
  resetPerformanceMetrics(): void {
    this.#performance.reset();
  }

  /**
   * Turns active features off through their own `destroy`, so the page returns to what X renders.
   *
   * This is the same teardown a full `destroyAll` performs, applied to a subset: nothing is
   * written to settings, so a reload restores everything regardless of what the caller does next.
   * Returns the ids that were actually turned off -- a feature that was never active, or is
   * already suspended, is not one of them.
   */
  async suspend(ctx: FeatureContext, ids: Iterable<string>): Promise<string[]> {
    const wanted = new Set(ids);
    // Reverse registration order, mirroring destroyAll: later features may lean on earlier ones.
    const targets = this.ids()
      .filter((id) => wanted.has(id) && this.#active.has(id))
      .reverse();
    for (const id of targets) {
      const feature = this.#features.get(id);
      try {
        await feature?.destroy(ctx);
      } catch (error) {
        ctx.diagnostics.error(`Feature failed to destroy: ${id}`, errorDetails(error));
      }
      this.#active.delete(id);
      this.#suspended.add(id);
    }
    return targets.reverse();
  }

  /**
   * Puts suspended features back through their own `init`, in registration order.
   *
   * Only features this registry suspended are eligible; passing an id it never took away is a
   * no-op rather than a second init of a feature that is already running.
   */
  async resume(ctx: FeatureContext, ids?: Iterable<string>): Promise<string[]> {
    const wanted = ids === undefined ? undefined : new Set(ids);
    const targets = this.ids().filter(
      (id) => this.#suspended.has(id) && (wanted === undefined || wanted.has(id))
    );
    const resumed: string[] = [];
    for (const id of targets) {
      const feature = this.#features.get(id);
      if (!feature) {
        this.#suspended.delete(id);
        continue;
      }
      try {
        await feature.init(ctx);
        this.#active.add(id);
        resumed.push(id);
        ctx.diagnostics.info(`Feature resumed: ${id}`);
      } catch (error) {
        ctx.diagnostics.error(`Feature failed to resume: ${id}`, errorDetails(error));
      }
      this.#suspended.delete(id);
    }
    return resumed;
  }

  async initAll(ctx: FeatureContext): Promise<void> {
    for (const feature of this.#features.values()) {
      try {
        await feature.init(ctx);
        this.#active.add(feature.id);
        ctx.diagnostics.info(`Feature initialized: ${feature.id}`);
      } catch (error) {
        ctx.diagnostics.error(`Feature failed to initialize: ${feature.id}`, errorDetails(error));
      }
    }
  }

  /**
   * Runs one pass at a time.
   *
   * Boot, the mutation observer, route changes and `requestApply` all fire `void applyAll(...)`
   * with no coordination, and `applyAll` awaits each feature — so two passes interleaved at every
   * await boundary. Features guard their work with module-level markers (`lastAppliedVersion`,
   * `compiledSignature`), and one pass would set a marker that made the other skip the rescan it
   * had been started for. The symptom was a feature that quietly failed to re-apply after a
   * settings change, which is hard to attribute and easy to blame on X.
   *
   * A whole-document pass supersedes another whole-document pass, so those coalesce. A pass
   * carrying `addedNodes` describes specific new nodes and is never merged away — dropping one
   * would leave those nodes unprocessed, which is the bug this is meant to prevent, not cause.
   */
  #applyChain: Promise<void> = Promise.resolve();
  #pendingFullPass: Promise<void> | undefined;

  applyAll(ctx: FeatureContext, root: ParentNode, addedNodes?: Element[]): Promise<void> {
    const isFullPass = addedNodes === undefined || addedNodes.length === 0;
    if (isFullPass && this.#pendingFullPass) {
      // An identical pass is already queued behind the running one; its result is ours.
      return this.#pendingFullPass;
    }

    const run = this.#applyChain.then(() => this.#runApply(ctx, root, addedNodes));
    // The chain must not reject or every later pass inherits the rejection; #runApply already
    // reports per-feature failures, so this only guards against an unexpected throw.
    this.#applyChain = run.then(
      () => undefined,
      () => undefined
    );

    if (isFullPass) {
      this.#pendingFullPass = run;
      void run.then(
        () => {
          if (this.#pendingFullPass === run) this.#pendingFullPass = undefined;
        },
        () => {
          if (this.#pendingFullPass === run) this.#pendingFullPass = undefined;
        }
      );
    }
    return run;
  }

  async #runApply(ctx: FeatureContext, root: ParentNode, addedNodes?: Element[]): Promise<void> {
    const passType = addedNodes === undefined || addedNodes.length === 0 ? "full" : "incremental";
    // Registration order, not init order. They are the same until a feature is suspended and
    // resumed, after which init order would put the resumed feature last -- and ad protection is
    // registered first precisely so it runs before anything that reads the timeline.
    for (const id of this.ids()) {
      if (!this.#active.has(id)) continue;
      const feature = this.#features.get(id);
      if (feature?.apply) {
        const started = performanceNow();
        try {
          await feature.apply(ctx, root, addedNodes);
        } catch (error) {
          ctx.diagnostics.error(`Feature failed to apply: ${id}`, errorDetails(error));
        } finally {
          const ended = performanceNow();
          this.#performance.record(id, passType, Math.max(0, ended - started), started, ended);
        }
      }
    }
  }

  async destroyAll(ctx: FeatureContext): Promise<void> {
    for (const id of this.ids().filter((id) => this.#active.has(id)).reverse()) {
      const feature = this.#features.get(id);
      try {
        if (feature) {
          await feature.destroy(ctx);
        }
      } catch (error) {
        ctx.diagnostics.error(`Feature failed to destroy: ${id}`, errorDetails(error));
      }
      this.#active.delete(id);
    }
    // Suspended features were already destroyed on the way in; the record of them goes with the
    // rest of the teardown so a later boot does not inherit a half-finished search.
    this.#suspended.clear();
  }

  statuses(): FeatureStatus[] {
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
          details: errorDetails(error)
        };
      }
    });
  }
}

function performanceNow(): number {
  const clock = globalThis.performance;
  return typeof clock?.now === "function" ? clock.now() : Date.now();
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
