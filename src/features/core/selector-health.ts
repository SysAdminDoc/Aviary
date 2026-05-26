import type { FeatureModule } from "../registry";
import { getSelectorHealth } from "../../platform/selectors";

const CRITICAL_SURFACES = new Set(["App root", "Primary column"]);
const MIN_LOG_INTERVAL_MS = 5000;

let lastLogAt = 0;
let lastSignature = "";

export const selectorHealthFeature: FeatureModule = {
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
