import type { IntegrationSettings } from "../../platform/settings";

export interface Aria2Request {
  url: string;
  filename: string;
}

export interface Aria2Result {
  ok: boolean;
  gid?: string;
  error?: string;
}

export interface Aria2Config {
  endpoint: string;
  secret: string;
}

export async function addUriToAria2(
  config: Aria2Config,
  request: Aria2Request
): Promise<Aria2Result> {
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
    const response = await fetch(`${config.endpoint}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    if (!response.ok) {
      return { ok: false, error: `Aria2 HTTP ${response.status}` };
    }
    const payload = (await response.json()) as { result?: string; error?: { message?: string } };
    if (payload?.error) {
      return { ok: false, error: payload.error.message ?? "Aria2 error" };
    }
    const result: Aria2Result = { ok: true };
    if (typeof payload?.result === "string") result.gid = payload.result;
    return result;
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

export async function tellActiveAria2(config: Aria2Config): Promise<Aria2ActiveDownload[]> {
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
  if (!gid) return { ok: false, error: "Missing GID" };
  const payload = await callAria2<string>(config, "aria2.remove", [gid]);
  if (typeof payload === "string") {
    return { ok: true, gid: payload };
  }
  return { ok: false, error: "Aria2 did not return a GID" };
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
    const response = await fetch(`${config.endpoint}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { result?: T };
    return (json?.result ?? null) as T | null;
  } catch {
    return null;
  }
}
