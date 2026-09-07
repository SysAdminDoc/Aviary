import type { IntegrationSettings } from "../../platform/settings.ts";
import type { StorageGateway } from "../../platform/storage.ts";
import { replaceStored, withStorageLock } from "../../platform/storage-lock.ts";

export const INTEGRATION_USAGE_KEY = "aviary.integration.usage.v1";
export const INTEGRATION_USAGE_SCHEMA_VERSION = 1;
export const USAGE_HISTORY_DAYS = 31;

export const DEFAULT_AI_MAX_REQUEST_BYTES = 32_000;
export const DEFAULT_AI_DAILY_REQUEST_BYTES = 1_000_000;
export const DEFAULT_EMBEDDING_MAX_RECORD_BYTES = 20_000;
export const DEFAULT_EMBEDDING_DAILY_RECORD_BYTES = 2_000_000;

type UsageKind = "ai" | "embedding";

export interface UsageBudget {
  maxRequestBytes: number;
  dailyBytes: number;
}

interface UsageDay {
  day: string;
  ai: { requests: number; bytes: number };
  embedding: { requests: number; records: number; bytes: number };
}

interface UsageState {
  schemaVersion: 1;
  days: UsageDay[];
}

export interface UsageSnapshot {
  day: string;
  historyDays: number;
  ai: { requests: number; bytes: number };
  embedding: { requests: number; records: number; bytes: number };
}

export interface UsageDecision {
  allowed: boolean;
  kind: UsageKind;
  requestBytes: number;
  usedBytes: number;
  dailyLimitBytes: number;
  reason?: string;
}

export interface IntegrationUsageStatus {
  day: string;
  networkAllowed: boolean;
  localOnly: boolean;
  lastBlocked: { kind: UsageKind; reason: string } | null;
  ai: UsageSnapshot["ai"] & { dailyLimitBytes: number };
  embedding: UsageSnapshot["embedding"] & { dailyLimitBytes: number };
}

export interface AiDisclosure {
  provider: string;
  endpoint: string;
  fields: string[];
  characterCount: number;
  requestBytes: number;
  estimatedTokens: number;
  retained: string;
  networkAllowed: boolean;
  budgetAllowed: boolean;
  budgetReason: string | null;
  dailyUsedBytes: number;
  dailyLimitBytes: number;
}

export interface EmbeddingDisclosure {
  provider: string;
  endpoint: string;
  fields: string[];
  retained: string;
  networkAllowed: boolean;
  dailyUsedBytes: number;
  dailyLimitBytes: number;
  maxRecordBytes: number;
}

const EMPTY: UsageState = { schemaVersion: 1, days: [] };

/**
 * Stores counters only. No provider, endpoint, credential, prompt, post text, or embedding
 * content enters this record, so a usage history can be inspected or backed up safely.
 */
