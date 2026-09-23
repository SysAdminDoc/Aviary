import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

import { parseCaptureManifest } from "../tools/capture-manifest.mjs";
import { captureHtml, captureSchema } from "./helpers/synthetic-capture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");
const NOW = "2026-09-22T12:00:00.000Z";

let browser;
let page;
let temp;
let bundle;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-structure-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(abs("src/features/core/structural-observation.ts"))};`,
      `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryStructure",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

async function observe(html, pathname) {
  await page.setContent(html);
  await page.addScriptTag({ path: bundle });
  return page.evaluate(
    ({ now, pathname: path }) =>
      AviaryStructure.observeStructure(document, window, { now: new Date(now), build: "0.0.0-test", pathname: path }),
    { now: NOW, pathname }
  );
}

test("the observation plan is the schema's own test ids, roles and aria", async () => {
  const schema = await captureSchema();
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ path: bundle });
  const plan = await page.evaluate(() => AviaryStructure.STRUCTURAL_OBSERVATION_PLAN);
  assert.deepEqual(plan.testIds, schema.testIds);
  assert.deepEqual(plan.roles, schema.roles);
  const { $comment, ...aria } = schema.aria;
  void $comment;
  assert.deepEqual(plan.aria, aria);
});

test("on the generated documents the observation reproduces the schema and passes its manifest check", async () => {
  const schema = await captureSchema();
  for (const [route, pathname] of [["home", "/home"], ["status", "/someone/status/1234"]]) {
    const observation = await observe(await captureHtml(route), pathname);
    const counts = observation.routes[route]?.observedCounts;
    assert.ok(counts, `${route}: no counts under routes.${route}`);
    const expected = schema.routes[route].observedCounts;
    const reproduction = schema.routes[route].reproduction;
    for (const [key, value] of Object.entries(expected)) {
      if (key.startsWith("$")) continue;
      if (reproduction[key] === "exact") {
        assert.equal(counts[key], value, `${route}.${key}`);
      } else {
        // The schema states why the generated document holds fewer; it must never hold more.
        assert.ok(counts[key] <= value, `${route}.${key}: ${counts[key]} > ${value}`);
      }
    }
    assert.equal(observation.routes[route].route, schema.routes[route].route);
    assert.equal(observation.routes[route].lang, schema.routes[route].lang);
    for (const key of ["cellToArticle", "timelineToCell", "mainToPrimaryColumn", "mediaToPhoto"]) {
      assert.equal(observation.nesting[key], schema.nesting[key], `${route}: nesting.${key}`);
    }

    const manifest = parseCaptureManifest(observation);
    assert.equal(manifest.captures[0].capturedOn, "2026-09-22");
    assert.equal(manifest.captures[0].route, schema.routes[route].route);
  }
});

test("the observation carries no text, names, handles, links or ids", async () => {
  const handle = "hostileHandle";
  const name = "Hostile Display Name";
  const text = "secret words from a private post";
  const id = "1234567890123456789";
  const hostile = [
    `<article data-testid="tweet" aria-labelledby="id_${id}">`,
    `<div data-testid="User-Name"><span>${name}</span><a href="/${handle}">@${handle}</a></div>`,
    `<div data-testid="tweetText" lang="en">${text} https://x.com/${handle}/status/${id}</div>`,
    `<button data-testid="like" aria-label="12 Likes. Like ${handle}"></button>`,
    `<div data-testid="UserAvatar-Container-${handle}"></div>`,
    "</article>"
  ].join("");
  const html = (await captureHtml("status"))
    // A well-formed tag carrying a name-like subtag, which a looser pattern would copy verbatim.
    .replace(/<html lang="[^"]*"/, '<html lang="en-jdoe1984"')
    .replace("<body", `<body data-owner="${handle}"`)
    .replace("</body>", `${hostile}</body>`)
    .replace(/<title>[^<]*<\/title>/, `<title>${name} on X: "${text}" / X</title>`);
  assert.ok(html.includes('lang="en-jdoe1984"'), "the hostile lang attribute must reach the page");
  const observation = await observe(html, `/${handle}/status/${id}`);
  const serialized = JSON.stringify(observation);

  for (const secret of [handle, handle.toLowerCase(), "Hostile", "secret", id, "x.com/" + handle]) {
    assert.ok(!serialized.includes(secret), `the observation leaked ${JSON.stringify(secret)}`);
  }
  assert.equal(observation.routes.status.lang, null, "only language, script and region subtags are kept");
  assert.ok(!serialized.includes("jdoe1984"));
  // The hostile post still counts, which is the point: structure without identity.
  assert.ok(observation.routes.status.observedCounts.posts > 0);
});

test("Privacy & diagnostics offers the copy action and reports the result", async () => {
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
  const result = await page.evaluate(async () => {
    let calls = 0;
    const handle = AviaryStructure.mountControlCenter({
      settings: AviaryStructure.cloneSettings(AviaryStructure.DEFAULT_SETTINGS),
      diagnostics: () => [],
      onChange: async () => {},
      onError() {},
      copyStructuralObservation: async () => {
        calls += 1;
      }
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="trust"]').click();
    const row = shadow.querySelector('[data-av-label="Copy structural observation"]');
    row?.querySelector("button")?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = shadow.querySelector(".av-status, [role='status']")?.textContent ?? "";
    handle.destroy();
    return { present: row !== null, calls, status };
  });
  assert.equal(result.present, true);
  assert.equal(result.calls, 1);
  assert.match(result.status, /Structural observation copied to clipboard\./);
});
