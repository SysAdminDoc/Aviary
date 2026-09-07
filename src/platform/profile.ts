import type { StorageGateway } from "./storage.ts";
import type { StorageLockFence } from "./storage-fence.ts";
import { mutateStored } from "./storage-lock.ts";
import { hashStorageValue } from "./storage-value-hash.ts";

export const PROFILE_REGISTRY_KEY = "aviary.profiles.v1";
export const ACTIVE_PROFILE_KEY = "aviary.profile.active.v1";
/** Install-wide journal for legacy profile adoption. It is never copied into a profile. */
export const PROFILE_MIGRATION_JOURNAL_KEY = "aviary.profile.migration.v1";

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

const MIGRATION_PHASES = [
  "copying",
  "destination-written",
  "completed",
  "conflicted",
  "failed"
] as const;

export type ProfileMigrationPhase = (typeof MIGRATION_PHASES)[number];

/** Durable receipt for one unscoped store being assigned to a profile. */
export interface ProfileMigrationEntry {
  sourceHash: string;
  destinationProfileId: string;
  phase: ProfileMigrationPhase;
  destinationHash?: string;
  updatedAt: string;
  error?: string;
}

export interface ProfileMigrationJournal {
  version: 1;
  entries: Record<string, ProfileMigrationEntry>;
}

export interface LegacyAdoptionResult {
  moved: number;
  skipped: number;
  completedAfterRetry: number;
  conflicted: number;
  failed: number;
}

interface ProfileState {
  profiles: ProfileRecord[];
}

type ProfileChange =
  | { kind: "add"; profile: ProfileRecord; defaultProfile?: ProfileRecord }
  | { kind: "update"; id: string; set: Partial<ProfileRecord> }
  | { kind: "clear" };

