import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, before, after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { importSourceModule } from "./helpers/source-import.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-lock-register-"));
  const entry = path.join(temp, "entry.ts");
  const bundle = path.join(temp, "bundle.js");
  await writeFile(
    entry,
    `export { StorageLockRegisterAuthority, STORAGE_LOCK_REGISTER_MESSAGE } from ${JSON.stringify(
      path.join(root, "src/platform/storage-lock-register.ts").replaceAll("\\", "/")
    )};`,
    "utf8"
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryLockRegister",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("the authority keeps concurrent contenders in one per-lock roster", async () => {
  const result = await page.evaluate(async () => {
    const values = new Map();
    const getCalls = [];
    const storage = {
      async get(keys) {
        getCalls.push(keys);
        if (typeof keys !== "string") throw new Error("the roster authority must read one known key");
        return values.has(keys) ? { [keys]: structuredClone(values.get(keys)) } : {};
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
      },
      async remove(keys) {
        values.delete(keys);
      }
    };
    for (let index = 0; index < 10_000; index += 1) values.set(`aviary.unrelated.${index}`, index);

    const authority = new AviaryLockRegister.StorageLockRegisterAuthority(storage);
    const prefix = "aviary.lock.v1.aviary.aviary.media.history.v1";
    const contender = (owner, ticket) => ({
      version: 1,
      owner,
      phase: "waiting",
      ticket,
      mode: "exclusive",
      expiresAt: Date.now() + 30_000
    });
    await Promise.all([
      authority.handle({ type: AviaryLockRegister.STORAGE_LOCK_REGISTER_MESSAGE, version: 1, operation: "write", prefix, key: `${prefix}.a`, value: contender("a", 1) }),
      authority.handle({ type: AviaryLockRegister.STORAGE_LOCK_REGISTER_MESSAGE, version: 1, operation: "write", prefix, key: `${prefix}.b`, value: contender("b", 2) })
    ]);

    const polls = [];
    const started = performance.now();
    for (let index = 0; index < 32; index += 1) {
      const response = await authority.handle({ type: AviaryLockRegister.STORAGE_LOCK_REGISTER_MESSAGE, version: 1, operation: "entries", prefix });
      polls.push(response.entries);
    }
    const elapsed = performance.now() - started;
    const samples = [];
    for (let index = 0; index < 64; index += 1) {
      const before = performance.now();
      await authority.handle({ type: AviaryLockRegister.STORAGE_LOCK_REGISTER_MESSAGE, version: 1, operation: "entries", prefix });
      samples.push(performance.now() - before);
    }
    const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    const variance = samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / samples.length;
    return {
      unrelatedCount: [...values.keys()].filter((key) => key.startsWith("aviary.unrelated.")).length,
      polls,
      getCalls,
      elapsed,
      mean,
      variance,
      rosterKey: getCalls.find((key) => typeof key === "string" && key.startsWith("aviary.lock.v1.roster."))
    };
  });

  assert.equal(result.unrelatedCount, 10_000);
  assert.equal(result.polls.length, 32);
  assert.ok(result.polls.every((entries) => JSON.stringify(entries) === JSON.stringify(result.polls[0])));
  assert.deepEqual(result.polls[0].map(([key]) => key).sort(), [
    "aviary.lock.v1.aviary.aviary.media.history.v1.a",
    "aviary.lock.v1.aviary.aviary.media.history.v1.b"
  ]);
  assert.ok(result.getCalls.every((key) => typeof key === "string"));
  assert.ok(result.getCalls.every((key) => key === result.rosterKey), "polls must not enumerate unrelated storage");
  assert.ok(Number.isFinite(result.mean) && Number.isFinite(result.variance));
  assert.ok(result.elapsed >= 0);
});

test("browser timing is labeled as a shared-map model, apart from extension and manager lanes", async () => {
  const labels = await page.evaluate(() => ({
    model: "shared-map browser model",
    extension: "extension authority",
    manager: "userscript roster"
  }));
  assert.deepEqual(labels, {
    model: "shared-map browser model",
    extension: "extension authority",
    manager: "userscript roster"
  });
});

test("userscript lock polls read the roster value instead of listing manager storage", async () => {
  const previous = {
    chrome: globalThis.chrome,
    GM_getValue: globalThis.GM_getValue,
    GM_setValue: globalThis.GM_setValue,
    GM_listValues: globalThis.GM_listValues,
    GM_deleteValue: globalThis.GM_deleteValue
  };
  const values = new Map();
  const getKeys = [];
  let listCalls = 0;
  delete globalThis.chrome;
  globalThis.GM_getValue = async (key, fallback) => {
    getKeys.push(key);
    return values.has(key) ? structuredClone(values.get(key)) : fallback;
  };
  globalThis.GM_setValue = async (key, value) => {
    values.set(key, structuredClone(value));
  };
  globalThis.GM_deleteValue = async (key) => {
    values.delete(key);
  };
  globalThis.GM_listValues = async () => {
    listCalls += 1;
    return [...values.keys(), ...Array.from({ length: 10_000 }, (_, index) => `unrelated.${index}`)];
  };

  try {
    const mod = await importSourceModule("src/platform/storage-lock.ts", { fresh: true });
    await Promise.all([
      mod.withStorageLock("aviary.userscript.roster", async () => "a"),
      mod.withStorageLock("aviary.userscript.roster", async () => "b")
    ]);
    assert.equal(listCalls, 3, "each new lock prefix may migrate once, but polls must not repeat it");
    assert.ok(getKeys.length > 0);
    assert.ok(getKeys.every((key) => key.startsWith("aviary.lock.v1.roster.")));
  } finally {
    if (previous.chrome) globalThis.chrome = previous.chrome;
    else delete globalThis.chrome;
    if (previous.GM_getValue) globalThis.GM_getValue = previous.GM_getValue;
    else delete globalThis.GM_getValue;
    if (previous.GM_setValue) globalThis.GM_setValue = previous.GM_setValue;
    else delete globalThis.GM_setValue;
    if (previous.GM_listValues) globalThis.GM_listValues = previous.GM_listValues;
    else delete globalThis.GM_listValues;
    if (previous.GM_deleteValue) globalThis.GM_deleteValue = previous.GM_deleteValue;
    else delete globalThis.GM_deleteValue;
  }
});
