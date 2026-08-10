import type { StorageGateway } from "../../platform/storage";

export const ARCHIVE_IMPORT_JOBS_KEY = "aviary.archive.imports.v1";
const MAX_RETAINED_JOBS = 12;
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;

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
  /** Base64 keeps the source portable across IndexedDB, GM storage, and localStorage fallbacks. */
  source: string;
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
    await this.load();
    if (source.byteLength > MAX_SOURCE_BYTES) {
      throw new Error("Archive exceeds the 256 MiB input limit.");
    }
    const now = new Date().toISOString();
    const job: ArchiveImportJob = {
      jobId: `archive-${Date.now()}-${++this.#state.sequence}`,
      filename: filename || "archive.zip",
      sourceBytes: source.byteLength,
      status: "queued",
      filesParsed: 0,
      recordCount: 0,
      warningCount: 0,
      errorCount: 0,
      createdAt: now,
      updatedAt: now,
      resumeOnBoot: true,
      source: encodeBase64(source)
    };
    this.#state.jobs[job.jobId] = job;
    this.#trim();
    await this.#persist();
    return cloneJob(job);
  }

  source(jobId: string): Uint8Array | null {
    const job = this.#state.jobs[jobId];
    if (!job) return null;
    try {
      const bytes = decodeBase64(job.source);
      return bytes.byteLength === job.sourceBytes ? bytes : null;
    } catch {
      return null;
    }
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
    return this.#set(jobId, (job) => {
      if (job.status === "cancelled") return false;
      job.status = "completed";
      job.resumeOnBoot = false;
      job.filesParsed = nonNegative(update.filesParsed, job.filesParsed);
      job.recordCount = nonNegative(update.recordCount, job.recordCount);
      job.warningCount = nonNegative(update.warningCount, job.warningCount);
      job.errorCount = nonNegative(update.errorCount, job.errorCount);
      // Completed imports no longer need the original ZIP; dropping it prevents a successful
      // 250 MiB import from pinning another 333 MiB base64 copy in local storage forever.
      job.source = "";
      delete job.error;
      return true;
    });
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
    return this.#action(jobId, (job) => {
      if (job.status !== "failed" && job.status !== "cancelled") return "Import is not failed or cancelled";
      if (job.source.length === 0) return "The original archive source is no longer available";
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

  async #persist(): Promise<void> {
    await this.#storage.set(ARCHIVE_IMPORT_JOBS_KEY, this.#state);
  }

  #trim(): void {
    const jobs = Object.values(this.#state.jobs).sort(compareJobs);
    for (const job of jobs.slice(0, Math.max(0, jobs.length - MAX_RETAINED_JOBS))) {
      delete this.#state.jobs[job.jobId];
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