export class IntegrationUsageLedger {
  readonly #storage: StorageGateway;
  #state: UsageState = { schemaVersion: 1, days: [] };
  #loaded = false;
  #lastBlocked: IntegrationUsageStatus["lastBlocked"] = null;

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const stored = await this.#storage.get<unknown>(INTEGRATION_USAGE_KEY, EMPTY);
    this.#state = normalizeState(stored);
    this.#loaded = true;
  }

  snapshot(now = new Date()): UsageSnapshot {
    const day = localDay(now);
    const current = this.#state.days.find((entry) => entry.day === day) ?? emptyDay(day);
    return {
      day,
      historyDays: this.#state.days.length,
      ai: { ...current.ai },
      embedding: { ...current.embedding }
    };
  }

  status(
    aiBudget: UsageBudget,
    embeddingBudget: UsageBudget,
    localOnly: boolean
  ): IntegrationUsageStatus {
    const snapshot = this.snapshot();
    return {
      day: snapshot.day,
      networkAllowed: !localOnly,
      localOnly,
      lastBlocked: this.#lastBlocked ? { ...this.#lastBlocked } : null,
      ai: { ...snapshot.ai, dailyLimitBytes: aiBudget.dailyBytes },
      embedding: { ...snapshot.embedding, dailyLimitBytes: embeddingBudget.dailyBytes }
    };
  }

  async reserveAi(requestBytes: number, budget: UsageBudget): Promise<UsageDecision> {
    return this.#reserve("ai", requestBytes, 0, budget);
  }

  async reserveEmbedding(
    recordBytes: number,
    budget: UsageBudget
  ): Promise<UsageDecision> {
    return this.#reserve("embedding", recordBytes, 1, budget);
  }

  async clear(): Promise<void> {
    await this.load();
    const before = this.#state;
    this.#state = { schemaVersion: 1, days: [] };
    this.#lastBlocked = null;
    try {
      await replaceStored(this.#storage, INTEGRATION_USAGE_KEY, this.#state);
    } catch (error) {
      this.#state = before;
      throw error;
    }
  }

  /**
   * Check the budget and spend from it, atomically across tabs.
   *
   * The whole body runs inside one lock and re-reads the stored ledger at the top of it. Without
   * that the sequence is a textbook time-of-check-to-time-of-use race: two tabs each read the same
   * "bytes used today", each conclude there is room, and each write their own total -- so a daily
   * budget could be spent once per open tab. The budget is the only promise Aviary makes about
   * what a provider is allowed to cost, so it is the one counter that has to be exact.
   */
  async #reserve(
    kind: UsageKind,
    requestBytes: number,
    records: number,
    budget: UsageBudget
  ): Promise<UsageDecision> {
    await this.load();
    return withStorageLock(INTEGRATION_USAGE_KEY, () =>
      this.#reserveLocked(kind, requestBytes, records, budget)
    );
  }

  async #reserveLocked(
    kind: UsageKind,
    requestBytes: number,
    records: number,
    budget: UsageBudget
  ): Promise<UsageDecision> {
    // Another tab may have spent since this one loaded, and the check below is only meaningful
    // against what is actually recorded now. Combined with what this tab already knows rather
    // than replaced by it: the counters only ever go up within a day, so taking the higher of the
    // two can never under-count -- which keeps the budget exact even on a backend whose read lags
    // its own write.
    this.#state = mergeHighest(
      this.#state,
      normalizeState(await this.#storage.get<unknown>(INTEGRATION_USAGE_KEY, EMPTY))
    );
    const bytes = Math.max(0, Math.floor(Number.isFinite(requestBytes) ? requestBytes : 0));
    const maxRequestBytes = finiteLimit(budget.maxRequestBytes);
    const dailyLimitBytes = finiteLimit(budget.dailyBytes);
    const current = this.snapshot();
    const usedBytes = kind === "ai" ? current.ai.bytes : current.embedding.bytes;
    if (overBudget(maxRequestBytes, bytes)) {
      return this.blocked(
        kind,
        bytes,
        usedBytes,
        dailyLimitBytes,
        maxRequestBytes <= 0
          ? `The ${kind} per-request budget is zero, so no provider request was made.`
          : `The ${kind} request is ${bytes} bytes, over the ${maxRequestBytes}-byte per-request budget.`
      );
    }
    if (overBudget(dailyLimitBytes, usedBytes + bytes)) {
      return this.blocked(
        kind,
        bytes,
        usedBytes,
        dailyLimitBytes,
        dailyLimitBytes <= 0
          ? `The ${kind} daily budget is zero, so no provider request was made.`
          : `The ${kind} daily budget has been reached; no provider request was made.`
      );
    }

    const before = cloneState(this.#state);
    const day = this.#getOrCreateDay(current.day);
    if (kind === "ai") {
      day.ai.requests += 1;
      day.ai.bytes += bytes;
    } else {
      day.embedding.requests += 1;
      day.embedding.records += records;
      day.embedding.bytes += bytes;
    }
    this.#trimHistory();
    try {
      await this.#storage.set(INTEGRATION_USAGE_KEY, this.#state);
    } catch {
      this.#state = before;
      return this.blocked(
        kind,
        bytes,
        usedBytes,
        dailyLimitBytes,
        "Usage could not be saved locally; the provider request was stopped."
      );
    }
    this.#lastBlocked = null;
    return {
      allowed: true,
      kind,
      requestBytes: bytes,
      usedBytes: usedBytes + bytes,
      dailyLimitBytes
    };
  }

  #getOrCreateDay(day: string): UsageDay {
    let current = this.#state.days.find((entry) => entry.day === day);
    if (!current) {
      current = emptyDay(day);
      this.#state.days.push(current);
      this.#state.days.sort((a, b) => a.day.localeCompare(b.day));
    }
    return current;
  }

  #trimHistory(): void {
    if (this.#state.days.length > USAGE_HISTORY_DAYS) {
      this.#state.days = this.#state.days.slice(-USAGE_HISTORY_DAYS);
    }
  }

  blocked(
    kind: UsageKind,
    requestBytes: number,
    usedBytes: number,
    dailyLimitBytes: number,
    reason: string
  ): UsageDecision {
    this.#lastBlocked = { kind, reason };
    return { allowed: false, kind, requestBytes, usedBytes, dailyLimitBytes, reason };
  }
}

