import { withExclusiveStorageGate } from "../../platform/storage-lock.ts";
import { ARIA2_HISTORY_KEY } from "../integrations/aria2.ts";
import { SEMANTIC_INDEX_KEY } from "../integrations/semantic-search.ts";
import { INTEGRATION_USAGE_KEY } from "../integrations/usage.ts";
import { ARCHIVE_IMPORT_JOBS_KEY } from "../library/archive-import-jobs.ts";
import { ARCHIVE_LIBRARY_KEY } from "../library/archive-library.ts";
import { CLEANUP_QUEUE_KEY } from "../library/cleanup-queue.ts";
import { BOOKMARKS_KEY } from "../library/bookmarks.ts";
import { SNAPSHOTS_KEY } from "../library/snapshots.ts";
import { USER_NOTES_KEY } from "../library/user-notes.ts";
import { UNDER_THE_HOOD_KEY } from "../library/under-the-hood.ts";
import { AUDIT_LOG_KEY } from "./audit-log.ts";
import { CHECKPOINT_KEY, RETENTION_KEYS } from "../export/jobs.ts";
import { QUERY_REGISTRY_KEY } from "../export/query-discovery.ts";
import { MEDIA_HISTORY_KEY } from "../media/history.ts";
import { MEDIA_QUEUE_KEY } from "../media/queue.ts";
import { LAST_DOWNLOAD_KEY } from "../media/last-download.ts";
import { HIDDEN_POSTS_KEY } from "../filtering/hidden-posts.ts";
import { READING_MARKERS_KEY, SEEN_POSTS_KEY } from "../filtering/seen-posts.ts";
import { CATCH_UP_KEY } from "../filtering/catch-up.ts";
import {
  buildSettingsExport,
  parseSettingsImport
} from "./settings-migration.ts";
import { normalizeSettings, SETTINGS_KEY } from "../../platform/settings.ts";
import {
  ACTIVE_PROFILE_KEY,
  createProfileStorageGateway,
  PROFILE_REGISTRY_KEY
} from "../../platform/profile.ts";
import type { StorageGateway } from "../../platform/storage.ts";
import { WACZ_SIGNING_KEY } from "../export/wacz-signing.ts";
import { sha256Hex } from "../export/assets.ts";

/** Schema 1 and 2 remain readable; schema 3 covers the expanded profile roster envelope. */
export const LIBRARY_BACKUP_SCHEMA_VERSION = 3;
export const SUPPORTED_LIBRARY_BACKUP_SCHEMAS = [1, 2, 3] as const;
export const LIBRARY_BACKUP_COLLECTION_VERSION = 1;
export const MAX_LIBRARY_BACKUP_BYTES = 100 * 1024 * 1024;

const REDACTED_SETTINGS_PATHS = [
  "integrations.aria2.secret",
  "integrations.bluesky.appPassword",
  "integrations.mastodon.token",
  "integrations.ai.apiKey",
  "integrations.semanticSearch.apiKey"
] as const;

export interface LibraryBackupCollectionDefinition {
  readonly key: string;
  readonly label: string;
  readonly version: 1;
}

/**
 * The allow-list is deliberate. StorageGateway has no enumeration API, and a backup must never
 * sweep up a provider token or an implementation detail merely because another feature happened
 * to write a key. New durable stores belong here before they become part of the backup contract.
 */
export const LIBRARY_BACKUP_COLLECTIONS = [
  { key: SETTINGS_KEY, label: "Settings", version: 1 },
  { key: INTEGRATION_USAGE_KEY, label: "Integration usage counters", version: 1 },
  { key: CHECKPOINT_KEY, label: "Export jobs and records", version: 1 },
  { key: QUERY_REGISTRY_KEY, label: "Discovered query IDs", version: 1 },
  { key: MEDIA_HISTORY_KEY, label: "Media history", version: 1 },
  { key: MEDIA_QUEUE_KEY, label: "Media queue", version: 1 },
  { key: ARIA2_HISTORY_KEY, label: "Aria2 history", version: 1 },
  { key: HIDDEN_POSTS_KEY, label: "Hidden posts", version: 1 },
  { key: SEEN_POSTS_KEY, label: "Seen posts", version: 1 },
  { key: READING_MARKERS_KEY, label: "Reading markers", version: 1 },
  { key: CATCH_UP_KEY, label: "Catch-up records", version: 1 },
  { key: LAST_DOWNLOAD_KEY, label: "Last download", version: 1 },
  { key: CLEANUP_QUEUE_KEY, label: "Cleanup queue", version: 1 },
  { key: USER_NOTES_KEY, label: "User notes", version: 1 },
  { key: AUDIT_LOG_KEY, label: "Audit log", version: 1 },
  { key: BOOKMARKS_KEY, label: "Bookmarks", version: 1 },
  { key: SNAPSHOTS_KEY, label: "Snapshots", version: 1 },
  { key: UNDER_THE_HOOD_KEY, label: "Under the Hood reports", version: 1 },
  { key: SEMANTIC_INDEX_KEY, label: "Semantic index", version: 1 },
  { key: ARCHIVE_IMPORT_JOBS_KEY, label: "Archive import jobs", version: 1 },
  { key: ARCHIVE_LIBRARY_KEY, label: "Archive library", version: 1 },
  { key: RETENTION_KEYS.maxJobs, label: "Job retention", version: 1 },
  { key: RETENTION_KEYS.maxRecordsPerJob, label: "Record retention", version: 1 },
  { key: RETENTION_KEYS.maxAgeDays, label: "Age retention", version: 1 },
  // The signing identity is a credential, so it travels only when the user opts in. Leaving it out
  // of the set entirely was the older behaviour, and it meant a restored install silently minted a
  // new keypair: every package signed before the restore stopped being attributable to the same
  // fingerprint, with nothing said about it.
  { key: WACZ_SIGNING_KEY, label: "WACZ signing identity", version: 1 }
] as const satisfies ReadonlyArray<LibraryBackupCollectionDefinition>;

