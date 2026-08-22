/**
 * A bound on the regular expressions a user can hand the filter engine.
 *
 * Filter patterns run synchronously against every article in every mutation batch, so a pattern
 * that backtracks catastrophically does not fail slowly — it freezes the tab. `/(a+)+b/` against a
 * long post is enough, and a user can reach that by accident while writing their own filter list.
 * JavaScript gives no way to abort a running match, so the only place to stop it is before it
 * compiles.
 *
 * Two shapes are refused, because between them they cover every case anyone has reached here by
 * accident. A quantifier applied to a group that already contains an unbounded quantifier is the
 * `(a+)+b` family. A quantifier applied to a group whose branches can match the same text is the
 * `(a|a)+$` family, which costs exactly as much and which the first check does not see, because the
 * branches carry no quantifier of their own. Repetition counts and pattern lengths past the point
 * of usefulness for filtering post text are refused too.
 *
 * This is still a guard rail rather than a proof — the general problem is undecidable — and it is
 * deliberately described that way in the message the user sees. Refusing every repeated group that
 * contains a top-level alternation costs a handful of patterns that would have been fine; a frozen
 * tab costs the whole session, and nothing can abort a running match.
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
 * Finds a quantifier applied to a group that makes the repetition ambiguous.
 *
 * Reports which shape it found so the message can name it: `nested` for `(a+)+`, where the body
 * already repeats, and `alternation` for `(a|a)+`, where two branches can match the same text.
 *
 * Walks the pattern tracking group spans rather than pattern-matching on text, so an escaped paren
 * or one inside a character class cannot be mistaken for a real group boundary.
 */
function repeatedGroupRisk(pattern: string): "nested" | "alternation" | null {
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
      return "nested";
    }
    if (hasTopLevelAlternation(body)) {
      return "alternation";
    }
  }
  return null;
}

/**
 * True when `body` contains a `|` at its own nesting level.
 *
 * Only a top-level alternation makes the enclosing repetition ambiguous. One nested inside a
 * further group is that group's problem, and that group is checked on its own when the walk above
 * closes it.
 */
function hasTopLevelAlternation(body: string): boolean {
  let depth = 0;
  let inClass = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

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
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      continue;
    }
    if (char === "|" && depth === 0) {
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

  const risk = repeatedGroupRisk(pattern);
  if (risk === "nested") {
    return {
      reason: "a repeated group that already repeats can backtrack badly enough to freeze the page"
    };
  }
  if (risk === "alternation") {
    return {
      reason:
        "a repeated group whose branches can match the same text can backtrack badly enough to " +
        "freeze the page"
    };
  }

  return { reason: null };
}
