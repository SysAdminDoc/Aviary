import tseslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
import globals from "globals";

const sourceFiles = ["src/**/*.ts", "tests/**/*.mjs", "tools/**/*.mjs", "eslint.config.mjs"];

/**
 * `toggleAttribute` writes the empty string, which is correct only for attributes whose mere
 * presence means true. Used on anything that carries a value it produces `attr=""`, which a
 * `[attr="1"]` selector never matches and which ARIA reads as the default rather than as true.
 * Both live instances of that bug shipped (a filtered post's row never collapsed, and a saving
 * transaction never announced itself busy), so the API is restricted to real HTML booleans.
 * A non-literal first argument is rejected too -- one of the two bugs passed a `const`.
 */
const HTML_BOOLEAN_ATTRIBUTES = [
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer",
  "disabled", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop", "multiple",
  "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed",
  "selected"
];

const toggleAttributeSelector = [
  'CallExpression[callee.property.name="toggleAttribute"]',
  ...HTML_BOOLEAN_ATTRIBUTES.map((name) => `:not([arguments.0.value="${name}"])`)
].join("");

export default [
  {
    ignores: ["dist/**", "node_modules/**", "_decoded/**", "work/**"]
  },
  {
    files: sourceFiles,
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      "constructor-super": "error",
      curly: ["error", "multi-line"],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-async-promise-executor": "error",
      "no-constant-binary-expression": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-duplicate-imports": "error",
      "no-fallthrough": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: toggleAttributeSelector,
          message:
            "toggleAttribute writes the empty string. Use setAttribute/removeAttribute for any attribute that carries a value (CSS selectors and ARIA booleans both need one), and pass a string literal when the attribute really is an HTML boolean."
        }
      ],
      "no-new-wrappers": "error",
      "no-promise-executor-return": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-throw-literal": "error",
      "no-unmodified-loop-condition": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      "no-var": "error",
      "object-shorthand": ["error", "always"],
      "prefer-const": "error",
      "no-console": "off",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as" }],
      "@typescript-eslint/no-array-constructor": "error",
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extra-non-null-assertion": "error",
      "@typescript-eslint/no-invalid-void-type": "error",
      "@typescript-eslint/no-misused-new": "error",
      "@typescript-eslint/no-namespace": "error",
      "@typescript-eslint/no-non-null-asserted-nullish-coalescing": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "@typescript-eslint/no-this-alias": "error",
      "@typescript-eslint/no-unnecessary-type-constraint": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "after-used", argsIgnorePattern: "^_", caughtErrors: "none", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-useless-constructor": "error",
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/triple-slash-reference": "error"
    }
  },
  {
    files: ["tests/**/*.mjs"],
    rules: {
      "no-promise-executor-return": "off",
      "@typescript-eslint/no-empty-function": "off"
    }
  },
  {
    files: ["src/types/**/*.d.ts"],
    rules: {
      "no-var": "off",
      "@typescript-eslint/no-invalid-void-type": "off"
    }
  }
];
