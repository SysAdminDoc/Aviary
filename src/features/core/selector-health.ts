import type { FeatureContext, FeatureModule } from "../registry";
import {
  getSelectorHealthForRoute,
  type SelectorHealth
} from "../../platform/selectors";
import type { StorageGateway } from "../../platform/storage";
import { observeAdMarkers } from "../privacy/ad-protection";
import {
  AD_OBSERVATIONS_KEY,
  AdObservationStore,
  emptyAdObservationSnapshot,
  type AdObservationSnapshot
} from "./ad-observations";

const CRITICAL_SURFACES = new Set(["App root", "Primary column"]);
const MIN_LOG_INTERVAL_MS = 5000;

let lastLogAt = 0;
let lastHealthSignature = "";
let lastCriticalSignature = "";
let previousState: "healthy" | "degraded" | null = null;
let currentSnapshot: SelectorHealthSnapshot = emptySnapshot();
let adObservations: AdObservationStore | undefined;

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
  adObservations: AdObservationSnapshot;
}

export const selectorHealthFeature: FeatureModule = {
  id: "core.selectorHealth",
  title: "Selector health diagnostics",
  category: "core",
  defaultEnabled: true,

  async init(ctx) {
    resetState();
    if (!ctx.settings.diagnostics.selectorHealth) {
      return;
    }
    await updateSnapshot(ctx);
    ctx.diagnostics.info("Selector health initialized", snapshotDetails(currentSnapshot));
  },

  async apply(ctx) {
    if (!ctx.settings.diagnostics.selectorHealth) {
      if (currentSnapshot.enabled) {
        resetState();
      }
      return;
    }

    await updateSnapshot(ctx);
    const missingCritical = currentSnapshot.surfaces.filter(
      (item) => item.relevance === "required" && !item.healthy && CRITICAL_SURFACES.has(item.surface)
    );
    const adDegradedReason = currentSnapshot.adObservations.degradedReason;
    if (missingCritical.length === 0 && !adDegradedReason) {
      return;
    }

    const signature = [
      ctx.route.surface,
      missingCritical.map((item) => item.surface).join(","),
      currentSnapshot.adObservations.missingContracts.join(",")
    ].join(":");
    const now = Date.now();
    if (signature !== lastCriticalSignature || now - lastLogAt >= MIN_LOG_INTERVAL_MS) {
      lastCriticalSignature = signature;
      lastLogAt = now;
      ctx.diagnostics.warn(
        missingCritical.length > 0 ? "Critical selector health degraded" : "Ad contract health degraded",
        {
          route: ctx.route.surface,
          missing: missingCritical.map((item) => item.surface),
          missingAdContracts: currentSnapshot.adObservations.missingContracts,
          degradedReason: adDegradedReason,
          affectedFeatures: currentSnapshot.affectedFeatures
        }
      );
    }
  },

  destroy(ctx) {
    resetState();
    ctx.diagnostics.info("Selector health destroyed");
  },

  getStatus() {
    return {
      ok: currentSnapshot.state === "healthy",
      message: currentSnapshot.adObservations.degradedReason
        ?? `${currentSnapshot.requiredMatched}/${currentSnapshot.required} required selector surfaces detected`,
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
    adObservations: {
      ...currentSnapshot.adObservations,
      counts: { ...currentSnapshot.adObservations.counts },
      missingContracts: [...currentSnapshot.adObservations.missingContracts]
    },
    lastTransition: currentSnapshot.lastTransition
      ? { ...currentSnapshot.lastTransition }
      : null
  };
}

export async function clearAdObservations(storage?: StorageGateway): Promise<void> {
  if (adObservations) {
    await adObservations.clear();
  } else if (storage) {
    await storage.remove(AD_OBSERVATIONS_KEY);
  }
  const affectedFeatures = currentSnapshot.affectedFeatures.filter((feature) => feature !== "Ad protection");
  const nextState: SelectorHealthSnapshot["state"] = currentSnapshot.missingRequired.length === 0
    ? "healthy"
    : "degraded";
  const lastTransition = currentSnapshot.state === nextState
    ? currentSnapshot.lastTransition
    : {
        at: new Date().toISOString(),
        from: currentSnapshot.state,
        to: nextState,
        route: currentSnapshot.route
      };
  previousState = nextState;
  lastHealthSignature = "";
  lastCriticalSignature = "";
  currentSnapshot = {
    ...currentSnapshot,
    state: nextState,
    affectedFeatures,
    adObservations: emptyAdObservationSnapshot(),
    lastTransition
  };
}

async function updateSnapshot(ctx: FeatureContext): Promise<void> {
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
  if (!adObservations) {
    adObservations = new AdObservationStore(ctx.storage);
    await adObservations.load();
  }
  let adObservationSnapshot: AdObservationSnapshot;
  try {
    adObservationSnapshot = await adObservations.observe(
      ctx.route.surface,
      observeAdMarkers(document)
    );
  } catch (error) {
    adObservationSnapshot = adObservations.snapshot();
    ctx.diagnostics.error("Ad observations failed to save", errorDetails(error));
  }
  if (adObservationSnapshot.degradedReason) {
    affectedFeatures.push("Ad protection");
  }
  const state = missingRequired.length === 0 && !adObservationSnapshot.degradedReason
    ? "healthy"
    : "degraded";
  const signature = [
    ctx.route.surface,
    state,
    ...surfaces.map((item) => `${item.surface}:${item.relevance}:${item.matched}:${item.stableCount}:${item.fallbackCount}`),
    `ads:${adObservationSnapshot.lastRoute}:${adObservationSnapshot.counts.native}:${adObservationSnapshot.counts.trend}:${adObservationSnapshot.counts.housePromo}:${adObservationSnapshot.counts.video}:${adObservationSnapshot.missingContracts.join(",")}`
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
    lastTransition,
    adObservations: adObservationSnapshot
  };
}

function resetState(): void {
  lastLogAt = 0;
  lastHealthSignature = "";
  lastCriticalSignature = "";
  previousState = null;
  adObservations = undefined;
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
    lastTransition: null,
    adObservations: emptyAdObservationSnapshot()
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
    lastTransition: snapshot.lastTransition,
    adObservations: snapshot.adObservations
  };
}

function errorDetails(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}