export function defaultAiBudget(config: IntegrationSettings["ai"]): UsageBudget {
  return {
    maxRequestBytes: config.maxRequestBytes ?? DEFAULT_AI_MAX_REQUEST_BYTES,
    dailyBytes: config.dailyRequestBytes ?? DEFAULT_AI_DAILY_REQUEST_BYTES
  };
}

export function defaultEmbeddingBudget(
  config: IntegrationSettings["semanticSearch"]
): UsageBudget {
  return {
    maxRequestBytes: config.maxRecordBytes ?? DEFAULT_EMBEDDING_MAX_RECORD_BYTES,
    dailyBytes: config.dailyRecordBytes ?? DEFAULT_EMBEDDING_DAILY_RECORD_BYTES
  };
}

export function buildAiDisclosure(
  config: IntegrationSettings["ai"],
  request: { prompt: string; systemPrompt?: string; maxTokens?: number },
  usage: UsageSnapshot | undefined,
  networkAllowed: boolean
): AiDisclosure {
  const text = [request.systemPrompt ?? "", request.prompt].join("\n");
  const budget = defaultAiBudget(config);
  const requestBytes = estimateAiRequestBytes(config, request);
  const budgetReason = overBudget(budget.maxRequestBytes, requestBytes)
    ? budget.maxRequestBytes <= 0
      ? "The AI per-request budget is zero, so no provider request will be made."
      : `The AI request is ${requestBytes} bytes, over the ${budget.maxRequestBytes}-byte per-request budget.`
    : usage && overBudget(budget.dailyBytes, usage.ai.bytes + requestBytes)
      ? budget.dailyBytes <= 0
        ? "The AI daily budget is zero, so no provider request will be made."
        : "The AI daily budget has been reached; no provider request was made."
      : null;
  return {
    provider: config.provider,
    endpoint: aiEndpoint(config),
    fields: ["model", ...(request.systemPrompt ? ["system instruction"] : []), "user prompt"],
    characterCount: [...text].length,
    requestBytes,
    estimatedTokens: estimateTokens(text),
    retained: "Aviary stores usage counters only; the provider's retention follows its policy.",
    networkAllowed,
    budgetAllowed: budgetReason === null,
    budgetReason,
    dailyUsedBytes: usage?.ai.bytes ?? 0,
    dailyLimitBytes: budget.dailyBytes
  };
}

export function buildEmbeddingDisclosure(
  config: IntegrationSettings["semanticSearch"],
  usage: UsageSnapshot | undefined,
  networkAllowed: boolean
): EmbeddingDisclosure {
  const budget = defaultEmbeddingBudget(config);
  return {
    provider: "Configured embedding endpoint",
    endpoint: config.endpoint || "Not configured",
    fields: ["model", "captured record text"],
    retained: "Vectors and bounded record text stay in Aviary's local semantic index; provider retention follows its policy.",
    networkAllowed,
    dailyUsedBytes: usage?.embedding.bytes ?? 0,
    dailyLimitBytes: budget.dailyBytes,
    maxRecordBytes: budget.maxRequestBytes
  };
}

export function aiEndpoint(config: IntegrationSettings["ai"]): string {
  if (config.endpoint) return config.endpoint;
  return config.provider === "anthropic"
    ? "https://api.anthropic.com/v1/messages"
    : "https://api.openai.com/v1/chat/completions";
}

