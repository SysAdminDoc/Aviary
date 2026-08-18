import type { AviarySettings } from "../platform/settings";
import type { Diagnostics } from "../platform/diagnostics";
import type { DiagnosticsStore } from "../platform/diagnostics-store";
import type { PageBridge } from "../platform/page-bridge";
import type { RouteState } from "../platform/route";
import type { StorageGateway } from "../platform/storage";
import type { ProfileManager } from "../platform/profile";
import type { TokenBucket } from "../platform/rate-limit";
import type { AuditLog } from "./core/audit-log";
import type { IntegrationUsageLedger } from "./integrations/usage";

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
  saveSettings(): Promise<void>;
  requestApply(): void;
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

  register(feature: FeatureModule): void {
    if (this.#features.has(feature.id)) {
      throw new Error(`Feature already registered: ${feature.id}`);
    }
    this.#features.set(feature.id, feature);
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

  /** Whether a registered feature's `init` completed without throwing. */
  isActive(id: string): boolean {
    return this.#active.has(id);
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
    for (const id of this.#active) {
      const feature = this.#features.get(id);
      if (feature?.apply) {
        try {
          await feature.apply(ctx, root, addedNodes);
        } catch (error) {
          ctx.diagnostics.error(`Feature failed to apply: ${id}`, errorDetails(error));
        }
      }
    }
  }

  async destroyAll(ctx: FeatureContext): Promise<void> {
    for (const id of [...this.#active].reverse()) {
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
