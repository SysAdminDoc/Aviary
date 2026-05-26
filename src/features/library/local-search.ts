import type { ExportRecord } from "../export/types";

export interface SearchHit {
  record: ExportRecord;
  score: number;
  matchedTerms: string[];
}

export interface SearchOptions {
  limit?: number;
  caseSensitive?: boolean;
}

export class LocalSearchIndex {
  readonly #postings = new Map<string, Set<number>>();
  readonly #records: ExportRecord[] = [];

  rebuild(records: readonly ExportRecord[]): void {
    this.#postings.clear();
    this.#records.length = 0;
    for (const record of records) {
      this.add(record);
    }
  }

  add(record: ExportRecord): void {
    const id = this.#records.push(record) - 1;
    for (const token of tokensFor(record)) {
      let posting = this.#postings.get(token);
      if (!posting) {
        posting = new Set<number>();
        this.#postings.set(token, posting);
      }
      posting.add(id);
    }
  }

  size(): number {
    return this.#records.length;
  }

  termCount(): number {
    return this.#postings.size;
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const limit = options.limit ?? 50;
    const docScores = new Map<number, { score: number; matched: Set<string> }>();

    for (const term of tokens) {
      const posting = this.#postings.get(term);
      if (!posting) continue;
      for (const id of posting) {
        const existing = docScores.get(id);
        if (existing) {
          existing.score += 1;
          existing.matched.add(term);
        } else {
          docScores.set(id, { score: 1, matched: new Set([term]) });
        }
      }
    }

    const sorted = [...docScores.entries()]
      .map(([id, { score, matched }]) => {
        const record = this.#records[id];
        if (!record) {
          return null;
        }
        return {
          record,
          score: score + matched.size,
          matchedTerms: [...matched].sort()
        };
      })
      .filter((hit): hit is SearchHit => hit !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return sorted;
  }
}

function tokensFor(record: ExportRecord): Set<string> {
  const haystack = [
    record.text,
    record.handle ?? "",
    record.displayName ?? "",
    record.surface,
    ...record.media.map((media) => media.url)
  ].join(" ");
  return new Set(tokenize(haystack));
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_@]+/i)
    .map((token) => token.replace(/^@/, ""))
    .filter((token) => token.length >= 2 && token.length <= 40);
}
