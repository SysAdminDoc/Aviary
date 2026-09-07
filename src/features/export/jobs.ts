import type { StorageGateway } from "../../platform/storage.ts";
import { mutateStored, replaceStored } from "../../platform/storage-lock.ts";
import type {
  ExportCheckpoint,
  ExportFormat,
  ExportJobProgress,
  ExportJobStatus,
  ExportRecord
} from "./types.ts";

export const CHECKPOINT_KEY = "aviary.export.checkpoints.v1";

export const RETENTION_KEYS = {
  maxJobs: "aviary.retention.maxJobs",
  maxRecordsPerJob: "aviary.retention.maxRecordsPerJob",
  maxAgeDays: "aviary.retention.maxAgeDays"
} as const;

export interface RetentionPolicy {
  /** Zero disables the limit. */
  maxJobs: number;
  /** Zero disables the limit. */
  maxRecordsPerJob: number;
  /** Zero disables the limit. */
  maxAgeDays: number;
}

export interface RetentionSweepResult {
  removedJobs: number;
  removedRecords: number;
  retainedJobs: number;
  policy: RetentionPolicy;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  maxJobs: 0,
  maxRecordsPerJob: 0,
  maxAgeDays: 0
};

export interface CheckpointStoreShape {
  jobs: Record<string, ExportCheckpoint>;
  records: Record<string, ExportRecord[]>;
}

const EMPTY: CheckpointStoreShape = { jobs: {}, records: {} };

type CheckpointField = keyof ExportCheckpoint;

type CheckpointChange =
  | { kind: "start"; job: ExportCheckpoint }
  | { kind: "append"; jobId: string; records: ExportRecord[]; total: number | null; updatedAt: string }
  | { kind: "update"; jobId: string; set: Partial<ExportCheckpoint>; remove?: readonly CheckpointField[] }
  | { kind: "updates"; updates: ReadonlyArray<{ jobId: string; set: Partial<ExportCheckpoint>; remove?: readonly CheckpointField[] }> }
  | { kind: "remove"; jobId: string }
  | { kind: "sweep"; policy: RetentionPolicy };

export class CheckpointStore {
  readonly #storage: StorageGateway;
  #state: CheckpointStoreShape = EMPTY;
  #policy: RetentionPolicy = DEFAULT_RETENTION_POLICY;
  #loaded = false;

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<RetentionSweepResult> {
    if (this.#loaded) return emptySweep(this.#policy, Object.keys(this.#state.jobs).length);
    const raw = await this.#storage.get<CheckpointStoreShape>(CHECKPOINT_KEY, EMPTY);
    this.#state = {
      jobs: normalizeJobs(raw?.jobs),
      records: normalizeRecords(raw?.records)
    };
    this.#policy = await loadRetentionPolicy(this.#storage);
    this.#loaded = true;
    const interrupted = Object.entries(raw?.jobs ?? {})
      .filter(([, value]) => Boolean(value && typeof value === "object" && (value as Partial<ExportCheckpoint>).status === "running"))
      .map(([jobId]) => ({
        jobId,
        set: {
          status: "paused" as const,
          done: false,
          resumeOnBoot: true,
          error: "Interrupted before completion; resume when ready."
        }
      }));
    if (interrupted.length > 0) {
      // Persist the recovery transition before sweep so a second context cannot write the live
      // status back over the paused state this boot just discovered.
      await this.#persistMany(interrupted);
    }
    return this.sweep();
  }

