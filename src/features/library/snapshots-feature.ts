import type { FeatureContext, FeatureModule } from "../registry.ts";
import {
  collectAccountsFromDom,
  measureListCoverage,
  SnapshotStore,
  type SnapshotEntry,
  type SnapshotKind
} from "./snapshots.ts";

let store: SnapshotStore | undefined;

export const snapshotsFeature: FeatureModule = {
  id: "library.snapshots",
  title: "Follower / following snapshots",
  category: "core",

  async init(ctx) {
    store = new SnapshotStore(ctx.storage);
    await store.load();
    ctx.diagnostics.info("Snapshots initialized", { entries: store.size() });
  },

  destroy(ctx) {
    store = undefined;
    ctx.diagnostics.info("Snapshots destroyed");
  },

  getStatus() {
    return {
      ok: true,
      message: store ? `${store.size()} snapshots stored` : "Snapshots idle"
    };
  }
};

export function getSnapshotStore(): SnapshotStore | undefined {
  return store;
}

export interface CaptureFromDomResult {
  entry: SnapshotEntry;
  totalAccounts: number;
  /** False when rows were still below the fold or still loading, so the capture is a slice. */
  reachedEnd: boolean;
}

export async function captureSnapshotFromDom(
  ctx: FeatureContext,
  kind: SnapshotKind,
  profileHandle: string
): Promise<CaptureFromDomResult | null> {
  if (!store) return null;
  const accounts = collectAccountsFromDom(document);
  if (accounts.length === 0) {
    ctx.diagnostics.warn("Snapshot skipped — no UserCell rows in DOM");
    return null;
  }
  const coverage = measureListCoverage(document, accounts.length);
  const entry = await store.record({
    kind,
    handle: profileHandle.toLowerCase(),
    source: "dom",
    accounts,
    coverage
  });
  ctx.diagnostics.info("Snapshot captured", {
    kind,
    handle: profileHandle,
    count: accounts.length,
    reachedEnd: coverage.reachedEnd
  });
  return { entry, totalAccounts: accounts.length, reachedEnd: coverage.reachedEnd };
}
