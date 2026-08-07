import type { AviarySettings } from "../platform/settings";
import type { Diagnostics } from "../platform/diagnostics";
import type { PageBridge } from "../platform/page-bridge";
import type { RouteState } from "../platform/route";
import type { StorageGateway } from "../platform/storage";
import type { TokenBucket } from "../platform/rate-limit";
import type { AuditLog } from "./core/audit-log";

export interface FeatureContext {
  route: RouteState;
  settings: AviarySettings;
  storage: StorageGateway;
  limiter: TokenBucket;
  diagnostics: Diagnostics;
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
  defaultEnabled: boolean;
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

  async initAll(ctx: FeatureContext): Promise<void> {
    for (const feature of this.#features.values()) {
      if (!feature.defaultEnabled) {
        continue;
      }
      try {
        await feature.init(ctx);
        this.#active.add(feature.id);
        ctx.diagnostics.info(`Feature initialized: ${feature.id}`);
      } catch (error) {
        ctx.diagnostics.error(`Feature failed to initialize: ${feature.id}`, errorDetails(error));
      }
    }
  }

  async applyAll(ctx: FeatureContext, root: ParentNode, addedNodes?: Element[]): Promise<void> {
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
