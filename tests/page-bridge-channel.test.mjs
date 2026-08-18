import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The control channel between the isolated world and the page-world agent.
 *
 * The handshake has to start on the window, because that is the only surface the page-world agent
 * can be reached from. Everything after it does not: the `hello` transfers a `MessagePort`, and a
 * port is neither readable from the page nor postable to without the reference. Before that, the
 * session nonce rode every envelope on a bus any page script could listen to, so catching one was
 * enough to replay `config` and switch the default-on ad guard off, or `teardown` and remove the
 * agent outright.
 *
 * `page.evaluate` runs in the page's own world, which is exactly the attacker's position here.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-bridge-channel-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { installPageAgent, uninstallPageAgent, readAgentConfig, PAGE_CHANNEL } from ${JSON.stringify(abs("src/page/page-agent.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryAgent",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * Installs the agent and completes a handshake that transfers a control port, the way the bridge
 * does. Returns the nonce a page observer would have been able to read off the window.
 */
async function handshake() {
  return page.evaluate(async () => {
    AviaryAgent.uninstallPageAgent();
    const nonce = "nonce-abcdefghijklmnop";
    const channel = new MessageChannel();
    const received = [];
    channel.port1.onmessage = (event) => received.push(event.data);
    channel.port1.start();

    AviaryAgent.installPageAgent(window);
    window.postMessage(
      { channel: AviaryAgent.PAGE_CHANNEL, kind: "hello", nonce, payload: undefined },
      "*",
      [channel.port2]
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    window.__aviaryTest = { nonce, port: channel.port1, received };
    return { nonce, ready: received.some((entry) => entry?.kind === "ready") };
  });
}

test("the agent answers over the transferred port, not the window", async () => {
  const result = await handshake();
  assert.equal(result.ready, true, "the handshake must complete on the port");
});

test("a page script that captured the nonce cannot switch ad protection off", async () => {
  await handshake();

  const config = await page.evaluate(async () => {
    const { nonce, port } = window.__aviaryTest;

    // Exactly what a page script could do: it saw the hello go past and knows the nonce.
    window.postMessage(
      { channel: AviaryAgent.PAGE_CHANNEL, kind: "config", nonce, payload: { blockAds: false, blockBeacons: false } },
      "*"
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterForged = AviaryAgent.readAgentConfig();

    // The isolated world holds the port, and its config is still honoured.
    port.postMessage({
      channel: AviaryAgent.PAGE_CHANNEL,
      kind: "config",
      nonce,
      payload: { blockAds: false, blockBeacons: true }
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterLegitimate = AviaryAgent.readAgentConfig();

    return { afterForged, afterLegitimate };
  });

  assert.equal(config.afterForged.blockAds, true, "a forged window config must be ignored");
  assert.equal(config.afterForged.blockBeacons, false, "and must not turn beacon refusal on either");
  assert.equal(config.afterLegitimate.blockAds, false, "the port holder must still be obeyed");
  assert.equal(config.afterLegitimate.blockBeacons, true);
});

test("a page script cannot tear the agent down", async () => {
  await handshake();

  const alive = await page.evaluate(async () => {
    const { nonce } = window.__aviaryTest;
    window.postMessage(
      { channel: AviaryAgent.PAGE_CHANNEL, kind: "teardown", nonce, payload: undefined },
      "*"
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    return AviaryAgent.readAgentConfig() !== undefined;
  });

  assert.equal(alive, true, "teardown must not be reachable from the page window");
});

test("a second hello cannot displace the standing channel", async () => {
  await handshake();

  const result = await page.evaluate(async () => {
    // A squatter arriving late with its own port, trying to become the control peer.
    const squatter = new MessageChannel();
    const seen = [];
    squatter.port1.onmessage = (event) => seen.push(event.data);
    squatter.port1.start();
    window.postMessage(
      { channel: AviaryAgent.PAGE_CHANNEL, kind: "hello", nonce: "squatter-abcdefghijkl", payload: undefined },
      "*",
      [squatter.port2]
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    squatter.port1.postMessage({
      channel: AviaryAgent.PAGE_CHANNEL,
      kind: "teardown",
      nonce: "squatter-abcdefghijkl",
      payload: undefined
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    return { adopted: seen.length > 0, alive: AviaryAgent.readAgentConfig() !== undefined };
  });

  assert.equal(result.adopted, false, "a later hello must not be answered");
  assert.equal(result.alive, true, "and must not be able to tear the agent down");
});
