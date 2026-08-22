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
 * How few times a quantifier at `index` can repeat what precedes it. 1 when there is none.
 *
 * The companion to {@link repetitionCeiling}, and the half that decides whether something is
 * optional. A term whose floor is 0 contributes nothing to the match on at least one path, which
 * is what makes a group nullable and therefore ambiguous under repetition.
 */
function repetitionFloor(source: string, index: number): number {
  const char = source[index];
  if (char === "*" || char === "?") return 0;
  if (char === "+") return 1;
  if (char !== "{") return 1;
  const brace = /^\{\s*(\d+)\s*(?:,\s*(\d*)\s*)?\}/.exec(source.slice(index));
  return brace ? Number(brace[1]) : 1;
}

/** Index just past the group, class or escape that starts at `index`. */
function atomEnd(source: string, index: number): number {
  const char = source[index];
  if (char === "\\") return Math.min(index + 2, source.length);
  if (char === "[") {
    let cursor = index + 1;
    if (source[cursor] === "^") cursor += 1;
    if (source[cursor] === "]") cursor += 1;
    while (cursor < source.length && source[cursor] !== "]") {
      cursor += source[cursor] === "\\" ? 2 : 1;
    }
    return Math.min(cursor + 1, source.length);
  }
  if (char === "(") {
    let depth = 0;
    let inClass = false;
    for (let cursor = index; cursor < source.length; cursor += 1) {
      const at = source[cursor];
      if (at === "\\") {
        cursor += 1;
        continue;
      }
      if (inClass) {
        if (at === "]") inClass = false;
        continue;
      }
      if (at === "[") inClass = true;
      else if (at === "(") depth += 1;
      else if (at === ")") {
        depth -= 1;
        if (depth === 0) return cursor + 1;
      }
    }
    return source.length;
  }
  return index + 1;
}

/** Index just past any quantifier at `index`, including a lazy marker. */
function quantifierEnd(source: string, index: number): number {
  const char = source[index];
  if (char === "*" || char === "+" || char === "?") {
    return source[index + 1] === "?" ? index + 2 : index + 1;
  }
  if (char === "{") {
    const brace = /^\{\s*\d+\s*(?:,\s*\d*\s*)?\}/.exec(source.slice(index));
    if (brace) {
      const end = index + brace[0].length;
      return source[end] === "?" ? end + 1 : end;
    }
  }
  return index;
}

/** The top-level `|` branches of `body`, with groups and character classes left intact. */
function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inClass = false;
  let start = 0;
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
    if (char === "[") inClass = true;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "|" && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * True when `body` can match without consuming anything.
 *
 * This is the hole the first version of this guard left open. `(a?){200}` carries no repeated
 * quantifier inside it and no alternation, so both checks below walked past it -- but the group can
 * match empty, so a bounded outer repeat has combinatorially many ways to distribute empty and
 * non-empty iterations across the same text. Measured: `(a?){200}b` against four characters took
 * 3.0 s and against five it did not finish, and `(.?){20}spam` took 1.2 s against an ordinary
 * 29-character post. The unbounded form is safe, because the engine breaks an empty-match loop; a
 * bounded one gets no such guard.
 */
function canMatchEmpty(body: string): boolean {
  return splitAlternatives(body).some((branch) => {
    let index = 0;
    while (index < branch.length) {
      const char = branch[index];
      const end = atomEnd(branch, index);
      const after = quantifierEnd(branch, end);
      const optional = repetitionFloor(branch, end) === 0;

      // Zero-width by construction, whatever quantifier follows.
      const zeroWidth =
        char === "^" ||
        char === "$" ||
        (char === "\\" && (branch[index + 1] === "b" || branch[index + 1] === "B")) ||
        (char === "(" && /^\(\?<?[=!]/.test(branch.slice(index)));

      if (!zeroWidth && !optional) {
        if (char !== "(") return false;
        const inner = branch.slice(index + 1, end - 1).replace(/^\?(?::|<[A-Za-z_$][\w$]*>)/, "");
        if (!canMatchEmpty(inner)) return false;
      }
      index = after > index ? after : index + 1;
    }
    return true;
  });
}

/**
 * Every group in the pattern, with how many times the engine may run it in total.
 *
 * "In total" is what matters and what a single pass cannot see: a group's own quantifier is written
 * after its closing paren, and its enclosing groups' quantifiers come later still. `((a|a){8}){8}`
 * carries nothing worse than an 8 anywhere in it and runs the ambiguous branch 64 times.
 */
interface GroupSpan {
  start: number;
  end: number;
  ceiling: number;
  lookaround: boolean;
}

function scanGroups(pattern: string): GroupSpan[] {
  const openStack: number[] = [];
  const spans: GroupSpan[] = [];
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
    if (char !== ")") continue;

    const start = openStack.pop();
    if (start === undefined) continue;
    spans.push({
      start,
      end: index,
      ceiling: repetitionCeiling(pattern, index + 1),
      lookaround: /^\(\?<?[=!]/.test(pattern.slice(start))
    });
  }
  return spans;
}

/**
 * How many times an ambiguous group may run before the cost stops being worth arguing about.
 *
 * The first version of this guard asked only whether a group repeated more than once, which read
 * `(cat|dog){2}` and `(\d{1,3}\.){3}\d{1,3}` -- the canonical IPv4 pattern -- as dangerous. They
 * are not: an ambiguous branch run n times explores at most 2^n paths per starting position, and
 * at 8 that is 256, which against the 400-character ceiling above is nothing. The patterns that
 * freeze a tab are the ones with a large or unbounded count, and those are what this catches.
 */
const AMBIGUITY_BUDGET = 8;

/**
 * Finds a group the engine may run enough times for an ambiguous body to matter.
 *
 * Reports which shape it found so the message can name it: `nested` for `(a+)+`, where the body
 * already repeats; `alternation` for `(a|a)+`, where two branches can match the same text; and
 * `nullable` for `(a?){200}`, where the body can match nothing at all and the engine has to try
 * every way of distributing the empty iterations.
 *
 * Works from group spans rather than pattern-matching on text, so an escaped paren or one inside a
 * character class cannot be mistaken for a real group boundary -- and so a group's total repetition
 * can account for the quantifiers on the groups around it, which are written after it in the source
 * and so are invisible to a single left-to-right pass.
 */
function repeatedGroupRisk(pattern: string): "nested" | "alternation" | "nullable" | null {
  const spans = scanGroups(pattern);

  for (const span of spans) {
    if (span.lookaround) {
      // Zero-width: a quantifier on it repeats nothing, and its branches cannot consume the same
      // text twice. `(?=a|b)+` is valid and harmless.
      continue;
    }

    let total = span.ceiling;
    for (const outer of spans) {
      if (outer !== span && outer.start < span.start && outer.end > span.end) {
        total *= outer.ceiling;
      }
    }
    if (total <= AMBIGUITY_BUDGET) {
      continue;
    }

    const body = pattern.slice(span.start + 1, span.end);
    if (hasRepetitionAnywhere(body)) {
      return "nested";
    }
    if (canMatchEmpty(body)) {
      return "nullable";
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
  if (risk === "nullable") {
    return {
      reason:
        "a repeated group that can match nothing has too many ways to match the same text and " +
        "can freeze the page"
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
