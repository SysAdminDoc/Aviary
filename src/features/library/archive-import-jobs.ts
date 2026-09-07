import type { StorageGateway } from "../../platform/storage.ts";
import { replaceStored } from "../../platform/storage-lock.ts";

export const ARCHIVE_IMPORT_JOBS_KEY = "aviary.archive.imports.v1";

/**
 * Archive sources are staged as fixed-size manager-safe chunks. Versioned keys are intentional:
 * DurableStorageGateway routes every `aviary.*.vN` key to the extension-owned IndexedDB backend,
 * while the userscript gateway keeps each base64 value well below its per-value manager limit.
 */
export const archiveSourceKey = (jobId: string): string =>
  `aviary.archive.import.source.${jobId}.v1`;

export const archiveSourceChunkKey = (jobId: string, index: number): string =>
  `aviary.archive.import.source.${jobId}.chunk.${index}.v1`;

export const ARCHIVE_SOURCE_CHUNK_BYTES = 3 * 1024 * 1024;
export const ARCHIVE_SOURCE_MAX_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 256 * 1024 * 1024;

interface ArchiveSourceManifest {
  version: 1;
  encoding: "base64-chunks";
  sourceBytes: number;
  chunkBytes: number;
  chunkCount: number;
}

export interface ArchiveByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Where an in-flight job's bytes were written before the key was versioned. */
const legacyArchiveSourceKey = (jobId: string): string =>
  `aviary.archive.import.source.${jobId}`;
const MAX_RETAINED_JOBS = 12;
/** Base64 costs four characters per three bytes. */
const BASE64_INFLATION = 4 / 3;