export function estimateAiRequestBytes(
  config: IntegrationSettings["ai"],
  request: { prompt: string; systemPrompt?: string; maxTokens?: number }
): number {
  return utf8Bytes(JSON.stringify(aiRequestBody(config, request)));
}

export function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil([...text].length / 4));
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function aiRequestBody(
  config: IntegrationSettings["ai"],
  request: { prompt: string; systemPrompt?: string; maxTokens?: number }
): Record<string, unknown> {
  if (config.provider === "anthropic") {
    return {
      model: config.model,
      max_tokens: request.maxTokens ?? 1024,
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      messages: [{ role: "user", content: request.prompt }]
    };
  }
  return {
    model: config.model,
    // OpenAI-compatible reasoning endpoints use the longer parameter name first. Estimating
    // that shape is conservative for the legacy fallback, whose `max_tokens` key is shorter.
    max_completion_tokens: request.maxTokens ?? 1024,
    messages: [
      ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
      { role: "user", content: request.prompt }
    ]
  };
}

function finiteLimit(value: number | undefined): number {
  if (value === undefined) return 0;
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * A budget of zero means zero.
 *
 * These guards used to read `limit > 0 && over`, so a limit of 0 disabled the check entirely and a
 * user who set the daily cap to zero to stop all provider spend got unlimited spend instead. There
 * is deliberately no "unlimited" value: on a control whose whole job is to bound what leaves the
 * browser, an unbounded setting is the one outcome nobody asks for by typing a number. Someone who
 * wants effectively no ceiling raises it to the schema maximum, which is still a stated number.
 */
function overBudget(limit: number, bytes: number): boolean {
  return limit <= 0 || bytes > limit;
}

function localDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function emptyDay(day: string): UsageDay {
  return { day, ai: { requests: 0, bytes: 0 }, embedding: { requests: 0, records: 0, bytes: 0 } };
}

function normalizeState(value: unknown): UsageState {
  if (!isRecord(value) || value.schemaVersion !== INTEGRATION_USAGE_SCHEMA_VERSION || !Array.isArray(value.days)) {
    return { schemaVersion: 1, days: [] };
  }
  const days = value.days
    .map(normalizeDay)
    .filter((day): day is UsageDay => day !== null)
    .sort((a, b) => a.day.localeCompare(b.day));
  return { schemaVersion: 1, days: days.slice(-USAGE_HISTORY_DAYS) };
}

function normalizeDay(value: unknown): UsageDay | null {
  if (!isRecord(value) || typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) {
    return null;
  }
  const ai = isRecord(value.ai) ? value.ai : {};
  const embedding = isRecord(value.embedding) ? value.embedding : {};
  return {
    day: value.day,
    ai: {
      requests: safeCount(ai.requests),
      bytes: safeCount(ai.bytes)
    },
    embedding: {
      requests: safeCount(embedding.requests),
      records: safeCount(embedding.records),
      bytes: safeCount(embedding.bytes)
    }
  };
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function cloneState(state: UsageState): UsageState {
  return {
    schemaVersion: 1,
    days: state.days.map((day) => ({
      day: day.day,
      ai: { ...day.ai },
      embedding: { ...day.embedding }
    }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The higher of two ledgers, counter by counter.
 *
 * A daily total is monotonic, so "whichever is larger" is always the one that has seen more
 * spending. That makes the merge safe in the direction that matters: it can refuse a request that
 * would have been allowed, and it can never allow one that should have been refused.
 */
function mergeHighest(local: UsageState, stored: UsageState): UsageState {
  const byDay = new Map<string, UsageDay>();
  for (const day of local.days) {
    byDay.set(day.day, day);
  }
  for (const day of stored.days) {
    const existing = byDay.get(day.day);
    byDay.set(
      day.day,
      existing
        ? {
            day: day.day,
            ai: {
              requests: Math.max(existing.ai.requests, day.ai.requests),
              bytes: Math.max(existing.ai.bytes, day.ai.bytes)
            },
            embedding: {
              requests: Math.max(existing.embedding.requests, day.embedding.requests),
              records: Math.max(existing.embedding.records, day.embedding.records),
              bytes: Math.max(existing.embedding.bytes, day.embedding.bytes)
            }
          }
        : day
    );
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { schemaVersion: 1, days: days.slice(-USAGE_HISTORY_DAYS) };
}
