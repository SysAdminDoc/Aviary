import type { StorageGateway } from "../../platform/storage";
import type { ExportCheckpoint, ExportFormat, ExportRecord } from "./types";

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
      jobs: { ...(raw?.jobs ?? {}) },
      records: { ...(raw?.records ?? {}) }
    };
    this.#policy = await loadRetentionPolicy(this.#storage);
    this.#loaded = true;
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
      preserveRawPayloads
    };
    this.#state.records[jobId] = [];
    await this.#persist();
    await this.sweep();
  }

  async append(jobId: string, batch: ExportRecord[]): Promise<void> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (!job) return;
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
    await this.#persist();
  }

  async finish(jobId: string): Promise<void> {
    await this.load();
    const job = this.#state.jobs[jobId];
    if (job) {
      job.done = true;
      await this.#persist();
    }
  }

  async remove(jobId: string): Promise<void> {
    await this.load();
    delete this.#state.jobs[jobId];
    delete this.#state.records[jobId];
    await this.#persist();
  }

  async sweep(policy?: RetentionPolicy): Promise<RetentionSweepResult> {
    await this.load();
    if (policy) {
      this.#policy = normalizeRetentionPolicy(policy);
    }

    const beforeJobs = Object.keys(this.#state.jobs).length;
    const beforeRecords = Object.values(this.#state.records).reduce(
      (total, records) => total + records.length,
      0
    );
    const removeIds = new Set<string>();

    if (this.#policy.maxAgeDays > 0) {
      const cutoff = Date.now() - this.#policy.maxAgeDays * 24 * 60 * 60 * 1000;
      for (const job of Object.values(this.#state.jobs)) {
        const startedAt = Date.parse(job.startedAt);
        if (Number.isFinite(startedAt) && startedAt < cutoff) {
          removeIds.add(job.jobId);
        }
      }
    }

    if (this.#policy.maxJobs > 0) {
      const newest = Object.values(this.#state.jobs)
        .filter((job) => !removeIds.has(job.jobId))
        .sort(compareJobs)
        .slice(-this.#policy.maxJobs)
        .map((job) => job.jobId);
      const keepIds = new Set(newest);
      for (const job of Object.values(this.#state.jobs)) {
        if (!removeIds.has(job.jobId) && !keepIds.has(job.jobId)) {
          removeIds.add(job.jobId);
        }
      }
    }

    for (const jobId of removeIds) {
      delete this.#state.jobs[jobId];
      delete this.#state.records[jobId];
    }

    for (const job of Object.values(this.#state.jobs)) {
      const records = this.#state.records[job.jobId] ?? [];
      if (this.#policy.maxRecordsPerJob > 0 && records.length > this.#policy.maxRecordsPerJob) {
        this.#state.records[job.jobId] = records.slice(-this.#policy.maxRecordsPerJob);
      }
      job.recordCount = this.#state.records[job.jobId]?.length ?? 0;
    }

    const afterRecords = Object.values(this.#state.records).reduce(
      (total, records) => total + records.length,
      0
    );
    const result: RetentionSweepResult = {
      removedJobs: beforeJobs - Object.keys(this.#state.jobs).length,
      removedRecords: beforeRecords - afterRecords,
      retainedJobs: Object.keys(this.#state.jobs).length,
      policy: this.retentionPolicy
    };
    if (result.removedJobs > 0 || result.removedRecords > 0) {
      await this.#persist();
    }
    return result;
  }

  async #persist(): Promise<void> {
    try {
      await this.#storage.set(CHECKPOINT_KEY, this.#state);
    } catch {
      // best effort
    }
  }
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
    storage.set(RETENTION_KEYS.maxJobs, policy.maxJobs),
    storage.set(RETENTION_KEYS.maxRecordsPerJob, policy.maxRecordsPerJob),
    storage.set(RETENTION_KEYS.maxAgeDays, policy.maxAgeDays)
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

function hashRecordText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
