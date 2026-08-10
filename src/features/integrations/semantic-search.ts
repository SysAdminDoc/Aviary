import type { StorageGateway } from "../../platform/storage";
import type { IntegrationSettings } from "../../platform/settings";
import type { ExportRecord } from "../export/types";
import { NETWORK_TIMEOUTS, withNetworkTimeout } from "../../platform/network";
import { assertOutboundAllowed } from "./network-policy";

export const SEMANTIC_INDEX_KEY = "aviary.semanticIndex.v1";

/**
 * Every other store here is bounded (bookmarks 5000, aria2 1000, audit 500); this one was not,
 * and each entry carries a full embedding -- roughly 20-30 KB of JSON at 1536 dimensions. A few
 * thousand posts is tens of megabytes rewritten on every persist, which exhausts
 * chrome.storage.local (10 MB without unlimitedStorage) and then surfaces as the storage error
 * sink firing on completely unrelated writes.
 */
export const SEMANTIC_INDEX_LIMIT = 400;
export const SEMANTIC_INDEX_MAX_BYTES = 8 * 1024 * 1024;
const MAX_VECTOR_DIMENSIONS = 4096;

/** Embeddings are unit-ish floats; five decimals keeps cosine similarity stable at ~1/3 the bytes. */
const VECTOR_PRECISION = 1e5;

function roundVector(vector: readonly number[]): number[] {
  return vector.map((value) => Math.round(value * VECTOR_PRECISION) / VECTOR_PRECISION);
}

export interface SemanticEntry {
  id: string;
  tweetId: string | null;
  handle: string | null;
  text: string;
  vector: number[];
  embeddedAt: string;
}

interface SemanticIndexState {
  entries: SemanticEntry[];
  model: string;
}

const EMPTY: SemanticIndexState = { entries: [], model: "" };

export interface SemanticHit {
  entry: SemanticEntry;
  score: number;
}

export class SemanticIndex {
  readonly #storage: StorageGateway;
  #state: SemanticIndexState = EMPTY;
  #loaded = false;

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const stored = await this.#storage.get<SemanticIndexState>(SEMANTIC_INDEX_KEY, EMPTY);
    this.#state = {
      entries: Array.isArray(stored?.entries)
        ? stored.entries.filter(isEntry).slice(-SEMANTIC_INDEX_LIMIT)
        : [],
      model: typeof stored?.model === "string" ? stored.model : ""
    };
    this.#trimToBudget();
    this.#loaded = true;
  }

  size(): number {
    return this.#state.entries.length;
  }

  model(): string {
    return this.#state.model;
  }

  async embedAndIndex(
    config: IntegrationSettings["semanticSearch"],
    records: readonly ExportRecord[]
  ): Promise<{ added: number; skipped: number; errors: number; dropped: number }> {
    if (!config.enabled || !config.endpoint || !config.apiKey || !config.model) {
      return { added: 0, skipped: records.length, errors: 0, dropped: 0 };
    }
    await this.load();
    const before = cloneState(this.#state);
    if (this.#state.model && this.#state.model !== config.model) {
      this.#state = { entries: [], model: config.model };
    } else {
      this.#state.model = config.model;
    }

    const known = new Set(this.#state.entries.map((entry) => entry.id));
    let added = 0;
    let skipped = 0;
    let errors = 0;
    for (const record of records) {
      const id = `${record.tweetId ?? "no-id"}:${(record.text || "").slice(0, 80)}`;
      if (known.has(id) || record.text.length === 0) {
        skipped += 1;
        continue;
      }
      const expectedDimension = this.#state.entries[0]?.vector.length;
      const vector = await fetchEmbedding(config, record.text, expectedDimension);
      if (!vector) {
        errors += 1;
        continue;
      }
      this.#state.entries.push({
        id,
        tweetId: record.tweetId,
        handle: record.handle,
        text: record.text,
        vector: roundVector(vector),
        embeddedAt: new Date().toISOString()
      });
      known.add(id);
      added += 1;
    }
    const dropped = this.#trimToBudget();
    try {
      await this.#persist();
    } catch (error) {
      this.#state = before;
      throw error;
    }
    return { added, skipped, errors, dropped };
  }

  async search(
    config: IntegrationSettings["semanticSearch"],
    query: string,
    limit = 10
  ): Promise<SemanticHit[]> {
    if (!config.enabled || !config.endpoint || !config.apiKey || !config.model || query.trim().length === 0) {
      return [];
    }
    await this.load();
    if (this.#state.entries.length === 0) return [];
    const queryVector = await fetchEmbedding(config, query, this.#state.entries[0]?.vector.length);
    if (!queryVector) return [];
    const hits = this.#state.entries
      .map((entry) => ({ entry, score: cosineSimilarity(queryVector, entry.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return hits;
  }

  async clear(): Promise<void> {
    const before = cloneState(this.#state);
    this.#state = { entries: [], model: this.#state.model };
    this.#loaded = true;
    try {
      await this.#persist();
    } catch (error) {
      this.#state = before;
      throw error;
    }
  }

  #trimToBudget(): number {
    const before = this.#state.entries.length;
    while (
      this.#state.entries.length > SEMANTIC_INDEX_LIMIT ||
      serializedBytes(this.#state) > SEMANTIC_INDEX_MAX_BYTES
    ) {
      if (this.#state.entries.length === 0) break;
      this.#state.entries.shift();
    }
    return before - this.#state.entries.length;
  }

  async #persist(): Promise<void> {
    await this.#storage.set(SEMANTIC_INDEX_KEY, this.#state);
  }
}

async function fetchEmbedding(
  config: IntegrationSettings["semanticSearch"],
  text: string,
  expectedDimension?: number
): Promise<number[] | null> {
  assertOutboundAllowed("Embedding");
  try {
    const payload = await withNetworkTimeout(async (signal) => {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({ model: config.model, input: text }),
        signal
      });
      if (!response.ok) return null;
      return (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
        embedding?: number[];
      };
    }, NETWORK_TIMEOUTS.semantic);
    if (!payload) return null;
    if (Array.isArray(payload?.embedding)) {
      return validEmbedding(payload.embedding, expectedDimension) ? payload.embedding : null;
    }
    const vector = payload?.data?.[0]?.embedding;
    return Array.isArray(vector) && validEmbedding(vector, expectedDimension) ? vector : null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!validEmbedding(a) || !validEmbedding(b) || a.length !== b.length) return 0;
  const length = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  const score = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(score) ? score : 0;
}

function isEntry(value: unknown): value is SemanticEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SemanticEntry>;
  return (
    typeof candidate.id === "string" &&
    (typeof candidate.tweetId === "string" || candidate.tweetId === null) &&
    (typeof candidate.handle === "string" || candidate.handle === null) &&
    typeof candidate.text === "string" &&
    typeof candidate.embeddedAt === "string" &&
    validEmbedding(candidate.vector)
  );
}

function validEmbedding(value: unknown, expectedDimension?: number): value is number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_VECTOR_DIMENSIONS ||
    (expectedDimension !== undefined && value.length !== expectedDimension)
  ) {
    return false;
  }
  return value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function serializedBytes(state: SemanticIndexState): number {
  try {
    return new TextEncoder().encode(JSON.stringify(state)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function cloneState(state: SemanticIndexState): SemanticIndexState {
  return {
    model: state.model,
    entries: state.entries.map((entry) => ({ ...entry, vector: [...entry.vector] }))
  };
}
