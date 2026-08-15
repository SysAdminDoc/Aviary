// Turn a browser-saved MHTML capture of X into the scrubbed `_decoded/<name>.html` that this
// repository proves its selectors against.
//
// Refreshing the capture set used to be an undocumented manual chore, which is why it never
// happened after the initial commit and the fixtures sat three months stale while every gate
// stayed green. One command is the difference between a chore and a habit.
//
//   npm run capture:decode -- "C:\path\Home _ X.mhtml" home
//
// What it does NOT do: log in, fetch anything, or contact X. It reads a file the operator already
// saved. Capture is theirs; decoding and scrubbing is ours.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Values that must never enter a tracked fixture. A capture is taken from a real signed-in session,
 * so the scrub is the thing standing between "useful evidence" and "published credentials".
 */
const SCRUB_PATTERNS = [
  // Auth material X puts in the document for its own bootstrap.
  [/("ct0"\s*:\s*")[^"]*(")/g, "$1SCRUBBED$2"],
  [/(Bearer\s+)[A-Za-z0-9%\-._~+/]+=*/g, "$1SCRUBBED"],
  [/((?:auth_token|kdt|twid|guest_id|personalization_id)=)[^;"'\s&]+/g, "$1SCRUBBED"],
  // Both shapes occur: a cookie string, and the same names as JSON keys in X's bootstrap.
  [/("(?:oauth_token|access_token|session_token|csrf_token|auth_token|kdt|twid|guest_id)"\s*:\s*")[^"]*(")/g, "$1SCRUBBED$2"],
  // Long opaque bearer-shaped literals that appear inline in X's bootstrap scripts.
  [/AAAAAAAAA[A-Za-z0-9%\-._~+/]{40,}=*/g, "SCRUBBED_BEARER"]
];

function decodeQuotedPrintable(body) {
  return body
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
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

/** Fails loudly rather than writing a fixture that still carries a token. */
export function assertScrubbed(html) {
  const leaks = [
    [/"ct0"\s*:\s*"(?!SCRUBBED)[^"]{8,}"/, "ct0 cookie value"],
    [/Bearer\s+(?!SCRUBBED)[A-Za-z0-9%\-._~+/]{20,}/, "Bearer token"],
    [/auth_token=(?!SCRUBBED)[^;"'\s&]{8,}/, "auth_token cookie"]
  ];
  for (const [pattern, label] of leaks) {
    if (pattern.test(html)) {
      throw new Error(`refusing to write the fixture: it still contains a ${label}`);
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

  const target = path.join(root, "_decoded", `${name}.html`);
  await writeFile(target, scrubbed, "utf8");

  const today = new Date().toISOString().slice(0, 10);
  console.log(`Wrote _decoded/${name}.html (${scrubbed.length} chars).`);
  console.log(`Scrub applied to ${removed.length} pattern(s).`);
  console.log("");
  console.log("Now update _decoded/captures.json:");
  console.log(`  set this capture's "capturedOn" to "${today}" and record its route and source file,`);
  console.log("  then re-run every \"measured: 0 hits\" claim in Roadmap_Blocked.md against it.");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("capture-decode.mjs")) {
  await main();
}