  get retentionPolicy(): RetentionPolicy {
    return { ...this.#policy };
  }

  list(): ExportCheckpoint[] {
    return Object.values(this.#state.jobs);
  }

  records(jobId: string): ExportRecord[] {
    return this.#state.records[jobId] ?? [];
  }

  async start(jobId: string, surface: string, formats: ExportFormat[], preserveRawPayloads: boolean): Promise<void> {
    await this.load();
    this.#state.jobs[jobId] = {
      jobId,
      startedAt: new Date().toISOString(),
      surface,
      recordCount: 0,
      done: false,
      formats,
      preserveRawPayloads,
      status: "running",
      progress: { completed: 0, total: null },
      updatedAt: new Date().toISOString(),
      resumeOnBoot: false
    };
    this.#state.records[jobId] = [];
    await this.#persist({ kind: "start", job: cloneJob(this.#state.jobs[jobId]) });
    await this.sweep();
  }

  async append(jobId: string, batch: ExportRecord[]): Promise<void> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job || isTerminal(job.status)) return;
    const seen = new Set(this.#state.records[jobId]?.map((entry) => recordKey(entry)) ?? []);
    const records = this.#state.records[jobId] ?? [];
    for (const record of batch) {
      const key = recordKey(record);
      if (!seen.has(key)) {
        seen.add(key);
        records.push(record);
      }
    }
    const retained = this.#policy.maxRecordsPerJob > 0
      ? records.slice(-this.#policy.maxRecordsPerJob)
      : records;
    this.#state.records[jobId] = retained;
    job.recordCount = retained.length;
    job.progress = { completed: retained.length, total: job.progress.total };
    job.updatedAt = new Date().toISOString();
    await this.#persist({
      kind: "append",
      jobId,
      records: batch.map(cloneRecord),
      total: job.progress.total,
      updatedAt: job.updatedAt
    });
  }

  async finish(jobId: string): Promise<void> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (job) {
      job.done = true;
      job.status = "completed";
      job.progress = { completed: job.recordCount, total: job.progress.total ?? job.recordCount };
      job.resumeOnBoot = false;
      job.updatedAt = new Date().toISOString();
      delete job.error;
      await this.#persist({
        kind: "update",
        jobId,
        set: {
          done: true,
          status: "completed",
          progress: { ...job.progress },
          resumeOnBoot: false,
          updatedAt: job.updatedAt
        },
        remove: ["error"]
      });
    }
  }

  async pause(jobId: string): Promise<boolean> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job || isTerminal(job.status)) return false;
    job.status = "paused";
    job.done = false;
    job.resumeOnBoot = false;
    job.updatedAt = new Date().toISOString();
    await this.#persist({
      kind: "update",
      jobId,
      set: { status: "paused", done: false, resumeOnBoot: false, updatedAt: job.updatedAt }
    });
    return true;
  }

  async resume(jobId: string): Promise<boolean> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job || (job.status !== "paused" && job.status !== "queued")) return false;
    job.status = "running";
    job.done = false;
    job.resumeOnBoot = false;
    job.updatedAt = new Date().toISOString();
    delete job.error;
    await this.#persist({
      kind: "update",
      jobId,
      set: { status: "running", done: false, resumeOnBoot: false, updatedAt: job.updatedAt },
      remove: ["error"]
    });
    return true;
  }

  async cancel(jobId: string): Promise<boolean> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job || isTerminal(job.status)) return false;
    job.status = "cancelled";
    job.done = true;
    job.resumeOnBoot = false;
    job.updatedAt = new Date().toISOString();
    await this.#persist({
      kind: "update",
      jobId,
      set: { status: "cancelled", done: true, resumeOnBoot: false, updatedAt: job.updatedAt }
    });
    return true;
  }

  async fail(jobId: string, error: unknown): Promise<boolean> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job || isTerminal(job.status)) return false;
    job.status = "failed";
    job.done = true;
    job.resumeOnBoot = false;
    job.updatedAt = new Date().toISOString();
    job.error = error instanceof Error ? error.message : String(error);
    await this.#persist({
      kind: "update",
      jobId,
      set: {
        status: "failed",
        done: true,
        resumeOnBoot: false,
        updatedAt: job.updatedAt,
        error: job.error
      }
    });
    return true;
  }

  async updateProgress(jobId: string, progress: Partial<ExportJobProgress>): Promise<boolean> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job || isTerminal(job.status)) return false;
    job.progress = {
      completed: nonNegativeInteger(progress.completed, job.progress.completed),
      total: progress.total === null ? null : nonNegativeInteger(progress.total, job.progress.total ?? 0)
    };
    job.updatedAt = new Date().toISOString();
    await this.#persist({
      kind: "update",
      jobId,
      set: { progress: { ...job.progress }, updatedAt: job.updatedAt }
    });
    return true;
  }

  listResumable(): ExportCheckpoint[] {
    return this.list()
      .filter((job) => job.status === "paused" && job.resumeOnBoot)
      .sort(compareJobs);
  }

  async remove(jobId: string): Promise<void> {
    await this.load();
    delete this.#state.jobs[jobId];
    delete this.#state.records[jobId];
    await this.#persist({ kind: "remove", jobId });
  }

  async sweep(policy?: RetentionPolicy): Promise<RetentionSweepResult> {
    await this.load();
    if (policy) {
      this.#policy = normalizeRetentionPolicy(policy);
    }
    let result = emptySweep(this.#policy, Object.keys(this.#state.jobs).length);
    await this.#persist({ kind: "sweep", policy: this.#policy }, (nextResult) => {
      result = nextResult;
    });
    return result;
  }

  async #persist(
    change: CheckpointChange,
    onResult?: (result: RetentionSweepResult) => void
  ): Promise<void> {
    try {
      const next = await mutateStored<CheckpointStoreShape>(
        this.#storage,
        CHECKPOINT_KEY,
        EMPTY,
        (stored) => {
          const applied = applyCheckpointChange(stored, change, this.#policy);
          onResult?.(applied.result);
          return applied.state;
        }
      );
      this.#state = normalizeCheckpointState(next);
    } catch {
      // best effort
    }
  }

  async #persistMany(
    updates: ReadonlyArray<{ jobId: string; set: Partial<ExportCheckpoint> }>
  ): Promise<void> {
    await this.#persist({ kind: "updates", updates });
  }
}

