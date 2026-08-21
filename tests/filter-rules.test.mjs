import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let mod;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-filter-rules-"));
  const entry = path.join(temp, "entry.ts");
  // One bundle so compileFilters and the rule module share state.
  await writeFile(
    entry,
    `export * from ${JSON.stringify(abs("src/features/filtering/rules.ts"))};
export { compileFilters, decide } from ${JSON.stringify(abs("src/features/filtering/predicates.ts"))};
export { DEFAULT_SETTINGS, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const outfile = path.join(temp, "bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  mod = await import(pathToFileURL(outfile).href);
});

after(async () => {
  await rm(temp, { recursive: true, force: true });
});

const signal = (overrides = {}) => ({
  text: "a post about crypto giveaways",
  handle: "someaccount",
  premium: false,
  media: { photo: false, video: false, gif: false },
  hasLink: false,
  ...overrides
});

function judge(lines, input) {
  const { rules, errors } = mod.compileRules(lines);
  assert.deepEqual(errors, [], `unexpected parse errors: ${JSON.stringify(errors)}`);
  return mod.evaluateRules(input, rules);
}

test("a single condition hides a matching post and spares the rest", () => {
  assert.equal(judge(["text contains crypto"], signal()), "hide");
  assert.equal(judge(["text contains knitting"], signal()), "show");
});

test("and requires every condition; or requires one", () => {
  const post = signal({ media: { photo: true, video: false, gif: false } });
  assert.equal(judge(["text contains crypto and media is photo"], post), "hide");
  assert.equal(judge(["text contains crypto and media is video"], post), "show");
  assert.equal(judge(["text contains knitting or media is photo"], post), "hide");
  assert.equal(judge(["text contains knitting or media is video"], post), "show");
});

test("not inverts a condition", () => {
  assert.equal(judge(["handle not is someaccount"], signal()), "show");
  assert.equal(judge(["handle not is someoneelse"], signal()), "hide");
});

test("every operator behaves as named", () => {
  const post = signal({ text: "Free airdrop today", handle: "cryptobot" });
  assert.equal(judge(["text starts free"], post), "hide");
  assert.equal(judge(["text ends today"], post), "hide");
  assert.equal(judge(["text is free airdrop today"], post), "hide");
  assert.equal(judge(["handle contains bot"], post), "hide");
  assert.equal(judge(["text matches /free .*airdrop/i"], post), "hide");
  assert.equal(judge(["text starts airdrop"], post), "show");
});

test("boolean fields read the signal, not the text", () => {
  assert.equal(judge(["verified is true"], signal({ premium: true })), "hide");
  assert.equal(judge(["verified is true"], signal({ premium: false })), "show");
  assert.equal(judge(["link is true"], signal({ hasLink: true })), "hide");
  assert.equal(judge(["link is false"], signal({ hasLink: true })), "show");
});

test("the dim prefix fades instead of hiding, and hide wins when both match", () => {
  assert.equal(judge(["dim: text contains crypto"], signal()), "dim");
  assert.equal(
    judge(["dim: text contains crypto", "text contains giveaway"], signal()),
    "hide",
    "the stronger action is the one the user asked for"
  );
});

test("a handle rule cannot match a post whose author could not be read", () => {
  assert.equal(judge(["handle contains anything"], signal({ handle: null })), "show");
  // But a negated handle rule must not turn an unreadable author into a match either.
  assert.equal(judge(["handle not is someone"], signal({ handle: null })), "hide");
});

test("blank lines and comments are ignored", () => {
  const { rules, errors } = mod.compileRules(["", "   ", "# a note", "text contains crypto"]);
  assert.deepEqual(errors, []);
  assert.equal(rules.length, 1);
});

test("a broken rule is reported with its line, not silently dropped", () => {
  const { rules, errors } = mod.compileRules([
    "text contains crypto",
    "colour is blue",
    "text contains",
    "text matches /unclosed(/",
    "media is audio",
    "verified is maybe",
    "text contains a and handle is b or media is gif"
  ]);
  assert.equal(rules.length, 1, "the valid rule must still compile");
  assert.deepEqual(
    errors.map((error) => error.line),
    [2, 3, 4, 5, 6, 7]
  );
  assert.match(errors[0].message, /unknown field/);
  assert.match(errors[2].message, /not a valid regular expression/);
  assert.match(errors[3].message, /photo, video, or gif/);
  assert.match(errors[4].message, /true or false/);
  assert.match(errors[5].message, /mixing 'and' with 'or'/);
});

test("quoted values keep their spaces", () => {
  assert.equal(judge(['text contains "about crypto"'], signal()), "hide");
  assert.equal(judge(['text contains "about knitting"'], signal()), "show");
});

test("rules run inside decide, and the whitelist still wins over them", () => {
  const { rules } = mod.compileRules(["text contains crypto"]);
  const filters = mod.compileFilters({
    rules,
    keywords: [],
    regex: [],
    whitelist: ["someaccount"],
    premium: "off",
    media: {},
    generation: 1
  });
  assert.equal(mod.decide(signal(), filters), "show", "an allowlisted author outranks a rule");
  assert.equal(mod.decide(signal({ handle: "other" }), filters), "hide");
});

test("rules round-trip through the settings normalizer", () => {
  const lines = ["text contains crypto", "dim: media is video"];
  const settings = mod.normalizeSettings({ filter: { rules: lines } });
  assert.deepEqual(settings.filter.rules, lines);
  // Settings export is a straight serialization of this object, so the rules travel with it.
  assert.deepEqual(mod.normalizeSettings(JSON.parse(JSON.stringify(settings))).filter.rules, lines);
});

test("rules default to empty, so the feature claims nothing until configured", () => {
  assert.deepEqual(mod.DEFAULT_SETTINGS.filter.rules, []);
  assert.equal(mod.evaluateRules(signal(), []), "show");
});

test("a rule set is bounded rather than unbounded work per post", () => {
  const many = Array.from({ length: 500 }, (_, index) => `text contains term${index}`);
  const { rules } = mod.compileRules(many);
  assert.ok(rules.length <= 100, `rule count must be capped, saw ${rules.length}`);
});

test("portable text preserves titles, lifetimes, comments, and Unicode", () => {
  const lines = [
    "# Weekend pack",
    "[Weekend sales] dim for 7d from 2026-08-19T10:00:00.000Z: text contains sale and media is photo",
    "text contains café"
  ];
  const text = mod.exportRuleSet(lines);
  assert.match(text, /^# Aviary filter rules v1\n/);

  const preview = mod.previewRuleSetImport(text, []);
  assert.deepEqual(preview.replace.errors, []);
  assert.deepEqual(preview.replace.lines, lines);
  assert.equal(preview.imported, 2);
  assert.equal(preview.comments, 1);
});

test("a pasted rule set previews add and replace before either writes", () => {
  const current = ["text contains crypto", "media is gif"];
  const preview = mod.previewRuleSetImport(
    ["# Aviary filter rules v1", "text contains crypto", "[Videos] dim: media is video"].join("\r\n"),
    current
  );

  assert.deepEqual(preview.add.errors, []);
  assert.deepEqual(preview.add.lines, [...current, "[Videos] dim: media is video"]);
  assert.equal(preview.add.added, 1);
  assert.equal(preview.add.duplicates, 1);
  assert.equal(preview.add.total, 3);
  assert.deepEqual(preview.replace.lines, ["text contains crypto", "[Videos] dim: media is video"]);
  assert.equal(preview.replace.replaced, 2);
  assert.equal(preview.replace.total, 2);
});

test("portable imports report every bad source line before applying", () => {
  const preview = mod.previewRuleSetImport(
    ["# Aviary filter rules v1", "colour is blue", "text contains sale", "media is audio"].join("\n"),
    ["text contains existing"]
  );

  assert.deepEqual(
    preview.replace.errors.map((problem) => problem.line),
    [2, 4]
  );
  assert.match(preview.replace.errors[0].message, /unknown field/);
  assert.match(preview.replace.errors[1].message, /photo, video, or gif/);
  assert.ok(preview.add.errors.length > 0, "add must be blocked by the same parse errors");
});

test("add mode identifies the exact pasted line that would exceed storage", () => {
  const current = Array.from({ length: 100 }, (_, index) => `text contains current${index}`);
  const preview = mod.previewRuleSetImport("text contains one-more", current);

  assert.deepEqual(preview.replace.errors, [], "replace remains available when the pasted set fits");
  assert.equal(preview.add.errors.length, 1);
  assert.equal(preview.add.errors[0].line, 1);
  assert.match(preview.add.errors[0].message, /100-line/);
});