/**
 * Stores that belong to the install rather than to any one profile.
 *
 * These are read through the unscoped base gateway. Without them a backup could carry three
 * profiles' collections and still restore into an install that had never heard of two of them.
 */
export const LIBRARY_BACKUP_GLOBAL_COLLECTIONS = [
  { key: PROFILE_REGISTRY_KEY, label: "Profiles", version: 1 },
  { key: ACTIVE_PROFILE_KEY, label: "Active profile", version: 1 }
] as const satisfies ReadonlyArray<LibraryBackupCollectionDefinition>;

/** Collections whose entire value is a credential, not merely a field inside one. */
const CREDENTIAL_COLLECTIONS = new Set<string>([WACZ_SIGNING_KEY]);

export type LibraryBackupKey =
  | (typeof LIBRARY_BACKUP_COLLECTIONS)[number]["key"]
  | (typeof LIBRARY_BACKUP_GLOBAL_COLLECTIONS)[number]["key"];

export interface LibraryBackupProfile {
  id: string;
  label: string;
}

export interface LibraryBackupCollection {
  key: LibraryBackupKey;
  /** Which profile this value belongs to; `null` for install-wide stores. */
  profileId: string | null;
  version: 1;
  present: boolean;
  count: number;
  byteLength: number;
  sha256: string;
  redactedPaths: string[];
  value?: unknown;
}

export interface LibraryBackupManifest {
  schemaVersion: 1 | 2 | 3;
  collectionCount: number;
  totalBytes: number;
  sha256: string;
}

export interface LibraryBackupEnvelope {
  generator: "Aviary";
  schemaVersion: 1 | 2 | 3;
  createdAt: string;
  profile: LibraryBackupProfile | null;
  /** Every profile the backup carries. Empty on a schema 1 backup, which held only one. */
  profiles: LibraryBackupProfile[];
  activeProfileId: string | null;
  includeCredentials: boolean;
  collections: LibraryBackupCollection[];
  manifest: LibraryBackupManifest;
}

export interface LibraryBackupArtifact {
  filename: string;
  contentType: "application/json";
  data: Uint8Array;
  collections: number;
  bytes: number;
}

export interface LibraryBackupBuildOptions {
  profile?: LibraryBackupProfile | null;
  includeCredentials?: boolean;
  selectedKeys?: readonly string[];
  createdAt?: string;
  /**
   * Every profile to back up. Omitted means "whatever gateway you handed me, as one profile",
   * which is what a single-profile install and every existing caller-supplied gateway looks like.
   */
  profiles?: readonly LibraryBackupProfile[];
  activeProfileId?: string | null;
}

export type LibraryBackupConflict = "add" | "replace" | "remove" | "unchanged";

export interface LibraryBackupPreviewCollection {
  key: LibraryBackupKey;
  profileId: string | null;
  label: string;
  version: 1;
  present: boolean;
  count: number;
  byteLength: number;
  conflict: LibraryBackupConflict;
  currentPresent: boolean;
  currentCount: number;
  currentByteLength: number;
}

export interface LibraryBackupPreview {
  schemaVersion: 1 | 2 | 3;
  createdAt: string;
  profile: LibraryBackupProfile | null;
  includeCredentials: boolean;
  credentialsRedacted: boolean;
  totalBytes: number;
  collections: LibraryBackupPreviewCollection[];
  /** Every profile the backup will write, so the preview can name them before it runs. */
  profiles: LibraryBackupProfile[];
  /** Collections present in the backup that this build will not write, and why. */
  skipped: Array<{ key: string; profileId: string | null; reason: string }>;
  conflictCount: number;
  warnings: string[];
}

export interface LibraryBackupRestoreOptions {
  dryRun?: boolean;
  selectedKeys?: readonly string[];
  signal?: AbortSignal;
  profileId?: string;
  /**
   * Permission to overwrite an existing WACZ signing identity with a different one.
   *
   * Replacing it silently would mean every package this install signed before the restore stops
   * verifying against the fingerprint it now holds, with nothing said. The restore refuses instead
   * and reports the two fingerprints, so the choice is made rather than discovered later.
   */
  replaceSigningIdentity?: boolean;
}

export interface LibraryBackupRestoreResult {
  applied: boolean;
  dryRun: boolean;
  cancelled: boolean;
  rolledBack: boolean;
  restoredKeys: LibraryBackupKey[];
  warnings: string[];
  errors: string[];
  rollbackErrors: string[];
  preview: LibraryBackupPreview;
}