function formatMiB(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MiB`;
}

export type ArchiveImportJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "failed"
  | "completed";

export interface ArchiveImportJob {
  jobId: string;
  filename: string;
  sourceBytes: number;
  status: ArchiveImportJobStatus;
  filesParsed: number;
  recordCount: number;
  warningCount: number;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
  resumeOnBoot: boolean;
  /** Empty for new jobs. Older jobs may still carry their legacy inline base64 source. */
  source: string;
  /** Number of fixed-size source chunks for jobs staged by the current build. */
  sourceChunks?: number;
  sourceChunkBytes?: number;
  error?: string;
}

export interface ArchiveImportJobActionResult {
  ok: boolean;
  error?: string;
}

interface ArchiveImportState {
  jobs: Record<string, ArchiveImportJob>;
  sequence: number;
}

const EMPTY: ArchiveImportState = { jobs: {}, sequence: 0 };

export class ArchiveImportJobStore {
  readonly #storage: StorageGateway;
  #state: ArchiveImportState = EMPTY;
  #loaded = false;

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const raw = await this.#storage.get<ArchiveImportState>(ARCHIVE_IMPORT_JOBS_KEY, EMPTY);
    this.#state = normalizeState(raw);
    let interrupted = false;
    for (const job of Object.values(this.#state.jobs)) {
      if (job.status === "running") {
        job.status = "paused";
        job.resumeOnBoot = true;
        job.error = "Interrupted before import completed; resume when ready.";
        job.updatedAt = new Date().toISOString();
        interrupted = true;
      }
    }
    this.#loaded = true;
    if (interrupted) {
      await this.#persist();
    }
  }

  list(): ArchiveImportJob[] {
    return Object.values(this.#state.jobs).sort(compareJobs).map(cloneJob);
  }

  get(jobId: string): ArchiveImportJob | undefined {
    const job = this.#state.jobs[jobId];
    return job ? cloneJob(job) : undefined;
  }

  async start(filename: string, source: Uint8Array): Promise<ArchiveImportJob> {
    return this.#startWithReader(filename, source.byteLength, async (offset, length) =>
      source.slice(offset, offset + length)
    );
  }

  /** Stage a File/Blob without ever materialising the complete input in the page. */
  async startBlob(filename: string, source: Blob): Promise<ArchiveImportJob> {
    if (!source || typeof source.size !== "number") {
      throw new Error("Archive source is not readable.");
    }
    if (typeof source.slice !== "function" || typeof source.arrayBuffer !== "function") {
      throw new Error("Archive source does not support chunked reads.");
    }
    return this.#startWithReader(filename, source.size, async (offset, length) => {
      const chunk = source.slice(offset, offset + length);
      return new Uint8Array(await chunk.arrayBuffer());
    });
  }

  async #startWithReader(
    filename: string,
    sourceBytes: number,
    read: (offset: number, length: number) => Promise<Uint8Array>
  ): Promise<ArchiveImportJob> {
    await this.load();
    const ceiling = this.#sourceCeiling();
    if (!Number.isInteger(sourceBytes) || sourceBytes < 0) {
      throw new Error("Archive source has an invalid byte length.");
    }
    if (sourceBytes > MAX_SOURCE_BYTES) {
      throw new Error("Archive exceeds the 256 MiB input limit before staging.");
    }
    if (sourceBytes > ceiling) {
      // Named in the message. Refusing a file with a limit the reader cannot reconcile against
      // what the panel promised is only marginally better than the quota error it replaces.
      throw new Error(
        `Archive is ${formatMiB(sourceBytes)}, over the ${formatMiB(ceiling)} this browser ` +
          `profile can store.`
      );
    }
    const chunkCount = Math.ceil(sourceBytes / ARCHIVE_SOURCE_CHUNK_BYTES);
    const now = new Date().toISOString();
    const job: ArchiveImportJob = {
      jobId: `archive-${Date.now()}-${++this.#state.sequence}`,
      filename: filename || "archive.zip",
      sourceBytes,
      status: "queued",
      filesParsed: 0,
      recordCount: 0,
      warningCount: 0,
      errorCount: 0,
      createdAt: now,
      updatedAt: now,
      resumeOnBoot: true,
      source: "",
      sourceChunks: chunkCount,
      sourceChunkBytes: ARCHIVE_SOURCE_CHUNK_BYTES
    };
    const manifest: ArchiveSourceManifest = {
      version: 1,
      encoding: "base64-chunks",
      sourceBytes,
      chunkBytes: ARCHIVE_SOURCE_CHUNK_BYTES,
      chunkCount
    };
    try {
      await this.#storage.set(archiveSourceKey(job.jobId), manifest);
      for (let index = 0; index < chunkCount; index += 1) {
        const offset = index * ARCHIVE_SOURCE_CHUNK_BYTES;
        const expected = Math.min(ARCHIVE_SOURCE_CHUNK_BYTES, sourceBytes - offset);
        const chunk = await read(offset, expected);
        if (chunk.byteLength !== expected || chunk.byteLength > ARCHIVE_SOURCE_CHUNK_BYTES) {
          throw new Error("Archive source changed while it was being staged.");
        }
        await this.#storage.set(archiveSourceChunkKey(job.jobId, index), encodeBase64(chunk));
      }
      this.#state.jobs[job.jobId] = job;
      await this.#trim();
      await this.#persist();
    } catch (error) {
      await this.#releaseSource(job.jobId, chunkCount);
      throw error;
    }
    return cloneJob(job);
  }

  /**
   * The smaller of what the product promises and what this browser profile can actually hold.
   *
   * `getStatus()` is optional on the gateway and its quota is nullable, so an unknown quota means
   * the declared limit stands -- guessing lower would refuse imports that would have worked. The
   * base64 the payload is stored as inflates it by about a third, and the job record is rewritten
   * alongside it, so the usable share of the quota is well under all of it.
   */
  #sourceCeiling(): number {
    const quota = this.#storage.getStatus?.().quotaBytes ?? null;
    if (quota === null || !Number.isFinite(quota) || quota <= 0) {
      return MAX_SOURCE_BYTES;
    }
    return Math.min(MAX_SOURCE_BYTES, Math.floor((quota * 0.6) / BASE64_INFLATION));
  }

  async source(jobId: string): Promise<Uint8Array | null> {
    const reader = await this.sourceReader(jobId);
    if (!reader) return null;
    const bytes = new Uint8Array(reader.size);
    for (let offset = 0; offset < reader.size; offset += ARCHIVE_SOURCE_CHUNK_BYTES) {
      const length = Math.min(ARCHIVE_SOURCE_CHUNK_BYTES, reader.size - offset);
      bytes.set(await reader.read(offset, length), offset);
    }
    return bytes;
  }

  /** Returns bounded random reads for the ZIP parser. New jobs never decode the whole source. */
  async sourceReader(jobId: string): Promise<ArchiveByteSource | null> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job) return null;
    if (job.source) {
      try {
        const bytes = decodeBase64(job.source);
        return bytes.byteLength === job.sourceBytes ? byteSourceFromBytes(bytes) : null;
      } catch {
        return null;
      }
    }
    const manifestValue = await this.#storage.get<unknown>(archiveSourceKey(jobId), null);
    const manifest = normalizeManifest(manifestValue, job);
    if (manifest) {
      return {
        size: manifest.sourceBytes,
        read: async (offset, length) => this.#readChunkRange(jobId, manifest, offset, length)
      };
    }
    // Pre-versioned jobs wrote one base64 value under the old key. Keep those imports resumable.
    const legacyEncoded =
      typeof manifestValue === "string"
        ? manifestValue
        : await this.#storage.get<string>(legacyArchiveSourceKey(jobId), "");
    if (!legacyEncoded) return null;
    try {
      const bytes = decodeBase64(legacyEncoded);
      return bytes.byteLength === job.sourceBytes ? byteSourceFromBytes(bytes) : null;
    } catch {
      return null;
    }
  }

  async #readChunkRange(
    jobId: string,
    manifest: ArchiveSourceManifest,
    offset: number,
    length: number
  ): Promise<Uint8Array> {
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > ARCHIVE_SOURCE_CHUNK_BYTES ||
      offset + length > manifest.sourceBytes
    ) {
      throw new Error("Archive source read is outside the staged byte range.");
    }
    const output = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const absolute = offset + written;
      const chunkIndex = Math.floor(absolute / manifest.chunkBytes);
      const chunkOffset = absolute % manifest.chunkBytes;
      const encoded = await this.#storage.get<string>(
        archiveSourceChunkKey(jobId, chunkIndex),
        ""
      );
      if (!encoded) throw new Error("The durable archive source is unavailable or corrupted.");
      let chunk: Uint8Array;
      try {
        chunk = decodeBase64(encoded);
      } catch {
        throw new Error("The durable archive source is unavailable or corrupted.");
      }
      const expected = Math.min(manifest.chunkBytes, manifest.sourceBytes - chunkIndex * manifest.chunkBytes);
      if (chunk.byteLength !== expected) {
        throw new Error("The durable archive source is unavailable or corrupted.");
      }
      const copy = Math.min(chunk.byteLength - chunkOffset, length - written);
      output.set(chunk.subarray(chunkOffset, chunkOffset + copy), written);
      written += copy;
    }
    return output;
  }

  async markRunning(jobId: string): Promise<boolean> {
    return this.#set(jobId, (job) => {
      if (isTerminal(job.status)) return false;
      job.status = "running";
      job.resumeOnBoot = true;
      delete job.error;
      return true;
    });
  }

  async updateProgress(
    jobId: string,
    update: Pick<ArchiveImportJob, "filesParsed" | "recordCount" | "warningCount" | "errorCount">
  ): Promise<boolean> {
    return this.#set(jobId, (job) => {
      if (isTerminal(job.status)) return false;
      job.filesParsed = nonNegative(update.filesParsed, job.filesParsed);
      job.recordCount = nonNegative(update.recordCount, job.recordCount);
      job.warningCount = nonNegative(update.warningCount, job.warningCount);
      job.errorCount = nonNegative(update.errorCount, job.errorCount);
      return true;
    });
  }

  async complete(
    jobId: string,
    update: Pick<ArchiveImportJob, "filesParsed" | "recordCount" | "warningCount" | "errorCount">
  ): Promise<boolean> {
    const released = await this.#set(jobId, (job) => {
      if (job.status === "cancelled") return false;
      job.status = "completed";
      job.resumeOnBoot = false;
      job.filesParsed = nonNegative(update.filesParsed, job.filesParsed);
      job.recordCount = nonNegative(update.recordCount, job.recordCount);
      job.warningCount = nonNegative(update.warningCount, job.warningCount);
      job.errorCount = nonNegative(update.errorCount, job.errorCount);
      // Completed imports no longer need the original ZIP. Drop the manifest and all chunks.
      job.source = "";
      delete job.sourceChunks;
      delete job.sourceChunkBytes;
      delete job.error;
      return true;
    });
    if (released) {
      await this.#releaseSource(jobId);
    }
    return released;
  }

  /**
   * Drops an archive's bytes. Failed and cancelled imports deliberately keep theirs, because
   * `retry` replays from exactly this payload -- releasing on every terminal state would quietly
   * delete a shipped feature. Eviction below is what bounds the space instead.
   */
  async #releaseSource(jobId: string, knownChunkCount = 0): Promise<void> {
    try {
      const manifestValue = await this.#storage.get<unknown>(archiveSourceKey(jobId), null);
      const manifest = normalizeManifest(manifestValue);
      const chunkCount = Math.max(knownChunkCount, manifest?.chunkCount ?? 0);
      for (let index = 0; index < chunkCount; index += 1) {
        await this.#storage.remove(archiveSourceChunkKey(jobId, index));
      }
      await this.#storage.remove(archiveSourceKey(jobId));
      await this.#storage.remove(legacyArchiveSourceKey(jobId));
    } catch {
      // A stranded payload is wasteful, not incorrect; the job record is already authoritative.
    }
  }

  async pause(jobId: string): Promise<ArchiveImportJobActionResult> {
    return this.#action(jobId, (job) => {
      if (isTerminal(job.status)) return "Import is already finished";
      job.status = "paused";
      job.resumeOnBoot = false;
      job.error = "Paused by user.";
      return null;
    });
  }

  async resume(jobId: string): Promise<ArchiveImportJobActionResult> {
    return this.#action(jobId, (job) => {
      if (job.status !== "paused" && job.status !== "queued") return "Import is not paused";
      job.status = "running";
      job.resumeOnBoot = false;
      delete job.error;
      return null;
    });
  }

  async cancel(jobId: string): Promise<ArchiveImportJobActionResult> {
    return this.#action(jobId, (job) => {
      if (isTerminal(job.status)) return "Import is already finished";
      job.status = "cancelled";
      job.resumeOnBoot = false;
      job.error = "Cancelled by user.";
      return null;
    });
  }

  async retry(jobId: string): Promise<ArchiveImportJobActionResult> {
    await this.load();
    // The payload lives under its own key now, so availability is a storage question rather than a
    // field on the record. Ask before promising a retry that would immediately fail.
    const available = (await this.sourceReader(jobId)) !== null;
    return this.#action(jobId, (job) => {
      if (job.status !== "failed" && job.status !== "cancelled") return "Import is not failed or cancelled";
      if (!available) return "The original archive source is no longer available";
      job.status = "queued";
      job.resumeOnBoot = true;
      delete job.error;
      return null;
    });
  }

  async fail(jobId: string, error: unknown): Promise<boolean> {
    return this.#set(jobId, (job) => {
      if (job.status === "cancelled") return false;
      job.status = "failed";
      job.resumeOnBoot = false;
      job.error = error instanceof Error ? error.message : String(error);
      return true;
    });
  }

  async #set(jobId: string, mutate: (job: ArchiveImportJob) => boolean): Promise<boolean> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job || !mutate(job)) return false;
    job.updatedAt = new Date().toISOString();
    await this.#persist();
    return true;
  }

  async #action(
    jobId: string,
    mutate: (job: ArchiveImportJob) => string | null
  ): Promise<ArchiveImportJobActionResult> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job) return { ok: false, error: "Archive import job was not found" };
    const error = mutate(job);
    if (error) return { ok: false, error };
    job.updatedAt = new Date().toISOString();
    await this.#persist();
    return { ok: true };
  }

  /**
   * Written under the lock, and deliberately not merged.
   *
   * A job belongs to the tab running it -- its payload, its cursor, its pause state -- and two
   * tabs importing the same archive is not a thing the flow allows. Merging would recreate jobs
   * `#trim` has already retired along with the payloads it released. The lock still matters: the
   * trim is a read-modify-write, and a second tab writing inside it would undo the release.
   */
  async #persist(): Promise<void> {
    await replaceStored(this.#storage, ARCHIVE_IMPORT_JOBS_KEY, this.#state);
  }

  async #trim(): Promise<void> {
    const jobs = Object.values(this.#state.jobs).sort(compareJobs);
    for (const job of jobs.slice(0, Math.max(0, jobs.length - MAX_RETAINED_JOBS))) {
      delete this.#state.jobs[job.jobId];
      // The payload outlives the record unless it is removed with it.
      await this.#releaseSource(job.jobId);
    }
  }
}

