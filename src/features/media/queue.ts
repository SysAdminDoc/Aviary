import type { StorageGateway } from "../../platform/storage.ts";
import { mutateStored } from "../../platform/storage-lock.ts";
import {
  normalizeMediaSidecarRequest,
  type MediaSidecarRequest
} from "./sidecar.ts";

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed"
  | "opened"
  | "duplicate";

export interface DownloadJob {
  id: string;
  url: string;
  fallbackUrls?: string[];
  filename: string;
  kind?: "photo" | "video" | "thumbnail" | "audio" | "subtitle";
  mediaId?: string | null;
  /** Browser download id retained while a handoff awaits terminal confirmation. */
  downloadId?: number;
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
  opened: number;
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

type QueueField = keyof DownloadJob;

type QueueChange =
  | { kind: "add"; job: DownloadJob; sequence: number }
  | { kind: "update"; id: string; set: Partial<DownloadJob>; remove?: readonly QueueField[] }
  | { kind: "updates"; updates: ReadonlyArray<{ id: string; set: Partial<DownloadJob>; remove?: readonly QueueField[] }> }
  | { kind: "remove"; id: string }
  | { kind: "clear"; sequence: number };

export class DownloadQueue {
  readonly #jobs: DownloadJob[] = [];
  readonly #listeners = new Set<(snapshot: QueueSnapshot) => void>();
  readonly #storage: StorageGateway | undefined;
  readonly #onPersistError: ((error: unknown) => void) | undefined;
  #seq = 0;
  #loaded = false;
  #persistTail: Promise<void> = Promise.resolve();
  #changeSequence = 0;
  #pendingChanges: Array<{ token: number; change: QueueChange }> = [];
  #lastPersistFailure: { token: number; error: unknown } | undefined;

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
      const interrupted = jobs
        .filter((job) => job.status === "paused" && job.resumeOnBoot)
        .map((job) => ({
          id: job.id,
          set: {
            status: "paused" as const,
            resumeOnBoot: true,
            ...(job.error ? { error: job.error } : {})
          }
        }));
      if (interrupted.length > 0) {
        this.#persist({ kind: "updates", updates: interrupted });
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
    const through = this.#changeSequence;
    await this.#persistTail;
    const failure = this.#lastPersistFailure;
    if (failure && failure.token <= through) {
      this.#lastPersistFailure = undefined;
      throw failure.error;
    }
  }

  enqueue(job: Omit<DownloadJob, "id" | "status">): DownloadJob {
    const entry: DownloadJob = {
      id: `job-${++this.#seq}-${randomSuffix()}`,
      status: "queued",
      resumeOnBoot: true,
      ...job
    };
    this.#jobs.push(entry);
    this.#trim();
    this.#persist({ kind: "add", job: cloneJob(entry), sequence: this.#seq });
    this.#notify();
    return entry;
  }