export class LibraryBackupError extends Error {
  readonly code: "invalid" | "too-large" | "unsupported" | "checksum";

  constructor(
    message: string,
    code: "invalid" | "too-large" | "unsupported" | "checksum" = "invalid"
  ) {
    super(message);
    this.name = "LibraryBackupError";
    this.code = code;
  }
}

export async function createLibraryBackup(
  storage: StorageGateway,
  options: LibraryBackupBuildOptions = {}
): Promise<{ envelope: LibraryBackupEnvelope; artifact: LibraryBackupArtifact }> {
  const includeCredentials = options.includeCredentials === true;
  const definitions = selectedDefinitions(options.selectedKeys);
  const collections: LibraryBackupCollection[] = [];
  const profiles = [...(options.profiles ?? [])];

  // Install-wide stores first, read through the gateway exactly as given. A profile roster that
  // lived only in the active profile's scope would restore into an install that had never heard
  // of the other profiles it carries.
  if (profiles.length > 0) {
    for (const definition of selectedGlobalDefinitions(options.selectedKeys)) {
      const current = await storage.get<unknown>(definition.key, undefined);
      collections.push(makeCollection(definition.key, current, includeCredentials, null));
    }
  }

  // No profile list means the caller handed us the gateway it wants read, which is how every
  // single-profile install and every existing test drives this.
  const scopes: Array<{ id: string | null; gateway: StorageGateway }> = profiles.length > 0
    ? profiles.map((profile) => ({
      id: profile.id,
      gateway: createProfileStorageGateway(storage, profile.id)
    }))
    : [{ id: null, gateway: storage }];

  for (const scope of scopes) {
    for (const definition of definitions) {
      const current = await scope.gateway.get<unknown>(definition.key, undefined);
      collections.push(makeCollection(definition.key, current, includeCredentials, scope.id));
    }
  }

  const envelope = makeEnvelope(collections, {
    createdAt: options.createdAt ?? new Date().toISOString(),
    includeCredentials,
    profile: normalizeProfile(options.profile),
    profiles: profiles.map((profile) => normalizeProfile(profile)).filter((profile) => profile !== null),
    activeProfileId: typeof options.activeProfileId === "string" ? options.activeProfileId : null
  });
  const text = JSON.stringify(envelope, null, 2);
  const data = new TextEncoder().encode(text);
  // The parser's limit applies to the complete UTF-8 envelope, not only to collection payloads.
  // Count the already encoded final artifact so multibyte values, profile metadata, checksums, and
  // JSON punctuation all contribute without allocating a second copy of the backup.
  assertBackupEnvelopeSize(data.byteLength);
  const artifact = {
    filename: backupFilename(envelope.createdAt),
    contentType: "application/json" as const,
    data,
    collections: collections.length,
    bytes: data.byteLength
  };
  // Recheck the exact bytes handed to the download layer after the artifact shape is complete.
  assertBackupEnvelopeSize(artifact.data.byteLength);
  return {
    envelope,
    artifact
  };
}

