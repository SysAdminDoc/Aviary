import type { StorageGateway } from "../../platform/storage";
import type { IntegrationSettings } from "../../platform/settings";
import type { ExportRecord } from "../export/types";
import { assertOutboundAllowed } from "./network-policy";

export const SEMANTIC_INDEX_KEY = "aviary.semanticIndex.v1";

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
      entries: Array.isArray(stored?.entries) ? stored.entries.filter(isEntry) : [],
      model: typeof stored?.model === "string" ? stored.model : ""
    };
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
  ): Promise<{ added: number; skipped: number; errors: number }> {
    if (!config.enabled || !config.endpoint || !config.apiKey || !config.model) {
      return { added: 0, skipped: records.length, errors: 0 };
    }
    await this.load();
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
      const vector = await fetchEmbedding(config, record.text);
      if (!vector) {
        errors += 1;
        continue;
      }
      this.#state.entries.push({
        id,
        tweetId: record.tweetId,
        handle: record.handle,
        text: record.text,
        vector,
        embeddedAt: new Date().toISOString()
      });
      known.add(id);
      added += 1;
    }
    await this.#persist();
    return { added, skipped, errors };
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
    const queryVector = await fetchEmbedding(config, query);
    if (!queryVector) return [];
    const hits = this.#state.entries
      .map((entry) => ({ entry, score: cosineSimilarity(queryVector, entry.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return hits;
  }

  async clear(): Promise<void> {
    this.#state = { entries: [], model: this.#state.model };
    this.#loaded = true;
    await this.#persist();
  }

  async #persist(): Promise<void> {
    try {
      await this.#storage.set(SEMANTIC_INDEX_KEY, this.#state);
    } catch {
      // best effort
    }
  }
}

async function fetchEmbedding(
  config: IntegrationSettings["semanticSearch"],
  text: string
): Promise<number[] | null> {
  assertOutboundAllowed("Embedding");
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({ model: config.model, input: text })
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
      embedding?: number[];
    };
    if (Array.isArray(payload?.embedding)) return payload.embedding;
    const vector = payload?.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector : null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
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
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function isEntry(value: unknown): value is SemanticEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SemanticEntry>;
  return typeof candidate.id === "string" && Array.isArray(candidate.vector);
}
