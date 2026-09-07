import assert from "node:assert/strict";
import { test } from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

test("Trusted Types returns a trusted value and preserves policy rejection", async () => {
  const { createTrustedHtmlPolicy } = await importSourceModule("src/platform/trusted-types.ts", { fresh: true });
  const originalWindow = globalThis.window;
  const policyCalls = [];
  globalThis.window = {
    trustedTypes: {
      createPolicy(name, rules) {
        policyCalls.push(name);
        return {
          createHTML(input) {
            if (input.includes("<script")) {
              throw new Error("policy rejected executable markup");
            }
            return { kind: "TrustedHTML", value: rules.createHTML(input) };
          }
        };
      }
    }
  };

  try {
    const policy = createTrustedHtmlPolicy("aviary-test");
    const trusted = policy.html("<p>safe</p>");
    assert.deepEqual(trusted, { kind: "TrustedHTML", value: "<p>safe</p>" });
    assert.deepEqual(policyCalls, ["aviary-test"]);
    assert.throws(
      () => policy.html("<script>alert(1)</script>"),
      /policy rejected executable markup/
    );
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Trusted Types fallback is an explicit string passthrough when unavailable", async () => {
  const { createTrustedHtmlPolicy } = await importSourceModule("src/platform/trusted-types.ts", { fresh: true });
  const originalWindow = globalThis.window;
  const input = "<p>the browser has no Trusted Types factory</p>";
  globalThis.window = {};

  try {
    const result = createTrustedHtmlPolicy().html(input);
    assert.equal(result, input, "fallback intentionally returns the input string unchanged");
    assert.equal(typeof result, "string", "the fallback degradation is a string passthrough");
  } finally {
    globalThis.window = originalWindow;
  }
});
