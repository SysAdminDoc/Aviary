import type { ExportRecord } from "../export/types";
import {
  documentFromExportRecord,
  OfflineQueryIndex,
  type OfflineQueryHit
} from "./query-model";

export interface SearchHit {
  record: ExportRecord;
  score: number;
  matchedTerms: string[];
}

export interface SearchOptions {
  limit?: number;
  caseSensitive?: boolean;
}

/** Compatibility wrapper for export callers; the actual ranking/indexing lives in query-model. */
export class LocalSearchIndex {
  readonly #index = new OfflineQueryIndex();

  rebuild(records: readonly ExportRecord[]): void {
    this.#index.rebuild(records.map(documentFromExportRecord));
  }

  add(record: ExportRecord): void {
    this.#index.add(documentFromExportRecord(record));
  }

  size(): number {
    return this.#index.size();
  }

  termCount(): number {
    return this.#index.termCount();
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const queryOptions = options.limit === undefined ? {} : { limit: options.limit };
    return this.#index.search(query, queryOptions).flatMap((hit: OfflineQueryHit) => {
      const record = hit.document.payload;
      return isExportRecord(record)
        ? [{ record, score: hit.score, matchedTerms: hit.matchedTerms }]
        : [];
    });
  }
}

function isExportRecord(value: unknown): value is ExportRecord {
  return typeof value === "object" && value !== null && typeof (value as ExportRecord).text === "string";
}
