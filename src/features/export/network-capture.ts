import type { FeatureContext, FeatureModule } from "../registry";
import type { CheckpointStore } from "./jobs";
import { getCheckpointStore } from "./export-feature";
import type { CapturedGraphqlPayload } from "../../page/page-agent";

const MAX_PAYLOAD_BYTES = 1_500_000;
const MAX_PAYLOADS = 50;

let subscribed = false;
let activeContext: FeatureContext | undefined;
let captureEpoch = 0;
let captureTail: Promise<void> = Promise.resolve();
const recentPayloads: Array<{ url: string; status: number; at: string; bytes: number }> = [];

/**
 * Records X's GraphQL responses into the CheckpointStore.
 *
 * This used to wrap `globalThis.fetch`, which is Aviary's own fetch and not the page's -- the
 * content script runs in the isolated world, so X's requests never passed through it and the
 * feature's own status line had to admit it saw nothing but Aviary's traffic.
 *
 * The requests now arrive from `src/page/page-agent.ts`, which runs in the page's world where
 * they are actually visible. The hook is switched on by `privacy.pageHooks` from
 * `export.preserveRawPayloads`, so this module never patches anything itself; it subscribes,
 * scrubs and persists.
 */
export const networkCaptureFeature: FeatureModule = {
  id: "export.networkCapture",
  title: "Passive GraphQL capture",
  category: "export",
  defaultEnabled: true,

  init(ctx) {
    activeContext = ctx;
    const bridge = ctx.pageBridge;
    if (bridge && !subscribed) {
      subscribed = true;
      bridge.on("graphql", (payload) => {
        const epoch = captureEpoch;
        captureTail = captureTail.then(() => onCaptured(payload as CapturedGraphqlPayload, epoch));
      });
    }
    ctx.diagnostics.info("Network capture feature ready", {
      enabled: ctx.settings.export.preserveRawPayloads,
      bridge: bridge?.status() ?? "absent"
    });
  },

  apply(ctx) {
    activeContext = ctx;
  },

  destroy(ctx) {
    // The page-side hook is turned off by `privacy.pageHooks`, which owns the config. Dropping
    // the context here is what stops anything reaching the store.
    activeContext = undefined;
    captureEpoch += 1;
    recentPayloads.length = 0;
    ctx.diagnostics.info("Network capture destroyed");
  },

  getStatus() {
    const ctx = activeContext;
    if (!ctx?.settings.export.preserveRawPayloads) {
      return { ok: true, message: "Capture inactive" };
    }
    const bridge = ctx.pageBridge;
    if (!bridge || bridge.status() === "unavailable") {
      return {
        ok: false,
        message: bridge?.reason() || "Aviary cannot see X's requests in this browser."
      };
    }
    if (recentPayloads.length === 0) {
      return { ok: true, message: "Watching X's timeline requests" };
    }
    return {
      ok: true,
      message: `${recentPayloads.length} payload${recentPayloads.length === 1 ? "" : "s"} captured`
    };
  }
};

export function getRecentCapturedPayloads(): typeof recentPayloads {
  return [...recentPayloads];
}

async function onCaptured(payload: CapturedGraphqlPayload, epoch: number): Promise<void> {
  const ctx = activeContext;
  if (epoch !== captureEpoch || !ctx || !payload || typeof payload.url !== "string") {
    return;
  }
  if (!ctx.settings.export.preserveRawPayloads) {
    return;
  }
  try {
    const body = typeof payload.body === "string" ? payload.body : "";
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes === 0 || bodyBytes > MAX_PAYLOAD_BYTES) {
      return;
    }
    recordPayload(payload.url, payload.status, bodyBytes);
    await persistPayload(ctx, payload.url, payload.operation || "graphql", body, epoch);
  } catch (error) {
    ctx.diagnostics.warn("Network capture skipped", {
      error: String((error as Error)?.message ?? error)
    });
  }
}

function recordPayload(url: string, status: number, bytes: number): void {
  recentPayloads.push({ url, status, bytes, at: new Date().toISOString() });
  while (recentPayloads.length > MAX_PAYLOADS) {
    recentPayloads.shift();
  }
}

async function persistPayload(
  ctx: FeatureContext,
  url: string,
  operationName: string,
  body: string,
  epoch: number
): Promise<void> {
  if (epoch !== captureEpoch || activeContext !== ctx) {
    return;
  }
  const store = getCheckpointStore() as CheckpointStore | undefined;
  if (!store) return;
  const jobId = `capture-${operationName}`;
  if (store.list().every((entry) => entry.jobId !== jobId)) {
    await store.start(jobId, "capture", ["json"], true);
  }
  const scrubbed = truncateUtf8(scrubAuth(body), MAX_PAYLOAD_BYTES);
  await store.append(jobId, [
    {
      tweetId: null,
      handle: null,
      displayName: null,
      text: scrubbed,
      capturedAt: new Date().toISOString(),
      surface: `graphql:${operationName}`,
      media: [],
      permalink: url
    }
  ]);
  void ctx.auditLog.record("capture.payload", { jobId, operation: operationName });
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}

function scrubAuth(body: string): string {
  // Aviary stores response bodies, but we still strip anything that looks like a session token or
  // bearer header echoed back into the response (rare but cheap to guard against).
  return body
    .replace(/"(ct0|auth_token|guest_id|csrf_token)"\s*:\s*"[^"]*"/g, '"$1":"<scrubbed>"')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/g, "Bearer <scrubbed>");
}
