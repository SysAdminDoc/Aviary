export type ApplyPassType = "full" | "incremental";

export interface FeaturePerformanceMetric {
  featureId: string;
  invocationCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  fullPasses: number;
  incrementalPasses: number;
  longFrameCount: number;
}

export interface ApplyTimingSample {
  featureId: string;
  passType: ApplyPassType;
  durationMs: number;
}

export interface LongFramePerformanceSummary {
  supported: boolean;
  observed: number;
  totalDurationMs: number;
  maxDurationMs: number;
  correlatedPasses: number;
  reason?: string;
}

export interface PerformanceMetricsSnapshot {
  version: 1;
  features: FeaturePerformanceMetric[];
  recentPasses: ApplyTimingSample[];
  longFrames: LongFramePerformanceSummary;
}

export interface LongAnimationFrameEntryLike {
  startTime?: unknown;
  duration?: unknown;
}

export interface LongAnimationFrameEntryListLike {
  getEntries(): ArrayLike<LongAnimationFrameEntryLike>;
}

export interface LongAnimationFrameObserverLike {
  observe(options: { type: "long-animation-frame"; buffered: boolean }): void;
  disconnect(): void;
}

export interface LongAnimationFrameObserverConstructor {
  new (callback: (list: LongAnimationFrameEntryListLike) => void): LongAnimationFrameObserverLike;
  supportedEntryTypes?: readonly string[];
}

export interface PerformanceDiagnosticsOptions {
  /** Test seam for browsers with and without Long Animation Frame timing. */
  observerFactory?: LongAnimationFrameObserverConstructor | null;
}

const MAX_FEATURES = 128;
const MAX_RECENT_PASSES = 256;
const MAX_LONG_FRAMES = 64;

interface MutableFeatureMetric extends FeaturePerformanceMetric {}

interface TimingWindow {
  key: number;
  featureId: string;
  passType: ApplyPassType;
  startTime: number;
  endTime: number;
  correlatedFrames: Set<number>;
}

interface LongFrameWindow {
  key: number;
  startTime: number;
  endTime: number;
  durationMs: number;
}

/**
 * Keeps a small, content-free view of feature apply cost for the current page.
 *
 * Nothing here is persisted. The rings are intentionally capped so a long-lived tab cannot turn
 * performance support into a second cache, and feature IDs are reduced to a safe identifier shape
 * before they can reach the Advanced panel or a copied support report.
 */
export class FeaturePerformanceDiagnostics {
  readonly #features = new Map<string, MutableFeatureMetric>();
  readonly #recentPasses: TimingWindow[] = [];
  readonly #longFrames: LongFrameWindow[] = [];
  #nextSampleKey = 0;
  #nextFrameKey = 0;
  #observedLongFrames = 0;
  #totalLongFrameDurationMs = 0;
  #maxLongFrameDurationMs = 0;
  #correlatedPasses = 0;
  #observer: LongAnimationFrameObserverLike | null = null;
  #longFrameSupported = false;
  #longFrameReason: string | undefined;

