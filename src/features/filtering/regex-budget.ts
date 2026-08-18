/**
 * A bound on the regular expressions a user can hand the filter engine.
 *
 * Filter patterns run synchronously against every article in every mutation batch, so a pattern
 * that backtracks catastrophically does not fail slowly — it freezes the tab. `/(a+)+b/` against a
 * long post is enough, and a user can reach that by accident while writing their own filter list.
 * JavaScript gives no way to abort a running match, so the only place to stop it is before it
 * compiles.
 *
 * What this catches is the shape behind almost every real case: a quantifier applied to a group
 * that itself contains an unbounded quantifier, plus repetition counts and pattern lengths past the
 * point of usefulness for filtering post text. What it does not catch is the general problem, which
 * is undecidable — two alternation branches that overlap can still backtrack badly. This is a guard
 * rail, not a proof, and it is deliberately described that way in the message the user sees.
 *
 * Note for anyone tempted to reach for `RegExp.escape`: it is Chrome 136 / Firefox 134, well above
 * this project's Chrome 116 / Firefox 128 manifest floors.
 */

/** Longer than any filter anyone writes by hand, and short enough to bound the search below. */
export const MAX_PATTERN_LENGTH = 400;

/** `a{1,5000}` is not a filter, it is a way to make the page stop. */
export const MAX_REPETITION = 200;

export interface RegexBudgetVerdict {
  /** Null when the pattern is acceptable, otherwise why it was refused. */
  reason: string | null;
}

const UNBOUNDED_QUANTIFIER = /[*+]|\{\s*\d*\s*,\s*\}/;

/**
 * Finds a quantifier applied to a group whose body already repeats — the `(a+)+` family.
 *
 * Walks the pattern tracking group spans rather than pattern-matching on text, so an escaped paren
 * or one inside a character class cannot be mistaken for a real group boundary.
 */
function hasNestedQuantifier(pattern: string): boolean {
  const openStack: number[] = [];
  let inClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === "\\") {
      index += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "(") {
      openStack.push(index);
      continue;
    }
    if (char !== ")") {
      continue;
    }

    const start = openStack.pop();
    if (start === undefined) {
      continue;
    }
    // What immediately follows the group, ignoring a lazy/possessive marker.
    const after = pattern.slice(index + 1).replace(/^[?]/, "");
    const groupIsRepeated = UNBOUNDED_QUANTIFIER.test(after.slice(0, 1)) || /^\{\s*\d*\s*,\s*\}/.test(after);
    if (!groupIsRepeated) {
      continue;
    }
    const body = pattern.slice(start + 1, index);
    if (UNBOUNDED_QUANTIFIER.test(body)) {
      return true;
    }
  }
  return false;
}

/** Rejects patterns whose cost is unbounded enough to hang the page, with a reason to show. */
export function checkRegexBudget(pattern: string): RegexBudgetVerdict {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      reason: `pattern is ${pattern.length} characters, over the ${MAX_PATTERN_LENGTH}-character limit`
    };
  }

  for (const match of pattern.matchAll(/\{\s*(\d+)\s*(?:,\s*(\d+)?\s*)?\}/g)) {
    const lower = Number(match[1]);
    const upper = match[2] === undefined ? lower : Number(match[2]);
    if (Math.max(lower, upper) > MAX_REPETITION) {
      return {
        reason: `repetition {${match[1]}${match[2] === undefined ? "" : `,${match[2]}`}} is over the ${MAX_REPETITION} limit`
      };
    }
  }

  if (hasNestedQuantifier(pattern)) {
    return {
      reason: "a repeated group that already repeats can backtrack badly enough to freeze the page"
    };
  }

  return { reason: null };
}
