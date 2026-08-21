import type { StorageGateway } from "../../platform/storage";
import {
  normalizeMediaSidecarRequest,
  type MediaSidecarRequest
} from "./sidecar";

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed"
  | "duplicate";

export interface DownloadJob {
  id: string;
  url: string;
  fallbackUrls?: string[];
  filename: string;
  kind?: "photo" | "video" | "thumbnail";
  mediaId?: string | null;
  sidecar?: MediaSidecarRequest;
  status: JobStatus;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  resumeOnBoot?: boolean;
}

export interface QueueSnapshot {
  total: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  duplicate: number;
  paused: number;
  cancelled: number;
  recent: DownloadJob[];
}

export const MEDIA_QUEUE_KEY = "aviary.media.queue.v1";
const RECENT_LIMIT = 40;
const QUEUE_LIMIT = 5_000;
interface QueueState {
  sequence: number;
  jobs: DownloadJob[];
}

export class DownloadQueue {
  readonly #jobs: DownloadJob[] = [];
  readonly #listeners = new Set<(snapshot: QueueSnapshot) => void>();
  readonly #storage: StorageGateway | undefined;
  readonly #onPersistError: ((error: unknown) => void) | undefined;
  #seq = 0;
  #loaded = false;
  #persistTail: Promise<void> = Promise.resolve();

  constructor(storage?: StorageGateway, onPersistError?: (error: unknown) => void) {
    this.#storage = storage;
    this.#onPersistError = onPersistError;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    if (!this.#storage) return;
    try {
      const raw = await this.#storage.get<QueueState>(MEDIA_QUEUE_KEY, { sequence: 0, jobs: [] });
      const jobs = Array.isArray(raw?.jobs) ? raw.jobs.filter(isDownloadJob).map(normalizeJob) : [];
      for (const job of jobs) {
        if (job.status === "running") {
          job.status = "paused";
          job.resumeOnBoot = true;
          job.error = "Interrupted before completion; resume when ready.";
        }
      }
      this.#jobs.push(...jobs.slice(-QUEUE_LIMIT));
      this.#seq = Math.max(
        Number.isFinite(raw?.sequence) ? Math.trunc(raw.sequence) : 0,
        ...this.#jobs.map((job) => sequenceFromId(job.id))
      );
      if (jobs.some((job) => job.status === "paused" && job.resumeOnBoot)) {
        this.#persist();
      }
      this.#notify();
    } catch (error) {
      this.#onPersistError?.(error);
    }
  }

  async flush(): Promise<void> {
    await this.#persistTail;
  }

  /** Persists every queued item before a batch starts its first external handoff. */
  async checkpoint(): Promise<void> {
    this.#persist();
    await this.flush();
  }

  enqueue(job: Omit<DownloadJob, "id" | "status">): DownloadJob {
    const entry: DownloadJob = {
      id: `job-${++this.#seq}`,
      status: "queued",
      resumeOnBoot: true,
      ...job
    };
    this.#jobs.push(entry);
    this.#trim();
    this.#notify();
    return entry;
  }

  mark(jobId: string, status: JobStatus, error?: string): void {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job) {
      return;
    }
    if (status === "running" && !job.startedAt) {
      job.startedAt = new Date().toISOString();
    }
    if (status === "completed" || status === "failed" || status === "duplicate") {
      job.finishedAt = new Date().toISOString();
      job.resumeOnBoot = false;
    }
    if (status === "cancelled") {
      job.finishedAt = new Date().toISOString();
      job.resumeOnBoot = false;
    }
    job.status = status;
    if (error) {
      job.error = error;
    } else if (status !== "failed") {
      delete job.error;
    }
    this.#persist();
    this.#notify();
  }

  pause(jobId: string): boolean {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "duplicate" || job.status === "cancelled") return false;
    job.status = "paused";
    job.resumeOnBoot = false;
    job.error = "Paused by user.";
    this.#persist();
    this.#notify();
    return true;
  }

  resume(jobId: string): boolean {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job || (job.status !== "paused" && job.status !== "queued")) return false;
    job.status = "queued";
    job.resumeOnBoot = false;
    delete job.error;
    this.#persist();
    this.#notify();
    return true;
  }

  cancel(jobId: string): boolean {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "duplicate" || job.status === "cancelled") return false;
    job.status = "cancelled";
    job.resumeOnBoot = false;
    job.finishedAt = new Date().toISOString();
    this.#persist();
    this.#notify();
    return true;
  }

  retryFailed(): DownloadJob[] {
    const retryable = this.#jobs.filter(
      (job) => job.status === "failed" || job.status === "cancelled"
    );
    for (const job of retryable) {
      job.status = "queued";
      job.resumeOnBoot = true;
      delete job.error;
      delete job.finishedAt;
    }
    if (retryable.length > 0) {
      this.#persist();
      this.#notify();
    }
    return retryable.map((job) => ({ ...job }));
  }

  pending(resumeOnBoot = false): DownloadJob[] {
    return this.#jobs
      .filter((job) => (job.status === "queued" || job.status === "paused") && (!resumeOnBoot || job.resumeOnBoot === true))
      .map((job) => ({ ...job }));
  }

  snapshot(): QueueSnapshot {
    const counts: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      duplicate: 0,
      paused: 0,
      cancelled: 0
    };
    for (const job of this.#jobs) {
      counts[job.status] += 1;
    }
    return {
      total: this.#jobs.length,
      queued: counts.queued,
      running: counts.running,
      completed: counts.completed,
      failed: counts.failed,
      duplicate: counts.duplicate,
      paused: counts.paused,
      cancelled: counts.cancelled,
      recent: this.#jobs.slice(-RECENT_LIMIT)
    };
  }

  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  clear(): void {
    this.#jobs.length = 0;
    this.#persist();
    this.#notify();
  }

  #trim(): void {
    while (this.#jobs.length > QUEUE_LIMIT) {
      this.#jobs.shift();
    }
  }

  #notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // Listeners are non-critical; swallow errors.
      }
    }
  }

  #persist(): void {
    if (!this.#storage) return;
    const snapshot: QueueState = {
      sequence: this.#seq,
      jobs: this.#jobs.map((job) => ({ ...job }))
    };
    this.#persistTail = this.#persistTail
      .then(() => this.#storage!.set(MEDIA_QUEUE_KEY, snapshot))
      .catch((error) => {
        this.#onPersistError?.(error);
      });
  }
}