function normalizeState(value: unknown): ArchiveImportState {
  if (!value || typeof value !== "object") return { ...EMPTY, jobs: {} };
  const raw = value as Partial<ArchiveImportState>;
  const jobs: Record<string, ArchiveImportJob> = {};
  if (raw.jobs && typeof raw.jobs === "object") {
    for (const [fallbackId, candidate] of Object.entries(raw.jobs)) {
      const job = normalizeJob(candidate, fallbackId);
      if (job) jobs[job.jobId] = job;
    }
  }
  return {
    sequence: nonNegative(raw.sequence, 0),
    jobs
  };
}

function normalizeJob(value: unknown, fallbackId: string): ArchiveImportJob | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ArchiveImportJob>;
  if (typeof raw.source !== "string" || typeof raw.filename !== "string") return null;
  const status = validStatus(raw.status) ? raw.status : "failed";
  const startedAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  return {
    jobId: typeof raw.jobId === "string" && raw.jobId.length > 0 ? raw.jobId : fallbackId,
    filename: raw.filename.slice(0, 240),
    sourceBytes: nonNegative(raw.sourceBytes, 0),
    status,
    filesParsed: nonNegative(raw.filesParsed, 0),
    recordCount: nonNegative(raw.recordCount, 0),
    warningCount: nonNegative(raw.warningCount, 0),
    errorCount: nonNegative(raw.errorCount, 0),
    createdAt: startedAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : startedAt,
    resumeOnBoot: status === "running" || (status === "paused" && raw.resumeOnBoot === true),
    source: raw.source,
    ...(typeof raw.sourceChunks === "number" ? { sourceChunks: nonNegative(raw.sourceChunks, 0) } : {}),
    ...(typeof raw.sourceChunkBytes === "number"
      ? { sourceChunkBytes: nonNegative(raw.sourceChunkBytes, ARCHIVE_SOURCE_CHUNK_BYTES) }
      : {}),
    ...(typeof raw.error === "string" && raw.error.length > 0 ? { error: raw.error } : {})
  };
}

