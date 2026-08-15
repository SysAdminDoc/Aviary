// Reads `_decoded/captures.json` and reports how old the evidence is.
//
// Kept separate from capture-decode.mjs so importing it cannot run a CLI, and separate from
// preflight so the test suite can assert the same numbers the release gate enforces.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MANIFEST_PATH = path.join(root, "_decoded", "captures.json");

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date, received ${JSON.stringify(value)}`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} is not a real date: ${value}`);
  }
  return parsed;
}

export async function readCaptureManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (!Array.isArray(manifest.captures) || manifest.captures.length === 0) {
    throw new Error("captures.json must list at least one capture");
  }
  if (!Number.isInteger(manifest.ceilingDays) || manifest.ceilingDays <= 0) {
    throw new Error("captures.json must declare a positive integer ceilingDays");
  }
  for (const capture of manifest.captures) {
    if (typeof capture.file !== "string" || capture.file.length === 0) {
      throw new Error("every capture needs a file name");
    }
    parseDay(capture.capturedOn, `capture ${capture.file} capturedOn`);
  }
  if (manifest.acknowledgedStaleUntil !== undefined) {
    parseDay(manifest.acknowledgedStaleUntil, "acknowledgedStaleUntil");
    if (typeof manifest.acknowledgedReason !== "string" || manifest.acknowledgedReason.length < 20) {
      throw new Error("acknowledgedStaleUntil requires an acknowledgedReason explaining the waiver");
    }
  }
  return manifest;
}

/** Every `.html` fixture on disk must be accounted for, so a new one cannot arrive undated. */
export async function listFixtureFiles() {
  const entries = await readdir(path.join(root, "_decoded"));
  return entries.filter((name) => name.endsWith(".html")).sort();
}

/**
 * @param {object} manifest
 * @param {number} [now] epoch ms, injectable so tests are not a function of the wall clock
 */
export function captureAgeReport(manifest, now = Date.now()) {
  const ages = manifest.captures.map((capture) => {
    const ageDays = Math.floor((now - parseDay(capture.capturedOn, capture.file)) / DAY_MS);
    return {
      file: capture.file,
      capturedOn: capture.capturedOn,
      ageDays,
      // Per capture, not just the newest: one fresh home.html used to mask an arbitrarily stale
      // status.html, and a selector proved against the stale one is exactly as speculative.
      overCeiling: ageDays > manifest.ceilingDays,
      overWarn: typeof manifest.warnDays === "number" && ageDays > manifest.warnDays
    };
  });
  const newest = ages.reduce((best, item) => (item.ageDays < best.ageDays ? item : best), ages[0]);
  const oldest = ages.reduce((worst, item) => (item.ageDays > worst.ageDays ? item : worst), ages[0]);
  const stale = ages.filter((item) => item.overCeiling);

  const waiverActive = isWaiverActive(manifest.acknowledgedStaleUntil, now);
  const overCeiling = stale.length > 0;
  return {
    ages,
    newest,
    oldest,
    stale,
    overCeiling,
    overWarn: ages.some((item) => item.overWarn),
    waiverActive,
    waiverUntil: manifest.acknowledgedStaleUntil ?? null,
    // A waiver defers the failure; it never removes it, because it carries its own expiry.
    blocking: overCeiling && !waiverActive
  };
}

/**
 * The waiver covers the whole of its stated day *where the reader is*. Comparing a local clock
 * against a UTC day-end expired it early evening of that day in the Americas, which is a silent
 * shortening of a deadline someone chose deliberately.
 */
function isWaiverActive(acknowledgedStaleUntil, now) {
  if (acknowledgedStaleUntil === undefined) {
    return false;
  }
  parseDay(acknowledgedStaleUntil, "acknowledgedStaleUntil");
  const [year, month, day] = acknowledgedStaleUntil.split("-").map(Number);
  // Local midnight at the start of the day *after* the waiver's last day.
  const expiresAt = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime();
  return now < expiresAt;
}
