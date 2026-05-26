import type { StorageGateway } from "../../platform/storage";
import type { ExportCheckpoint, ExportFormat, ExportRecord } from "./types";

export const CHECKPOINT_KEY = "aviary.export.checkpoints.v1";

export interface CheckpointStoreShape {
  jobs: Record<string, ExportCheckpoint>;
  records: Record<string, ExportRecord[]>;
}

const EMPTY: CheckpointStoreShape = { jobs: {}, records: {} };

export class CheckpointStore {
  readonly #storage: StorageGateway;
  #state: CheckpointStoreShape = EMPTY;
  #loaded = false;

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const raw = await this.#storage.get<CheckpointStoreShape>(CHECKPOINT_KEY, EMPTY);
    this.#state = {
      jobs: { ...(raw?.jobs ?? {}) },
      records: { ...(raw?.records ?? {}) }
    };
    this.#loaded = true;
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
    this.#state.records[jobId] = records;
    job.recordCount = records.length;
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

  async #persist(): Promise<void> {
    try {
      await this.#storage.set(CHECKPOINT_KEY, this.#state);
    } catch {
      // best effort
    }
  }
}

function recordKey(record: ExportRecord): string {
  return `${record.tweetId ?? ""}|${record.handle ?? ""}|${record.text.slice(0, 80)}`;
}
