import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Under the Hood parser reads X's monthly aggregate shape and bounds labels", async () => {
  const { parseUnderTheHoodJson } = await importBundledModule("src/features/library/under-the-hood.ts");
  const result = parseUnderTheHoodJson(
    JSON.stringify({
      notes: "X's best-effort report",
      period: { startDate: "2026-07-01", endDate: "2026-07-31", timezone: "UTC" },
      generatedAt: "2026-08-12T10:00:00.000Z",
      postCount: 181,
      postLabels: [{
        label: "AbusiveBehavior",
        about: "A public explanation",
        effect: "Recommendations may be limited",
        posts: 4,
        totalPostsInMonth: 181,
        percentageOfPosts: "2.20%"
      }],
      accountLabels: [{
        label: "Spam",
        about: "Account explanation",
        effect: "Reach may be limited",
        days: 3,
        daysInPeriod: 31,
        percentageOfDays: 9.67,
        activeDays: [2, 3, 4]
      }]
    }),
    "2026-08-13T12:00:00.000Z"
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.report.id, "uth-2026-07-01-2026-07-31");
  assert.equal(result.report.generatedAt, "2026-08-12T10:00:00.000Z");
  assert.equal(result.report.postCount, 181);
  assert.equal(result.report.postLabels[0].percentageOfPosts, 2.2);
  assert.deepEqual(result.report.accountLabels[0].activeDays, [2, 3, 4]);
  assert.equal(result.report.importedAt, "2026-08-13T12:00:00.000Z");
});

test("Under the Hood parser accepts reportJson wrappers and rejects malformed or oversized files", async () => {
  const { parseUnderTheHoodJson, MAX_UNDER_THE_HOOD_BYTES } = await importBundledModule("src/features/library/under-the-hood.ts");
  const wrapped = parseUnderTheHoodJson(JSON.stringify({
    reportJson: JSON.stringify({
      monthBucket: 202606,
      postCount: 10,
      postLabels: [],
      accountLabels: []
    })
  }));
  assert.equal(wrapped.errors.length, 0);
  assert.equal(wrapped.report.period.startDate, "2026-06-01");
  assert.ok(wrapped.warnings.some((warning) => /inferred/i.test(warning)));

  assert.deepEqual(parseUnderTheHoodJson("not json").report, null);
  assert.ok(parseUnderTheHoodJson("not json").errors.length > 0);
  const oversized = parseUnderTheHoodJson("x".repeat(MAX_UNDER_THE_HOOD_BYTES + 1));
  assert.equal(oversized.report, null);
  assert.match(oversized.errors[0], /2 MiB/);
});

test("Under the Hood comparison reports month-over-month label changes", async () => {
  const { compareUnderTheHoodReports, parseUnderTheHoodJson } = await importBundledModule("src/features/library/under-the-hood.ts");
  const make = (month, postCount, postLabels, accountLabels) => parseUnderTheHoodJson(JSON.stringify({
    period: { startDate: `${month}-01`, endDate: `${month}-28`, timezone: "UTC" },
    postCount,
    postLabels,
    accountLabels
  })).report;
  const earlier = make("2026-06", 10, [{ label: "Spam", posts: 2 }], [{ label: "AdultContent", days: 1 }]);
  const later = make("2026-07", 15, [{ label: "Spam", posts: 5 }, { label: "Abuse", posts: 1 }], [{ label: "AdultContent", days: 0 }, { label: "Compromised", days: 2 }]);
  const comparison = compareUnderTheHoodReports(earlier, later);
  assert.equal(comparison.postCountDelta, 5);
  assert.equal(comparison.postLabelCountDelta, 4);
  assert.equal(comparison.accountLabelDayCountDelta, 1);
  assert.deepEqual(comparison.addedPostLabels, ["Abuse"]);
  assert.deepEqual(comparison.removedAccountLabels, []);
  assert.equal(comparison.postLabelChanges.find((entry) => entry.label === "Spam").delta, 3);
});

test("Under the Hood store deduplicates months and exports normalized user data", async () => {
  const { UnderTheHoodStore, UNDER_THE_HOOD_KEY } = await importBundledModule("src/features/library/under-the-hood.ts");
  const store = new Map();
  const storage = storageFrom(store);
  const reports = new UnderTheHoodStore(storage);
  await reports.load();
  const payload = JSON.stringify({
    period: { startDate: "2026-07-01", endDate: "2026-07-31", timezone: "UTC" },
    postCount: 12,
    postLabels: [{ label: "Spam", posts: 1 }],
    accountLabels: []
  });
  assert.equal((await reports.importPayload(payload)).report.period.startDate, "2026-07-01");
  assert.equal((await reports.importPayload(payload)).report.period.startDate, "2026-07-01");
  assert.equal(reports.status().reportCount, 1);
  const artifact = reports.exportArtifact("2026-08-22T00:00:00.000Z");
  assert.equal(artifact.filename, "aviary-under-the-hood-20260822.json");
  assert.equal(artifact.reports, 1);
  assert.match(new TextDecoder().decode(artifact.data), /X Under the Hood monthly summaries/);
  assert.ok(store.has(UNDER_THE_HOOD_KEY));
});

test("Under the Hood reports are part of the full library backup allow-list", async () => {
  const { createLibraryBackup, parseLibraryBackup } = await importBundledModule("src/features/core/library-backup.ts");
  const underTheHoodKey = "aviary.library.underTheHood.v1";
  const storage = storageFrom(new Map([[underTheHoodKey, {
    version: 1,
    reports: [{
      id: "uth-2026-07-01-2026-07-31",
      source: "x-under-the-hood",
      importedAt: "2026-08-13T12:00:00.000Z",
      generatedAt: "2026-08-12T10:00:00.000Z",
      period: { startDate: "2026-07-01", endDate: "2026-07-31", timezone: "UTC" },
      postCount: 181,
      postLabels: [],
      accountLabels: [],
      totalPostLabels: 0,
      totalAccountLabels: 0,
      notes: null
    }]
  }]]));
  const { artifact } = await createLibraryBackup(storage, {
    selectedKeys: [underTheHoodKey],
    createdAt: "2026-08-22T00:00:00.000Z"
  });
  const backup = parseLibraryBackup(new TextDecoder().decode(artifact.data));
  assert.equal(backup.collections[0].key, underTheHoodKey);
  assert.equal(backup.collections[0].count, 1);
});

function storageFrom(store) {
  return {
    store,
    async get(key, fallback) {
      return this.store.has(key) ? this.store.get(key) : fallback;
    },
    async set(key, value) {
      this.store.set(key, value);
    },
    async remove(key) {
      this.store.delete(key);
    }
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-under-the-hood-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