function normalizeCheckpointState(value: unknown): CheckpointStoreShape {
  if (!value || typeof value !== "object") return { jobs: {}, records: {} };
  const raw = value as Partial<CheckpointStoreShape>;
  return {
    jobs: normalizeJobs(raw.jobs, false),
    records: normalizeRecords(raw.records)
  };
}

function cloneJob(job: ExportCheckpoint): ExportCheckpoint {
  return {
    ...job,
    formats: [...job.formats],
    progress: { ...job.progress }
  };
}

function cloneRecord(record: ExportRecord): ExportRecord {
  return { ...record };
}

function applyCheckpointChange(
  value: unknown,
  change: CheckpointChange,
  policy: RetentionPolicy
): { state: CheckpointStoreShape; result: RetentionSweepResult } {
  const state = normalizeCheckpointState(value);
  let result = emptySweep(policy, Object.keys(state.jobs).length);

  if (change.kind === "start") {
    state.jobs[change.job.jobId] = cloneJob(change.job);
    state.records[change.job.jobId] = [];
  } else if (change.kind === "append") {
    const job = state.jobs[change.jobId];
    if (job && !isTerminal(job.status)) {
      const records = state.records[change.jobId] ?? [];
      const seen = new Set(records.map((entry) => recordKey(entry)));
      for (const record of change.records) {
        const key = recordKey(record);
        if (!seen.has(key)) {
          seen.add(key);
          records.push(cloneRecord(record));
        }
      }
      const retained = policy.maxRecordsPerJob > 0
        ? records.slice(-policy.maxRecordsPerJob)
        : records;
      state.records[change.jobId] = retained;
      job.recordCount = retained.length;
      job.progress = { completed: retained.length, total: change.total };
      job.updatedAt = change.updatedAt;
    }
  } else if (change.kind === "update") {
    applyCheckpointUpdate(state, change.jobId, change.set, change.remove);
  } else if (change.kind === "updates") {
    for (const update of change.updates) {
      applyCheckpointUpdate(state, update.jobId, update.set, update.remove);
    }
  } else if (change.kind === "remove") {
    delete state.jobs[change.jobId];
    delete state.records[change.jobId];
  } else {
    const swept = sweepCheckpointState(state, policy);
    result = swept.result;
    return { state: swept.state, result };
  }

  return { state, result };
}

