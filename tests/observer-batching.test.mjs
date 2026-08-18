import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The mutation observer that every feature's incremental pass hangs off.
 *
 * It was asserted by matching `/FLUSH_DELAY_MS/`, `/MAX_BATCH_NODES/`, `/setTimeout\(flush/` and
 * `/isConnected/` in its own source. Those constants can exist and be applied to the wrong side
 * of a comparison; `isConnected` can appear in a branch that never runs. What matters is the
 * shape of what features receive — one batch rather than one call per record, no node the page
 * has already thrown away, and a cap so a bulk insert cannot hand a feature the whole timeline
 * at once.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-observer-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { observeAddedElements } from ${JSON.stringify(abs("src/platform/observer.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryObserver",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body><div id=host></div></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("many inserts in one tick arrive as one batch, not one call each", async () => {
  const result = await page.evaluate(async () => {
    const host = document.getElementById("host");
    host.replaceChildren();
    const batches = [];
    const stop = AviaryObserver.observeAddedElements(host, (nodes) => batches.push(nodes.length));

    // Exactly what a timeline scroll delivers: a run of appends inside one task.
    for (let i = 0; i < 30; i++) {
      const node = document.createElement("div");
      node.dataset.index = String(i);
      host.append(node);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    stop();
    return { batches, total: batches.reduce((sum, n) => sum + n, 0) };
  });

  assert.equal(result.batches.length, 1, `30 inserts produced ${result.batches.length} batches`);
  assert.equal(result.total, 30, "every inserted node must reach the handler exactly once");
});

test("a node the page removed again before the flush is never handed to a feature", async () => {
  const seen = await page.evaluate(async () => {
    const host = document.getElementById("host");
    host.replaceChildren();
    const delivered = [];
    const stop = AviaryObserver.observeAddedElements(host, (nodes) => {
      delivered.push(...nodes.map((node) => node.dataset.index));
    });

    for (let i = 0; i < 6; i++) {
      const node = document.createElement("div");
      node.dataset.index = String(i);
      host.append(node);
    }
    // X's virtualizer recycles rows constantly; a feature handed a detached node does work that
    // can never be seen and can write attributes onto a node that is about to be reused.
    host.querySelector('[data-index="2"]').remove();
    host.querySelector('[data-index="4"]').remove();

    await new Promise((resolve) => setTimeout(resolve, 300));
    stop();
    return delivered;
  });

  assert.deepEqual(seen.sort(), ["0", "1", "3", "5"], "a detached node reached the handler");
});

test("a bulk insert degrades to a full re-scan instead of one enormous batch", async () => {
  const result = await page.evaluate(async () => {
    const host = document.getElementById("host");
    host.replaceChildren();
    const batches = [];
    const stop = AviaryObserver.observeAddedElements(host, (nodes) => batches.push(nodes.length));

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 900; i++) fragment.append(document.createElement("div"));
    host.append(fragment);

    await new Promise((resolve) => setTimeout(resolve, 500));
    stop();
    return { batches, largest: batches.length > 0 ? Math.max(...batches) : null };
  });

  // Past the cap the observer stops trying to name the nodes and hands features an empty list,
  // which every feature already treats as "re-scan the document". A 900-node batch would instead
  // be one synchronous pass over the whole insert inside every registered feature.
  assert.ok(result.batches.length >= 1, "the bulk insert must still wake the features");
  assert.equal(result.largest, 0, `a batch of ${result.largest} nodes was delivered instead of a re-scan`);
});

test("stopping the observer stops the delivery", async () => {
  const after = await page.evaluate(async () => {
    const host = document.getElementById("host");
    host.replaceChildren();
    let calls = 0;
    const stop = AviaryObserver.observeAddedElements(host, () => calls++);
    host.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const before = calls;

    stop();
    host.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { before, afterStop: calls };
  });

  assert.equal(after.before, 1, "the observer must be delivering before this proves anything");
  assert.equal(after.afterStop, 1, "a stopped observer must not deliver, and must not leave a timer armed");
});
