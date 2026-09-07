import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { assertCurrentExtensionBuild } from "../../tools/settings-visual-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionDir = path.join(root, "dist", "extension-chrome");

if (!existsSync(extensionDir)) {
  console.error("Build the extension first: `npm run build`.");
  process.exit(2);
}

await assertCurrentExtensionBuild(extensionDir);

let commandId = 0;

/** Send one CDP command to a target created in an isolated private browser context. */
async function sendToTarget(cdp, sessionId, method, params = {}) {
  const id = ++commandId;
  const result = new Promise((resolve, reject) => {
    const onEvent = (event) => {
      if (
        event.method !== "Target.receivedMessageFromTarget" ||
        event.params.sessionId !== sessionId
      ) {
        return;
      }
      const message = JSON.parse(event.params.message);
      if (message.id !== id) return;
      cdp.off("event", onEvent);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    cdp.on("event", onEvent);
  });
  await cdp.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({ id, method, params })
  });
  return result;
}

async function probe(extensionPath) {
  const userData = await mkdtemp(path.join(tmpdir(), "aviary-incognito-smoke-"));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    // Ask Chrome to make the unpacked package available in private contexts. A manifest with
    // incognito: not_allowed must still be refused by Chrome, while the control package below
    // proves the harness can run the same content script when that policy is absent.
    const extension = await cdp.send("Extensions.loadUnpacked", {
      path: extensionPath,
      enableInIncognito: true
    });
    // Give Chrome time to register the unpacked content script before the isolated target is
    // created. No regular X tab is needed, which avoids leaving a page-owned storage lease behind.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const created = await cdp.send("Target.createBrowserContext", {});
    const target = await cdp.send("Target.createTarget", {
      url: "https://x.com/incognito-smoke",
      browserContextId: created.browserContextId
    });
    const attached = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const state = await sendToTarget(cdp, attached.sessionId, "Runtime.evaluate", {
      expression: `(async () => ({
        ready: document.documentElement.dataset.avReady ?? null,
        local: Object.keys(localStorage).filter((key) => key.startsWith("aviary.")),
        session: Object.keys(sessionStorage).filter((key) => key.startsWith("aviary.")),
        databases: (await indexedDB.databases())
          .map((database) => database.name ?? "")
          .filter((name) => name.startsWith("aviary.")),
        bootNotice: document.querySelector("#av-boot-notice")?.shadowRoot?.textContent ?? ""
      }))()`,
      awaitPromise: true,
      returnByValue: true
    });
    return { id: extension.id, state: state.result?.value };
  } finally {
    await context.close();
    await rm(userData, { recursive: true, force: true });
  }
}

const controlExtension = await mkdtemp(path.join(tmpdir(), "aviary-incognito-control-"));
try {
  await cp(extensionDir, controlExtension, { recursive: true });
  const manifestPath = path.join(controlExtension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  delete manifest.incognito;
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  const declared = await probe(extensionDir);
  const control = await probe(controlExtension);
  assert.notEqual(declared.state?.ready, "true", "Aviary booted in a private window");
  assert.deepEqual(declared.state?.local, [], "private-window localStorage contains Aviary keys");
  assert.deepEqual(declared.state?.session, [], "private-window sessionStorage contains Aviary keys");
  assert.deepEqual(declared.state?.databases, [], "private-window IndexedDB contains Aviary databases");
  assert.equal(control.state?.ready, "true", `the control extension did not run in a private window: ${JSON.stringify(control.state)}`);
  console.log("[incognito-smoke] manifest policy blocked Aviary; control extension verified the private target.");
} finally {
  await rm(controlExtension, { recursive: true, force: true });
}