  constructor(options: PerformanceDiagnosticsOptions = {}) {
    const factory = Object.hasOwn(options, "observerFactory")
      ? options.observerFactory
      : detectLongAnimationFrameObserver();
    if (!factory) {
      this.#longFrameReason = "Long Animation Frame timing is unavailable in this browser.";
      return;
    }
    if (factory.supportedEntryTypes && !factory.supportedEntryTypes.includes("long-animation-frame")) {
      this.#longFrameReason = "Long Animation Frame timing is unavailable in this browser.";
      return;
    }
    try {
      const observer = new factory((list) => this.#handleLongFrames(list));
      observer.observe({ type: "long-animation-frame", buffered: true });
      this.#observer = observer;
      this.#longFrameSupported = true;
    } catch {
      this.#longFrameReason = "Long Animation Frame timing is unavailable in this browser.";
    }
  }

  record(
    featureId: string,
    passType: ApplyPassType,
    durationMs: number,
    startTime = now(),
    endTime = startTime + Math.max(0, finiteDuration(durationMs))
  ): void {
    const safeId = safeFeatureId(featureId);
    const duration = finiteDuration(durationMs);
    const start = Number.isFinite(startTime) ? startTime : now();
    const end = Number.isFinite(endTime) ? Math.max(start, endTime) : start + duration;
    let metric = this.#features.get(safeId);
    if (!metric && this.#features.size < MAX_FEATURES) {
      metric = {
        featureId: safeId,
        invocationCount: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        fullPasses: 0,
        incrementalPasses: 0,
        longFrameCount: 0
      };
      this.#features.set(safeId, metric);
    }
    if (metric) {
      metric.invocationCount += 1;
      metric.totalDurationMs += duration;
      metric.maxDurationMs = Math.max(metric.maxDurationMs, duration);
      if (passType === "full") metric.fullPasses += 1;
      else metric.incrementalPasses += 1;
    }

    const sample: TimingWindow = {
      key: ++this.#nextSampleKey,
      featureId: safeId,
      passType,
      startTime: start,
      endTime: end,
      correlatedFrames: new Set()
    };
    this.#recentPasses.push(sample);
    if (this.#recentPasses.length > MAX_RECENT_PASSES) {
      this.#recentPasses.shift();
    }
    if (this.#longFrameSupported) {
      for (const frame of this.#longFrames) this.#correlate(sample, frame);
    }
  }

  snapshot(): PerformanceMetricsSnapshot {
    return {
      version: 1,
      features: [...this.#features.values()].map((metric) => ({
        ...metric,
        totalDurationMs: roundMs(metric.totalDurationMs),
        maxDurationMs: roundMs(metric.maxDurationMs)
      })),
      recentPasses: this.#recentPasses.map((sample) => ({
        featureId: sample.featureId,
        passType: sample.passType,
        durationMs: roundMs(sample.endTime - sample.startTime)
      })),
      longFrames: {
        supported: this.#longFrameSupported,
        observed: this.#observedLongFrames,
        totalDurationMs: roundMs(this.#totalLongFrameDurationMs),
        maxDurationMs: roundMs(this.#maxLongFrameDurationMs),
        correlatedPasses: this.#correlatedPasses,
        ...(this.#longFrameReason ? { reason: this.#longFrameReason } : {})
      }
    };
  }

  reset(): void {
    this.#features.clear();
    this.#recentPasses.length = 0;
    this.#longFrames.length = 0;
    this.#nextSampleKey = 0;
    this.#nextFrameKey = 0;
    this.#observedLongFrames = 0;
    this.#totalLongFrameDurationMs = 0;
    this.#maxLongFrameDurationMs = 0;
    this.#correlatedPasses = 0;
  }

  destroy(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #handleLongFrames(list: LongAnimationFrameEntryListLike): void {
    let entries: LongAnimationFrameEntryLike[];
    try {
      entries = Array.from(list.getEntries());
    } catch {
      return;
    }
    for (const entry of entries) {
      const start = finiteNumber(entry.startTime);
      const duration = finiteDuration(entry.duration);
      if (start === null || duration <= 0) continue;
      const frame: LongFrameWindow = {
        key: ++this.#nextFrameKey,
        startTime: start,
        endTime: start + duration,
        durationMs: duration
      };
      this.#longFrames.push(frame);
      if (this.#longFrames.length > MAX_LONG_FRAMES) this.#longFrames.shift();
      this.#observedLongFrames += 1;
      this.#totalLongFrameDurationMs += duration;
      this.#maxLongFrameDurationMs = Math.max(this.#maxLongFrameDurationMs, duration);
      for (const sample of this.#recentPasses) this.#correlate(sample, frame);
    }
  }

  #correlate(sample: TimingWindow, frame: LongFrameWindow): void {
    if (frame.endTime <= sample.startTime || frame.startTime >= sample.endTime) return;
    if (sample.correlatedFrames.has(frame.key)) return;
    sample.correlatedFrames.add(frame.key);
    this.#correlatedPasses += 1;
    const metric = this.#features.get(sample.featureId);
    if (metric) metric.longFrameCount += 1;
  }
}

function detectLongAnimationFrameObserver(): LongAnimationFrameObserverConstructor | null {
  const candidate = (globalThis as { PerformanceObserver?: LongAnimationFrameObserverConstructor })
    .PerformanceObserver;
  return candidate ?? null;
}

function safeFeatureId(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value) ? value : "unknown";
}

function finiteDuration(value: unknown): number {
  const number = finiteNumber(value);
  return number === null ? 0 : Math.min(60_000, Math.max(0, number));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function now(): number {
  const clock = globalThis.performance;
  return typeof clock?.now === "function" ? clock.now() : Date.now();
}
