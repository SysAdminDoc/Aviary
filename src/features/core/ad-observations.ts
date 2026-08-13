import type { RouteSurface } from "../../platform/route";
import type { StorageGateway } from "../../platform/storage";
import type { AdMarkerCounts } from "../privacy/ad-protection";

export const AD_OBSERVATIONS_KEY = "aviary.adObservations.v1";
export const AD_OBSERVATION_LIMIT = 64;
export const AD_OBSERVATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AD_OBSERVATION_REFRESH_MS = 15 * 60 * 1000;
const MAX_MARKER_COUNT = 10_000;

const ROUTES = new Set<RouteSurface>([
  "home",
  "status",
  "profile",
  "notifications",
  "messages",
  "settings",
  "search",
  "grok",
  "unknown"
]);

export type AdMarkerKind = keyof AdMarkerCounts;

export interface AdObservation {
  at: string;
  route: RouteSurface;
  counts: AdMarkerCounts;
}

export interface AdObservationSnapshot {
  lastObservedAt: string | null;
  lastRoute: RouteSurface | null;
  counts: AdMarkerCounts;
  retained: number;
  missingContracts: AdMarkerKind[];
  degradedReason: string | null;
}

interface StoredAdObservations {
  version: 1;
  observations: AdObservation[];
}

const MARKER_KINDS: AdMarkerKind[] = ["native", "trend", "housePromo", "video"];

/**
 * A deliberately tiny, content-free history of the ad marker contracts Aviary has seen.
 *
 * Normalization reconstructs every entry from an allow-list. Even if a future bug writes extra
 * fields, a subsequent load drops them instead of carrying post text, handles, URLs, or response
 * data forward. The ring and age cap also make retention independent of mutation volume.
 */
export class AdObservationStore {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  readonly #now: () => number;
  #observations: AdObservation[] = [];

  constructor(
    storage: StorageGateway,
    options: { limit?: number; now?: () => number } = {}
  ) {
    this.#storage = storage;
    this.#limit = Math.max(1, Math.min(AD_OBSERVATION_LIMIT, options.limit ?? AD_OBSERVATION_LIMIT));
    this.#now = options.now ?? Date.now;
  }

  async load(): Promise<void> {
    const stored = await this.#storage.get<unknown>(AD_OBSERVATIONS_KEY, {
      version: 1,
      observations: []
    });
    this.#observations = normalizeObservations(stored, this.#now(), this.#limit);
    const normalized: StoredAdObservations = {
      version: 1,
      observations: this.observations()
    };
    // Purge expired, malformed, or unexpected fields immediately. This is both retention
    // enforcement and a privacy boundary if an older or corrupted writer added content fields.
    if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
      await this.#storage.set(AD_OBSERVATIONS_KEY, normalized);
    }
  }

  async observe(route: RouteSurface, counts: AdMarkerCounts): Promise<AdObservationSnapshot> {
    const now = this.#now();
    const next: AdObservation = {
      at: new Date(now).toISOString(),
      route: ROUTES.has(route) ? route : "unknown",
      counts: normalizeCounts(counts)
    };
    const previous = this.#observations.at(-1);
    const sameSample = previous && sameObservation(previous, next);
    const previousAt = previous ? Date.parse(previous.at) : 0;

    if (!sameSample || !Number.isFinite(previousAt) || now - previousAt >= AD_OBSERVATION_REFRESH_MS) {
      this.#observations.push(next);
      this.#observations = trimObservations(this.#observations, now, this.#limit);
      await this.#persist();
    }

    return this.snapshot();
  }

  snapshot(): AdObservationSnapshot {
    const last = this.#observations.at(-1);
    if (!last) return emptyAdObservationSnapshot();

    const priorForRoute = this.#observations.slice(0, -1).filter((entry) => entry.route === last.route);
    const missingContracts = MARKER_KINDS.filter(
      (kind) => last.counts[kind] === 0 && priorForRoute.some((entry) => entry.counts[kind] > 0)
    );
    return {
      lastObservedAt: last.at,
      lastRoute: last.route,
      counts: { ...last.counts },
      retained: this.#observations.length,
      missingContracts,
      degradedReason: missingContracts.length > 0
        ? `Formerly observed ${missingContracts.join(", ")} ad markers are no longer detected on ${last.route}.`
        : null
    };
  }

  observations(): AdObservation[] {
    return this.#observations.map((entry) => ({
      ...entry,
      counts: { ...entry.counts }
    }));
  }

  async clear(): Promise<void> {
    this.#observations = [];
    await this.#storage.remove(AD_OBSERVATIONS_KEY);
  }

  async #persist(): Promise<void> {
    const payload: StoredAdObservations = {
      version: 1,
      observations: this.observations()
    };
    await this.#storage.set(AD_OBSERVATIONS_KEY, payload);
  }
}

export function emptyAdObservationSnapshot(): AdObservationSnapshot {
  return {
    lastObservedAt: null,
    lastRoute: null,
    counts: emptyCounts(),
    retained: 0,
    missingContracts: [],
    degradedReason: null
  };
}

function normalizeObservations(raw: unknown, now: number, limit: number): AdObservation[] {
  const source = isRecord(raw) && Array.isArray(raw.observations) ? raw.observations : [];
  const cutoff = now - AD_OBSERVATION_RETENTION_MS;
  const normalized: AdObservation[] = [];
  for (const candidate of source) {
    if (!isRecord(candidate) || typeof candidate.at !== "string") continue;
    const at = Date.parse(candidate.at);
    if (!Number.isFinite(at) || at < cutoff || at > now + 60_000) continue;
    const route = typeof candidate.route === "string" && ROUTES.has(candidate.route as RouteSurface)
      ? candidate.route as RouteSurface
      : "unknown";
    normalized.push({
      at: new Date(at).toISOString(),
      route,
      counts: normalizeCounts(candidate.counts)
    });
  }
  normalized.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return normalized.slice(-limit);
}

function trimObservations(observations: AdObservation[], now: number, limit: number): AdObservation[] {
  const cutoff = now - AD_OBSERVATION_RETENTION_MS;
  return observations
    .filter((entry) => Date.parse(entry.at) >= cutoff)
    .slice(-limit);
}

function normalizeCounts(raw: unknown): AdMarkerCounts {
  const value = isRecord(raw) ? raw : {};
  return {
    native: normalizeCount(value.native),
    trend: normalizeCount(value.trend),
    housePromo: normalizeCount(value.housePromo),
    video: normalizeCount(value.video)
  };
}

function normalizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_MARKER_COUNT, Math.trunc(value)));
}

function sameObservation(a: AdObservation, b: AdObservation): boolean {
  return a.route === b.route && MARKER_KINDS.every((kind) => a.counts[kind] === b.counts[kind]);
}

function emptyCounts(): AdMarkerCounts {
  return { native: 0, trend: 0, housePromo: 0, video: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
