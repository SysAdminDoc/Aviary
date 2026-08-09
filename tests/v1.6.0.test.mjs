import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("derivePostKey prefers the status id and falls back to a handle+text signature", async () => {
  const { derivePostKey } = await importBundledModule("src/features/filtering/hidden-posts.ts");

  assert.equal(
    derivePostKey({ tweetId: "1234567890", handle: "someone", text: "hello" }),
    "id:1234567890"
  );

  const promoted = derivePostKey({ tweetId: null, handle: "@BrandCo", text: "Buy   our\nthing" });
  assert.match(promoted, /^sig:brandco:[a-z0-9]+$/);

  // Whitespace shape must not change identity — X re-renders the same post with different wrapping.
  assert.equal(
    promoted,
    derivePostKey({ tweetId: null, handle: "brandco", text: " Buy our thing " })
  );

  assert.equal(derivePostKey({ tweetId: null, handle: null, text: "orphan" }), null);
  assert.equal(derivePostKey({ tweetId: null, handle: "someone", text: "   " }), null);
  assert.equal(derivePostKey({ tweetId: "not-an-id", handle: null, text: "" }), null);
});

test("handleFromHref reads root-relative and absolute profile links", async () => {
  const { handleFromHref } = await importBundledModule("src/features/filtering/hidden-posts.ts");

  assert.equal(handleFromHref("/JuvyWicks"), "juvywicks");
  assert.equal(handleFromHref("/JuvyWicks/status/123"), "juvywicks");
  assert.equal(handleFromHref("https://x.com/JuvyWicks"), "juvywicks");
  assert.equal(handleFromHref("https://mobile.twitter.com/JuvyWicks/photo"), "juvywicks");
  assert.equal(handleFromHref("https://evil.example/JuvyWicks"), null);
  assert.equal(handleFromHref("/i/grok"), "i");
  assert.equal(handleFromHref(null), null);
});

test("normalizeHiddenPosts rejects malformed keys, dedupes, and trims oldest past the cap", async () => {
  const { normalizeHiddenPosts } = await importBundledModule(
    "src/features/filtering/hidden-posts.ts"
  );

  const snapshot = normalizeHiddenPosts(
    {
      entries: [
        { key: "id:1", hiddenAt: "2026-01-01T00:00:00.000Z", handle: "a", tweetId: "1", text: "one" },
        { key: "id:1", hiddenAt: "2026-01-05T00:00:00.000Z", handle: "a", tweetId: "1", text: "newer" },
        { key: "id:2", hiddenAt: "2026-01-02T00:00:00.000Z", handle: "b", tweetId: "2", text: "two" },
        { key: "id:3", hiddenAt: "2026-01-03T00:00:00.000Z", handle: "c", tweetId: "3", text: "three" },
        { key: "javascript:alert(1)", hiddenAt: "2026-01-04T00:00:00.000Z" },
        { key: "sig:bad handle:zz", hiddenAt: "2026-01-04T00:00:00.000Z" },
        "not-an-object"
      ],
      updatedAt: "2026-01-05T00:00:00.000Z"
    },
    2
  );

  assert.deepEqual(
    snapshot.entries.map((entry) => entry.key),
    ["id:3", "id:1"]
  );
  assert.equal(snapshot.entries[1].text, "newer");
  assert.equal(snapshot.updatedAt, "2026-01-05T00:00:00.000Z");

  assert.deepEqual(normalizeHiddenPosts(null, 10), { entries: [], updatedAt: null });
});

test("HiddenPostStore persists hides, evicts at the cap, and restores through undo", async () => {
  const { HiddenPostStore, HIDDEN_POSTS_KEY } = await importBundledModule(
    "src/features/filtering/hidden-posts.ts"
  );

  const storage = createMemoryStorage();
  const store = new HiddenPostStore(storage);
  await store.load(3);

  const first = await store.hide({ tweetId: "111", handle: "alpha", text: "first" }, 3);
  assert.equal(first.key, "id:111");
  assert.equal(store.has("id:111"), true);
  assert.equal(store.size(), 1);

  // A second hide of the same post is a no-op, not a duplicate entry.
  assert.equal(await store.hide({ tweetId: "111", handle: "alpha", text: "first" }, 3), null);
  assert.equal(store.size(), 1);

  await store.hide({ tweetId: "222", handle: "beta", text: "second" }, 3);
  await store.hide({ tweetId: "333", handle: "gamma", text: "third" }, 3);
  await store.hide({ tweetId: "444", handle: "delta", text: "fourth" }, 3);

  assert.equal(store.size(), 3);
  assert.equal(store.has("id:111"), false, "oldest entry is evicted at the cap");
  assert.equal(store.has("id:444"), true);

  const persisted = storage.read(HIDDEN_POSTS_KEY);
  assert.equal(persisted.entries.length, 3);
  assert.ok(typeof persisted.updatedAt === "string");

  const undone = await store.undoLast();
  assert.equal(undone.key, "id:444");
  assert.equal(store.has("id:444"), false);
  assert.equal(store.size(), 2);

  const restored = await store.unhide("id:333");
  assert.equal(restored.key, "id:333");
  assert.equal(await store.unhide("id:333"), null);

  const removed = await store.clear();
  assert.equal(removed, 1);
  assert.equal(store.size(), 0);
  assert.equal(storage.read(HIDDEN_POSTS_KEY).entries.length, 0);
});

