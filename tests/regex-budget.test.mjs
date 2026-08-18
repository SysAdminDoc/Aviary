import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Filter patterns run synchronously against every article in every mutation batch, and JavaScript
 * cannot abort a running match -- so a pattern that backtracks catastrophically does not fail
 * slowly, it freezes the tab. A user can reach that by accident while writing their own rules.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the classic backtracking shapes are refused before they compile", async () => {
  const { checkRegexBudget } = await importBundledModule("src/features/filtering/regex-budget.ts");

  // A quantified group whose body already repeats is the family behind nearly every real case.
  for (const pattern of ["(a+)+b", "(a*)*b", "(\\d+)*$", "([a-z]+)+@", "(ab+)+c"]) {
    assert.notEqual(checkRegexBudget(pattern).reason, null, `${pattern} must be refused`);
  }

  assert.match(checkRegexBudget("a{5000}").reason ?? "", /repetition/);
  assert.match(checkRegexBudget("a{1,9999}").reason ?? "", /repetition/);
  assert.match(checkRegexBudget("x".repeat(500)).reason ?? "", /characters/);
});

test("ordinary filter patterns are left alone", async () => {
  const { checkRegexBudget } = await importBundledModule("src/features/filtering/regex-budget.ts");

  for (const pattern of [
    "crypto",
    "buy\\s+now",
    "^(gm|gn)$",
    "(free|cheap) (nft|token)",
    "https?://\\S+",
    "\\b(airdrop|giveaway)\\b",
    "a{2,10}",
    "[a-z]+"
  ]) {
    assert.equal(checkRegexBudget(pattern).reason, null, `${pattern} must be allowed`);
  }
});

test("a parenthesis inside a class or escaped is not read as a group", async () => {
  const { checkRegexBudget } = await importBundledModule("src/features/filtering/regex-budget.ts");

  // These look like nested quantifiers to a naive text scan and are perfectly safe.
  assert.equal(checkRegexBudget("[(+]+x").reason, null);
  assert.equal(checkRegexBudget("\\(a+\\)+").reason, null);
});

test("a refused pattern does not become an active filter", async () => {
  const { compileFilters } = await importBundledModule("src/features/filtering/predicates.ts");

  const filters = compileFilters({
    keywords: [],
    regex: ["(a+)+b", "crypto"],
    whitelist: [],
    premium: "off",
    media: { photo: false, video: false, gif: false, other: false },
    generation: 1
  });

  // The safe one survives; the hostile one is dropped rather than compiled and run per article.
  assert.equal(filters.patterns.length, 1);
  assert.ok(filters.patterns[0].source.includes("crypto"));
});

test("the rule DSL reports a refused pattern per line instead of applying it", async () => {
  const { compileRules } = await importBundledModule("src/features/filtering/rules.ts");

  const compiled = compileRules(['text matches "(a+)+b"', 'text matches "crypto"']);
  const errors = compiled.errors ?? [];

  assert.equal(errors.length, 1, "exactly the hostile line must fail");
  assert.match(String(errors[0].message ?? errors[0]), /refused/);
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-regex-budget-"));
  try {
    const outfile = path.join(temp, "module.mjs");
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      logLevel: "silent"
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