export function parseLibraryBackup(payload: string | Uint8Array): LibraryBackupEnvelope {
  const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
  if (new TextEncoder().encode(text).byteLength > MAX_LIBRARY_BACKUP_BYTES) {
    throw new LibraryBackupError(
      `Backup exceeds the ${Math.round(MAX_LIBRARY_BACKUP_BYTES / (1024 * 1024))} MiB limit.`,
      "too-large"
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new LibraryBackupError(`Invalid backup JSON: ${errorMessage(error)}`);
  }
  if (!isRecord(raw)) {
    throw new LibraryBackupError("Backup top-level value must be an object.");
  }
  if (raw.generator !== "Aviary") {
    throw new LibraryBackupError("Backup generator is not Aviary.", "unsupported");
  }
  const schemaVersion = SUPPORTED_LIBRARY_BACKUP_SCHEMAS.find((known) => known === raw.schemaVersion);
  if (schemaVersion === undefined) {
    throw new LibraryBackupError(
      `Backup schema ${String(raw.schemaVersion)} is not supported (expected ${SUPPORTED_LIBRARY_BACKUP_SCHEMAS.join(" or ")}).`,
      "unsupported"
    );
  }
  if (typeof raw.createdAt !== "string" || raw.createdAt.length === 0) {
    throw new LibraryBackupError("Backup is missing its creation time.");
  }
  if (typeof raw.includeCredentials !== "boolean") {
    throw new LibraryBackupError("Backup credential policy is invalid.");
  }

  const profile = parseProfile(raw.profile);
  if (!Array.isArray(raw.collections)) {
    throw new LibraryBackupError("Backup collections must be an array.");
  }
  const seen = new Set<string>();
  const collections: LibraryBackupCollection[] = [];
  for (const candidate of raw.collections) {
    if (!isRecord(candidate)) {
      throw new LibraryBackupError("Backup contains an invalid collection entry.");
    }
    const definition = definitionFor(candidate.key);
    if (!definition) {
      throw new LibraryBackupError(`Backup collection '${String(candidate.key)}' is not supported.`, "unsupported");
    }
    const profileId = candidate.profileId === undefined || candidate.profileId === null
      ? null
      : nonEmptyString(candidate.profileId, `Collection '${definition.key}' profile`);
    // A key repeated under two profiles is two collections, not a duplicate. Only the pair is
    // unique, which is what a multi-profile backup means.
    const identity = `${profileId ?? ""}::${definition.key}`;
    if (seen.has(identity)) {
      throw new LibraryBackupError(
        `Backup contains duplicate collection '${definition.key}'${profileId ? ` for profile '${profileId}'` : ""}.`
      );
    }
    seen.add(identity);
    if (candidate.version !== LIBRARY_BACKUP_COLLECTION_VERSION) {
      throw new LibraryBackupError(
        `Collection '${definition.key}' uses unsupported version ${String(candidate.version)}.`,
        "unsupported"
      );
    }
    const present = candidate.present === true;
    const count = nonNegativeInteger(candidate.count, `Collection '${definition.key}' count`);
    const byteLength = nonNegativeInteger(candidate.byteLength, `Collection '${definition.key}' byte length`);
    if (byteLength > MAX_LIBRARY_BACKUP_BYTES) {
      throw new LibraryBackupError(`Collection '${definition.key}' is too large.`, "too-large");
    }
    const sha256 = validChecksum(candidate.sha256, `Collection '${definition.key}' checksum`);
    const redactedPaths = parseRedactedPaths(candidate.redactedPaths, definition.key);
    let value: unknown;
    if (present) {
      if (!("value" in candidate)) {
        throw new LibraryBackupError(`Collection '${definition.key}' is marked present without a value.`);
      }
      try {
        value = deserializeBackupValue(JSON.stringify(candidate.value));
      } catch (error) {
        throw new LibraryBackupError(`Collection '${definition.key}' has an invalid value: ${errorMessage(error)}`);
      }
      verifyCollectionChecksum(definition.key, value, byteLength, sha256);
    } else {
      if (count !== 0 || byteLength !== 0) {
        throw new LibraryBackupError(`Empty collection '${definition.key}' has non-empty metadata.`);
      }
      if (sha256 !== sha256Hex(new Uint8Array())) {
        throw new LibraryBackupError(`Empty collection '${definition.key}' has an invalid checksum.`, "checksum");
      }
    }
    collections.push({
      key: definition.key as LibraryBackupKey,
      profileId,
      version: 1,
      present,
      count,
      byteLength,
      sha256,
      redactedPaths,
      ...(present ? { value } : {})
    });
  }

  const manifest = parseManifest(raw.manifest);
  if (manifest.schemaVersion !== schemaVersion) {
    throw new LibraryBackupError(
      "Backup envelope and manifest schema versions do not match.",
      "checksum"
    );
  }
  const expectedTotal = collections.reduce((total, collection) => total + collection.byteLength, 0);
  if (manifest.collectionCount !== collections.length || manifest.totalBytes !== expectedTotal) {
    throw new LibraryBackupError("Backup manifest totals do not match its collections.", "checksum");
  }
  // Schema 2 already carried the profile roster, but its historical checksum did not cover it.
  // Schema 3 keeps that shape and covers the roster and active pointer in the new formula. Schema 1
  // predates the roster entirely, so fields with those names are ignored for its legacy semantics.
  const profiles = schemaVersion >= 2 ? parseProfiles(raw.profiles) : [];
  const activeProfileId = schemaVersion >= 2 && typeof raw.activeProfileId === "string"
    ? raw.activeProfileId
    : null;
  const expectedManifestChecksum = manifestChecksum({
    createdAt: raw.createdAt,
    includeCredentials: raw.includeCredentials,
    profile,
    collections,
    schemaVersion,
    profiles,
    activeProfileId
  });
  if (manifest.sha256 !== expectedManifestChecksum) {
    throw new LibraryBackupError("Backup manifest checksum does not match its collections.", "checksum");
  }

  return {
    generator: "Aviary",
    schemaVersion,
    createdAt: raw.createdAt,
    profile,
    profiles,
    activeProfileId,
    includeCredentials: raw.includeCredentials,
    collections,
    manifest
  };
}

export async function previewLibraryRestore(
  storage: StorageGateway,
  payload: string | Uint8Array,
  options: Pick<LibraryBackupRestoreOptions, "profileId"> = {}
): Promise<LibraryBackupPreview> {
  const backup = parseLibraryBackup(payload);
  const collections: LibraryBackupPreviewCollection[] = [];
  const fallbackProfileId = backup.schemaVersion === 1 ? options.profileId ?? null : null;
  const skipped: LibraryBackupPreview["skipped"] = [];
  for (const collection of backup.collections) {
    const scoped = collectionGateway(storage, collection, fallbackProfileId);
    const current = await scoped.get<unknown>(collection.key, undefined);
    const currentCollection = makeCollection(collection.key, current, true, collection.profileId);
    if (!collection.present && CREDENTIAL_COLLECTIONS.has(collection.key)) {
      // Withheld or never held. Either way, writing "not present" over a live credential would
      // delete it, so this is reported as skipped rather than compared as a conflict.
      skipped.push({
        key: collection.key,
        profileId: collection.profileId,
        reason: collection.redactedPaths.includes(collection.key)
          ? "Withheld from the backup as a credential; the value already saved is kept."
          : "The backup carries no value for this credential; the value already saved is kept."
      });
      continue;
    }
    const conflict = compareCollections(collection, currentCollection);
    const definition = definitionFor(collection.key)!;
    collections.push({
      key: collection.key,
      profileId: collection.profileId,
      label: definition.label,
      version: collection.version,
      present: collection.present,
      count: collection.count,
      byteLength: collection.byteLength,
      conflict,
      currentPresent: currentCollection.present,
      currentCount: currentCollection.count,
      currentByteLength: currentCollection.byteLength
    });
  }

  const warnings: string[] = [];
  if (backup.profile?.id && options.profileId && backup.profile.id !== options.profileId) {
    warnings.push(`Backup profile '${backup.profile.id}' differs from the active profile '${options.profileId}'.`);
  }
  if (!backup.includeCredentials && backup.collections.some((collection) => collection.redactedPaths.length > 0)) {
    warnings.push("Credentials are redacted; the values already saved in this profile will be kept.");
  }
  for (const collection of backup.collections) {
    if (collection.key !== WACZ_SIGNING_KEY || !collection.present) continue;
    const scoped = collectionGateway(storage, collection, fallbackProfileId);
    const current = await scoped.get<unknown>(WACZ_SIGNING_KEY, undefined);
    const incoming = signingFingerprint(collection.value);
    const held = signingFingerprint(current);
    if (held && incoming && held !== incoming) {
      warnings.push(
        `This backup carries a different WACZ signing identity (${incoming.slice(0, 12)}) than the one saved here (${held.slice(0, 12)}). Packages already signed with the saved identity will not verify against the restored one.`
      );
    }
  }
  return {
    schemaVersion: backup.schemaVersion,
    createdAt: backup.createdAt,
    profile: backup.profile,
    includeCredentials: backup.includeCredentials,
    credentialsRedacted: backup.collections.some((collection) => collection.redactedPaths.length > 0),
    totalBytes: backup.manifest.totalBytes,
    collections,
    profiles: backup.profiles,
    skipped,
    conflictCount: collections.filter((collection) => collection.conflict !== "unchanged").length,
    warnings
  };
}

/**
 * Restores under one lock held across snapshot, write, and rollback.
 *
 * The window between reading each key's current value (kept for the rollback) and writing the
 * backup's value over it is where a second tab's ordinary save used to land: the snapshot then
 * holds a value that is no longer current, and a rollback restores the wrong thing. One lock over
 * the whole sequence is the only way the rollback can promise what it says.
 */
export async function restoreLibraryBackup(
  storage: StorageGateway,
  payload: string | Uint8Array,
  options: LibraryBackupRestoreOptions = {}
): Promise<LibraryBackupRestoreResult> {
  return withExclusiveStorageGate(() =>
    restoreLibraryBackupLocked(storage, payload, options)
  );
}

async function restoreLibraryBackupLocked(
  storage: StorageGateway,
  payload: string | Uint8Array,
  options: LibraryBackupRestoreOptions
): Promise<LibraryBackupRestoreResult> {
  const backup = parseLibraryBackup(payload);
  const preview = await previewLibraryRestore(
    storage,
    payload,
    options.profileId === undefined ? {} : { profileId: options.profileId }
  );
  const selected = selectedKeys(backup.collections, options.selectedKeys);
  const fallbackProfileId = backup.schemaVersion === 1 ? options.profileId ?? null : null;
  const entries = backup.collections.filter((collection) =>
    selected.has(collection.key) &&
    // A credential the backup does not carry is never an instruction to delete one. That covers
    // both a value withheld by redaction and one the source install simply never had.
    !(!collection.present && CREDENTIAL_COLLECTIONS.has(collection.key))
  );
  const dryRun = options.dryRun === true;
  if (!options.replaceSigningIdentity) {
    for (const entry of entries) {
      if (entry.key !== WACZ_SIGNING_KEY || !entry.present) continue;
      const gateway = collectionGateway(storage, entry, fallbackProfileId);
      const held = signingFingerprint(await gateway.get<unknown>(WACZ_SIGNING_KEY, undefined));
      const incoming = signingFingerprint(entry.value);
      if (held && incoming && held !== incoming) {
        return {
          applied: false,
          dryRun,
          cancelled: false,
          rolledBack: false,
          restoredKeys: [],
          warnings: [...preview.warnings],
          errors: [
            `This restore would replace the WACZ signing identity ${held.slice(0, 12)} with ${incoming.slice(0, 12)}. Choose to replace it explicitly, or deselect the signing identity to keep the one saved here.`
          ],
          rollbackErrors: [],
          preview
        };
      }
    }
  }
  const snapshot: Array<{
    key: LibraryBackupKey;
    value: unknown;
    scopeId: string | null;
    gateway: StorageGateway;
  }> = [];
  const warnings = [...preview.warnings];

  try {
    for (const entry of entries) {
      assertNotAborted(options.signal);
      const gateway = collectionGateway(storage, entry, fallbackProfileId);
      const current = await gateway.get<unknown>(entry.key, undefined);
      snapshot.push({ key: entry.key, value: current, scopeId: collectionScope(entry, fallbackProfileId), gateway });
      if (entry.key === SETTINGS_KEY && entry.present) {
        const report = parseSettingsImport(JSON.stringify(entry.value), normalizeSettings(current));
        warnings.push(...report.warnings);
        if (!report.applied) {
          throw new LibraryBackupError(`Settings collection could not be normalized: ${report.errors.join("; ")}`);
        }
      }
    }
  } catch (error) {
    return {
      applied: false,
      dryRun,
      cancelled: isAbortError(error),
      rolledBack: false,
      restoredKeys: [],
      warnings,
      errors: [errorMessage(error)],
      rollbackErrors: [],
      preview
    };
  }

  if (dryRun) {
    return {
      applied: false,
      dryRun: true,
      cancelled: false,
      rolledBack: false,
      restoredKeys: [],
      warnings,
      errors: [],
      rollbackErrors: [],
      preview
    };
  }

  const restoredKeys: LibraryBackupKey[] = [];
  try {
    for (const entry of entries) {
      assertNotAborted(options.signal);
      const gateway = collectionGateway(storage, entry, fallbackProfileId);
      if (!entry.present) {
        await gateway.remove(entry.key);
      } else if (entry.key === SETTINGS_KEY) {
        const scopeId = collectionScope(entry, fallbackProfileId);
        const current = snapshot.find(
          (item) => item.key === entry.key && item.scopeId === scopeId
        )?.value;
        const report = parseSettingsImport(JSON.stringify(entry.value), normalizeSettings(current));
        if (!report.applied) {
          throw new LibraryBackupError(`Settings collection could not be restored: ${report.errors.join("; ")}`);
        }
        warnings.push(...report.warnings);
        await gateway.set(entry.key, report.settings);
      } else {
        await gateway.set(entry.key, entry.value);
      }
      restoredKeys.push(entry.key);
    }
    return {
      applied: true,
      dryRun: false,
      cancelled: false,
      rolledBack: false,
      restoredKeys,
      warnings,
      errors: [],
      rollbackErrors: [],
      preview
    };
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const item of [...snapshot].reverse()) {
      try {
        if (item.value === undefined) await item.gateway.remove(item.key);
        else await item.gateway.set(item.key, item.value);
      } catch (rollbackError) {
        rollbackErrors.push(`${item.key}: ${errorMessage(rollbackError)}`);
      }
    }
    return {
      applied: false,
      dryRun: false,
      cancelled: isAbortError(error),
      rolledBack: rollbackErrors.length === 0,
      restoredKeys: [],
      warnings,
      errors: [errorMessage(error)],
      rollbackErrors,
      preview
    };
  }
}

