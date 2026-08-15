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

export interface CompiledRule {
  source: string;
  action: Extract<FilterDecision, "hide" | "dim">;
  combinator: "and" | "or";
  conditions: RuleCondition[];
}

export interface RuleParseError {
  source: string;
  line: number;
  message: string;
}

export interface CompiledRuleSet {
  rules: CompiledRule[];
  errors: RuleParseError[];
}

const MEDIA_VALUES = new Set<FilterMediaKey>(["photo", "video", "gif"]);
const BOOLEAN_FIELDS = new Set<RuleField>(["verified", "link"]);
const MAX_RULES = 100;

export function compileRules(lines: readonly string[]): CompiledRuleSet {
  const rules: CompiledRule[] = [];
  const errors: RuleParseError[] = [];

  lines.slice(0, MAX_RULES).forEach((raw, index) => {
    const source = raw.trim();
    if (source.length === 0 || source.startsWith("#")) {
      return;
    }
    try {
      rules.push(parseRule(source));
    } catch (error) {
      errors.push({
        source,
        line: index + 1,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return { rules, errors };
}

function parseRule(source: string): CompiledRule {
  let body = source;
  let action: CompiledRule["action"] = "hide";
  const prefix = /^(hide|dim)\s*:\s*/i.exec(body);
  if (prefix?.[1]) {
    action = prefix[1].toLowerCase() === "dim" ? "dim" : "hide";
    body = body.slice(prefix[0].length);
  }

  const parts = splitOnConnective(body);
  const conditions = parts.clauses.map((clause) => parseCondition(clause));
  if (conditions.length === 0) {
    throw new Error("a rule needs at least one condition");
  }
  return { source, action, combinator: parts.combinator, conditions };
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
