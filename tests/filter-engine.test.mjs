import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("compileFilters lowercases keywords, sanitizes regex flags, and seeds whitelist", async () => {
  const { compileFilters } = await importBundledModule("src/features/filtering/predicates.ts");
  const filters = compileFilters({
    keywords: ["  Crypto  ", "", "NFT"],
    regex: ["/foo/uy", "(unclosed", "bar"],
    whitelist: ["@Foo", "BAD HANDLE", "alpha_99"],
    premium: "dim",
    media: { photo: true, video: false, gif: true, other: true },
    generation: 7
  });

  assert.deepEqual(filters.keywords, ["crypto", "nft"]);
  assert.equal(filters.patterns.length, 2);
  assert.ok(filters.patterns[0].flags.includes("u"));
  assert.ok(filters.patterns.every((pattern) => pattern.flags.includes("i")));
  assert.ok(filters.whitelist.has("foo"));
  assert.ok(filters.whitelist.has("alpha_99"));
  assert.equal(filters.whitelist.has("bad handle"), false);
  assert.equal(filters.premium, "dim");
  assert.deepEqual(filters.media, { photo: true, video: false, gif: true });
  assert.equal(filters.generation, 7);
});

test("decide returns hide for keyword/regex/media hits and respects whitelist + premium action", async () => {
  const { compileFilters, decide } = await importBundledModule(
    "src/features/filtering/predicates.ts"
  );
  const filters = compileFilters({
    keywords: ["spam"],
    regex: ["/buy now/i"],
    whitelist: ["safe_user"],
    premium: "dim",
    media: { photo: false, video: true, gif: false },
    generation: 1
  });

  assert.equal(
    decide(
      { text: "Totally safe content", handle: "anyone", premium: false, media: emptyMedia() },
      filters
    ),
    "show"
  );
  assert.equal(
    decide(
      { text: "this is spam", handle: "anyone", premium: false, media: emptyMedia() },
      filters
    ),
    "hide"
  );
  assert.equal(
    decide(
      { text: "BUY NOW or else", handle: "anyone", premium: false, media: emptyMedia() },
      filters
    ),
    "hide"
  );
  assert.equal(
    decide(
      { text: "this is spam", handle: "safe_user", premium: true, media: { ...emptyMedia(), video: true } },
      filters
    ),
    "show"
  );
  assert.equal(
    decide(
      {
        text: "ok",
        handle: "anyone",
        premium: false,
        media: { ...emptyMedia(), video: true }
      },
      filters
    ),
    "hide"
  );
  assert.equal(
    decide(
      { text: "ok", handle: "anyone", premium: true, media: emptyMedia() },
      filters
    ),
    "dim"
  );
});

test("decide with premium=off ignores premium signal", async () => {
  const { compileFilters, decide } = await importBundledModule(
    "src/features/filtering/predicates.ts"
  );
  const filters = compileFilters({
    keywords: [],
    regex: [],
    whitelist: [],
    premium: "off",
    media: { photo: false, video: false, gif: false },
    generation: 1
  });

  assert.equal(
    decide({ text: "ok", handle: null, premium: true, media: emptyMedia() }, filters),
    "show"
  );
});

test("normalizeSettings keeps surfaces and selfRepost stable", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );

  const normalized = normalizeSettings({
    filter: {
      surfaces: ["home", "home", "lol", "status"],
      selfRepost: "dim"
    }
  });

  assert.deepEqual(normalized.filter.surfaces, ["home", "status"]);
  assert.equal(normalized.filter.selfRepost, "dim");

  const fallback = normalizeSettings({ filter: { surfaces: ["nope"] } });
  assert.deepEqual(fallback.filter.surfaces, DEFAULT_SETTINGS.filter.surfaces);
});

test("profile collection subroutes keep profile-scoped features active", async () => {
  const { readRoute } = await importBundledModule("src/platform/route.ts");
  for (const pathname of [
    "/alice",
    "/alice/",
    "/alice/followers",
    "/alice/following",
    "/alice/verified_followers",
    "/alice/with_replies",
    "/alice/media",
    "/alice/likes",
    "/alice/highlights",
    "/alice/articles"
  ]) {
    assert.equal(readRoute({ href: `https://x.com${pathname}`, pathname }).surface, "profile", pathname);
  }
  assert.equal(readRoute({ href: "https://x.com/alice/communities", pathname: "/alice/communities" }).surface, "unknown");
  for (const pathname of ["/messages", "/i/chat", "/i/chat/pin/recovery", "/i/chat/123-456"]) {
    assert.equal(readRoute({ href: `https://x.com${pathname}`, pathname }).surface, "messages", pathname);
  }
});

test("home fixture exposes verified, photo, and video markers required by the filter engine", async () => {
  const html = await readFile(path.join(root, "_decoded/home.html"), "utf8");

  assert.match(html, /data-testid="icon-verified"/);
  assert.match(html, /data-testid="tweetPhoto"/);
  assert.match(html, /data-testid="videoPlayer"|data-testid="videoComponent"/);
});

function emptyMedia() {
  return { photo: false, video: false, gif: false };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-filter-"));
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