function makeEnvelope(
  collections: LibraryBackupCollection[],
  options: {
    createdAt: string;
    includeCredentials: boolean;
    profile: LibraryBackupProfile | null;
    profiles: LibraryBackupProfile[];
    activeProfileId: string | null;
  }
): LibraryBackupEnvelope {
  return {
    generator: "Aviary",
    schemaVersion: LIBRARY_BACKUP_SCHEMA_VERSION,
    createdAt: options.createdAt,
    profile: options.profile,
    profiles: options.profiles,
    activeProfileId: options.activeProfileId,
    includeCredentials: options.includeCredentials,
    collections,
    manifest: {
      schemaVersion: LIBRARY_BACKUP_SCHEMA_VERSION,
      collectionCount: collections.length,
      totalBytes: collections.reduce((total, collection) => total + collection.byteLength, 0),
      sha256: manifestChecksum({ ...options, collections })
    }
  };
}

function makeCollection(
  key: string,
  current: unknown,
  includeCredentials: boolean,
  profileId: string | null = null
): LibraryBackupCollection {
  const definition = definitionFor(key);
  if (!definition) {
    throw new LibraryBackupError(`Collection '${key}' is not supported.`, "unsupported");
  }
  // The signing identity is a private key end to end; there is no field to redact and leave a
  // useful remainder. Withhold the whole value and say so, so a restore knows it was withheld
  // rather than absent.
  if (current !== undefined && !includeCredentials && CREDENTIAL_COLLECTIONS.has(key)) {
    return {
      key: definition.key as LibraryBackupKey,
      profileId,
      version: 1,
      present: false,
      count: 0,
      byteLength: 0,
      sha256: sha256Hex(new Uint8Array()),
      redactedPaths: [key]
    };
  }
  if (current === undefined) {
    return {
      key: definition.key as LibraryBackupKey,
      profileId,
      version: 1,
      present: false,
      count: 0,
      byteLength: 0,
      sha256: sha256Hex(new Uint8Array()),
      redactedPaths: []
    };
  }
  const value = valueForBackup(key, current, includeCredentials);
  const serialized = serializeBackupValue(value);
  const bytes = new TextEncoder().encode(serialized);
  if (bytes.byteLength > MAX_LIBRARY_BACKUP_BYTES) {
    throw new LibraryBackupError(`Collection '${key}' is too large.`, "too-large");
  }
  return {
    key: definition.key as LibraryBackupKey,
    profileId,
    version: 1,
    present: true,
    count: collectionCount(key, value),
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
    redactedPaths: key === SETTINGS_KEY && !includeCredentials ? [...REDACTED_SETTINGS_PATHS] : [],
    // Keep the tagged JSON form in the envelope. A raw Uint8Array would stringify as a numeric
    // object when the outer backup JSON is written, losing its type and invalidating its checksum.
    value: JSON.parse(serialized)
  };
}

