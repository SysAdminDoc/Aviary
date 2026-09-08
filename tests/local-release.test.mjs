import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ensureSigningKey, packCrx3, verifyCrx3 } from "../tools/release-crx.mjs";
import { assertAlignedVersions, hasResumableReleaseState, parseReleaseArgs, selectVerificationScript } from "../tools/release-local.mjs";
import { missingReleaseReport, reconcileReleaseLedger } from "../tools/release-ledger.mjs";
import { importSourceModule } from "./helpers/source-import.mjs";

test("local release CRX3 output carries a verifiable proof and safe ZIP paths", async () => {
  const { buildStoreZip } = await importSourceModule("src/features/export/zip-store.ts");
  const archive = buildStoreZip([
    { filename: "manifest.json", data: new TextEncoder().encode('{"version":"1.48.0"}') },
    { filename: "chunks/panel.js", data: new TextEncoder().encode("panel") }
  ]);
  const temp = await mkdtemp(path.join(os.tmpdir(), "aviary-release-crx-test-"));
  try {
    const keyPath = path.join(temp, "Aviary-selfhost.pem");
    const { privateKey, created } = await ensureSigningKey(keyPath);
    assert.equal(created, true);
    const crx = packCrx3(Buffer.from(archive), privateKey);
    const verified = verifyCrx3(crx);
    assert.equal(verified.valid, true);
    assert.equal(verified.payloadBytes, archive.length);
    assert.match(verified.keyFingerprint, /^sha256:[0-9a-f]{64}$/);

    const reloaded = await ensureSigningKey(keyPath);
    assert.equal(reloaded.created, false);
    assert.equal(verifyCrx3(packCrx3(Buffer.from(archive), reloaded.privateKey)).valid, true);

    const tampered = Buffer.from(crx);
    tampered[tampered.length - 1] ^= 1;
    assert.equal(verifyCrx3(tampered).valid, false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("release ledger maps missing versions to exact package commits", () => {
  const ledger = reconcileReleaseLedger(
    { "1.38.0": "commit-138", "1.44.1": "commit-1441", "1.45.0": "commit-145", "1.48.0": "commit-current" },
    ["v1.45.0"],
    ["v1.45.0"],
    "1.48.0"
  );
  assert.deepEqual(missingReleaseReport(ledger), [
    {
      version: "1.38.0",
      commit: "commit-138",
      tag: "v1.38.0",
      tagPresent: false,
      releasePresent: false,
      status: "missing"
    },
    {
      version: "1.44.1",
      commit: "commit-1441",
      tag: "v1.44.1",
      tagPresent: false,
      releasePresent: false,
      status: "missing"
    },
    {
      version: "1.48.0",
      commit: "commit-current",
      tag: "v1.48.0",
      tagPresent: false,
      releasePresent: false,
      status: "missing"
    }
  ]);
});

test("local release CLI makes publishing explicit and supports historical rebuilds", () => {
  assert.equal(parseReleaseArgs(["--plan"]).plan, true);
  assert.equal(parseReleaseArgs(["--publish", "--version=1.48.0"]).publish, true);
  assert.equal(parseReleaseArgs(["--publish", "--historical", "1.44.1"]).historical, "1.44.1");
  assert.throws(() => parseReleaseArgs(["--unknown"]), /Unknown release option/);
});

test("historical releases use the strongest verification script available at that commit", () => {
  assert.equal(selectVerificationScript({ scripts: { verify: "npm run test" } }), "verify");
  assert.equal(selectVerificationScript({ scripts: { "verify:fast": "npm run test" } }), "verify:fast");
  assert.equal(selectVerificationScript({ scripts: { "verify:release": "npm run verify:fast" } }), "verify:release");
  assert.equal(selectVerificationScript({ scripts: {} }), null);
});

test("historical release state can resume only after the verified artifact set exists", () => {
  const expected = { version: "1.44.1", commit: "commit-1441" };
  assert.equal(hasResumableReleaseState({
    format: 1,
    version: expected.version,
    commit: expected.commit,
    assets: ["release.zip"],
    releaseDir: "C:/releases/v1.44.1",
    digests: { "release.zip": "sha256:abc" }
  }, expected), true);
  assert.equal(hasResumableReleaseState({ ...expected, format: 1, assets: [] }, expected), false);
  assert.equal(hasResumableReleaseState(null, expected), false);
});

test("release planning rejects drifted version markers", async () => {
  await assert.doesNotReject(() => assertAlignedVersions(process.cwd(), "1.48.0"));
});
