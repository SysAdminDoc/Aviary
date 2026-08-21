import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { stopProcess, webdriverJson } from "./smoke/dnr-firefox.smoke.mjs";

test("Firefox WebDriver commands time out even when the transport ignores abort", async () => {
  const stalledFetch = async () => new Promise(() => {});
  const startedAt = Date.now();
  await assert.rejects(
    webdriverJson(
      "http://127.0.0.1:4444",
      "/session/example",
      { method: "DELETE" },
      20,
      stalledFetch
    ),
    /WebDriver request timed out after 20 ms/
  );
  assert.ok(Date.now() - startedAt < 100, "a stalled WebDriver command should fail promptly");
});

test("Firefox process cleanup cannot report success while the child is alive", async () => {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    kill() {
      return false;
    }
  });

  const startedAt = Date.now();
  await assert.rejects(
    stopProcess(child, {
      graceMs: 5,
      forceMs: 10,
      force: async () => false
    }),
    /did not exit after forced cleanup/
  );
  assert.ok(Date.now() - startedAt < 100, "a refused kill should fail promptly");
});

test("Firefox process cleanup waits for forced termination to be observed", async () => {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 12346,
    exitCode: null,
    signalCode: null,
    kill() {
      return false;
    }
  });

  await stopProcess(child, {
    graceMs: 5,
    forceMs: 50,
    force: async () => {
      setTimeout(() => {
        child.exitCode = 1;
        child.emit("exit", 1, null);
      }, 5);
      return true;
    }
  });
  assert.equal(child.exitCode, 1);
});
