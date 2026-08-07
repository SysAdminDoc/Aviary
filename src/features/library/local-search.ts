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
  // Unicode-aware: the old ASCII-only class produced zero tokens for Japanese, Korean, Arabic,
  // Hebrew and Cyrillic -- the very languages the panel is translated into -- so those records
  // were unfindable and queries in them always returned nothing.
  //
  // NFC, never NFD: decomposing Hangul yields Jamo, which are letters rather than marks, and a
  // decomposed query would never match a composed record.
  const normalized = value.normalize("NFC").toLowerCase();
  const words = normalized
    .split(/[^\p{L}\p{N}_@]+/u)
    .map((token) => token.replace(/^@/, ""))
    .filter((token) => token.length > 0 && token.length <= 40);

  const tokens: string[] = [];
  for (const word of words) {
    // Scripts that do not space their words need bigrams, or the whole run is one token that
    // only an exact-phrase query could ever hit.
    if (UNSPACED_SCRIPT.test(word)) {
      if (word.length === 1) {
        tokens.push(word);
        continue;
      }
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.slice(i, i + 2));
      }
      continue;
    }
    if (word.length >= 2) {
      tokens.push(word);
    }
  }
  return tokens;
}

/** Han, Hiragana, Katakana and Hangul: written without spaces between words. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
