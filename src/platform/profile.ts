import type { StorageGateway } from "./storage.ts";

export const PROFILE_REGISTRY_KEY = "aviary.profiles.v1";
export const ACTIVE_PROFILE_KEY = "aviary.profile.active.v1";

/** Stores that contained account-specific data before profile isolation was introduced. */
export const PROFILE_MIGRATION_KEYS = [
  "aviary.settings.v1",
  "aviary.integration.usage.v1",
  "aviary.export.checkpoints.v1",
  "aviary.queryIds.v1",
  "aviary.media.history.v1",
  "aviary.media.queue.v1",
  "aviary.aria2.history.v1",
  "aviary.hiddenPosts.v1",
  "aviary.seenPosts.v1",
  "aviary.readingMarkers.v1",
  "aviary.catchUp.v1",
  "aviary.media.last-download.v1",
  "aviary.cleanupQueue.v1",
  "aviary.userNotes.v1",
  "aviary.audit.v1",
  "aviary.firstRun.v1",
  "aviary.diagnostics.v1",
  "aviary.adObservations.v1",
  "aviary.library.bookmarks.v1",
  "aviary.snapshots.v1",
  "aviary.library.underTheHood.v1",
  "aviary.semanticIndex.v1",
  "aviary.archive.imports.v1",
  "aviary.archive.library.v1",
  "aviary.waczSigning.v1",
  "aviary.retention.maxJobs",
  "aviary.retention.maxRecordsPerJob",
  "aviary.retention.maxAgeDays"
] as const;

/** The profile every install starts in, before the user creates a named one. */
export const DEFAULT_PROFILE_ID = "offline-default";

/** `crypto.randomUUID` where the host has it; a bounded random fallback where it does not. */
function randomId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid;
  }
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ProfileRecord {
  id: string;
  label: string;
  kind: "offline" | "x-account";
  createdAt: string;
  lastUsedAt: string;
}

export interface ProfileStatus {
  activeId: string;
  activeLabel: string;
  profiles: ProfileRecord[];
  legacyDataAvailable: boolean;
}

interface ProfileState {
  profiles: ProfileRecord[];
}

const EMPTY: ProfileState = { profiles: [] };

export class ProfileManager {
  readonly #base: StorageGateway;
  #state: ProfileState = EMPTY;
  #activeId = DEFAULT_PROFILE_ID;
  #legacyDataAvailable = false;
  #legacySweep: Promise<void> = Promise.resolve();
  #loaded = false;

