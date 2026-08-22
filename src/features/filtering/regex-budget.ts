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

/**
 * How many times a quantifier at `index` can repeat what precedes it, or 0 when there is none.
 *
 * `Infinity` for `*`, `+` and `{n,}`. A bounded form reports its own ceiling, and that matters more
 * than it looks: the check used to ask only whether a quantifier was unbounded, so `(a|a){1,200}`
 * read as harmless and skipped every ambiguity test below. It is not harmless. Measured against a
 * 26-character subject it took 807 ms, and each further two characters multiply that by four -- a
 * frozen tab, reached by changing two characters of a pattern the guard already refuses.
 *
 * `?` reports 1, not 2: matching something once or not at all repeats nothing.
 */
function repetitionCeiling(source: string, index: number): number {
  const char = source[index];
  if (char === "*" || char === "+") return Number.POSITIVE_INFINITY;
  if (char === "?") return 1;
  if (char !== "{") return 0;
  const brace = /^\{\s*(\d+)\s*(?:,\s*(\d*)\s*)?\}/.exec(source.slice(index));
  if (!brace) return 0;
  if (brace[2] === undefined) return Number(brace[1]);
  return brace[2] === "" ? Number.POSITIVE_INFINITY : Number(brace[2]);
}

/**
 * True when `body` contains a quantifier that can repeat more than once, at any depth.
 *
 * This is the inner half of the `(a+)+b` family. It reads the body character by character rather
 * than with a regex so that an escaped `+` or a `*` inside a character class is not mistaken for a
 * quantifier -- and so that a bounded inner repeat counts, since `(a{1,200})+` backtracks for the
 * same reason `(a+)+` does.
 */
function hasRepetitionAnywhere(body: string): boolean {
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
    if (repetitionCeiling(body, index) > 1) return true;
  }
  return false;
}

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
    // A lookaround is zero-width, so a quantifier on it repeats nothing and its branches cannot
    // consume the same text twice. Nested lookarounds were already skipped below; the group being
    // examined was not, which is why `(?=a|b)+` -- a valid, harmless pattern -- was refused.
    if (/^\(\?<?[=!]/.test(pattern.slice(start))) {
      continue;
    }
    // What immediately follows the group, ignoring a lazy/possessive marker.
    const after = pattern.slice(index + 1).replace(/^[?]/, "");
    if (repetitionCeiling(after, 0) <= 1) {
      continue;
    }
    const body = pattern.slice(start + 1, index);
    if (hasRepetitionAnywhere(body)) {
      return "nested";
    }
    if (hasAlternationAnywhere(body)) {
      return "alternation";
    }
  }
  return null;
}

/**
 * True when repeating `body` can be ambiguous, at any depth.
 *
 * A `|` at the body's own level is the plain case. But wrapping it changes nothing about the cost:
 * `((a|a))+` matches the same language as `(a|a)+` and backtracks exactly as badly, and only the
 * outer group carries the quantifier, so a check that looked at depth 0 alone walked straight past
 * it. Measured: `((a|a))+$` against thirty repeated characters did not finish inside two minutes.
 *
 * So the search descends. A group that only ever wraps -- `(?=...)`, `(?!...)` and their lookbehind
 * forms -- is skipped, because a lookaround is not repeated by the enclosing quantifier and its
 * branches cannot consume the same text twice.
 */
function hasAlternationAnywhere(body: string): boolean {
  let inClass = false;
  // Depth 0 is the body itself; each entry records whether that nesting level is a lookaround,
  // whose contents cannot contribute to the enclosing repetition's ambiguity.
  const lookaroundStack: boolean[] = [];
  let skipDepth = 0;

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
      const isLookaround = /^\(\?<?[=!]/.test(body.slice(index));
      lookaroundStack.push(isLookaround);
      if (isLookaround) skipDepth += 1;
      continue;
    }
    if (char === ")") {
      if (lookaroundStack.pop() === true) skipDepth -= 1;
      continue;
    }
    if (char === "|" && skipDepth === 0) {
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
