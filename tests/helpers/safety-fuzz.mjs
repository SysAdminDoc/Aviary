/**
 * Small deterministic corpora for the two user-input parsers with a page-wide blast radius.
 * Keep the seed in the test output so a future reducer can be replayed exactly.
 */

export const CSS_FUZZ_SEED = 0x51f15eed;
export const REGEX_FUZZ_SEED = 0x4f9e2d31;
export const SAFETY_FUZZ_CASES = 10_000;

function random32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)] ?? values[0];
}

const SELECTORS = [
  ".card",
  ".card > p",
  '[data-testid="tweet"]',
  '[data-x="1"] > p',
  ":is(.card, .note)",
  ".card + .note"
];

const COLORS = ["red", "#4f46e5", "rgb(20, 30, 40)", "color-mix(in srgb, red 50%, blue)"];

/**
 * Mutations intentionally include both ordinary CSS and hostile syntax. The latter is valuable
 * because a sanitizer that only rejects the handful of hand-written fixtures can still accept a
 * tokenizer edge case reached through comments, escapes, or nested functions.
 */
export function generateCssFuzzCorpus(count = SAFETY_FUZZ_CASES, seed = CSS_FUZZ_SEED) {
  const random = random32(seed);
  const families = [
    "comments",
    "escapes",
    "nested-functions",
    "selector-lists",
    "nested-at-rules",
    "strings",
    "network-hooks",
    "malformed"
  ];
  const corpus = [];

  for (let index = 0; index < count; index += 1) {
    const family = families[index % families.length];
    const selector = pick(random, SELECTORS);
    const color = pick(random, COLORS);
    const suffix = `${index % 17}`;
    let source;

    switch (family) {
      case "comments":
        source = `${index % 2 ? "/* open */" : "/* { } ; */"} ${selector} { color: ${color}; } /* tail ${suffix} */`;
        break;
      case "escapes":
        source = index % 3 === 0
          ? `${selector}::before { content: "\\2192 ${suffix}"; }`
          : `${selector} { background: \\75 72\\6c(\"https://evil.example/${suffix}.png\"); }`;
        break;
      case "nested-functions": {
        const value = pick(random, [
          `color-mix(in srgb, ${color} 50%, blue)`,
          `calc(100% - ${index % 31}px)`,
          `var(--av-test-${index % 5}, ${color})`,
          `image-set(\"https://evil.example/${suffix}.png\" 1x)`,
          `cross-fade(image-set(\"https://evil.example/${suffix}.png\" 1x), ${color}, 50%)`,
          "paint(aviary-test)"
        ]);
        source = `${selector} { background: ${value}; }`;
        break;
      }
      case "selector-lists":
        source = `${selector}, ${pick(random, SELECTORS)} > ${pick(random, ["span", "p", ".label"])} { color: ${color}; }`;
        break;
      case "nested-at-rules":
        source = `@${index % 2 ? "supports (display: grid)" : `media (min-width: ${index % 401}px)`} { ${selector} { color: ${color}; } }`;
        break;
      case "strings":
        source = `${selector}::after { content: "value ${index % 2 ? '\\"quoted\\"' : '\\7b not-a-block \\7d'}"; }`;
        break;
      case "network-hooks":
        source = pick(random, [
          `@import url(https://evil.example/${suffix}.css);`,
          `${selector} { background: url(https://evil.example/${suffix}.png); }`,
          `${selector} { background: image-set(\"https://evil.example/${suffix}.png\" 1x); }`,
          `${selector} { src: \"https://evil.example/${suffix}.woff2\"; }`,
          `${selector} { background: paint(aviary-test); }`,
          `@font-face { src: url(https://evil.example/${suffix}.woff2); }`
        ]);
        break;
      case "malformed":
        source = pick(random, [
          `${selector} { color: ${color};`,
          `${selector} color: ${color}; }`,
          `${selector} { content: \"unterminated; }`,
          `${selector} { color: ${color}; }} #outside { outline: 1px solid red; }`,
          `@media (min-width: 1px) { ${selector} { color: ${color}; }`
        ]);
        break;
      default:
        source = `${selector} { color: ${color}; }`;
    }

    corpus.push({ id: `css-${index}`, family, source });
  }
  return corpus;
}

