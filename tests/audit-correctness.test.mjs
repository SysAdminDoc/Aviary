import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("CSV export neutralizes spreadsheet formulas in attacker-controlled text", async () => {
  const { formatExport } = await importBundledModule("src/features/export/formatters.ts");

  const csv = new TextDecoder().decode(
    formatExport("csv", [
      record({ text: '=HYPERLINK("http://evil.example","click")' }),
      record({ text: "+1234567890", handle: "-lead" }),
      record({ text: "@SUM(A1:A2)" }),
      record({ text: "ordinary text, with a comma" })
    ]).data
  );

  const lines = csv.trim().split("\n");
  assert.ok(lines[1].includes(`'=HYPERLINK`), "leading = must be escaped to a literal");
  assert.ok(lines[2].includes("'+1234567890"), "leading + must be escaped");
  assert.ok(lines[2].includes("'-lead"), "leading - must be escaped");
  assert.ok(lines[3].includes("'@SUM(A1:A2)"), "leading @ must be escaped");
  assert.ok(!lines[4].includes("'ordinary"), "safe text must not be altered");
  // Quoting still applies for embedded commas.
  assert.ok(lines[4].includes('"ordinary text, with a comma"'));
});

test("HTML export drops non-http(s) hrefs instead of emitting them", async () => {
  const { formatExport } = await importBundledModule("src/features/export/formatters.ts");

  const html = new TextDecoder().decode(
    formatExport("html", [
      {
        ...record({ text: "hi" }),
        permalink: "javascript:alert(1)//status/1234567",
        media: [{ kind: "photo", url: "javascript:alert(2)" }]
      },
      {
        ...record({ text: "ok" }),
        permalink: "https://x.com/a/status/1234567",
        media: [{ kind: "photo", url: "https://pbs.twimg.com/media/abc?name=orig" }]
      }
    ]).data
  );

  assert.ok(!/href="javascript:/i.test(html), "javascript: URLs must never reach the export");
  assert.ok(html.includes('href="https://x.com/a/status/1234567"'));
  assert.ok(html.includes("https://pbs.twimg.com/media/abc?name=orig"));
});

test("XLSX export strips XML-illegal control characters", async () => {
  const { formatXlsx } = await importBundledModule("src/features/export/xlsx.ts");
  const { readStoreZip } = await importBundledModule("src/features/export/zip-reader.ts");

  const artifact = formatXlsx([record({ text: `bad${String.fromCharCode(7)}bell` })]);
  const sheet = readStoreZip(artifact.data).find((entry) =>
    entry.filename === "xl/worksheets/sheet1.xml"
  );
  const xml = new TextDecoder().decode(sheet.data);

  assert.ok(xml.includes("badbell"), "surrounding text is preserved");
  assert.ok(!xml.includes(String.fromCharCode(7)), "the control character must be gone");
  // Inline strings are never treated as formulas, so an = prefix is safe here.
  assert.ok(xml.includes('t="inlineStr"'));
});

test("normalizeImageUrl honours the preferOriginalImages preference", async () => {
  const { normalizeImageUrl } = await importBundledModule("src/features/media/urls.ts");
  const served = "https://pbs.twimg.com/media/ABCDEFGH?format=jpg&name=small";

  assert.equal(normalizeImageUrl(served).url.includes("name=orig"), true, "default stays original quality");
  assert.equal(
    normalizeImageUrl(served, { preferOriginal: true }).url.includes("name=orig"),
    true
  );

  const kept = normalizeImageUrl(served, { preferOriginal: false });
  assert.ok(kept.url.includes("name=small"), "served size is kept when the toggle is off");
  assert.ok(!kept.url.includes("name=orig"));

  // A URL with no name param still gets a sane bound rather than the raw thumbnail.
  const noName = normalizeImageUrl("https://pbs.twimg.com/media/ABCDEFGH?format=png", {
    preferOriginal: false
  });
  assert.ok(noName.url.includes("name=large"));
  assert.equal(noName.format, "png");
});

test("media buttons and batch downloads pass the preference through to extraction", async () => {
  const buttons = await readFile(path.join(root, "src/features/media/media-buttons.ts"), "utf8");
  const batch = await readFile(path.join(root, "src/features/media/batch-downloader.ts"), "utf8");

  assert.match(buttons, /preferOriginalImages: ctx\.settings\.media\.preferOriginalImages/);
  assert.match(batch, /preferOriginalImages: ctx\.settings\.media\.preferOriginalImages/);
  // The item-cap path must not bypass the configured concurrency.
  assert.ok(
    !/runTasks\(ctx, downloader, queue, history, tasks\.slice\(0, max\)\)/.test(batch),
    "every runTasks call must pass the resolved concurrency"
  );
});

test("mutation batches are coalesced instead of delivered per record", async () => {
  const source = await readFile(path.join(root, "src/platform/observer.ts"), "utf8");

  assert.match(source, /FLUSH_DELAY_MS/);
  assert.match(source, /MAX_BATCH_NODES/);
  assert.match(source, /setTimeout\(flush/);
  assert.match(source, /clearTimeout/);
  assert.match(source, /isConnected/, "detached nodes must not be handed to features");
});

test("Control Center defers rebuilds that would destroy in-progress input", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  assert.match(source, /const isBusy = \(\): boolean =>/);
  assert.match(source, /if \(!open \|\| isBusy\(\)\) \{\s*dirtyWhileBusy = true;/);
  assert.match(source, /dirtyWhileBusy = false;\s*render\(\);/);
});

test("network capture takes its payloads from the page bridge and patches no fetch of its own", async () => {
  const source = await readFile(path.join(root, "src/features/export/network-capture.ts"), "utf8");

  // Until v1.12.0 this module wrapped `globalThis.fetch` -- Aviary's own fetch, not the page's,
  // because the content script runs in the isolated world. It saw none of X's traffic. Payloads
  // now arrive from src/page/page-agent.ts, which runs where those requests are visible.
  assert.ok(
    !source.includes("globalThis.fetch ="),
    "network-capture must not patch fetch: the copy it can reach is not the one X uses"
  );
  assert.match(source, /pageBridge/, "payloads must come from the page bridge");
  assert.match(source, /bridge\.on\("graphql"/);
  assert.match(source, /auth_token/, "session cookies must be scrubbed from stored payloads");
});

test("link unshortening restores class and title on teardown", async () => {
  const source = await readFile(path.join(root, "src/features/library/link-unshorten.ts"), "utf8");

  assert.match(source, /classList\.remove\("av-link-clean"\)/);
  assert.match(source, /avOriginalTitle/);
  const destroyBody = source.slice(source.indexOf("destroy(ctx)"), source.indexOf("};"));
  assert.ok(destroyBody.includes("av-link-clean"), "destroy must drop the class it added");
});

function record(overrides = {}) {
  return {
    tweetId: "1234567890",
    handle: "someone",
    displayName: "Some One",
    text: "hello",
    capturedAt: "2026-08-06T00:00:00.000Z",
    surface: "home",
    media: [],
    permalink: "https://x.com/someone/status/1234567890",
    ...overrides
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-audit-"));
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
