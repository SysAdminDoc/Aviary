import type { StorageGateway } from "../../platform/storage";

export const QUERY_REGISTRY_KEY = "aviary.queryIds.v1";

export interface QueryRegistry {
  queries: Record<string, string>;
  observedAt: string | null;
}

const QUERY_REGEX = /\/i\/api\/graphql\/([A-Za-z0-9_-]{6,})\/([A-Za-z0-9_]{2,80})/g;

export async function discoverQueryIds(storage: StorageGateway): Promise<QueryRegistry> {
  const fallback: QueryRegistry = { queries: {}, observedAt: null };
  const existing = await storage.get<QueryRegistry>(QUERY_REGISTRY_KEY, fallback);
  const queries = { ...existing.queries };

  if (typeof document !== "undefined") {
    const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
    for (const script of scripts) {
      mergeFromString(queries, script.src);
    }
    const documentText = document.documentElement?.outerHTML ?? "";
    mergeFromString(queries, documentText);
  }

  const result: QueryRegistry = {
    queries,
    observedAt: new Date().toISOString()
  };
  try {
    await storage.set(QUERY_REGISTRY_KEY, result);
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