function validStatus(value: unknown): value is ArchiveImportJobStatus {
  return value === "queued" || value === "running" || value === "paused" || value === "cancelled" || value === "failed" || value === "completed";
}

function isTerminal(status: ArchiveImportJobStatus): boolean {
  return status === "cancelled" || status === "failed" || status === "completed";
}

function nonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function compareJobs(left: ArchiveImportJob, right: ArchiveImportJob): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.jobId.localeCompare(right.jobId);
}

function cloneJob(job: ArchiveImportJob): ArchiveImportJob {
  return { ...job };
}

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(output);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeManifest(value: unknown, job?: ArchiveImportJob): ArchiveSourceManifest | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<ArchiveSourceManifest>;
  const sourceBytes = nonNegative(raw.sourceBytes, job?.sourceBytes ?? 0);
  const chunkBytes = nonNegative(raw.chunkBytes, job?.sourceChunkBytes ?? ARCHIVE_SOURCE_CHUNK_BYTES);
  const chunkCount = nonNegative(raw.chunkCount, job?.sourceChunks ?? 0);
  if (
    raw.version !== 1 ||
    raw.encoding !== "base64-chunks" ||
    sourceBytes > MAX_SOURCE_BYTES ||
    chunkBytes <= 0 ||
    chunkBytes > ARCHIVE_SOURCE_CHUNK_BYTES ||
    chunkCount !== Math.ceil(sourceBytes / chunkBytes)
  ) {
    return null;
  }
  return { version: 1, encoding: "base64-chunks", sourceBytes, chunkBytes, chunkCount };
}

function byteSourceFromBytes(bytes: Uint8Array): ArchiveByteSource {
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
        throw new Error("Archive source read is outside the staged byte range.");
      }
      return bytes.slice(offset, offset + length);
    }
  };
}
