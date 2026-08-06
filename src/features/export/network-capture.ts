import type { FeatureContext, FeatureModule } from "../registry";
import type { CheckpointStore } from "./jobs";
import { getCheckpointStore } from "./export-feature";

const MAX_PAYLOAD_BYTES = 1_500_000;
const MAX_PAYLOADS = 50;

let installed = false;
let activeContext: FeatureContext | undefined;
const recentPayloads: Array<{ url: string; status: number; at: string; bytes: number }> = [];

interface OriginalFetch {
  fn: typeof fetch;
}

let originalFetch: OriginalFetch | undefined;
let patchedFetch: typeof fetch | undefined;

export const networkCaptureFeature: FeatureModule = {
  id: "export.networkCapture",
  title: "Passive GraphQL capture",
  category: "export",
  defaultEnabled: true,

  init(ctx) {
    activeContext = ctx;
    if (ctx.settings.export.preserveRawPayloads) {
      installInterceptor(ctx);
    }
    ctx.diagnostics.info("Network capture feature ready", {
      enabled: ctx.settings.export.preserveRawPayloads,
      installed
    });
  },

  apply(ctx) {
    activeContext = ctx;
    if (ctx.settings.export.preserveRawPayloads && !installed) {
      installInterceptor(ctx);
    } else if (!ctx.settings.export.preserveRawPayloads && installed) {
      uninstallInterceptor(ctx);
    }
  },

  destroy(ctx) {
    if (installed) {
      uninstallInterceptor(ctx);
    }
    activeContext = undefined;
    ctx.diagnostics.info("Network capture destroyed");
  },

  getStatus() {
    return {
      ok: true,
      message: installed
        ? `Capturing GraphQL — ${recentPayloads.length} payload${recentPayloads.length === 1 ? "" : "s"} sampled`
        : "Capture inactive"
    };
  }
};

export function getRecentCapturedPayloads(): typeof recentPayloads {
  return [...recentPayloads];
}

function installInterceptor(ctx: FeatureContext): void {
  if (installed || typeof globalThis.fetch !== "function") return;
  originalFetch = { fn: globalThis.fetch };
  const patched = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch!.fn(input, init);
    // Clone only what will actually be captured: an unread clone tees the body stream and
    // holds it until GC, and X streams video segments through fetch.
    if (response.ok && shouldCapture(resolveUrl(input))) {
      void capturePayload(ctx, input, response.clone());
    }
    return response;
  };
  patchedFetch = patched as typeof fetch;
  globalThis.fetch = patchedFetch;
  installed = true;
  ctx.diagnostics.info("Passive GraphQL interceptor installed");
}

function uninstallInterceptor(ctx: FeatureContext): void {
  if (!installed || !originalFetch) return;
  // Another script may have wrapped fetch after us; restoring blindly would clobber it.
  if (globalThis.fetch === patchedFetch) {
    globalThis.fetch = originalFetch.fn;
  } else {
    ctx.diagnostics.warn("fetch was re-patched downstream — leaving the current wrapper in place");
  }
  originalFetch = undefined;
  patchedFetch = undefined;
  installed = false;
  ctx.diagnostics.info("Passive GraphQL interceptor uninstalled");
}

async function capturePayload(
  ctx: FeatureContext,
  input: RequestInfo | URL,
  response: Response
): Promise<void> {
  try {
    const url = resolveUrl(input);
    if (!shouldCapture(url)) return;
    if (!response.ok || !response.body) return;
    const blob = await response.blob();
    if (blob.size === 0 || blob.size > MAX_PAYLOAD_BYTES) return;
    const text = await blob.text();
    recordPayload(url, response.status, blob.size);
    await persistPayload(ctx, url, text);
  } catch (error) {
    ctx.diagnostics.warn("Network capture skipped", { error: String((error as Error)?.message ?? error) });
  }
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

function shouldCapture(url: string): boolean {
  if (!/\/i\/api\/graphql\//.test(url)) return false;
  return true;
}

function recordPayload(url: string, status: number, bytes: number): void {
  recentPayloads.push({ url, status, bytes, at: new Date().toISOString() });
  while (recentPayloads.length > MAX_PAYLOADS) {
    recentPayloads.shift();
  }
}

async function persistPayload(ctx: FeatureContext, url: string, body: string): Promise<void> {
  const store = getCheckpointStore() as CheckpointStore | undefined;
  if (!store) return;
  const operationName = /\/i\/api\/graphql\/[^/]+\/([A-Za-z0-9_]+)/.exec(url)?.[1] ?? "graphql";
  const jobId = `capture-${operationName}`;
  if (store.list().every((entry) => entry.jobId !== jobId)) {
    await store.start(jobId, "capture", ["json"], true);
  }
  await store.append(jobId, [
    {
      tweetId: null,
      handle: null,
      displayName: null,
      text: scrubAuth(body).slice(0, MAX_PAYLOAD_BYTES),
      capturedAt: new Date().toISOString(),
      surface: `graphql:${operationName}`,
      media: [],
      permalink: url
    }
  ]);
  void ctx.auditLog.record("export.start", { jobId, operation: operationName });
}

function scrubAuth(body: string): string {
  // Aviary stores response bodies, but we still strip anything that looks like a session token or
  // bearer header echoed back into the response (rare but cheap to guard against).
  return body
    .replace(/"(ct0|auth_token|guest_id|csrf_token)"\s*:\s*"[^"]*"/g, '"$1":"<scrubbed>"')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/g, "Bearer <scrubbed>");
}
