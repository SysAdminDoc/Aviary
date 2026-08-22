import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Filter patterns run synchronously against every article in every mutation batch, and JavaScript
 * cannot abort a running match -- so a pattern that backtracks catastrophically does not fail
 * slowly, it freezes the tab. A user can reach that by accident while writing their own rules.
 */

test("the classic backtracking shapes are refused before they compile", async () => {
  const { checkRegexBudget } = await importSourceModule("src/features/filtering/regex-budget.ts");

  // A quantified group whose body already repeats is the family behind nearly every real case.
  for (const pattern of ["(a+)+b", "(a*)*b", "(\\d+)*$", "([a-z]+)+@", "(ab+)+c"]) {
    assert.notEqual(checkRegexBudget(pattern).reason, null, `${pattern} must be refused`);
  }

  assert.match(checkRegexBudget("a{5000}").reason ?? "", /repetition/);
  assert.match(checkRegexBudget("a{1,9999}").reason ?? "", /repetition/);
  assert.match(checkRegexBudget("x".repeat(500)).reason ?? "", /characters/);
});

test("ordinary filter patterns are left alone", async () => {
  const { checkRegexBudget } = await importSourceModule("src/features/filtering/regex-budget.ts");

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
  const { checkRegexBudget } = await importSourceModule("src/features/filtering/regex-budget.ts");

  // These look like nested quantifiers to a naive text scan and are perfectly safe.
  assert.equal(checkRegexBudget("[(+]+x").reason, null);
  assert.equal(checkRegexBudget("\\(a+\\)+").reason, null);
});

test("a refused pattern does not become an active filter", async () => {
  const { compileFilters } = await importSourceModule("src/features/filtering/predicates.ts");

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
  const { compileRules } = await importSourceModule("src/features/filtering/rules.ts");

  const compiled = compileRules(['text matches "(a+)+b"', 'text matches "crypto"']);
  const errors = compiled.errors ?? [];

  assert.equal(errors.length, 1, "exactly the hostile line must fail");
  assert.match(String(errors[0].message ?? errors[0]), /refused/);
});

/**
 * The other half of the catastrophic family.
 *
 * `hasNestedQuantifier` only fired when the repeated group's body carried its own quantifier, so
 * `(a+)+b` was refused while `(a|a)+$` sailed through -- and costs exactly the same, because two
 * branches that can match the same text make the repetition ambiguous. Measured end to end through
 * `judge`, `/(a|a)+$/` took about 0.1s against 20 repeated characters, 2.3s against 28 and 9.8s
 * against 30, synchronously, once per article per mutation batch, with no way to abort it.
 */
test("a repeated group whose branches overlap is refused, and ordinary patterns are not", async () => {
  const { checkRegexBudget } = await importSourceModule("src/features/filtering/regex-budget.ts");

  const refuse = ["(a|a)+$", "(a|ab)+$", "(?:a|a)+$", "(x|x|x)+y", "^(a|a)*$", "(a|b|c)*d"];
  for (const pattern of refuse) {
    const verdict = checkRegexBudget(pattern);
    assert.notEqual(verdict.reason, null, `${pattern} must be refused`);
  }

  // An alternation that is not repeated is ordinary, and so is a repeated group with one branch.
  const keep = ["(cat|dog)", "^(spam|scam) ", "(abc)+", "[a-z]+@[a-z]+", "https?://\\S+", "(?:re)?post"];
  for (const pattern of keep) {
    const verdict = checkRegexBudget(pattern);
    assert.equal(verdict.reason, null, `${pattern} must be allowed, got ${verdict.reason}`);
  }
});

/**
 * A rule that does not run has to say so.
 *
 * `compileFilters` kept what compiled and dropped the rest with no record, while the panel counted
 * the raw textarea lines and reported "Saved N regex rules". A budget-refused or uncompilable line
 * was indistinguishable from a working one.
 */
test("a refused regex is reported with its reason instead of vanishing", async () => {
  const { compileFilters } = await importSourceModule("src/features/filtering/predicates.ts");

  const filters = compileFilters({
    keywords: [],
    regex: ["(a+)+b", "[unclosed", "/ok/", "  ", "(a|a)+$"],
    whitelist: [],
    premium: "off",
    media: {},
    generation: 1
  });

  assert.equal(filters.patterns.length, 1, "only the valid pattern becomes a filter");
  assert.deepEqual(filters.patternSources, ["/ok/"]);

  const refusedSources = filters.refusedPatterns.map((entry) => entry.source);
  assert.deepEqual(refusedSources, ["(a+)+b", "[unclosed", "(a|a)+$"]);
  for (const refused of filters.refusedPatterns) {
    assert.ok(
      refused.reason.length > 0,
      `${refused.source} must carry a reason the panel can show`
    );
  }
  // A blank line is not a mistake and must not be reported as one.
  assert.ok(!refusedSources.includes(""));
});