  /** Refreshes a queued target after a late metadata observation improves its direct URL. */
  updateTarget(
    jobId: string,
    target: Pick<DownloadJob, "url" | "fallbackUrls" | "mediaId">
  ): boolean {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job || (job.status !== "queued" && job.status !== "paused")) return false;
    job.url = target.url;
    if (target.fallbackUrls === undefined) delete job.fallbackUrls;
    else job.fallbackUrls = [...target.fallbackUrls];
    if (target.mediaId === undefined) delete job.mediaId;
    else job.mediaId = target.mediaId;
    const remove: QueueField[] = [];
    if (target.fallbackUrls === undefined) remove.push("fallbackUrls");
    if (target.mediaId === undefined) remove.push("mediaId");
    this.#persist({
      kind: "update",
      id: jobId,
      set: {
        url: target.url,
        ...(target.fallbackUrls === undefined ? {} : { fallbackUrls: [...target.fallbackUrls] }),
        ...(target.mediaId === undefined ? {} : { mediaId: target.mediaId })
      },
      ...(remove.length > 0 ? { remove } : {})
    });
    this.#notify();
    return true;
  }

  mark(jobId: string, status: JobStatus, error?: string): void {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job) {
      return;
    }
    if (status === "running" && !job.startedAt) {
      job.startedAt = new Date().toISOString();
    }
    if (status === "completed" || status === "failed" || status === "opened" || status === "duplicate") {
      job.finishedAt = new Date().toISOString();
      job.resumeOnBoot = false;
      delete job.downloadId;
    }
    if (status === "cancelled") {
      job.finishedAt = new Date().toISOString();
      job.resumeOnBoot = false;
      delete job.downloadId;
    }
    job.status = status;
    if (error) {
      job.error = error;
    } else if (status !== "failed") {
      delete job.error;
    }
    const set: Partial<DownloadJob> = { status };
    const remove: QueueField[] = [];
    if (status === "running" && job.startedAt) set.startedAt = job.startedAt;
    if (status === "completed" || status === "failed" || status === "opened" || status === "duplicate" || status === "cancelled") {
      if (job.finishedAt) set.finishedAt = job.finishedAt;
      set.resumeOnBoot = false;
      remove.push("downloadId");
    }
    if (error) set.error = error;
    else if (status !== "failed") remove.push("error");
    this.#persist({ kind: "update", id: jobId, set, remove });
    this.#notify();
  }

  trackDownload(jobId: string, downloadId: number): void {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job || !Number.isSafeInteger(downloadId) || downloadId < 0) return;
    job.downloadId = downloadId;
    this.#persist({ kind: "update", id: jobId, set: { downloadId } });
    this.#notify();
  }

  pause(jobId: string): boolean {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "opened" || job.status === "duplicate" || job.status === "cancelled") return false;
    job.status = "paused";
    job.resumeOnBoot = false;
    job.error = "Paused by user.";
    this.#persist({
      kind: "update",
      id: jobId,
      set: { status: "paused", resumeOnBoot: false, error: "Paused by user." }
    });
    this.#notify();
    return true;
  }

  resume(jobId: string): boolean {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job || (job.status !== "paused" && job.status !== "queued")) return false;
    job.status = "queued";
    job.resumeOnBoot = false;
    delete job.error;
    this.#persist({ kind: "update", id: jobId, set: { status: "queued", resumeOnBoot: false }, remove: ["error"] });
    this.#notify();
    return true;
  }

  cancel(jobId: string): boolean {
    const job = this.#jobs.find((entry) => entry.id === jobId);
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "opened" || job.status === "duplicate" || job.status === "cancelled") return false;
    job.status = "cancelled";
    job.resumeOnBoot = false;
    job.finishedAt = new Date().toISOString();
    this.#persist({
      kind: "update",
      id: jobId,
      set: { status: "cancelled", resumeOnBoot: false, finishedAt: job.finishedAt }
    });
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
      this.#persist({
        kind: "updates",
        updates: retryable.map((job) => ({
          id: job.id,
          set: { status: "queued" as const, resumeOnBoot: true },
          remove: ["error", "finishedAt"] as QueueField[]
        }))
      });
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
      opened: 0,
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
      opened: counts.opened,
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
    this.#persist({ kind: "clear", sequence: this.#seq });
    this.#notify();
  }

  remove(jobId: string): boolean {
    const index = this.#jobs.findIndex((job) => job.id === jobId);
    if (index < 0) return false;
    this.#jobs.splice(index, 1);
    this.#persist({ kind: "remove", id: jobId });
    this.#notify();
    return true;
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

  #persist(change: QueueChange): void {
    void this.#queuePersist(change).catch(() => undefined);
  }

  #queuePersist(change: QueueChange): Promise<void> {
    if (!this.#storage) return Promise.resolve();
    const token = ++this.#changeSequence;
    this.#pendingChanges.push({ token, change });
    const write = this.#persistTail.then(() =>
      mutateStored<QueueState>(
        this.#storage!,
        MEDIA_QUEUE_KEY,
        { sequence: 0, jobs: [] },
        (stored) => applyQueueChange(stored, change)
      )
    ).then((next) => {
      this.#pendingChanges = this.#pendingChanges.filter((entry) => entry.token !== token);
      this.#adopt(next, change);
      for (const pending of this.#pendingChanges) {
        this.#adopt(applyQueueChange(this.#currentState(), pending.change));
      }
    });
    this.#persistTail = write.catch((error) => {
      this.#pendingChanges = this.#pendingChanges.filter((entry) => entry.token !== token);
      this.#lastPersistFailure = { token, error };
      this.#onPersistError?.(error);
    });
    return write;
  }

  #currentState(): QueueState {
    return { sequence: this.#seq, jobs: this.#jobs.map(cloneJob) };
  }

  #adopt(next: QueueState, change?: QueueChange): void {
    const normalized = normalizeQueueState(next);
    const preserveMissing = change?.kind === "update" || change?.kind === "updates";
    const existing = preserveMissing
      ? new Map(this.#jobs.map((job) => [job.id, cloneJob(job)]))
      : undefined;
    if (existing) {
      for (const job of normalized.jobs) existing.set(job.id, cloneJob(job));
      // Some lightweight callers intentionally provide a no-op persistence gateway. Keep their
      // local status visible when the gateway returns its empty fallback, while real writes still
      // adopt every merged job that the transaction read.
      for (const job of existing.values()) {
        if (!normalized.jobs.some((entry) => entry.id === job.id)) normalized.jobs.push(job);
      }
    }
    this.#jobs.length = 0;
    this.#jobs.push(...normalized.jobs.map(cloneJob));
    this.#seq = Math.max(normalized.sequence, ...this.#jobs.map((job) => sequenceFromId(job.id)));
  }
}

