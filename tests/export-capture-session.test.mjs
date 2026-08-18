import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Capture-as-you-scroll is one session that stays open, not a window opened and shut per apply.
 *
 * The old test sliced `export-feature.ts` between two function names and matched
 * `/lifecycleQueue\.then\(\(\) => reconcileExportState/` and `/checkpointStore\.start\(/`. That
 * cannot see whether a second apply opened a second job, whether records from a later batch
 * landed in the first job, or whether teardown left a session marked running forever — which is
 * the actual failure: a job that is never marked done is a job the next boot tries to resume.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const post = (i) => `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <a href="/alice/status/19000000000000${String(i).padStart(2, "0")}"><time datetime="2026-08-18T10:00:00.000Z">now</time></a>
      <div data-testid="User-Name"><a href="/alice"><span>@alice</span></a></div>
      <div data-testid="tweetText">post ${i}</div>
    </article>
  </div>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-capture-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { exportFeature, getCheckpointStore } from ${JSON.stringify(abs("src/features/export/export-feature.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryCapture",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
  await page.evaluate((template) => {
    window.postTemplate = (0, eval)(`(${template})`);
    window.makeCtx = (enabled) => {
      const settings = AviaryCapture.cloneSettings(AviaryCapture.DEFAULT_SETTINGS);
      settings.export.enabled = enabled;
      settings.export.autoDiscoverQueryIds = false;
      const values = new Map();
      return {
        settings,
        // destroy() drops the module-level checkpoint store, so after teardown the only evidence
        // of what it did is what it wrote. This is that.
        persisted: () => JSON.stringify([...values.values()]),
        route: { surface: "home", path: "/home" },
        storage: {
          async get(key, fallback) {
            return values.has(key) ? structuredClone(values.get(key)) : fallback;
          },
          async set(key, value) {
            values.set(key, structuredClone(value));
          },
          async remove(key) {
            values.delete(key);
          }
        },
        auditLog: { async record() {} },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
    };
    window.jobs = () =>
      (AviaryCapture.getCheckpointStore()?.list() ?? []).map((job) => ({
        jobId: job.jobId,
        status: job.status,
        records: job.recordCount
      }));
  }, post.toString());
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("scrolling more posts into a running session appends to the same job", async () => {
  const timeline = await page.evaluate(async () => {
    document.body.innerHTML = `<main data-testid="primaryColumn">${window.postTemplate(1)}${window.postTemplate(2)}</main>`;
    const ctx = window.makeCtx(true);
    await AviaryCapture.exportFeature.init(ctx);
    await AviaryCapture.exportFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const opened = window.jobs();

    // A second batch, the way the mutation observer delivers one.
    const column = document.querySelector('[data-testid="primaryColumn"]');
    column.insertAdjacentHTML("beforeend", window.postTemplate(3) + window.postTemplate(4));
    const added = [...column.querySelectorAll('[data-testid="cellInnerDiv"]')].slice(2);
    await AviaryCapture.exportFeature.apply(ctx, column, added);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterSecond = window.jobs();

    await AviaryCapture.exportFeature.apply(ctx, column);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterThird = window.jobs();

    const beforeTeardown = window.jobs();
    await AviaryCapture.exportFeature.destroy(ctx);
    return { opened, afterSecond, afterThird, beforeTeardown, persisted: ctx.persisted() };
  });

  assert.equal(timeline.opened.length, 1, "the first apply must open exactly one capture session");
  assert.equal(timeline.opened[0].status, "running");
  assert.equal(timeline.afterSecond.length, 1, "a second apply must not open a second job");
  assert.equal(timeline.afterSecond[0].jobId, timeline.opened[0].jobId, "and must stay in the same one");
  assert.ok(
    timeline.afterSecond[0].records > timeline.opened[0].records,
    `the second batch was not captured (${timeline.opened[0].records} then ${timeline.afterSecond[0].records})`
  );
  assert.equal(timeline.afterThird.length, 1, "a whole-document re-apply must not open a job either");
  assert.equal(timeline.beforeTeardown[0].status, "running", "the session must still be open before teardown");
  assert.ok(
    !/"status":"running"/.test(timeline.persisted),
    "teardown left a capture session persisted as running"
  );
});

test("turning capture off closes the session; turning it on does not resume a finished one twice", async () => {
  const cycle = await page.evaluate(async () => {
    document.body.innerHTML = `<main data-testid="primaryColumn">${window.postTemplate(1)}</main>`;
    const ctx = window.makeCtx(true);
    await AviaryCapture.exportFeature.init(ctx);
    await AviaryCapture.exportFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const running = window.jobs();

    ctx.settings.export.enabled = false;
    await AviaryCapture.exportFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const stopped = window.jobs();

    // A second apply while still off must not reopen anything.
    await AviaryCapture.exportFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const stillStopped = window.jobs();

    await AviaryCapture.exportFeature.destroy(ctx);
    return { running, stopped, stillStopped };
  });

  assert.equal(cycle.running.length, 1);
  assert.equal(cycle.running[0].status, "running");
  assert.notEqual(cycle.stopped[0].status, "running", "the toggle must close the session");
  assert.equal(cycle.stillStopped.length, cycle.stopped.length, "an apply while off must not open a job");
});

test("a session left open by capture is never abandoned in the running state", async () => {
  const leftover = await page.evaluate(async () => {
    document.body.innerHTML = `<main data-testid="primaryColumn">${window.postTemplate(1)}</main>`;
    const ctx = window.makeCtx(true);
    await AviaryCapture.exportFeature.init(ctx);
    await AviaryCapture.exportFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const open = window.jobs();

    // Teardown is the case that matters: a job still marked running is one the next boot tries
    // to resume, appending this session's records to the next one.
    await AviaryCapture.exportFeature.destroy(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { open, persisted: ctx.persisted() };
  });

  assert.equal(leftover.open.length, 1, "the fixture must have opened a session for this to prove anything");
  assert.equal(leftover.open[0].status, "running");
  assert.ok(
    !/"status":"running"/.test(leftover.persisted),
    "destroy left a capture session persisted as running"
  );
});
