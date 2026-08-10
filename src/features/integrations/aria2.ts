import type { IntegrationSettings } from "../../platform/settings";
import type { StorageGateway } from "../../platform/storage";
import { NETWORK_TIMEOUTS, withNetworkTimeout } from "../../platform/network";
import { assertOutboundAllowed } from "./network-policy";

export const ARIA2_HISTORY_KEY = "aviary.aria2.history.v1";
const ARIA2_HISTORY_LIMIT = 1000;

export interface Aria2Request {
  url: string;
  filename: string;
}

export interface Aria2Result {
  ok: boolean;
  gid?: string;
  error?: string;
}

export type Aria2HistoryStatus = "queued" | "complete";

export interface Aria2HistoryEntry {
  gid: string;
  url: string;
  filename: string;
  status: Aria2HistoryStatus;
  queuedAt: string;
  completedAt?: string;
}

interface Aria2HistorySnapshot {
  entries: Aria2HistoryEntry[];
}

export interface Aria2Config {
  endpoint: string;
  secret: string;
}

export async function addUriToAria2(
  config: Aria2Config,
  request: Aria2Request
): Promise<Aria2Result> {
  assertOutboundAllowed("The Aria2 handoff");
  if (!config.endpoint) {
    return { ok: false, error: "Aria2 endpoint not configured" };
  }
  const token = config.secret ? `token:${config.secret}` : undefined;
  const params: unknown[] = token ? [token] : [];
  params.push([request.url]);
  params.push({ out: request.filename });
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: `aviary-${Date.now()}`,
    method: "aria2.addUri",
    params
  });
  try {
    const networkResult = await withNetworkTimeout(async (signal) => {
      const response = await fetch(`${config.endpoint}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal
      });
      if (!response.ok) return { status: response.status } as const;
      return { payload: (await response.json()) as { result?: string; error?: { message?: string } } } as const;
    }, NETWORK_TIMEOUTS.aria2);
    if ("status" in networkResult) {
      return { ok: false, error: `Aria2 HTTP ${networkResult.status}` };
    }
    const payload = networkResult.payload;
    if (payload?.error) {
      return { ok: false, error: payload.error.message ?? "Aria2 error" };
    }
    const ariaResult: Aria2Result = { ok: true };
    if (typeof payload?.result === "string") ariaResult.gid = payload.result;
    return ariaResult;
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function shouldHandoffToAria2(
  integration: IntegrationSettings["aria2"],
  estimatedBytes: number | null
): boolean {
  if (!integration.enabled || !integration.endpoint) return false;
  if (estimatedBytes === null) return true;
  return estimatedBytes >= integration.minBytes;
}

export interface Aria2ActiveDownload {
  gid: string;
  status: string;
  totalLength: number;
  completedLength: number;
  files: Array<{ path: string }>;
}

export class Aria2History {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  #entries: Aria2HistoryEntry[] = [];
  #loaded = false;

  constructor(storage: StorageGateway, limit = ARIA2_HISTORY_LIMIT) {
    this.#storage = storage;
    this.#limit = Math.max(50, Math.trunc(limit));
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const fallback: Aria2HistorySnapshot = { entries: [] };
    const raw = await this.#storage.get<Aria2HistorySnapshot>(ARIA2_HISTORY_KEY, fallback);
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    this.#entries = entries
      .filter(isHistoryEntry)
      .slice(-this.#limit);
    this.#loaded = true;
  }

  hasUrl(url: string): boolean {
    return this.#entries.some((entry) => entry.url === url);
  }

  snapshot(): Aria2HistorySnapshot {
    return { entries: this.#entries.map((entry) => ({ ...entry })) };
  }

  async rememberQueued(entry: Omit<Aria2HistoryEntry, "status" | "queuedAt">): Promise<void> {
    await this.load();
    if (this.hasUrl(entry.url)) return;
    this.#entries.push({
      ...entry,
      status: "queued",
      queuedAt: new Date().toISOString()
    });
    while (this.#entries.length > this.#limit) {
      this.#entries.shift();
    }
    await this.#persist();
  }

  async reconcile(config: Aria2Config): Promise<{ completed: number; removed: number }> {
    await this.load();
    let completed = 0;
    let removed = 0;
    const retained: Aria2HistoryEntry[] = [];
    for (const entry of this.#entries) {
      if (entry.status !== "queued") {
        retained.push(entry);
        continue;
      }
      const status = await tellAria2Status(config, entry.gid);
      if (status === "complete") {
        retained.push({ ...entry, status: "complete", completedAt: new Date().toISOString() });
        completed += 1;
      } else if (status === "error" || status === "removed") {
        removed += 1;
      } else {
        retained.push(entry);
      }
    }
    this.#entries = retained;
    if (completed > 0 || removed > 0) {
      await this.#persist();
    }
    return { completed, removed };
  }

  async clear(): Promise<void> {
    this.#entries = [];
    this.#loaded = true;
    await this.#persist();
  }

  async #persist(): Promise<void> {
    try {
      await this.#storage.set<Aria2HistorySnapshot>(ARIA2_HISTORY_KEY, this.snapshot());
    } catch {
      // History is best-effort; Aria2 remains usable without a storage backend.
    }
  }
}

/**
 * Reaches the RPC without side effects. The old ping called `aria2.addUri` with a bogus URL --
 * aria2 accepts any syntactically valid URI and returns a GID, so every press of "Test
 * connection" left a real, permanently-failing download in the user's queue.
 */
export async function pingAria2Version(config: Aria2Config): Promise<Aria2Result> {
  assertOutboundAllowed("The Aria2 connection test");
  if (!config.endpoint) {
    return { ok: false, error: "Aria2 endpoint not configured" };
  }
  try {
    const result = await withNetworkTimeout(async (signal) => {
      const response = await fetch(`${config.endpoint}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `aviary-${Date.now()}`,
          method: "aria2.getVersion",
          params: config.secret ? [`token:${config.secret}`] : []
        }),
        signal
      });
      if (!response.ok) return { status: response.status } as const;
      return {
        payload: (await response.json()) as {
          result?: { version?: unknown };
          error?: { message?: string };
        }
      } as const;
    }, NETWORK_TIMEOUTS.aria2);
    if ("status" in result) {
      return { ok: false, error: `Aria2 HTTP ${result.status}` };
    }
    const payload = result.payload;
    if (payload?.error) {
      return { ok: false, error: payload.error.message ?? "Aria2 rejected the request" };
    }
    return typeof payload?.result?.version === "string"
      ? { ok: true, gid: payload.result.version }
      : { ok: false, error: "Aria2 did not report a version" };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export async function tellActiveAria2(config: Aria2Config): Promise<Aria2ActiveDownload[]> {
  assertOutboundAllowed("The Aria2 sweep");
  const payload = await callAria2<Array<Record<string, unknown>>>(config, "aria2.tellActive", []);
  if (!Array.isArray(payload)) return [];
  return payload.map((row) => ({
    gid: typeof row.gid === "string" ? row.gid : "",
    status: typeof row.status === "string" ? row.status : "unknown",
    totalLength: Number(row.totalLength ?? 0),
    completedLength: Number(row.completedLength ?? 0),
    files: Array.isArray(row.files)
      ? row.files
          .map((file) => (typeof file === "object" && file !== null ? (file as Record<string, unknown>) : {}))
          .map((file) => ({ path: typeof file.path === "string" ? file.path : "" }))
      : []
  }));
}