test("HiddenPostStore reloads what it wrote and bumps its version on every mutation", async () => {
  const { HiddenPostStore } = await importBundledModule("src/features/filtering/hidden-posts.ts");

  const storage = createMemoryStorage();
  const first = new HiddenPostStore(storage);
  await first.load(100);
  const before = first.version();
  await first.hide({ tweetId: "900", handle: "carol", text: "kept across sessions" }, 100);
  assert.ok(first.version() > before, "version must change so DOM passes re-evaluate");

  const second = new HiddenPostStore(storage);
  await second.load(100);
  assert.equal(second.has("id:900"), true);
  assert.equal(second.list()[0].handle, "carol");

  // With no session stack, undo falls back to the newest stored entry.
  const undone = await second.undoLast();
  assert.equal(undone.key, "id:900");
  assert.equal(await second.undoLast(), null);
});

test("hidden settings normalize with their own defaults and a clamped cap", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );

  assert.deepEqual(DEFAULT_SETTINGS.hidden.surfaces, [
    "home",
    "status",
    "profile",
    "search",
    "notifications"
  ]);
  // Off since v1.13.0. The surface list is still the full set, so enabling it needs one toggle
  // rather than a toggle plus rebuilding the surfaces.
  assert.equal(DEFAULT_SETTINGS.hidden.enabled, false);
  // True, but gated by `enabled` above. Two separate switches meant turning "Hide posts" on
  // still produced no Hide button anywhere, with nothing to say a second toggle was needed.
  assert.equal(DEFAULT_SETTINGS.hidden.buttons, true);

  const defaults = normalizeSettings({});
  assert.deepEqual(defaults.hidden, DEFAULT_SETTINGS.hidden);

  const custom = normalizeSettings({
    hidden: { enabled: false, buttons: "yes", surfaces: ["home", "nope", "home"], maxEntries: 9_000_000 }
  });
  assert.equal(custom.hidden.enabled, false);
  assert.equal(custom.hidden.buttons, true, "non-boolean falls back to the default");
  assert.deepEqual(custom.hidden.surfaces, ["home"]);
  assert.equal(custom.hidden.maxEntries, 50_000);

  const floor = normalizeSettings({ hidden: { maxEntries: 1 } });
  assert.equal(floor.hidden.maxEntries, 100);

  // Filter surfaces must keep their own fallback, not inherit the hidden-post list.
  const filterFallback = normalizeSettings({ filter: { surfaces: [] } });
  assert.deepEqual(filterFallback.filter.surfaces, DEFAULT_SETTINGS.filter.surfaces);
});

test("hidden posts feature collapses the virtualizer cell and is registered at boot", async () => {
  const feature = await readFile(
    path.join(root, "src/features/filtering/hidden-posts-feature.ts"),
    "utf8"
  );
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  const controlCenter = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  assert.match(feature, /av-hide-posts-enabled/);
  assert.match(feature, /data-testid="cellInnerDiv"/);
  assert.match(feature, /article\.closest\(CELL_SELECTOR\)/);
  assert.match(feature, /dispatchEvent\(new Event\("resize"\)\)/);
  assert.match(feature, /destroy/);
  assert.ok(!/innerHTML/.test(feature), "hidden posts must not use innerHTML");
  assert.ok(!/keydown|keyup|keypress/.test(feature), "Aviary registers no keyboard shortcuts");

  assert.match(main, /registry\.register\(hiddenPostsFeature\)/);
  // Sections are declared in the panel's registry rather than inlined into one long render.
  assert.match(
    controlCenter,
    /id:\s*"hidden",\s*title:\s*"Hidden posts",\s*group:\s*"\w+",[\s\S]*?build:\s*hiddenPostRows/
  );
});

test("home fixture exposes the anchors the hide button and collapse rely on", async () => {
  const html = await readFile(path.join(root, "_decoded/home.html"), "utf8");

  assert.match(html, /data-testid="cellInnerDiv"/);
  assert.match(html, /data-testid="caret"/);
  assert.match(html, /data-testid="User-Name"/);
  assert.match(html, /href="[^"]*\/status\/\d+/);
});

function createMemoryStorage() {
  const values = new Map();
  return {
    async get(key, fallback) {
      return values.has(key) ? structuredClone(values.get(key)) : fallback;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    },
    read(key) {
      return values.get(key);
    }
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v16-"));
  const outfile = path.join(temp, "module.mjs");

  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}
