import type { FeatureContext, FeatureModule } from "../registry.ts";
import type { CheckpointStore } from "./jobs.ts";
import { getCheckpointStore } from "./export-feature.ts";
import {
  MAX_GRAPHQL_PAYLOAD_BYTES,
  sanitizeCapturedGraphqlPayload,
  type SanitizedCapturedGraphqlPayload
} from "../../page/page-agent.ts";
import type { PageBridge } from "../../platform/page-bridge.ts";
import { mirrorBookmarks } from "../library/bookmarks-feature.ts";
import { parseCapturedBookmarks } from "../library/bookmark-capture.ts";
import { parseCapturedThreadRecords } from "./thread-capture.ts";

const MAX_PAYLOADS = 50;
const MAX_SESSION_PAYLOADS = 500;
const MAX_SESSION_BYTES = 50_000_000;
const MAX_PENDING_PAYLOADS = 32;

let subscribedBridge: PageBridge | undefined;
let activeContext: FeatureContext | undefined;
let captureEpoch = 0;
let captureTail: Promise<void> = Promise.resolve();
let sessionPayloads = 0;
let sessionBytes = 0;
let pendingPayloads = 0;
let rejectedPayloads = 0;
let lastRejectionWarningAt = 0;
let lastCaptureEnabled = false;
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

  init(ctx) {
    const previousContext = activeContext;
    activeContext = ctx;
    const bridge = ctx.pageBridge;
    if (bridge && (subscribedBridge !== bridge || previousContext !== ctx)) {
      resetCaptureSession();
      subscribedBridge = bridge;
      bridge.on("graphql", (payload) => {
        const current = activeContext;
        if (current) {
          enqueueCaptured(payload, captureEpoch, current);
        }
      });
    }
    ctx.diagnostics.info("Network capture feature ready", {
      enabled: ctx.settings.export.preserveRawPayloads,
      bridge: bridge?.status() ?? "absent"
    });
  },

  apply(ctx) {
    activeContext = ctx;
    const enabled = ctx.settings.export.preserveRawPayloads;
    if (enabled !== lastCaptureEnabled) {
      resetCaptureSession();
      lastCaptureEnabled = enabled;
    }
  },

  destroy(ctx) {
    // The page-side hook is turned off by `privacy.pageHooks`, which owns the config. Dropping
    // the context here is what stops anything reaching the store.
    activeContext = undefined;
    resetCaptureSession();
    lastCaptureEnabled = false;
    recentPayloads.length = 0;
    if (subscribedBridge === ctx.pageBridge) {
      subscribedBridge = undefined;
    }
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
      return {
        ok: true,
        message:
          rejectedPayloads > 0
            ? `Watching X's timeline requests · ${rejectedPayloads} rejected`
            : "Watching X's timeline requests"
      };
    }
    return {
      ok: true,
      message: `${recentPayloads.length} payload${recentPayloads.length === 1 ? "" : "s"} captured${
        rejectedPayloads > 0 ? ` · ${rejectedPayloads} rejected` : ""
      }`
    };
  }
};

export function getRecentCapturedPayloads(): typeof recentPayloads {
  return [...recentPayloads];
}

async function onCaptured(payload: SanitizedCapturedGraphqlPayload, epoch: number): Promise<void> {
  const ctx = activeContext;
  if (epoch !== captureEpoch || !ctx || !payload || typeof payload.url !== "string") {
    return;
  }
  if (!ctx.settings.export.preserveRawPayloads) {
    return;
  }
  try {
    recordPayload(payload.url, payload.status, payload.bytes);
    await persistPayload(ctx, payload.url, payload.operation, payload.body, epoch);
  } catch (error) {
    ctx.diagnostics.warn("Network capture skipped", {
      error: String((error as Error)?.message ?? error)
    });
  }
}

function enqueueCaptured(payload: unknown, epoch: number, ctx: FeatureContext): void {
  if (epoch !== captureEpoch || activeContext !== ctx) {
    return;
  }
  const sanitized = sanitizeCapturedGraphqlPayload(payload, pageOrigin(ctx));
  if (!sanitized) {
    rejectCapture(ctx, "invalid GraphQL payload");
    return;
  }
  if (sessionPayloads >= MAX_SESSION_PAYLOADS) {
    rejectCapture(ctx, "session payload limit reached");
    return;
  }
  if (sessionBytes + sanitized.bytes > MAX_SESSION_BYTES) {
    rejectCapture(ctx, "session byte limit reached");
    return;
  }
  if (pendingPayloads >= MAX_PENDING_PAYLOADS) {
    rejectCapture(ctx, "capture backpressure limit reached");
    return;
  }
  sessionPayloads += 1;
  sessionBytes += sanitized.bytes;
  pendingPayloads += 1;
  captureTail = captureTail
    .then(() => onCaptured(sanitized, epoch))
    .catch((error: unknown) => {
      ctx.diagnostics.warn("Network capture event failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    })
    .finally(() => {
      if (captureEpoch === epoch) {
        pendingPayloads = Math.max(0, pendingPayloads - 1);
      }
    });
}

function rejectCapture(ctx: FeatureContext, reason: string): void {
  rejectedPayloads += 1;
  const now = Date.now();
  if (now - lastRejectionWarningAt < 1000) {
    return;
  }
  lastRejectionWarningAt = now;
  ctx.diagnostics.warn("Network capture rejected a page message", { reason });
}

function resetCaptureSession(): void {
  captureEpoch += 1;
  captureTail = Promise.resolve();
  sessionPayloads = 0;
  sessionBytes = 0;
  pendingPayloads = 0;
  rejectedPayloads = 0;
  lastRejectionWarningAt = 0;
}

function pageOrigin(ctx: FeatureContext): string | undefined {
  try {
    const origin = new URL(ctx.route.href).origin;
    return origin.startsWith("https://") ? origin : undefined;
  } catch {
    return undefined;
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
  const capturedAt = new Date().toISOString();
  const mirrored = parseCapturedBookmarks(body, operationName, capturedAt, url);
  if (mirrored.length > 0) {
    const count = await mirrorBookmarks(mirrored);
    if (count > 0) {
      void ctx.auditLog.record("bookmark.mirror", {
        operation: operationName,
        records: count
      });
      ctx.diagnostics.info("Captured bookmarks mirrored locally", {
        operation: operationName,
        records: count
      });
    }
  }
  if (!store) return;
  const jobId = `capture-${operationName}`;
  if (store.list().every((entry) => entry.jobId !== jobId)) {
    await store.start(jobId, "capture", ["json"], true);
  }
  const scrubbed = truncateUtf8(scrubAuth(body), MAX_GRAPHQL_PAYLOAD_BYTES);
  const threadRecords = parseCapturedThreadRecords(body, operationName, capturedAt, url);
  await store.append(jobId, [
    ...threadRecords,
    {
      tweetId: null,
      handle: null,
      displayName: null,
      text: scrubbed,
      capturedAt,
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
