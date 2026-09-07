// Reads `_decoded/dom-schema.json` and reports how old the observation behind it is.
//
// Kept separate from capture-decode.mjs so importing it cannot run a CLI, and separate from
// preflight so the test suite can assert the same numbers the release gate enforces.
//
// The thing that ages is the observation, not the markup. Fixtures are generated fresh on every
// run from the schema, so the only date that means anything is `derivedFrom.capturedOn` -- the day
// an operator actually looked at X. Regenerating documents must never move it.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MANIFEST_PATH = path.join(root, "_decoded", "dom-schema.json");

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
  const schema = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (!Number.isInteger(schema.ceilingDays) || schema.ceilingDays <= 0) {
    throw new Error("dom-schema.json must declare a positive integer ceilingDays");
  }
  if (!schema.derivedFrom || !Array.isArray(schema.derivedFrom.sources) || schema.derivedFrom.sources.length === 0) {
    throw new Error("dom-schema.json must record what the schema was derived from");
  }
  parseDay(schema.derivedFrom.capturedOn, "derivedFrom.capturedOn");
  if (schema.acknowledgedStaleUntil !== undefined) {
    parseDay(schema.acknowledgedStaleUntil, "acknowledgedStaleUntil");
    if (typeof schema.acknowledgedReason !== "string" || schema.acknowledgedReason.length < 20) {
      throw new Error("acknowledgedStaleUntil requires an acknowledgedReason explaining the waiver");
    }
  }
  // Reported as one dated observation so the age report, and every test written against it, keeps
  // working on the same shape it always had.
  return {
    ceilingDays: schema.ceilingDays,
    warnDays: schema.warnDays,
    acknowledgedStaleUntil: schema.acknowledgedStaleUntil,
    acknowledgedReason: schema.acknowledgedReason,
    captures: [
      {
        file: "dom-schema.json",
        capturedOn: schema.derivedFrom.capturedOn,
        route: Object.values(schema.routes)
          .map((route) => route.route)
          .join(", "),
        source: schema.derivedFrom.sources.join("; "),
        notes: schema.derivedFrom.notes ?? ""
      }
    ]
  };
}

/**
 * Saved pages that found their way back into `_decoded/`.
 *
 * Fixtures are generated from the schema on every run, so there is nothing here to keep. A saved
 * capture is an authenticated page carrying a real handle, display name and post bodies: it is
 * decoded, measured into the schema, and thrown away. Anything left behind is a mistake.
 */
export async function listFixtureFiles() {
  const entries = await readdir(path.join(root, "_decoded"));
  return entries.filter((name) => /\.(x?html?|mht|mhtml|webarchive)$/i.test(name)).sort();
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
