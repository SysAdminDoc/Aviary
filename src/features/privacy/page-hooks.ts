import type { FeatureContext, FeatureModule, FeatureStatus } from "../registry";
import type { PageBridge } from "../../platform/page-bridge";
import type {
  BlockedBeaconPayload,
  PlaylistRewritePayload
} from "../../page/page-agent";

/**
 * Owns everything that needs the page's own world: refusing X's analytics beacons and forcing the
 * top video rendition.
 *
 * Both were previously filed as unbuildable, and both were: neither manifest declared
 * `"world": "MAIN"`, so patching `fetch` here rewrote Aviary's copy and left the page's alone.
 * `src/platform/page-bridge.ts` is the route in; this feature only decides what to ask for and
 * reports what actually happened.
 *
 * Counters are deliberately observable. A hook that is installed but never fires is
 * indistinguishable from a hook that does not work, and this repo has shipped that confusion
 * before -- so the status line reports the count, not the intent.
 */

let blockedBeacons = 0;
let blockedAdRequests = 0;
let rewrittenPlaylists = 0;
let bridgeStatus: "unavailable" | "connecting" | "connected" = "connecting";
let bridgeReason = "";
let subscribedBridge: PageBridge | undefined;

export const pageHooksFeature: FeatureModule = {
  id: "privacy.pageHooks",
  title: "Page-world hooks",
  category: "privacy",
  defaultEnabled: true,

  init(ctx) {
    const bridge = ctx.pageBridge;
    if (!bridge) {
      bridgeStatus = "unavailable";
      bridgeReason = "No page bridge was created for this build.";
      return;
    }

    if (subscribedBridge !== bridge) {
      subscribedBridge = bridge;
      bridge.on("blocked", (payload) => {
        const blocked = payload as BlockedBeaconPayload;
        if (blocked?.category === "ad") {
          blockedAdRequests += 1;
          ctx.diagnostics.info("Promoted-content logging call refused", {
            via: blocked?.via,
            url: blocked?.url
          });
          return;
        }
        blockedBeacons += 1;
        ctx.diagnostics.info("Analytics beacon refused", {
          via: blocked?.via,
          url: blocked?.url
        });
      });
      bridge.on("playlist", (payload) => {
        rewrittenPlaylists += 1;
        const rewrite = payload as PlaylistRewritePayload;
        ctx.diagnostics.info("Video playlist pinned to its best rendition", {
          variantsBefore: rewrite?.variantsBefore
        });
      });
    }

    pushConfig(ctx);
  },

  apply(ctx) {
    pushConfig(ctx);
  },

  destroy(ctx) {
    // Leave the bridge itself alone -- main.ts owns its lifetime. Turning every hook off is what
    // reversing this feature means, and it is what restores X's own behaviour.
    ctx.pageBridge?.configure({
      blockAds: false,
      blockBeacons: false,
      captureGraphql: false,
      captureMediaMetadata: false,
      forceVideoQuality: false
    });
    blockedBeacons = 0;
    blockedAdRequests = 0;
    rewrittenPlaylists = 0;
    if (subscribedBridge === ctx.pageBridge) {
      subscribedBridge = undefined;
    }
  },

  getStatus(): FeatureStatus {
    if (bridgeStatus === "unavailable") {
      return {
        ok: false,
        message: bridgeReason || "Aviary cannot reach the page's own network layer."
      };
    }
    if (bridgeStatus === "connecting") {
      return { ok: true, message: "Connecting to the page…" };
    }

    const parts: string[] = [];
    if (blockedAdRequests > 0) {
      parts.push(`${blockedAdRequests} ad call${blockedAdRequests === 1 ? "" : "s"} refused`);
    }
    if (blockedBeacons > 0) {
      parts.push(`${blockedBeacons} beacon${blockedBeacons === 1 ? "" : "s"} refused`);
    }
    if (rewrittenPlaylists > 0) {
      parts.push(
        `${rewrittenPlaylists} video${rewrittenPlaylists === 1 ? "" : "s"} pinned to best quality`
      );
    }
    return {
      ok: true,
      message: parts.length > 0 ? parts.join(" · ") : "Connected to the page"
    };
  }
};

function pushConfig(ctx: FeatureContext): void {
  const bridge = ctx.pageBridge;
  if (!bridge) {
    return;
  }
  bridgeStatus = bridge.status();
  bridgeReason = bridge.reason();
  bridge.configure({
    blockAds: ctx.settings.privacy.blockAds,
    blockBeacons: ctx.settings.privacy.blockAnalyticsBeacons,
    captureGraphql: ctx.settings.export.preserveRawPayloads,
    captureMediaMetadata: ctx.settings.media.buttons,
    forceVideoQuality: ctx.settings.performance.forceVideoQuality
  });
}

/** Exposed for the Control Center readout and for tests. */
export function pageHookCounters(): {
  blockedBeacons: number;
  blockedAdRequests: number;
  rewrittenPlaylists: number;
} {
  return { blockedBeacons, blockedAdRequests, rewrittenPlaylists };
}