function valueForBackup(key: string, current: unknown, includeCredentials: boolean): unknown {
  if (key !== SETTINGS_KEY) return current;
  return buildSettingsExport(normalizeSettings(current), { includeSecrets: includeCredentials });
}

function selectedDefinitions(selectedKeys: readonly string[] | undefined): LibraryBackupCollectionDefinition[] {
  if (selectedKeys === undefined) return [...LIBRARY_BACKUP_COLLECTIONS];
  const requested = new Set(selectedKeys);
  for (const key of requested) {
    if (!definitionFor(key)) {
      throw new LibraryBackupError(`Collection '${key}' is not supported.`, "unsupported");
    }
  }
  return LIBRARY_BACKUP_COLLECTIONS.filter((definition) => requested.has(definition.key));
}

function selectedGlobalDefinitions(
  selectedKeys: readonly string[] | undefined
): LibraryBackupCollectionDefinition[] {
  if (selectedKeys === undefined) return [...LIBRARY_BACKUP_GLOBAL_COLLECTIONS];
  const requested = new Set(selectedKeys);
  return LIBRARY_BACKUP_GLOBAL_COLLECTIONS.filter((definition) => requested.has(definition.key));
}

/** The profile a collection resolves to, used to match a snapshot entry without object identity. */
function collectionScope(
  collection: Pick<LibraryBackupCollection, "key" | "profileId">,
  fallbackProfileId: string | null
): string | null {
  if (LIBRARY_BACKUP_GLOBAL_COLLECTIONS.some((entry) => entry.key === collection.key)) return null;
  return collection.profileId ?? fallbackProfileId;
}