function isDownloadJob(value: unknown): value is DownloadJob {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.url === "string" && typeof record.filename === "string";
}

function normalizeJob(value: DownloadJob): DownloadJob {
  const valid = value.status === "queued" || value.status === "running" || value.status === "completed" || value.status === "failed" || value.status === "opened" || value.status === "duplicate" || value.status === "paused" || value.status === "cancelled";
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
    ...(value.kind === "photo" || value.kind === "video" || value.kind === "thumbnail" || value.kind === "audio" || value.kind === "subtitle"
      ? { kind: value.kind }
      : {}),
    ...(typeof value.mediaId === "string"
      ? { mediaId: value.mediaId.slice(0, 160) }
      : value.mediaId === null
        ? { mediaId: null }
        : {}),
    ...(sidecar ? { sidecar } : {}),
    ...(typeof value.downloadId === "number" && Number.isSafeInteger(value.downloadId) && value.downloadId >= 0
      ? { downloadId: value.downloadId }
      : {}),
    status: valid ? value.status : "failed",
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.startedAt === "string" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.finishedAt === "string" ? { finishedAt: value.finishedAt } : {}),
    resumeOnBoot: value.resumeOnBoot === true
  };
}

function sequenceFromId(id: string): number {
  const match = /^job-(\d+)/.exec(id);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

function randomSuffix(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replaceAll("-", "").slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

function cloneJob(job: DownloadJob): DownloadJob {
  return {
    ...job,
    ...(job.fallbackUrls ? { fallbackUrls: [...job.fallbackUrls] } : {}),
    ...(job.sidecar ? { sidecar: { ...job.sidecar } } : {})
  };
}

function normalizeQueueState(value: unknown): QueueState {
  if (!value || typeof value !== "object") return { sequence: 0, jobs: [] };
  const raw = value as Partial<QueueState>;
  const jobs = Array.isArray(raw.jobs)
    ? raw.jobs.filter(isDownloadJob).map(normalizeJob).slice(-QUEUE_LIMIT)
    : [];
  const sequence = Math.max(
    Number.isFinite(raw.sequence) ? Math.trunc(raw.sequence as number) : 0,
    ...jobs.map((job) => sequenceFromId(job.id))
  );
  return { sequence, jobs };
}

function applyQueueChange(value: unknown, change: QueueChange): QueueState {
  const state = normalizeQueueState(value);
  if (change.kind === "clear") {
    return { sequence: Math.max(state.sequence, change.sequence), jobs: [] };
  }
  const byId = new Map(state.jobs.map((job) => [job.id, cloneJob(job)]));
  if (change.kind === "add") {
    byId.set(change.job.id, cloneJob(change.job));
  } else if (change.kind === "remove") {
    byId.delete(change.id);
  } else {
    const updates = change.kind === "update" ? [change] : change.updates;
    for (const update of updates) {
      const current = byId.get(update.id);
      // An update from a stale tab must not resurrect a job explicitly cleared elsewhere.
      if (!current) continue;
      const next = { ...current, ...update.set };
      for (const field of update.remove ?? []) delete next[field];
      byId.set(update.id, next);
    }
  }
  return {
    sequence: Math.max(state.sequence, change.kind === "add" ? change.sequence : 0),
    jobs: [...byId.values()].slice(-QUEUE_LIMIT)
  };
}
