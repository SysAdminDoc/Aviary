import { importSourceEntry, importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("formatXlsx packages an OPC-shaped ZIP with the expected parts", async () => {
  const { formatXlsx } = await importSourceModule("src/features/export/xlsx.ts");
  const { readStoreZip } = await importSourceModule("src/features/export/zip-reader.ts");

  const artifact = formatXlsx([
    {
      tweetId: "1",
      handle: "alpha",
      displayName: "Alpha",
      text: 'Has "quoted" tokens & angle <brackets>',
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/alpha/status/1"
    }
  ]);

  assert.equal(artifact.filename, "tweets.xlsx");
  assert.equal(
    artifact.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  const entries = readStoreZip(artifact.data);
  const filenames = new Set(entries.map((entry) => entry.filename));
  assert.ok(filenames.has("[Content_Types].xml"));
  assert.ok(filenames.has("_rels/.rels"));
  assert.ok(filenames.has("xl/workbook.xml"));
  assert.ok(filenames.has("xl/worksheets/sheet1.xml"));
  const sheet = new TextDecoder().decode(
    entries.find((entry) => entry.filename === "xl/worksheets/sheet1.xml").data
  );
  assert.match(sheet, /Has &quot;quoted&quot; tokens &amp; angle &lt;brackets&gt;/);
});

test("selectSupportedFormats now accepts xlsx", async () => {
  const { selectSupportedFormats } = await importSourceModule(
    "src/features/export/export-feature.ts"
  );
  assert.deepEqual(selectSupportedFormats(["json", "xlsx"]), ["json", "xlsx"]);
  assert.deepEqual(selectSupportedFormats(["exe", "xlsx"]), ["xlsx"]);
});

test("BookmarkStore round-trips, dedupes tags, and reports tag/folder summaries", async () => {
  const { BookmarkStore } = await importSourceModule("src/features/library/bookmarks.ts");

  const store = new Map();
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async set(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      store.delete(key);
    }
  };

  const bookmarks = new BookmarkStore(storage);
  await bookmarks.load();

  const first = await bookmarks.upsert({
    tweetId: "1",
    handle: "alpha",
    text: "Hello",
    tags: ["Reading", "reading", "#reading", "DESIGN", "  spaced  "],
    folder: "later"
  });
  // "spaced" is a valid tag after trim; "Reading"/"reading"/"#reading" dedupe to "reading"; "DESIGN" lowercases.
  assert.deepEqual(first.tags, ["design", "reading", "spaced"]);
  assert.equal(first.folder, "later");

  await bookmarks.upsert({ tweetId: "2", handle: "beta", text: "Two", folder: "later" });
  await bookmarks.upsert({ tweetId: "3", handle: "gamma", text: "Three", folder: "archive" });

  assert.equal(bookmarks.list().length, 3);
  assert.deepEqual(bookmarks.folders(), ["archive", "later"]);
  assert.deepEqual(bookmarks.tags(), ["design", "reading", "spaced"]);

  await bookmarks.remove(first.id);
  assert.equal(bookmarks.list().length, 2);

  // Persistence round-trip
  const reloaded = new BookmarkStore(storage);
  await reloaded.load();
  assert.equal(reloaded.list().length, 2);
});

test("BookmarkStore.dueReminders selects entries past the cutoff", async () => {
  const { BookmarkStore } = await importSourceModule("src/features/library/bookmarks.ts");
  const store = new Map();
  const storage = makeStorage(store);
  const bookmarks = new BookmarkStore(storage);
  await bookmarks.load();
  const past = await bookmarks.upsert({ tweetId: "1", text: "past", remindAt: "2026-05-18T00:00:00Z" });
  const future = await bookmarks.upsert({ tweetId: "2", text: "future", remindAt: "2027-01-01T00:00:00Z" });

  const due = bookmarks.dueReminders(new Date("2026-05-19T12:00:00Z"));
  assert.equal(due.length, 1);
  assert.equal(due[0].id, past.id);
  assert.ok(!due.find((entry) => entry.id === future.id));
});

test("a captured payload is scrubbed of session tokens and truncated to its byte cap", async () => {
  // The scrub happens on the way into the checkpoint store, so the store is where it is visible.
  // The recent-payload list carries metadata only, which the last assertion here pins.
  // One bundle for both: `getCheckpointStore` is module-level state, so bundling the two
  // separately would give network-capture its own copy and persist nothing anywhere the export
  // feature could see -- a green test against a capture path that stores nothing.
  const bundled = await importSourceEntry([
    "src/features/export/network-capture.ts",
    "src/features/export/export-feature.ts"
  ]);
  const capture = bundled;
  const exportFeature = { exportFeature: bundled.exportFeature };

  const values = new Map();
  const storage = {
    async get(key, fallback) {
      return values.has(key) ? structuredClone(values.get(key)) : fallback;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    }
  };
  const bridge = fakeBridge();
  const context = {
    pageBridge: bridge,
    route: { href: "https://x.com/home", surface: "home", path: "/home" },
    settings: {
      export: { preserveRawPayloads: true, enabled: false, autoDiscoverQueryIds: false, formats: ["json"] }
    },
    storage,
    diagnostics: { info() {}, warn() {}, error() {} },
    auditLog: { record: async () => {} }
  };

  await exportFeature.exportFeature.init(context);
  capture.networkCaptureFeature.init(context);

  const secrets = JSON.stringify({
    ct0: "0123456789abcdef",
    auth_token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    guest_id: "v1%3A123456789",
    csrf_token: "deadbeefdeadbeef",
    header: "Bearer abcdefghijklmnopqrstuvwxyz",
    data: { home: { instructions: [] } }
  });
  bridge.emit("graphql", {
    url: "https://x.com/i/api/graphql/abc/HomeTimeline",
    operation: "HomeTimeline",
    status: 200,
    bytes: secrets.length,
    at: new Date().toISOString(),
    body: secrets
  });
  // A response past the 1.5 MB cap: capture is a debugging aid, not a mirror of the session.
  const huge = JSON.stringify({ pad: "x".repeat(2_000_000) });
  bridge.emit("graphql", {
    url: "https://x.com/i/api/graphql/abc/UserTweets",
    operation: "UserTweets",
    status: 200,
    bytes: huge.length,
    at: new Date().toISOString(),
    body: huge
  });
  await new Promise((resolve) => setTimeout(resolve, 60));

  const stored = JSON.stringify([...values.values()]);
  assert.ok(stored.includes("graphql:HomeTimeline"), "the payload was not persisted at all");
  for (const secret of ["0123456789abcdef", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "v1%3A123456789", "deadbeefdeadbeef"]) {
    assert.ok(!stored.includes(secret), `a session token survived capture: ${secret}`);
  }
  assert.ok(!/Bearer\s+abcdefghij/.test(stored), "a bearer header survived capture");
  assert.ok(stored.includes("<scrubbed>"), "the scrub must leave a marker, not delete the field");
  // Refused outright here rather than truncated, which is the stricter of the two acceptable
  // outcomes; what must never happen is a 2 MB response body landing in local storage.
  assert.ok(!stored.includes("x".repeat(100_000)), "a payload past the 1.5 MB cap reached storage");
  assert.ok(!stored.includes("graphql:UserTweets"), "an oversized payload was persisted anyway");

  // The in-memory list the Trust panel reads is metadata only; a body there would put response
  // content into every diagnostics copy.
  for (const entry of capture.getRecentCapturedPayloads()) {
    assert.deepEqual(Object.keys(entry).sort(), ["at", "bytes", "status", "url"]);
  }

  capture.networkCaptureFeature.destroy(context);
  await exportFeature.exportFeature.destroy(context);
});

test("network capture never patches the fetch it can reach, because it is the wrong one", async () => {
  const { networkCaptureFeature } = await importSourceModule("src/features/export/network-capture.ts");
  const bridge = fakeBridge();
  const context = {
    pageBridge: bridge,
    route: { href: "https://x.com/home" },
    settings: { export: { preserveRawPayloads: true } },
    diagnostics: { info() {}, warn() {}, error() {} },
    auditLog: { record: async () => {} }
  };

  // Until v1.12.0 this module wrapped `globalThis.fetch` — Aviary's own, not the page's, because
  // the content script runs in the isolated world. It saw none of X's traffic.
  const originalFetch = globalThis.fetch;
  const originalXhr = globalThis.XMLHttpRequest?.prototype?.open;
  networkCaptureFeature.init(context);
  networkCaptureFeature.apply(context);
  const patchedFetch = globalThis.fetch !== originalFetch;
  const patchedXhr = globalThis.XMLHttpRequest?.prototype?.open !== originalXhr;
  // Measured while the feature is live. destroy() now unsubscribes, so counting after teardown
  // would be asking whether the handler leaked, which is a different claim from this one.
  const subscribedWhileActive = bridge.count("graphql");
  networkCaptureFeature.destroy(context);

  assert.equal(patchedFetch, false, "network-capture patched fetch");
  assert.equal(patchedXhr, false, "network-capture patched XMLHttpRequest");
  assert.equal(subscribedWhileActive, 1, "payloads must arrive from the page bridge instead");
  assert.equal(bridge.count("graphql"), 0, "and the subscription must not outlive the feature");
});

test("network capture rejects forged payloads and bounds a burst before persistence", async () => {
  const { networkCaptureFeature, getRecentCapturedPayloads } = await importSourceModule(
    "src/features/export/network-capture.ts"
  );
  const bridge = fakeBridge();
  const diagnostics = { events: [], info() {}, warn(message, details) { this.events.push({ message, details }); }, error() {} };
  const context = {
    pageBridge: bridge,
    route: { href: "https://x.com/home" },
    settings: { export: { preserveRawPayloads: true } },
    diagnostics,
    auditLog: { record: async () => {} }
  };

  networkCaptureFeature.init(context);
  const at = new Date().toISOString();
  bridge.emit("graphql", {
    url: "https://evil.example/i/api/graphql/abc/HomeTimeline",
    operation: "HomeTimeline",
    status: 200,
    bytes: 2,
    at,
    body: "{}"
  });
  for (let index = 0; index < 64; index += 1) {
    bridge.emit("graphql", {
      url: "https://x.com/i/api/graphql/abc/HomeTimeline",
      operation: "HomeTimeline",
      status: 200,
      bytes: 2,
      at,
      body: "{}"
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(getRecentCapturedPayloads().length, 32, "burst intake must stop at backpressure capacity");
  assert.ok(
    diagnostics.events.some((entry) => entry.details?.reason === "invalid GraphQL payload"),
    "malformed or off-origin page messages must be diagnosed"
  );
  assert.match(networkCaptureFeature.getStatus().message, /rejected/);
  networkCaptureFeature.destroy(context);
});

test("page-world feature subscriptions survive a destroy and reboot", async () => {
  const { pageHooksFeature } = await importSourceModule("src/features/privacy/page-hooks.ts");
  const { networkCaptureFeature } = await importSourceModule("src/features/export/network-capture.ts");

  for (const [feature, event] of [
    [pageHooksFeature, "blocked"],
    [networkCaptureFeature, "graphql"]
  ]) {
    const first = fakeBridge();
    feature.init(contextFor(first));
    assert.equal(first.count(event), 1, `${event} subscription missing on first boot`);
    feature.destroy(contextFor(first));

    const second = fakeBridge();
    feature.init(contextFor(second));
    assert.equal(second.count(event), 1, `${event} subscription missing after reboot`);
    feature.destroy(contextFor(second));
  }
});

function makeStorage(map) {
  return {
    async get(key, fallback) {
      return map.has(key) ? map.get(key) : fallback;
    },
    async set(key, value) {
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      map.delete(key);
    }
  };
}

function fakeBridge() {
  const handlers = new Map();
  return {
    status: () => "connected",
    reason: () => "",
    configure() {},
    on(kind, handler) {
      const list = handlers.get(kind) ?? [];
      list.push(handler);
      handlers.set(kind, list);
    },
    // Part of the PageBridge contract: features unsubscribe in destroy so a suspend/resume cycle
    // cannot leave a second live handler behind.
    off(kind, handler) {
      const list = handlers.get(kind);
      if (!list) return;
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    },
    emit(kind, payload) {
      for (const handler of handlers.get(kind) ?? []) {
        handler(payload);
      }
    },
    count(kind) {
      return handlers.get(kind)?.length ?? 0;
    },
    destroy() {}
  };
}

function contextFor(pageBridge) {
  return {
    pageBridge,
    settings: {
      privacy: { blockAnalyticsBeacons: false },
      export: { preserveRawPayloads: false },
      media: { buttons: false },
      performance: { forceVideoQuality: false }
    },
    diagnostics: { info() {}, warn() {}, error() {} }
  };
}