function isDownloadJob(value: unknown): value is DownloadJob {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.url === "string" && typeof record.filename === "string";
}

function normalizeJob(value: DownloadJob): DownloadJob {
  const valid = value.status === "queued" || value.status === "running" || value.status === "completed" || value.status === "failed" || value.status === "duplicate" || value.status === "paused" || value.status === "cancelled";
  const sidecar = normalizeMediaSidecarRequest(value.sidecar);
  return {
    id: value.id,
    url: value.url,
    ...(Array.isArray(value.fallbackUrls)
      ? {
          fallbackUrls: value.fallbackUrls
            .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url))
            .slice(0, 8)
        }
      : {}),
    filename: value.filename,
    ...(value.kind === "photo" || value.kind === "video" || value.kind === "thumbnail"
      ? { kind: value.kind }
      : {}),
    ...(typeof value.mediaId === "string"
      ? { mediaId: value.mediaId.slice(0, 160) }
      : value.mediaId === null
        ? { mediaId: null }
        : {}),
    ...(sidecar ? { sidecar } : {}),
    status: valid ? value.status : "failed",
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.startedAt === "string" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.finishedAt === "string" ? { finishedAt: value.finishedAt } : {}),
    resumeOnBoot: value.resumeOnBoot === true
  };
}

function sequenceFromId(id: string): number {
  const match = /^job-(\d+)$/.exec(id);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}
