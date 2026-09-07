import type { StorageGateway } from "../../platform/storage.ts";
import { replaceStored } from "../../platform/storage-lock.ts";

export const QUERY_REGISTRY_KEY = "aviary.queryIds.v1";

export interface QueryRegistry {
  queries: Record<string, string>;
  observedAt: string | null;
}

const QUERY_REGEX = /\/i\/api\/graphql\/([A-Za-z0-9_-]{6,})\/([A-Za-z0-9_]{2,80})/g;

/** X inlines a small bootstrap script; anything larger than this is a bundle worth skipping. */
const MAX_INLINE_SCRIPT_BYTES = 256_000;

export async function discoverQueryIds(storage: StorageGateway): Promise<QueryRegistry> {
  const fallback: QueryRegistry = { queries: {}, observedAt: null };
  const existing = await storage.get<QueryRegistry>(QUERY_REGISTRY_KEY, fallback);
  const queries = { ...existing.queries };

  if (typeof document !== "undefined") {
    // Only inline script text is scanned. The full-document `outerHTML` serialisation this used
    // to do cost several megabytes of string allocation at boot and found nothing: measured
    // against both 2026-05-19 captures (315KB of Home and 263KB of a conversation, of real X
    // markup) this pattern matches 0 times. X's query IDs live inside the bundled JS, which is
    // referenced by URL and never inlined, so there is nothing in the served HTML to find.
    const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script"));
    for (const script of scripts) {
      const src = script.getAttribute("src");
      if (src) {
        mergeFromString(queries, src);
      } else if (script.textContent && script.textContent.length <= MAX_INLINE_SCRIPT_BYTES) {
        mergeFromString(queries, script.textContent);
      }
    }
  }

  const result: QueryRegistry = {
    queries,
    observedAt: new Date().toISOString()
  };
  try {
    await replaceStored(storage, QUERY_REGISTRY_KEY, result);
  } catch {
    // best effort
  }
  return result;
}

function mergeFromString(target: Record<string, string>, source: string): void {
  QUERY_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUERY_REGEX.exec(source)) !== null) {
    const [, id, operation] = match;
    if (id && operation) {
      target[operation] = id;
    }
  }
}