function applyCheckpointUpdate(
  state: CheckpointStoreShape,
  jobId: string,
  set: Partial<ExportCheckpoint>,
  remove: readonly CheckpointField[] | undefined
): void {
  const job = state.jobs[jobId];
  // A stale update cannot recreate a job removed by another tab.
  if (!job) return;
  state.jobs[jobId] = { ...job, ...set, progress: set.progress ? { ...set.progress } : { ...job.progress } };
  for (const field of remove ?? []) delete state.jobs[jobId][field];
}

function sweepCheckpointState(
  input: CheckpointStoreShape,
  policy: RetentionPolicy
): { state: CheckpointStoreShape; result: RetentionSweepResult } {
  const state = normalizeCheckpointState(input);
  const beforeJobs = Object.keys(state.jobs).length;
  const beforeRecords = Object.values(state.records).reduce((total, records) => total + records.length, 0);
  const removeIds = new Set<string>();

  if (policy.maxAgeDays > 0) {
    const cutoff = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
    for (const job of Object.values(state.jobs)) {
      const startedAt = Date.parse(job.startedAt);
      if (Number.isFinite(startedAt) && startedAt < cutoff) removeIds.add(job.jobId);
    }
  }

  if (policy.maxJobs > 0) {
    const newest = Object.values(state.jobs)
      .filter((job) => !removeIds.has(job.jobId))
      .sort(compareJobs)
      .slice(-policy.maxJobs)
      .map((job) => job.jobId);
    const keepIds = new Set(newest);
    for (const job of Object.values(state.jobs)) {
      if (!removeIds.has(job.jobId) && !keepIds.has(job.jobId)) removeIds.add(job.jobId);
    }
  }

  for (const jobId of removeIds) {
    delete state.jobs[jobId];
    delete state.records[jobId];
  }
  for (const job of Object.values(state.jobs)) {
    const records = state.records[job.jobId] ?? [];
    if (policy.maxRecordsPerJob > 0 && records.length > policy.maxRecordsPerJob) {
      state.records[job.jobId] = records.slice(-policy.maxRecordsPerJob);
    }
    job.recordCount = state.records[job.jobId]?.length ?? 0;
  }

  const afterRecords = Object.values(state.records).reduce((total, records) => total + records.length, 0);
  return {
    state,
    result: {
      removedJobs: beforeJobs - Object.keys(state.jobs).length,
      removedRecords: beforeRecords - afterRecords,
      retainedJobs: Object.keys(state.jobs).length,
      policy: { ...policy }
    }
  };
}

export function normalizeRetentionPolicy(input: unknown): RetentionPolicy {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    maxJobs: retentionNumber(record.maxJobs, DEFAULT_RETENTION_POLICY.maxJobs, 10_000),
    maxRecordsPerJob: retentionNumber(
      record.maxRecordsPerJob,
      DEFAULT_RETENTION_POLICY.maxRecordsPerJob,
      100_000
    ),
    maxAgeDays: retentionNumber(record.maxAgeDays, DEFAULT_RETENTION_POLICY.maxAgeDays, 3_650)
  };
}

export async function loadRetentionPolicy(storage: StorageGateway): Promise<RetentionPolicy> {
  const [maxJobs, maxRecordsPerJob, maxAgeDays] = await Promise.all([
    storage.get<unknown>(RETENTION_KEYS.maxJobs, DEFAULT_RETENTION_POLICY.maxJobs),
    storage.get<unknown>(RETENTION_KEYS.maxRecordsPerJob, DEFAULT_RETENTION_POLICY.maxRecordsPerJob),
    storage.get<unknown>(RETENTION_KEYS.maxAgeDays, DEFAULT_RETENTION_POLICY.maxAgeDays)
  ]);
  return normalizeRetentionPolicy({ maxJobs, maxRecordsPerJob, maxAgeDays });
}

