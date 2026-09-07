import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { generateCaptureDocument, readDomSchema } from "../../tools/fixture-generator.mjs";

/**
 * The synthetic Home and conversation documents every selector test runs against.
 *
 * Written to a temp directory rather than into the repository, because a generated artifact
 * checked in beside its schema is a second copy that can drift from it. Tests that need a real
 * navigation (`page.goto`) get a `file://` URL; tests that only read markup get the string.
 *
 * One directory per process, removed when the process exits, so a test file that opens both routes
 * pays for the generation once.
 */

let pending;

async function ensure() {
  if (!pending) {
    pending = (async () => {
      const schema = await readDomSchema();
      const directory = await mkdtemp(path.join(tmpdir(), "aviary-capture-"));
      const files = {};
      const html = {};
      for (const route of Object.keys(schema.routes)) {
        const document = generateCaptureDocument(schema, route);
        const file = path.join(directory, `${route}.html`);
        await writeFile(file, document, "utf8");
        files[route] = file;
        html[route] = document;
      }
      const layoutFile = path.join(directory, "home-layout.html");
      await writeFile(layoutFile, generateCaptureDocument(schema, "home", { layout: true }), "utf8");
      files["home-layout"] = layoutFile;
      process.once("exit", () => {
        rm(directory, { recursive: true, force: true }).catch(() => {});
      });
      return { schema, directory, files, html };
    })();
  }
  return pending;
}

/** `file://` URL for a generated route, for `page.goto`. */
export async function captureUrl(route) {
  const { files } = await ensure();
  const file = files[route];
  if (!file) throw new Error(`no generated document for route ${JSON.stringify(route)}`);
  return pathToFileURL(file).href;
}

/** The generated markup for a route, for tests that assert on source text. */
export async function captureHtml(route) {
  const { html } = await ensure();
  const document = html[route];
  if (!document) throw new Error(`no generated document for route ${JSON.stringify(route)}`);
  return document;
}

/** The schema the documents were generated from. */
export async function captureSchema() {
  return (await ensure()).schema;
}