/**
 * One extra pair of parentheses must not defeat the alternation check.
 *
 * The first version of this guard looked for a `|` at the quantified group's own level, so
 * `(a|a)+$` was refused while `((a|a))+$` -- the same language, the same catastrophic backtracking,
 * and only the outer group carrying the quantifier -- walked straight through. Measured on the
 * bypass: about 14 ms against 20 repeated characters, 50 ms against 22, and past two minutes
 * against 30, which is the frozen tab the whole budget exists to prevent.
 */
test("wrapping an overlapping alternation in another group does not get it past the budget", async () => {
  const { checkRegexBudget } = await importSourceModule("src/features/filtering/regex-budget.ts");

  for (const pattern of [
    "((a|a))+$",
    "(?:(a|a))+$",
    "((a|a))*$",
    "(((a|a)))+$",
    "(([a-z]|[a-z]))+$"
  ]) {
    assert.notEqual(checkRegexBudget(pattern).reason, null, `${pattern} must be refused`);
  }

  // A lookaround's branches cannot consume the same text twice, so repeating what wraps one is not
  // ambiguous and must stay usable.
  for (const pattern of ["(?=a|b)x+", "(\\w(?=a|b))+", "(spam|scam)", "\\b(crypto|nft)\\b"]) {
    assert.equal(
      checkRegexBudget(pattern).reason,
      null,
      `${pattern} must stay allowed, got ${checkRegexBudget(pattern).reason}`
    );
  }
});

/**
 * A bounded quantifier is not a safe quantifier.
 *
 * The guard used to ask only whether the quantifier on a group was unbounded, so every ambiguity
 * check below it was skipped for `(a|a){1,200}` -- the same catastrophic pattern as `(a|a)+` with
 * two characters changed, and well inside the repetition ceiling the budget already enforces.
 * Measured on the bypass: 52 ms against 22 repeated characters, 200 ms against 24, 807 ms against
 * 26. Each further two characters multiply it by four, so this reaches a frozen tab the same way
 * the unbounded form does.
 */
test("a bounded quantifier on an ambiguous group is refused too", async () => {
  const { checkRegexBudget } = await importSourceModule("src/features/filtering/regex-budget.ts");

  for (const pattern of [
    "(a|a){1,200}$",
    "((a|a)){1,200}$",
    "(?:(a|a)){1,200}$",
    "((?<n>(?:a|a)){1,200}){1,200}$",
    // The nested half of the same gap: a bounded inner repeat backtracks for the same reason
    // `(a+)+` does, and read as harmless for the same reason.
    "(a{1,200})+b",
    "(?:(\\d?a?){1,200})+$",
    "(a{2,5})+b"
  ]) {
    assert.notEqual(checkRegexBudget(pattern).reason, null, `${pattern} must be refused`);
  }

  // `?` repeats nothing, and a group with no quantifier at all is not repeated. Neither may be
  // dragged in by widening what counts as repetition.
  for (const pattern of ["(ab)?", "(a|b)?", "(spam|scam)", "^@?(\\w{1,15})$", "(\\w{1,15})"]) {
    assert.equal(
      checkRegexBudget(pattern).reason,
      null,
      `${pattern} must stay allowed, got ${checkRegexBudget(pattern).reason}`
    );
  }
});

/**
 * The lookaround skip has to cover the group being examined, not only the ones inside it.
 *
 * `hasAlternationAnywhere` is handed the group's body with the opening paren already stripped, so
 * the `?=` that makes the group a lookaround was never visible to it. Nested lookarounds were
 * skipped correctly; the outermost one was not, and `(?=a|b)+` -- valid, zero-width, and incapable
 * of the ambiguity the check is looking for -- was refused.
 */
test("a quantified lookaround is not treated as an ambiguous repeated group", async () => {
  const { checkRegexBudget } = await importSourceModule("src/features/filtering/regex-budget.ts");

  for (const pattern of ["(?=a|b)+", "(?!a|b)+", "(?=a|b)*", "(?!spam|scam)+"]) {
    assert.equal(
      checkRegexBudget(pattern).reason,
      null,
      `${pattern} must stay allowed, got ${checkRegexBudget(pattern).reason}`
    );
  }

  // A lookaround alongside a real alternation in the same repeated group is still refused: the
  // skip is for the lookaround's own branches, not for everything sharing the group with it.
  for (const pattern of ["(a(?=b|c)|d)+", "((?=a)|a)+", "((?=[(])|a)+"]) {
    assert.notEqual(checkRegexBudget(pattern).reason, null, `${pattern} must be refused`);
  }
});