  constructor(base: StorageGateway) {
    this.#base = base;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#state = normalizeState(await this.#base.get<ProfileState>(PROFILE_REGISTRY_KEY, EMPTY));
    const active = await this.#base.get<string | null>(ACTIVE_PROFILE_KEY, null);
    if (typeof active === "string" && this.#state.profiles.some((profile) => profile.id === active)) {
      this.#activeId = active;
    }
    if (!this.#state.profiles.some((profile) => profile.id === this.#activeId)) {
      this.#state.profiles.unshift({
        id: DEFAULT_PROFILE_ID,
        label: "Offline library",
        kind: "offline",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      });
    }
    this.#loaded = true;
    // Deferred to a later task, not merely left unawaited. The answer drives one optional panel
    // row and nothing on the timeline, while the walk is 28 storage reads -- 25 of them separate
    // IndexedDB transactions -- and main.ts awaits this before a single feature initializes.
    // Issuing the reads in this task would still put them in front of the first paint even if
    // nothing waited for the results.
    this.#legacySweep = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.#refreshLegacyAvailability().then(resolve, resolve);
      }, 0);
    });
  }

  /**
   * Whether a pre-profile install left data outside the active profile.
   *
   * Awaitable so a caller that genuinely needs the answer -- a test, or a panel that wants to be
   * sure -- can wait for it rather than reading a value that has not been computed yet. Boot does
   * not wait, because it does not need to.
   */
  async legacyDataSettled(): Promise<boolean> {
    await this.#legacySweep;
    return this.#legacyDataAvailable;
  }

  async #refreshLegacyAvailability(): Promise<void> {
    this.#legacyDataAvailable = await this.hasLegacyData();
  }

  get activeId(): string {
    return this.#activeId;
  }

  status(): ProfileStatus {
    const active = this.#state.profiles.find((profile) => profile.id === this.#activeId);
    return {
      activeId: this.#activeId,
      activeLabel: active?.label ?? this.#activeId,
      profiles: this.#state.profiles.map((profile) => ({ ...profile })),
      legacyDataAvailable: this.#legacyDataAvailable
    };
  }

  async create(label: string, kind: ProfileRecord["kind"] = "offline"): Promise<ProfileRecord> {
    await this.load();
    const cleanLabel = label.trim().slice(0, 80) || "Offline library";
    const now = new Date().toISOString();
    const profile: ProfileRecord = {
      // `Date.now()` plus a count is the collision pattern already fixed once in bookmarks:
      // two profiles created in the same millisecond after a deletion can collide.
      id: `${kind === "x-account" ? "account" : "offline"}-${randomId()}`,
      label: cleanLabel,
      kind,
      createdAt: now,
      lastUsedAt: now
    };
    this.#state.profiles.push(profile);
    await this.#persist();
    return { ...profile };
  }

  async switchTo(profileId: string): Promise<boolean> {
    await this.load();
    const profile = this.#state.profiles.find((entry) => entry.id === profileId);
    if (!profile) return false;
    this.#activeId = profile.id;
    profile.lastUsedAt = new Date().toISOString();
    await this.#base.set(ACTIVE_PROFILE_KEY, this.#activeId);
    await this.#persist();
    return true;
  }

  async adoptLegacyIntoActive(): Promise<{ moved: number; skipped: number }> {
    await this.load();
    const scoped = createProfileStorageGateway(this.#base, this.#activeId);
    let moved = 0;
    let skipped = 0;
    for (const key of PROFILE_MIGRATION_KEYS) {
      const legacy = await this.#base.get<unknown>(key, undefined);
      if (legacy === undefined) continue;
      const existing = await scoped.get<unknown>(key, undefined);
      if (existing !== undefined) {
        skipped += 1;
        continue;
      }
      await scoped.set(key, legacy);
      await this.#base.remove(key);
      moved += 1;
    }
    this.#legacySweep = this.#refreshLegacyAvailability();
    await this.#legacySweep;
    return { moved, skipped };
  }

  /**
   * One round of reads rather than 28 in series.
   *
   * The old loop returned on the first hit, which sounds cheaper and is the opposite on the path
   * that matters: a fresh install has none of these keys, so it always ran all 28 to completion,
   * one await at a time. Asking for them together lets the durable gateway overlap them, and the
   * early-exit saving it gives up only ever applied to installs that had legacy data anyway.
   */
  async hasLegacyData(): Promise<boolean> {
    const found = await Promise.all(
      PROFILE_MIGRATION_KEYS.map((key) => this.#base.get<unknown>(key, undefined))
    );
    return found.some((value) => value !== undefined);
  }

  async #persist(): Promise<void> {
    await this.#base.set(PROFILE_REGISTRY_KEY, this.#state);
  }
}

export function createProfileStorageGateway(base: StorageGateway, profileId: string): StorageGateway {
  const safeId = profileId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80) || DEFAULT_PROFILE_ID;
  const prefix = `aviary.profile.${safeId}`;
  const scoped = (key: string): string =>
    key.startsWith("aviary.") ? `${prefix}.${key.slice("aviary.".length)}` : `${prefix}.${key}`;
  return {
    get<T>(key: string, fallback: T): Promise<T> {
      return base.get(scoped(key), fallback);
    },
    set<T>(key: string, value: T): Promise<void> {
      return base.set(scoped(key), value);
    },
    remove(key: string): Promise<void> {
      return base.remove(scoped(key));
    },
    getStatus(): ReturnType<NonNullable<StorageGateway["getStatus"]>> {
      return base.getStatus?.() ?? {
        backend: "legacy",
        schemaVersion: 0,
        migratedKeys: 0,
        usageBytes: null,
        quotaBytes: null,
        persistence: "unknown",
        pendingWrites: 0,
        lastError: null
      };
    }
  };
}

function normalizeState(value: unknown): ProfileState {
  if (!value || typeof value !== "object") return { profiles: [] };
  const raw = value as Partial<ProfileState>;
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map(normalizeProfile).filter((profile): profile is ProfileRecord => profile !== null)
    : [];
  const unique = new Map(profiles.map((profile) => [profile.id, profile]));
  return { profiles: [...unique.values()] };
}

function normalizeProfile(value: unknown): ProfileRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ProfileRecord>;
  if (typeof raw.id !== "string" || raw.id.length === 0 || typeof raw.label !== "string") return null;
  const kind = raw.kind === "x-account" ? "x-account" : "offline";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  return {
    id: raw.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80),
    label: raw.label.trim().slice(0, 80) || "Offline library",
    kind,
    createdAt,
    lastUsedAt: typeof raw.lastUsedAt === "string" ? raw.lastUsedAt : createdAt
  };
}