const EMPTY: ProfileState = { profiles: [] };
const EMPTY_MIGRATION_JOURNAL: ProfileMigrationJournal = { version: 1, entries: {} };

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

  /**
   * The unscoped gateway every profile is scoped from.
   *
   * A library backup has to read across profiles and carry the roster itself, and the roster keys
   * live here rather than inside any one profile. Features get the scoped gateway; this is the
   * install-wide one, and the profile manager is already its owner.
   */
  get baseStorage(): StorageGateway {
    return this.#base;
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
    // row and nothing on the timeline, while the walk covers every migration key -- most are
    // separate IndexedDB transactions -- and main.ts awaits this before a single feature initializes.
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
    const defaultProfile = this.#state.profiles.find((entry) => entry.id === DEFAULT_PROFILE_ID);
    await this.#persist({
      kind: "add",
      profile: { ...profile },
      ...(defaultProfile ? { defaultProfile: { ...defaultProfile } } : {})
    });
    return { ...profile };
  }

  async switchTo(profileId: string): Promise<boolean> {
    await this.load();
    const profile = this.#state.profiles.find((entry) => entry.id === profileId);
    if (!profile) return false;
    this.#activeId = profile.id;
    const lastUsedAt = new Date().toISOString();
    profile.lastUsedAt = lastUsedAt;
    await mutateStored<string | null>(this.#base, ACTIVE_PROFILE_KEY, null, () => this.#activeId);
    await this.#persist({ kind: "update", id: profile.id, set: { lastUsedAt } });
    return true;
  }

  async adoptLegacyIntoActive(): Promise<LegacyAdoptionResult> {
    await this.load();
    const scoped = createProfileStorageGateway(this.#base, this.#activeId);
    const journal = await this.#readMigrationJournal();
    const result: LegacyAdoptionResult = {
      moved: 0,
      skipped: 0,
      completedAfterRetry: 0,
      conflicted: 0,
      failed: 0
    };

    for (const key of PROFILE_MIGRATION_KEYS) {
      let sourceHash: string | undefined;
      let destinationHash: string | undefined;
      let destinationWritten = false;
      let sourceRemoved = false;
      let conflictDetected = false;
      let lastEntry: ProfileMigrationEntry | undefined;

      const save = async (entry: ProfileMigrationEntry): Promise<void> => {
        await this.#persistMigrationEntry(key, entry);
        journal.entries[key] = entry;
        lastEntry = entry;
      };

      try {
        const prior = journal.entries[key];
        const legacy = await this.#base.get<unknown>(key, undefined);

        // A prior destination-written receipt with no source means a previous attempt did remove
        // the source but was interrupted before it could write the completed receipt. Verify the
        // destination before closing that receipt. The original profile may no longer be active.
        if (legacy === undefined) {
          if (prior && prior.phase !== "completed") {
            const priorScoped = createProfileStorageGateway(this.#base, prior.destinationProfileId);
            const priorDestination = await priorScoped.get<unknown>(key, undefined);
            if (priorDestination !== undefined) {
              destinationHash = await hashStorageValue(priorDestination);
              if (destinationHash === prior.sourceHash) {
                await save({
                  ...prior,
                  phase: "completed",
                  destinationHash,
                  updatedAt: new Date().toISOString()
                });
                result.completedAfterRetry += 1;
              } else {
                await save({
                  ...prior,
                  phase: "conflicted",
                  destinationHash,
                  updatedAt: new Date().toISOString(),
                  error: "The destination changed before the migration receipt was completed."
                });
                result.conflicted += 1;
              }
            }
          }
          continue;
        }

        sourceHash = await hashStorageValue(legacy);
        const retry =
          prior?.destinationProfileId === this.#activeId &&
          prior.sourceHash === sourceHash &&
          prior.phase !== "completed";
        await save({
          sourceHash,
          destinationProfileId: this.#activeId,
          phase: "copying",
          updatedAt: new Date().toISOString()
        });
        let destinationWasPresent = false;
        const destination = await mutateStored<unknown>(
          scoped,
          key,
          undefined,
          (current) => {
            destinationWasPresent = current !== undefined;
            return current === undefined ? legacy : current;
          }
        );
        destinationWritten = true;
        if (destination === undefined) {
          conflictDetected = true;
          await save({
            sourceHash,
            destinationProfileId: this.#activeId,
            phase: "conflicted",
            updatedAt: new Date().toISOString(),
            error: "The destination could not be verified after it was written."
          });
          result.conflicted += 1;
          continue;
        }
        destinationHash = await hashStorageValue(destination);
        if (destinationHash !== sourceHash) {
          conflictDetected = true;
          await save({
            sourceHash,
            destinationProfileId: this.#activeId,
            phase: "conflicted",
            destinationHash,
            updatedAt: new Date().toISOString(),
            error: "The destination changed before the source could be retired."
          });
          result.conflicted += 1;
          continue;
        }
        // Re-read immediately before retiring the source. The atomic ensure above prevents this
        // tab from overwriting a concurrent destination, and this final check avoids deleting a
        // source if another writer changed that matching value while the receipt was being saved.
        const latestDestination = await scoped.get<unknown>(key, undefined);
        if (latestDestination === undefined) {
          conflictDetected = true;
          await save({
            sourceHash,
            destinationProfileId: this.#activeId,
            phase: "conflicted",
            destinationHash,
            updatedAt: new Date().toISOString(),
            error: "The destination disappeared before the source could be retired."
          });
          result.conflicted += 1;
          continue;
        }
        destinationHash = await hashStorageValue(latestDestination);
        if (destinationHash !== sourceHash) {
          conflictDetected = true;
          await save({
            sourceHash,
            destinationProfileId: this.#activeId,
            phase: "conflicted",
            destinationHash,
            updatedAt: new Date().toISOString(),
            error: "The destination changed before the source could be retired."
          });
          result.conflicted += 1;
          continue;
        }
        await save({
          sourceHash,
          destinationProfileId: this.#activeId,
          phase: "destination-written",
          destinationHash,
          updatedAt: new Date().toISOString()
        });
        await this.#base.remove(key);
        sourceRemoved = true;
        if (retry) result.completedAfterRetry += 1;
        else if (destinationWasPresent) result.skipped += 1;
        else result.moved += 1;
        await save({
          sourceHash,
          destinationProfileId: this.#activeId,
          phase: "completed",
          destinationHash,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        // A source deletion failure must retain destination-written, not overwrite it with a
        // generic failed phase. That receipt is what makes the next run converge without copying
        // again. If the source was already removed, the data move succeeded even if the final
        // journal write was interrupted, so do not report a false failed count.
        if (!sourceRemoved) result.failed += 1;
        if (sourceHash && !sourceRemoved) {
          try {
            await save({
              sourceHash,
              destinationProfileId: this.#activeId,
              phase: conflictDetected ? "conflicted" : destinationWritten ? "destination-written" : "failed",
              ...(destinationHash ? { destinationHash } : {}),
              updatedAt: new Date().toISOString(),
              error: migrationError(error)
            });
          } catch {
            // The journal is best effort here. The source remains untouched, so a later run can
            // still compare it with any destination value before making another change.
          }
        } else if (!sourceRemoved && lastEntry && lastEntry.phase !== "completed") {
          try {
            await save({
              ...lastEntry,
              phase: "failed",
              updatedAt: new Date().toISOString(),
              error: migrationError(error)
            });
          } catch {
            // Preserve the original failure while leaving the data in place for a future retry.
          }
        }
      }
    }
    this.#legacySweep = this.#refreshLegacyAvailability();
    await this.#legacySweep;
    return result;
  }

  async #readMigrationJournal(): Promise<ProfileMigrationJournal> {
    return normalizeMigrationJournal(
      await this.#base.get<ProfileMigrationJournal>(PROFILE_MIGRATION_JOURNAL_KEY, EMPTY_MIGRATION_JOURNAL)
    );
  }

  async #persistMigrationEntry(key: string, entry: ProfileMigrationEntry): Promise<void> {
    await mutateStored<ProfileMigrationJournal>(
      this.#base,
      PROFILE_MIGRATION_JOURNAL_KEY,
      EMPTY_MIGRATION_JOURNAL,
      (stored) => {
        const journal = normalizeMigrationJournal(stored);
        journal.entries[key] = { ...entry };
        return journal;
      }
    );
  }

  /**
   * One round of reads rather than one serial transaction per migration key.
   *
   * The old loop returned on the first hit, which sounds cheaper and is the opposite on the path
   * that matters: a fresh install has none of these keys, so it always ran the complete migration
   * list, one await at a time. Asking for them together lets the durable gateway overlap them, and the
   * early-exit saving it gives up only ever applied to installs that had legacy data anyway.
   */
  async hasLegacyData(): Promise<boolean> {
    const found = await Promise.all(
      PROFILE_MIGRATION_KEYS.map((key) => this.#base.get<unknown>(key, undefined))
    );
    return found.some((value) => value !== undefined);
  }

  async #persist(change: ProfileChange): Promise<void> {
    const next = await mutateStored<ProfileState>(
      this.#base,
      PROFILE_REGISTRY_KEY,
      EMPTY,
      (stored) => applyProfileChange(stored, change)
    );
    this.#state = normalizeState(next);
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
    set<T>(key: string, value: T, fence?: StorageLockFence): Promise<void> {
      return base.set(scoped(key), value, fence);
    },
    remove(key: string, fence?: StorageLockFence): Promise<void> {
      return base.remove(scoped(key), fence);
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

function normalizeMigrationJournal(value: unknown): ProfileMigrationJournal {
  if (!value || typeof value !== "object") return { version: 1, entries: {} };
  const raw = value as { entries?: unknown };
  if (!raw.entries || typeof raw.entries !== "object" || Array.isArray(raw.entries)) {
    return { version: 1, entries: {} };
  }
  const entries: Record<string, ProfileMigrationEntry> = {};
  const rawEntries = raw.entries as Record<string, unknown>;
  for (const key of PROFILE_MIGRATION_KEYS) {
    const entry = normalizeMigrationEntry(rawEntries[key]);
    if (entry) entries[key] = entry;
  }
  return { version: 1, entries };
}

function normalizeMigrationEntry(value: unknown): ProfileMigrationEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ProfileMigrationEntry>;
  if (
    typeof raw.sourceHash !== "string" ||
    raw.sourceHash.length === 0 ||
    typeof raw.destinationProfileId !== "string" ||
    raw.destinationProfileId.length === 0 ||
    typeof raw.phase !== "string" ||
    !MIGRATION_PHASES.includes(raw.phase as ProfileMigrationPhase)
  ) {
    return null;
  }
  const destinationProfileId = raw.destinationProfileId
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 80);
  if (!destinationProfileId) return null;
  const entry: ProfileMigrationEntry = {
    sourceHash: raw.sourceHash.slice(0, 128),
    destinationProfileId,
    phase: raw.phase as ProfileMigrationPhase,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString()
  };
  if (typeof raw.destinationHash === "string" && raw.destinationHash.length > 0) {
    entry.destinationHash = raw.destinationHash.slice(0, 128);
  }
  if (typeof raw.error === "string" && raw.error.length > 0) {
    entry.error = raw.error.slice(0, 240);
  }
  return entry;
}

function migrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240) || "Migration failed";
}

function applyProfileChange(value: unknown, change: ProfileChange): ProfileState {
  const state = normalizeState(value);
  if (change.kind === "clear") return { profiles: [] };
  const byId = new Map(state.profiles.map((profile) => [profile.id, { ...profile }]));
  if (change.kind === "add") {
    if (change.defaultProfile && !byId.has(DEFAULT_PROFILE_ID)) {
      byId.set(DEFAULT_PROFILE_ID, { ...change.defaultProfile });
    }
    byId.set(change.profile.id, { ...change.profile });
  } else {
    const current = byId.get(change.id);
    // A stale update must not recreate a profile that another tab removed or cleared.
    if (current) byId.set(change.id, { ...current, ...change.set });
  }
  return { profiles: [...byId.values()] };
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
