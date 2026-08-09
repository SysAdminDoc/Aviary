import type { FeatureContext, FeatureModule } from "../registry";
import {
  getSelectorHealthForRoute,
  type SelectorHealth
} from "../../platform/selectors";

const CRITICAL_SURFACES = new Set(["App root", "Primary column"]);
const MIN_LOG_INTERVAL_MS = 5000;

let lastLogAt = 0;
let lastHealthSignature = "";
let lastCriticalSignature = "";
let previousState: "healthy" | "degraded" | null = null;
let currentSnapshot: SelectorHealthSnapshot = emptySnapshot();

export interface SelectorHealthTransition {
  at: string;
  from: "healthy" | "degraded" | null;
  to: "healthy" | "degraded";
  route: string;
}

export interface SelectorHealthSnapshot {
  enabled: boolean;
  route: string;
  state: "healthy" | "degraded";
  required: number;
  requiredMatched: number;
  optional: number;
  optionalMatched: number;
  missingRequired: string[];
  optionalMissing: string[];
  fallbackMatches: Array<{ surface: string; selector: string }>;
  affectedFeatures: string[];
  surfaces: SelectorHealth[];
  lastTransition: SelectorHealthTransition | null;
}

export const selectorHealthFeature: FeatureModule = {
  id: "core.selectorHealth",
  title: "Selector health diagnostics",
  category: "core",
  defaultEnabled: true,

  init(ctx) {
    resetState();
    if (!ctx.settings.diagnostics.selectorHealth) {
      return;
    }
    updateSnapshot(ctx);
    ctx.diagnostics.info("Selector health initialized", snapshotDetails(currentSnapshot));
  },

  apply(ctx) {
    if (!ctx.settings.diagnostics.selectorHealth) {
      if (currentSnapshot.enabled) {
        resetState();
      }
      return;
    }

    updateSnapshot(ctx);
    const missingCritical = currentSnapshot.surfaces.filter(
      (item) => item.relevance === "required" && !item.healthy && CRITICAL_SURFACES.has(item.surface)
    );
    if (missingCritical.length === 0) {
      return;
    }

    const signature = `${ctx.route.surface}:${missingCritical.map((item) => item.surface).join(",")}`;
    const now = Date.now();
    if (signature !== lastCriticalSignature || now - lastLogAt >= MIN_LOG_INTERVAL_MS) {
      lastCriticalSignature = signature;
      lastLogAt = now;
      ctx.diagnostics.warn("Critical selector health degraded", {
        route: ctx.route.surface,
        missing: missingCritical.map((item) => item.surface),
        affectedFeatures: currentSnapshot.affectedFeatures
      });
    }
  },

  destroy(ctx) {
    resetState();
    ctx.diagnostics.info("Selector health destroyed");
  },

  getStatus() {
    return {
      ok: currentSnapshot.state === "healthy",
      message: `${currentSnapshot.requiredMatched}/${currentSnapshot.required} required selector surfaces detected`,
      details: snapshotDetails(currentSnapshot)
    };
  }
};

export function getSelectorHealthSnapshot(): SelectorHealthSnapshot {
  return {
    ...currentSnapshot,
    missingRequired: [...currentSnapshot.missingRequired],
    optionalMissing: [...currentSnapshot.optionalMissing],
    fallbackMatches: currentSnapshot.fallbackMatches.map((entry) => ({ ...entry })),
    affectedFeatures: [...currentSnapshot.affectedFeatures],
    surfaces: currentSnapshot.surfaces.map((entry) => ({ ...entry })),
    lastTransition: currentSnapshot.lastTransition
      ? { ...currentSnapshot.lastTransition }
      : null
  };
}

function updateSnapshot(ctx: FeatureContext): void {
  const surfaces = getSelectorHealthForRoute(document, ctx.route.surface);
  const required = surfaces.filter((item) => item.relevance === "required");
  const optional = surfaces.filter((item) => item.relevance === "optional");
  const missingRequired = required.filter((item) => !item.healthy).map((item) => item.surface);
  const optionalMissing = optional.filter((item) => !item.healthy).map((item) => item.surface);
  const fallbackMatches = surfaces
    .filter((item) => item.relevance !== "inapplicable" && item.matched === "fallback" && item.matchedSelector)
    .map((item) => ({ surface: item.surface, selector: item.matchedSelector! }));
  const affectedFeatures = [...new Set(
    surfaces
      .filter((item) => item.relevance !== "inapplicable" && !item.healthy)
      .map((item) => item.feature)
  )];
  const state = missingRequired.length === 0 ? "healthy" : "degraded";
  const signature = [
    ctx.route.surface,
    state,
    ...surfaces.map((item) => `${item.surface}:${item.relevance}:${item.matched}:${item.stableCount}:${item.fallbackCount}`)
  ].join("|");
  let lastTransition = currentSnapshot.lastTransition;
  if (signature !== lastHealthSignature) {
    lastTransition = {
      at: new Date().toISOString(),
      from: previousState,
      to: state,
      route: ctx.route.surface
    };
    previousState = state;
    lastHealthSignature = signature;
  }
  currentSnapshot = {
    enabled: true,
    route: ctx.route.surface,
    state,
    required: required.length,
    requiredMatched: required.filter((item) => item.healthy).length,
    optional: optional.length,
    optionalMatched: optional.filter((item) => item.healthy).length,
    missingRequired,
    optionalMissing,
    fallbackMatches,
    affectedFeatures,
    surfaces,
    lastTransition
  };
}

function resetState(): void {
  lastLogAt = 0;
  lastHealthSignature = "";
  lastCriticalSignature = "";
  previousState = null;
  currentSnapshot = emptySnapshot();
}

function emptySnapshot(): SelectorHealthSnapshot {
  return {
    enabled: false,
    route: "unknown",
    state: "healthy",
    required: 0,
    requiredMatched: 0,
    optional: 0,
    optionalMatched: 0,
    missingRequired: [],
    optionalMissing: [],
    fallbackMatches: [],
    affectedFeatures: [],
    surfaces: [],
    lastTransition: null
  };
}

function snapshotDetails(snapshot: SelectorHealthSnapshot): Record<string, unknown> {
  return {
    enabled: snapshot.enabled,
    route: snapshot.route,
    state: snapshot.state,
    required: snapshot.required,
    requiredMatched: snapshot.requiredMatched,
    optional: snapshot.optional,
    optionalMatched: snapshot.optionalMatched,
    missingRequired: snapshot.missingRequired,
    optionalMissing: snapshot.optionalMissing,
    fallbackMatches: snapshot.fallbackMatches,
    affectedFeatures: snapshot.affectedFeatures,
    lastTransition: snapshot.lastTransition
  };
}