export async function saveRetentionPolicy(
  storage: StorageGateway,
  input: RetentionPolicy
): Promise<RetentionPolicy> {
  const policy = normalizeRetentionPolicy(input);
  await Promise.all([
    replaceStored(storage, RETENTION_KEYS.maxJobs, policy.maxJobs),
    replaceStored(storage, RETENTION_KEYS.maxRecordsPerJob, policy.maxRecordsPerJob),
    replaceStored(storage, RETENTION_KEYS.maxAgeDays, policy.maxAgeDays)
  ]);
  return policy;
}

function retentionNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function compareJobs(left: ExportCheckpoint, right: ExportCheckpoint): number {
  const leftAt = Date.parse(left.startedAt);
  const rightAt = Date.parse(right.startedAt);
  if (leftAt !== rightAt) return leftAt - rightAt;
  return left.jobId.localeCompare(right.jobId);
}

function emptySweep(policy: RetentionPolicy, retainedJobs: number): RetentionSweepResult {
  return { removedJobs: 0, removedRecords: 0, retainedJobs, policy: { ...policy } };
}

function recordKey(record: ExportRecord): string {
  const identity = record.tweetId
    ? `tweet:${record.tweetId}`
    : `source:${record.permalink ?? ""}|${record.surface}|${record.handle ?? ""}`;
  return `${identity}|${record.text.length}|${hashRecordText(record.text)}`;
}

function normalizeJobs(input: unknown, recoverRunning = true): Record<string, ExportCheckpoint> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, ExportCheckpoint> = {};
  for (const [jobId, value] of Object.entries(input)) {
    const job = normalizeJob(value, jobId, recoverRunning);
    if (job) result[job.jobId] = job;
  }
  return result;
}

function normalizeRecords(input: unknown): Record<string, ExportRecord[]> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, ExportRecord[]> = {};
  for (const [jobId, records] of Object.entries(input)) {
    if (Array.isArray(records)) result[jobId] = records as ExportRecord[];
  }
  return result;
}

function normalizeJob(value: unknown, fallbackId: string, recoverRunning = true): ExportCheckpoint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ExportCheckpoint>;
  const jobId = typeof raw.jobId === "string" && raw.jobId.length > 0 ? raw.jobId : fallbackId;
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : new Date(0).toISOString();
  const recordCount = nonNegativeInteger(raw.recordCount, 0);
  const persistedStatus = validStatus(raw.status)
    ? raw.status
    : raw.done === true
      ? "completed"
      : "paused";
  // A process that died cannot leave a live runner behind. Reclassify it as an interrupted,
  // user-visible pause and make it eligible for the next boot's explicit resume check.
  const status = recoverRunning && persistedStatus === "running" ? "paused" : persistedStatus;
  const progress = normalizeProgress(raw.progress, recordCount);
  return {
    jobId,
    startedAt,
    surface: typeof raw.surface === "string" ? raw.surface : "unknown",
    recordCount,
    done: status === "completed" || status === "cancelled" || status === "failed",
    formats: Array.isArray(raw.formats) ? raw.formats.filter(isExportFormat) : ["json"],
    preserveRawPayloads: raw.preserveRawPayloads === true,
    status,
    progress,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : startedAt,
    resumeOnBoot: status === "paused" && (persistedStatus === "running" || raw.resumeOnBoot !== false),
    ...(typeof raw.error === "string" && raw.error.length > 0 ? { error: raw.error } : {})
  };
}

function normalizeProgress(value: unknown, fallback: number): ExportJobProgress {
  if (!value || typeof value !== "object") return { completed: fallback, total: null };
  const raw = value as Partial<ExportJobProgress>;
  return {
    completed: nonNegativeInteger(raw.completed, fallback),
    total: raw.total === null ? null : nonNegativeInteger(raw.total, fallback)
  };
}

function validStatus(value: unknown): value is ExportJobStatus {
  return value === "queued" || value === "running" || value === "paused" || value === "cancelled" || value === "failed" || value === "completed";
}

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "json" || value === "csv" || value === "html" || value === "markdown" || value === "xlsx";
}

function isTerminal(status: ExportJobStatus): boolean {
  return status === "cancelled" || status === "failed" || status === "completed";
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function hashRecordText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