function collectionGateway(
  base: StorageGateway,
  collection: Pick<LibraryBackupCollection, "key" | "profileId">,
  fallbackProfileId: string | null
): StorageGateway {
  if (LIBRARY_BACKUP_GLOBAL_COLLECTIONS.some((entry) => entry.key === collection.key)) {
    return base;
  }
  const profileId = collection.profileId ?? fallbackProfileId;
  return profileId === null ? base : createProfileStorageGateway(base, profileId);
}

function selectedKeys(
  collections: readonly LibraryBackupCollection[],
  selectedKeysOption: readonly string[] | undefined
): Set<LibraryBackupKey> {
  if (selectedKeysOption === undefined) return new Set(collections.map((collection) => collection.key));
  const requested = new Set(selectedKeysOption);
  for (const key of requested) {
    if (!definitionFor(key)) {
      throw new LibraryBackupError(`Collection '${key}' is not supported.`, "unsupported");
    }
  }
  return new Set(collections.map((collection) => collection.key).filter((key) => requested.has(key)));
}

function definitionFor(key: unknown): LibraryBackupCollectionDefinition | undefined {
  const global = LIBRARY_BACKUP_GLOBAL_COLLECTIONS.find((entry) => entry.key === key);
  if (global) return global;
  return LIBRARY_BACKUP_COLLECTIONS.find((definition) => definition.key === key);
}

function compareCollections(
  backup: LibraryBackupCollection,
  current: LibraryBackupCollection
): LibraryBackupConflict {
  if (!current.present && !backup.present) return "unchanged";
  if (!current.present && backup.present) return "add";
  if (current.present && !backup.present) return "remove";
  return current.sha256 === backup.sha256 && current.byteLength === backup.byteLength
    ? "unchanged"
    : "replace";
}

function collectionCount(key: string, value: unknown): number {
  if (key === SETTINGS_KEY || key === LAST_DOWNLOAD_KEY) return 1;
  if (key === CHECKPOINT_KEY && isRecord(value)) {
    const records = isRecord(value.records) ? value.records : {};
    return Object.values(records).reduce(
      (total, entries) => total + (Array.isArray(entries) ? entries.length : 0),
      0
    );
  }
  if (Array.isArray(value)) return value.length;
  if (!isRecord(value)) return 1;
  const arrayKeys = [
    "entries",
    "items",
    "jobs",
    "records",
    "snapshots",
    "vectors",
    "media",
    "followers",
    "following",
    "lists",
    "directMessages",
    "history"
  ];
  const counts = arrayKeys.flatMap((name) => {
    const candidate = value[name];
    if (Array.isArray(candidate)) return [candidate.length];
    if (name === "jobs" && isRecord(candidate)) return [Object.keys(candidate).length];
    if (name === "records" && isRecord(candidate)) {
      return [Object.values(candidate).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0)];
    }
    return [];
  });
  return counts.length > 0 ? counts.reduce((total, count) => total + count, 0) : 1;
}

/**
 * Version-aware by necessity.
 *
 * Schema 1 omitted `profileId` from collection descriptors. Schema 2 added it and the profile
 * roster fields, but the roster stayed outside the checksum. Schema 3 covers that roster and the
 * active pointer. The version is an input, not a constant, so old files keep their exact formula.
 */
