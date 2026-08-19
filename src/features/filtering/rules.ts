import { checkRegexBudget } from "./regex-budget";
import type { FilterMediaKey } from "../../platform/settings";
import type { FilterDecision, FilterInput } from "./predicates";

/**
 * A small rule language for the timeline filter.
 *
 * The engine's existing rules are fixed kinds — keywords, regexes, media types, premium — so
 * anything they do not express cannot be filtered at all. Every comparable tool (RES's
 * filteReddit, Control Panel for Twitter, rxliuli's Feed Filter) offers field/operator/value rules
 * instead, and it is the one structural gap in this feature.
 *
 * One rule per line, so the whole set round-trips through the existing settings export as plain
 * text and can be shared as-is:
 *
 *   text contains crypto
 *   dim: handle is someaccount and media is video
 *   text matches /free .*airdrop/i or text contains giveaway
 *   handle not is myfriend and text contains sale
 *
 * Only fields the DOM signal actually carries are accepted. A rule naming anything else is a parse
 * error reported back to the panel rather than a filter that silently never matches — the failure
 * mode this repository has fixed repeatedly elsewhere.
 */

export const RULE_FIELDS = ["text", "handle", "media", "verified", "link"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPERATORS = ["contains", "is", "starts", "ends", "matches"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  value: string;
  negate: boolean;
  /** Compiled once at parse time; `matches` without a valid pattern is a parse error. */
  pattern?: RegExp;
}

/**
 * How long a rule lasts, kept as the window the user chose plus the instant it started, rather
 * than as a bare deadline. Storing the window is what makes "renew" a one-click operation: the
 * start moves to now and the rule's own duration decides the rest.
 */
export interface RuleWindow {
  amount: number;
  unit: "h" | "d";
  startedAt: number;
}

export interface CompiledRule {
  source: string;
  /** What the user called this rule. Null for the untitled rules that predate the syntax. */
  title: string | null;
  action: Extract<FilterDecision, "hide" | "dim">;
  combinator: "and" | "or";
  conditions: RuleCondition[];
  /** The window this rule lives in, or null when it never expires. */
  window: RuleWindow | null;
  /** When the window closes. Null when there is no window. */
  expiresAt: number | null;
}

export interface RuleParseError {
  source: string;
  line: number;
  message: string;
}

export interface CompiledRuleSet {
  /** The rules that are in force right now. Expired ones are not here. */
  rules: CompiledRule[];
  /**
   * Rules whose window has closed. They keep applying to nothing and are never deleted -- an
   * expired rule the user forgot about is a rule they can renew, and a rule that vanished is one
   * they cannot.
   */
  expired: CompiledRule[];
  errors: RuleParseError[];
  /**
   * The next instant at which this set changes on its own, so the engine knows when to recompile
   * without asking the clock once per post.
   */
  nextExpiry: number | null;
}

const MEDIA_VALUES = new Set<FilterMediaKey>(["photo", "video", "gif"]);
const BOOLEAN_FIELDS = new Set<RuleField>(["verified", "link"]);
const MAX_RULES = 100;

export function compileRules(lines: readonly string[], now = Date.now()): CompiledRuleSet {
  const rules: CompiledRule[] = [];
  const expired: CompiledRule[] = [];
  const errors: RuleParseError[] = [];
  let nextExpiry: number | null = null;

  lines.slice(0, MAX_RULES).forEach((raw, index) => {
    const source = raw.trim();
    if (source.length === 0 || source.startsWith("#")) {
      return;
    }
    try {
      const rule = parseRule(source);
      if (rule.expiresAt !== null && rule.expiresAt <= now) {
        expired.push(rule);
        return;
      }
      if (rule.expiresAt !== null && (nextExpiry === null || rule.expiresAt < nextExpiry)) {
        nextExpiry = rule.expiresAt;
      }
      rules.push(rule);
    } catch (error) {
      errors.push({
        source,
        line: index + 1,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return { rules, expired, errors, nextExpiry };
}

/**
 * The optional header a rule may carry, ahead of its conditions:
 *
 *   [Crypto noise] dim for 7d from 2026-08-19T10:00:00.000Z: text contains crypto
 *
 * Every part is optional and old rules have none of them. A leading `[...]` is unambiguous — a
 * condition always starts with a bare word — and the rest is only read when the line carries the
 * colon that separates a header from the conditions, which is the same colon `dim:` already used.
 *
 * The window is written as its duration plus the instant it started rather than as a deadline, so
 * that renewing a rule is a matter of moving the start rather than recomputing what the user
 * originally asked for.
 */
// The instant is matched greedily: an ISO timestamp contains colons of its own, so a lazy match
// would stop at "2026-08-19T10" and read the rest of the time as conditions.
const RULE_HEADER = /^(?:(hide|dim)\b\s*)?(?:for\s+(\d+)\s*([hd])\s+from\s+(\S+)\s*)?:\s*/i;

function parseRule(source: string): CompiledRule {
  let body = source;
  let title: string | null = null;

  if (body.startsWith("[")) {
    const close = body.indexOf("]");
    if (close < 0) {
      throw new Error("a rule title needs a closing ]");
    }
    title = body.slice(1, close).trim();
    if (title.length === 0) {
      throw new Error("a rule title cannot be empty; drop the brackets instead");
    }
    body = body.slice(close + 1).trim();
    if (body.length === 0) {
      throw new Error("a titled rule still needs conditions");
    }
  }

  let action: CompiledRule["action"] = "hide";
  let window: RuleWindow | null = null;
  const header = RULE_HEADER.exec(body);
  if (header) {
    if (header[1]) {
      action = header[1].toLowerCase() === "dim" ? "dim" : "hide";
    }
    if (header[2] && header[3] && header[4]) {
      window = parseWindow(header[2], header[3], header[4]);
    }
    body = body.slice(header[0].length);
  }

  const parts = splitOnConnective(body);
  const conditions = parts.clauses.map((clause) => parseCondition(clause));
  if (conditions.length === 0) {
    throw new Error("a rule needs at least one condition");
  }
  return {
    source,
    title,
    action,
    combinator: parts.combinator,
    conditions,
    window,
    expiresAt: window ? windowEnd(window) : null
  };
}

const HOUR_MS = 60 * 60 * 1000;

export function windowEnd(window: RuleWindow): number {
  return window.startedAt + window.amount * (window.unit === "d" ? 24 : 1) * HOUR_MS;
}

function parseWindow(amount: string, unit: string, from: string): RuleWindow {
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error(`"${amount}${unit}" is not a duration between 1h and 3650d`);
  }
  const startedAt = Date.parse(from);
  if (Number.isNaN(startedAt)) {
    throw new Error(`"${from}" is not a date Aviary can read; use an ISO instant`);
  }
  return { amount: value, unit: unit.toLowerCase() === "d" ? "d" : "h", startedAt };
}

/**
 * The same rule, its window restarted at `now`. Returns the line unchanged when it has no window,
 * so a caller can renew a whole set without deciding which lines carry one.
 */
export function renewRuleLine(source: string, now = Date.now()): string {
  return source.replace(
    /(for\s+\d+\s*[hd]\s+from\s+)(\S+)(\s*:)/i,
    (_match, head: string, _instant: string, tail: string) =>
      `${head}${new Date(now).toISOString()}${tail}`
  );
}

/** Writes the header a panel control produces, for a rule the user is giving a window to. */
export function withRuleWindow(source: string, amount: number, unit: "h" | "d", now = Date.now()): string {
  const stripped = renewRuleLine(source, now);
  if (stripped !== source) {
    return stripped.replace(/for\s+\d+\s*[hd]\s+from/i, `for ${amount}${unit} from`);
  }
  const titled = /^(\[[^\]]*\]\s*)?/.exec(source);
  const head = titled?.[1] ?? "";
  let rest = source.slice(head.length);
  let action = "hide";
  const existing = /^(hide|dim)\s*:\s*/i.exec(rest);
  if (existing?.[1]) {
    action = existing[1].toLowerCase();
    rest = rest.slice(existing[0].length);
  }
  return `${head}${action} for ${amount}${unit} from ${new Date(now).toISOString()}: ${rest}`;
}

/**
 * Splits on a single connective. Mixing `and` with `or` is rejected rather than guessed at:
 * without parentheses there is no precedence a reader and the engine would agree on.
 */
function splitOnConnective(body: string): { clauses: string[]; combinator: "and" | "or" } {
  const tokens = body.split(/\s+(and|or)\s+/i);
  const clauses: string[] = [];
  const connectives: string[] = [];
  tokens.forEach((token, index) => {
    if (index % 2 === 0) clauses.push(token);
    else connectives.push(token.toLowerCase());
  });
  const unique = new Set(connectives);
  if (unique.size > 1) {
    throw new Error("mixing 'and' with 'or' needs two separate rules");
  }
  return { clauses, combinator: connectives[0] === "or" ? "or" : "and" };
}

function parseCondition(clause: string): RuleCondition {
  const trimmed = clause.trim();
  if (trimmed.length === 0) {
    throw new Error("empty condition");
  }
  const match = /^(\w+)\s+(?:(not)\s+)?(\w+)\s+(.+)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`could not read "${trimmed}"; expected: field [not] operator value`);
  }
  const [, rawField, negate, rawOperator, rawValue] = match;

  const field = String(rawField).toLowerCase() as RuleField;
  if (!RULE_FIELDS.includes(field)) {
    throw new Error(`unknown field "${rawField}"; use one of ${RULE_FIELDS.join(", ")}`);
  }
  const operator = String(rawOperator).toLowerCase() as RuleOperator;
  if (!RULE_OPERATORS.includes(operator)) {
    throw new Error(`unknown operator "${rawOperator}"; use one of ${RULE_OPERATORS.join(", ")}`);
  }

  const value = unquote(String(rawValue).trim());
  if (value.length === 0) {
    throw new Error("a condition needs a value");
  }

  const condition: RuleCondition = { field, operator, value, negate: Boolean(negate) };

  if (field === "media" && !MEDIA_VALUES.has(value.toLowerCase() as FilterMediaKey)) {
    throw new Error(`media takes photo, video, or gif — not "${value}"`);
  }
  if (BOOLEAN_FIELDS.has(field) && !["true", "false"].includes(value.toLowerCase())) {
    throw new Error(`${field} takes true or false — not "${value}"`);
  }
  if (operator === "matches") {
    condition.pattern = compilePattern(value);
  }
  return condition;
}

function unquote(value: string): string {
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted?.[1] ?? value;
}

function compilePattern(value: string): RegExp {
  const delimited = /^\/(.+)\/([a-z]*)$/i.exec(value);
  const body = delimited?.[1] ?? value;
  const rawFlags = delimited?.[2] ?? "";
  const flags = new Set(["i"]);
  for (const flag of rawFlags.toLowerCase()) {
    if (["i", "m", "s", "u"].includes(flag)) flags.add(flag);
  }
  const budget = checkRegexBudget(body);
  if (budget.reason !== null) {
    throw new Error(`"${value}" is refused: ${budget.reason}`);
  }
  try {
    return new RegExp(body, [...flags].join(""));
  } catch {
    throw new Error(`"${value}" is not a valid regular expression`);
  }
}

export interface RuleSignal extends FilterInput {
  /** Whether the post's own text carries an outbound link. */
  hasLink: boolean;
}

export function evaluateRules(signal: RuleSignal, rules: readonly CompiledRule[]): FilterDecision {
  // "hide" wins over "dim" when both match: the stronger action is the one the user asked for.
  let decision: FilterDecision = "show";
  for (const rule of rules) {
    const results = rule.conditions.map((condition) => matches(signal, condition));
    const matched = rule.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
    if (!matched) {
      continue;
    }
    if (rule.action === "hide") {
      return "hide";
    }
    decision = "dim";
  }
  return decision;
}

function matches(signal: RuleSignal, condition: RuleCondition): boolean {
  const result = evaluateCondition(signal, condition);
  return condition.negate ? !result : result;
}

function evaluateCondition(signal: RuleSignal, condition: RuleCondition): boolean {
  if (condition.field === "media") {
    const key = condition.value.toLowerCase() as FilterMediaKey;
    return signal.media[key] === true;
  }
  if (condition.field === "verified") {
    return signal.premium === (condition.value.toLowerCase() === "true");
  }
  if (condition.field === "link") {
    return signal.hasLink === (condition.value.toLowerCase() === "true");
  }

  const haystack = condition.field === "handle" ? (signal.handle ?? "") : signal.text;
  if (condition.field === "handle" && signal.handle === null) {
    // A rule about the author cannot match a post whose author could not be read.
    return false;
  }
  return compare(haystack, condition);
}

function compare(haystack: string, condition: RuleCondition): boolean {
  if (condition.operator === "matches") {
    const pattern = condition.pattern;
    if (!pattern) return false;
    pattern.lastIndex = 0;
    return pattern.test(haystack);
  }
  const value = condition.value.toLowerCase();
  const subject = haystack.toLowerCase().replace(/^@/, "");
  switch (condition.operator) {
    case "contains":
      return subject.includes(value);
    case "is":
      return subject === value.replace(/^@/, "");
    case "starts":
      return subject.startsWith(value);
    case "ends":
      return subject.endsWith(value);
    default:
      return false;
  }
}
