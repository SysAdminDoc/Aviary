export type JobStatus = "queued" | "running" | "completed" | "failed" | "duplicate";

export interface DownloadJob {
  id: string;
  url: string;
  filename: string;
  status: JobStatus;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface QueueSnapshot {
  total: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  duplicate: number;
  recent: DownloadJob[];
}

const RECENT_LIMIT = 40;

export class DownloadQueue {
  readonly #jobs: DownloadJob[] = [];
  readonly #listeners = new Set<(snapshot: QueueSnapshot) => void>();
  #seq = 0;

  enqueue(job: Omit<DownloadJob, "id" | "status">): DownloadJob {
    const entry: DownloadJob = {
      id: `job-${++this.#seq}`,
      status: "queued",
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
    }
    job.status = status;
    if (error) {
      job.error = error;
    } else if (status !== "failed") {
      delete job.error;
    }
    this.#notify();
  }

  snapshot(): QueueSnapshot {
    const counts: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      duplicate: 0
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
    this.#notify();
  }

  #trim(): void {
    while (this.#jobs.length > 200) {
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
}