function manifestChecksum(input: {
  createdAt: string;
  includeCredentials: boolean;
  profile: LibraryBackupProfile | null;
  collections: readonly LibraryBackupCollection[];
  schemaVersion?: 1 | 2 | 3;
  profiles?: readonly LibraryBackupProfile[];
  activeProfileId?: string | null;
}): string {
  const schemaVersion = input.schemaVersion ?? LIBRARY_BACKUP_SCHEMA_VERSION;
  const descriptors = input.collections.map(({ value: _value, ...descriptor }) => {
    if (schemaVersion !== 1) return descriptor;
    const { profileId: _profileId, ...legacy } = descriptor;
    return legacy;
  });
  const text = JSON.stringify({
    generator: "Aviary",
    schemaVersion,
    createdAt: input.createdAt,
    includeCredentials: input.includeCredentials,
    profile: input.profile,
    ...(schemaVersion >= 3
      ? { profiles: input.profiles ?? [], activeProfileId: input.activeProfileId ?? null }
      : {}),
    collections: descriptors
  });
  return sha256Hex(new TextEncoder().encode(text));
}

function serializeBackupValue(value: unknown): string {
  const text = JSON.stringify(value, (_key, current: unknown) => {
    if (current instanceof Uint8Array) {
      return { __aviaryType: "Uint8Array", base64: encodeBase64(current) };
    }
    return current;
  });
  if (text === undefined) {
    throw new LibraryBackupError("A collection contains an unsupported undefined value.");
  }
  return text;
}

function assertBackupEnvelopeSize(byteLength: number): void {
  if (byteLength <= MAX_LIBRARY_BACKUP_BYTES) return;
  throw new LibraryBackupError(
    "Backup exceeds the " + Math.round(MAX_LIBRARY_BACKUP_BYTES / (1024 * 1024)) + " MiB limit.",
    "too-large"
  );
}

function deserializeBackupValue(text: string): unknown {
  return JSON.parse(text, (_key, current: unknown) => {
    if (!isRecord(current) || current.__aviaryType !== "Uint8Array") return current;
    if (typeof current.base64 !== "string") {
      throw new Error("Uint8Array value is missing base64 data");
    }
    return decodeBase64(current.base64);
  });
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("invalid base64 data");
  }
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseManifest(value: unknown): LibraryBackupManifest {
  const schemaVersion = isRecord(value)
    ? SUPPORTED_LIBRARY_BACKUP_SCHEMAS.find((known) => known === value.schemaVersion)
    : undefined;
  if (!isRecord(value) || schemaVersion === undefined) {
    throw new LibraryBackupError("Backup manifest is missing or unsupported.", "unsupported");
  }
  return {
    schemaVersion,
    collectionCount: nonNegativeInteger(value.collectionCount, "Manifest collection count"),
    totalBytes: nonNegativeInteger(value.totalBytes, "Manifest byte count"),
    sha256: validChecksum(value.sha256, "Manifest checksum")
  };
}

function parseProfile(value: unknown): LibraryBackupProfile | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string") {
    throw new LibraryBackupError("Backup profile metadata is invalid.");
  }
  return { id: value.id.slice(0, 120), label: value.label.slice(0, 120) };
}

function parseRedactedPaths(value: unknown, key: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new LibraryBackupError(`Collection '${key}' redaction metadata is invalid.`);
  }
  return value.map((entry) => entry.slice(0, 160));
}

function verifyCollectionChecksum(key: string, value: unknown, byteLength: number, checksum: string): void {
  const bytes = new TextEncoder().encode(serializeBackupValue(value));
  if (bytes.byteLength !== byteLength || sha256Hex(bytes) !== checksum) {
    throw new LibraryBackupError(`Collection '${key}' checksum does not match its value.`, "checksum");
  }
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new LibraryBackupError(`${label} is invalid.`);
  }
  return value;
}

function validChecksum(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new LibraryBackupError(`${label} is invalid.`, "checksum");
  }
  return value.toLowerCase();
}

/** The public half of a stored signing identity, or null when the value is not one. */
function signingFingerprint(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.fingerprint === "string" && value.fingerprint.length > 0
    ? value.fingerprint
    : null;
}

function parseProfiles(raw: unknown): LibraryBackupProfile[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new LibraryBackupError("Backup profile list must be an array.");
  }
  return raw.map((entry) => {
    if (!isRecord(entry)) {
      throw new LibraryBackupError("Backup profile list contains an invalid entry.");
    }
    const normalized = normalizeProfile({
      id: nonEmptyString(entry.id, "Backup profile id"),
      label: typeof entry.label === "string" ? entry.label : ""
    });
    if (!normalized) {
      throw new LibraryBackupError("Backup profile list contains an invalid entry.");
    }
    return normalized;
  });
}

function nonEmptyString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LibraryBackupError(`${what} must be a non-empty string.`);
  }
  return value;
}

function normalizeProfile(profile: LibraryBackupProfile | null | undefined): LibraryBackupProfile | null {
  if (!profile) return null;
  return { id: profile.id.slice(0, 120), label: profile.label.slice(0, 120) };
}

function backupFilename(createdAt: string): string {
  const stamp = createdAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "backup";
  return `aviary-library-backup-${stamp}.json`;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Backup restore cancelled", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