export async function removeAria2Download(config: Aria2Config, gid: string): Promise<Aria2Result> {
  assertOutboundAllowed("The Aria2 cancel");
  if (!gid) return { ok: false, error: "Missing GID" };
  const payload = await callAria2<string>(config, "aria2.remove", [gid]);
  if (typeof payload === "string") {
    return { ok: true, gid: payload };
  }
  return { ok: false, error: "Aria2 did not return a GID" };
}

export async function tellAria2Status(config: Aria2Config, gid: string): Promise<string | null> {
  if (!gid) return null;
  if (!config.endpoint) return null;
  // Inside the soft-failure contract, not above it. A status check is a background reconcile;
  // in local-only mode it must report "unknown" like any other unreachable endpoint rather than
  // throwing out of the caller and failing whatever feature happened to be initializing.
  try {
    assertOutboundAllowed("The Aria2 status check");
  } catch {
    return null;
  }
  const token = config.secret ? `token:${config.secret}` : undefined;
  const params: unknown[] = token ? [token, gid] : [gid];
  try {
    const payload = await withNetworkTimeout(async (signal) => {
      const response = await fetch(`${config.endpoint}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `aviary-${Date.now()}`,
          method: "aria2.tellStatus",
          params
        }),
        signal
      });
      if (!response.ok) return null;
      return (await response.json()) as {
        result?: { status?: unknown };
        error?: { code?: unknown; message?: unknown };
      };
    }, NETWORK_TIMEOUTS.aria2);
    if (!payload) return null;
    // Only a GID aria2 does not know means the download is gone. Every other fault -- a wrong
    // secret above all -- used to map to "removed" too, and reconcile deletes those entries, so
    // one boot with a mistyped secret erased the whole queued ledger and re-enabled duplicate
    // handoffs. An unrecognised error returns null, which reconcile retains.
    if (payload.error) {
      return isUnknownGidError(payload.error) ? "removed" : null;
    }
    return typeof payload.result?.status === "string" ? payload.result.status : null;
  } catch {
    return null;
  }
}

async function callAria2<T>(config: Aria2Config, method: string, args: unknown[]): Promise<T | null> {
  if (!config.endpoint) return null;
  const token = config.secret ? `token:${config.secret}` : undefined;
  const params: unknown[] = token ? [token, ...args] : args;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: `aviary-${Date.now()}`,
    method,
    params
  });
  try {
    const json = await withNetworkTimeout(async (signal) => {
      const response = await fetch(`${config.endpoint}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal
      });
      if (!response.ok) return null;
      return (await response.json()) as { result?: T };
    }, NETWORK_TIMEOUTS.aria2);
    if (!json) return null;
    return (json?.result ?? null) as T | null;
  } catch {
    return null;
  }
}

/**
 * aria2 answers `tellStatus` for an unknown GID with code 1 and a message naming the GID. Auth
 * and transport faults use other codes and messages, and must not be read as "this download is
 * finished with".
 */
function isUnknownGidError(error: { code?: unknown; message?: unknown }): boolean {
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return /gid/.test(message) && /(not found|is not found|cannot be found)/.test(message);
}

function isHistoryEntry(value: unknown): value is Aria2HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<Aria2HistoryEntry>;
  return (
    typeof entry.gid === "string" &&
    typeof entry.url === "string" &&
    typeof entry.filename === "string" &&
    (entry.status === "queued" || entry.status === "complete") &&
    typeof entry.queuedAt === "string" &&
    (entry.completedAt === undefined || typeof entry.completedAt === "string")
  );
}