const WORDS = ["crypto", "giveaway", "airdrop", "number", "post", "spam"];

export function generateRegexFuzzCorpus(count = SAFETY_FUZZ_CASES, seed = REGEX_FUZZ_SEED) {
  const random = random32(seed);
  const families = [
    "literal",
    "escape",
    "nested-quantifier",
    "lookaround",
    "backreference",
    "alternation",
    "character-class",
    "invalid"
  ];
  const corpus = [];

  for (let index = 0; index < count; index += 1) {
    const family = families[index % families.length];
    const word = pick(random, WORDS);
    const countA = 1 + (index % 12);
    let source;

    switch (family) {
      case "literal":
        source = `${word}-${index % 19}`;
        break;
      case "escape":
        source = index % 2 ? `\\b(?:${word}|nft)\\b` : `\\x${index % 2 ? "61" : "62"}+`;
        break;
      case "nested-quantifier":
        source = pick(random, [
          `(a+)+${index % 2 ? "b" : "$"}`,
          `(a?){${index % 2 ? 200 : countA}}b`,
          `(\\w+\\s){${index % 4 + 1}}${word}`,
          `(\\d{1,3}\\.){${index % 4 + 1}}\\d{1,3}`
        ]);
        break;
      case "lookaround":
        source = pick(random, [
          `(?=${word}|nft)+`,
          `(?!spam|scam)+${word}`,
          `(?<=${word})\\s+post`,
          `(?<!${word})${word}`
        ]);
        break;
      case "backreference":
        source = pick(random, [
          `(${word})\\1`,
          `(?<capture>${word}+)\\k<capture>`,
          `(?:([a-z])\\1){${index % 4 + 1}}`
        ]);
        break;
      case "alternation":
        source = pick(random, [
          `(cat|dog){${index % 9 + 1}}`,
          `(a|a){${index % 18 + 1}}$`,
          `(?:${word}|nft|token)`
        ]);
        break;
      case "character-class":
        source = pick(random, [`[a-z]{${index % 12 + 1}}`, `[^\\n]{${index % 5 + 1}}`, `[${word[0] ?? "a"}-z]+`]);
        break;
      case "invalid":
        source = pick(random, ["(", "[unclosed", "(?<bad>", `\\u{${index % 32}`]);
        break;
      default:
        source = word;
    }

    corpus.push({ id: `regex-${index}`, family, source });
  }
  return corpus;
}

/** Reduced cases are kept permanently once a fuzz run exposes them. */
export const CSS_REDUCER_FIXTURES = [
  { family: "escaped-function", source: '.card { background: \\75 72\\6c("https://evil.example/x.png"); }', expected: "reject" },
  { family: "nested-network-function", source: '.card { background: cross-fade(image-set("https://evil.example/x.png" 1x), red, 50%); }', expected: "reject" },
  { family: "newline-brace", source: '.card { content: "x\n}\n}\n#outside { outline: 1px solid red; }\n"; }', expected: "reject" },
  { family: "selector-list", source: ".card, .note > p { color: red; }", expected: "accept" }
];

export const REGEX_REDUCER_FIXTURES = [
  { family: "wrapped-overlap", source: "((a|a))+$", expected: "reject" },
  { family: "nullable-repeat", source: "(a?){200}b", expected: "reject" },
  { family: "bounded-varying-repeat", source: "(a{1,3}){3}b", expected: "accept" },
  { family: "lookaround", source: "(?=a|b)+", expected: "accept" },
  { family: "backreference", source: "(?<capture>a+)\\k<capture>", expected: "accept" }
];
