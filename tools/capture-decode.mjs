// Turn a browser-saved MHTML capture of X into a scrubbed HTML page the operator can measure
// into `_decoded/dom-schema.json`.
//
// The decoded page is written outside the repository on purpose. It is an authenticated page
// carrying a real handle, display name and post bodies, and it used to be committed: read it,
// record what it shows in the schema, and delete it. The schema is what selectors are proved
// against, and it is what ages.
//
// Refreshing the capture set used to be an undocumented manual chore, which is why it never
// happened after the initial commit and the fixtures sat three months stale while every gate
// stayed green. One command is the difference between a chore and a habit.
//
//   npm run capture:decode -- "C:\path\Home _ X.mhtml" home
//
// What it does NOT do: log in, fetch anything, or contact X. It reads a file the operator already
// saved. Capture is theirs; decoding and scrubbing is ours.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";


/**
 * Values that must never enter a tracked fixture. A capture is taken from a real signed-in session,
 * so the scrub is the thing standing between "useful evidence" and "published credentials".
 */
/**
 * Every secret name, in one place, so the scrub and the leak guard below cannot drift apart. The
 * first version listed `ct0` only in its JSON form, so a `ct0=<value>` cookie string passed the
 * scrub *and* the guard that exists to catch exactly that.
 */
const SECRET_NAMES = [
  "ct0",
  "auth_token",
  "oauth_token",
  "access_token",
  "session_token",
  "csrf_token",
  "kdt",
  "twid",
  "guest_id",
  "personalization_id"
];

const SECRET_ALTERNATION = SECRET_NAMES.join("|");

/** Cookie/query shape: `name=value`. */
const COOKIE_SHAPE = new RegExp(`\\b(${SECRET_ALTERNATION})=([^;"'\\s&]+)`, "g");
/** JSON shape: `"name": "value"`. */
const JSON_SHAPE = new RegExp(`("(?:${SECRET_ALTERNATION})"\\s*:\\s*")[^"]*(")`, "g");

const SCRUB_PATTERNS = [
  // Both shapes occur: a cookie string, and the same names as JSON keys in X's bootstrap.
  [COOKIE_SHAPE, "$1=SCRUBBED"],
  [JSON_SHAPE, "$1SCRUBBED$2"],
  [/(Bearer\s+)[A-Za-z0-9%\-._~+/]+=*/g, "$1SCRUBBED"],
  // Long opaque bearer-shaped literals that appear inline in X's bootstrap scripts.
  [/AAAAAAAAA[A-Za-z0-9%\-._~+/]{40,}=*/g, "SCRUBBED_BEARER"]
];

/**
 * Quoted-printable carries bytes, not characters: `=E2=80=94` is one em-dash in three octets. The
 * first version mapped each octet through `String.fromCharCode` and wrote the result back as UTF-8,
 * so every non-ASCII character in a capture came out as mojibake -- display names, non-English
 * posts, and the localized ad labels the fixtures exist to measure. Decode to bytes, then decode
 * those bytes once as UTF-8.
 */
function decodeQuotedPrintable(body) {
  const unfolded = body.replace(/=\r?\n/g, "");
  const encoder = new TextEncoder();
  const chunks = [];
  const escape = /=([0-9A-Fa-f]{2})/g;
  let last = 0;
  let match;
  while ((match = escape.exec(unfolded)) !== null) {
    if (match.index > last) {
      chunks.push(encoder.encode(unfolded.slice(last, match.index)));
    }
    chunks.push(Uint8Array.of(parseInt(match[1], 16)));
    last = escape.lastIndex;
  }
  if (last < unfolded.length) {
    chunks.push(encoder.encode(unfolded.slice(last)));
  }
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * MHTML is a MIME multipart document. We want the first `text/html` part, which is the page itself;
 * the remaining parts are stylesheets and images that the fixture does not need.
 */
export function extractHtml(mhtml) {
  const boundaryMatch = mhtml.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    throw new Error("no MIME boundary found — is this a browser-saved .mhtml file?");
  }
  const parts = mhtml.split(`--${boundaryMatch[1]}`);
  for (const part of parts) {
    const headerEnd = part.search(/\r?\n\r?\n/);
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd).toLowerCase();
    // Must be the part's own Content-Type. The document's top-level headers carry
    // `multipart/related; type="text/html"`, so a substring test matches the preamble and returns
    // an empty body.
    if (!/^content-type:\s*text\/html/m.test(headers)) continue;
    const body = part.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
    return headers.includes("quoted-printable") ? decodeQuotedPrintable(body) : body;
  }
  throw new Error("no text/html part found in the capture");
}

export function scrub(html) {
  let output = html;
  const removed = [];
  for (const [pattern, replacement] of SCRUB_PATTERNS) {
    const before = output;
    output = output.replace(pattern, replacement);
    if (output !== before) removed.push(pattern.source.slice(0, 40));
  }
  return { html: output, removed };
}

/**
 * Fails loudly rather than writing a fixture that still carries a token. Built from the same
 * `SECRET_NAMES` list as the scrub, so a name can never be scrubbed-but-unchecked or the reverse.
 */
export function assertScrubbed(html) {
  const leaks = [
    [
      new RegExp(`\\b(?:${SECRET_ALTERNATION})=(?!SCRUBBED)[^;"'\\s&]{8,}`),
      "credential in cookie form"
    ],
    [
      new RegExp(`"(?:${SECRET_ALTERNATION})"\\s*:\\s*"(?!SCRUBBED)[^"]{8,}"`),
      "credential in JSON form"
    ],
    [/Bearer\s+(?!SCRUBBED)[A-Za-z0-9%\-._~+/]{20,}/, "Bearer token"]
  ];
  for (const [pattern, label] of leaks) {
    const found = html.match(pattern);
    if (found) {
      const name = found[0].split(/[=:]/)[0].replace(/"/g, "").trim();
      throw new Error(`refusing to write the fixture: it still contains a ${label} (${name})`);
    }
  }
}

async function main() {
  const [source, name] = process.argv.slice(2);
  if (!source || !name) {
    console.error('usage: npm run capture:decode -- "<saved.mhtml>" <name>');
    console.error('  e.g. npm run capture:decode -- "Home _ X.mhtml" home');
    process.exitCode = 1;
    return;
  }
  const mhtml = await readFile(source, "utf8");
  const html = extractHtml(mhtml);
  const { html: scrubbed, removed } = scrub(html);
  assertScrubbed(scrubbed);

  const directory = await mkdtemp(path.join(tmpdir(), "aviary-capture-decode-"));
  const target = path.join(directory, `${name}.html`);
  await writeFile(target, scrubbed, "utf8");

  const today = new Date().toISOString().slice(0, 10);
  console.log(`Wrote ${target} (${scrubbed.length} chars).`);
  console.log(`Scrub applied to ${removed.length} pattern(s).`);
  console.log("");
  console.log("This file is outside the repository and must stay that way. Now:");
  console.log(`  1. Measure it into _decoded/dom-schema.json and set derivedFrom.capturedOn to "${today}".`);
  console.log("  2. Re-run every \"measured: 0 hits\" claim in Roadmap_Blocked.md against it.");
  console.log("  3. Delete the decoded page.");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("capture-decode.mjs")) {
  await main();
}
