import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-ad-lang-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { adLabelLanguageSupported, documentLanguage } from ${JSON.stringify(abs("src/features/privacy/ad-protection.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryAdLang",
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

async function check(lang) {
  return page.evaluate((value) => {
    if (value === null) {
      document.documentElement.removeAttribute("lang");
    } else {
      document.documentElement.setAttribute("lang", value);
    }
    return {
      language: AviaryAdLang.documentLanguage(),
      supported: AviaryAdLang.adLabelLanguageSupported()
    };
  }, lang);
}

test("a language with labels reports as covered", async () => {
  for (const lang of ["en", "es", "fr", "de", "ja", "ko", "pt", "ar", "he"]) {
    const result = await check(lang);
    assert.equal(result.supported, true, `${lang} has labels and must report covered`);
  }
});

test("a region subtag does not change the answer", async () => {
  assert.equal((await check("en-GB")).supported, true);
  assert.equal((await check("pt-BR")).supported, true);
  assert.equal((await check("it-IT")).supported, false);
});

test("a language with no labels is reported rather than silently unprotected", async () => {
  for (const lang of ["it", "nl", "tr", "pl", "hi", "th"]) {
    const result = await check(lang);
    assert.equal(result.supported, false, `${lang} has no labels and must say so`);
    assert.equal(result.language, lang);
  }
});

test("a missing lang attribute does not cry wolf", async () => {
  // Absence is not evidence of an unsupported language, and a false warning about ad protection
  // is worse than none: it would tell a covered user their ads are getting through.
  const result = await check(null);
  assert.equal(result.language, "");
  assert.equal(result.supported, true);
});

test("the captured pages carry the lang attribute this reads", async () => {
  for (const capture of ["_decoded/home.html", "_decoded/status.html"]) {
    const html = await readFile(path.join(root, capture), "utf8");
    assert.match(html, /<html[^>]*lang="/, `${capture} must expose a lang attribute`);
  }
});

test("every language claimed as covered actually has labels in the set", async () => {
  // The list and the labels are two places that can drift apart; a language claimed as covered
  // with no matching label would report protection that does not exist.
  const source = await readFile(path.join(root, "src/features/privacy/ad-protection.ts"), "utf8");
  const claimed = source.match(/LABELLED_LANGUAGES = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "";
  const languages = [...claimed.matchAll(/"([a-z]{2})"/g)].map((match) => match[1]);
  assert.deepEqual(languages, ["en", "es", "fr", "de", "ja", "ko", "pt", "ar", "he"]);

  const labels = source.match(/AD_LABELS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  // One representative label per claimed language, so the two lists cannot silently diverge.
  for (const marker of ["Ad", "Anuncio", "Publicité", "Anzeige", "広告", "광고", "Anúncio", "إعلان", "מודעה"]) {
    assert.ok(labels.includes(marker), `no label found for a language claimed as covered: ${marker}`);
  }
});
