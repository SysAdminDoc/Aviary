import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Loads the background service worker against a stubbed `chrome`.
 *
 * `stored` is deliberately a caller-supplied object: passing the same one to two loads is how a
 * service-worker restart is reproduced -- the new worker has no memory of anything except what was
 * written to `storage.local`, which is the whole reason the download tracking is persisted.
 */
export async function loadBackground({ stored = {}, granted = true } = {}) {
  const downloads = [];
  const tabMessages = [];
  const pending = new Set();
  let onMessage;
  let onDownloadChanged;
  let nextId = 1;

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { onMessage = listener; } }
    },
    action: { onClicked: { addListener() {} } },
    contextMenus: {
      create() {},
      removeAll(callback) { callback?.(); },
      onClicked: { addListener() {} }
    },
    permissions: {
      async contains() { return granted; },
      async request() { return granted; }
    },
    tabs: {
      async sendMessage(tabId, message) {
        tabMessages.push({ tabId, message });
      }
    },
    downloads: {
      async download(options) {
        downloads.push(options);
        return nextId++;
      },
      onChanged: { addListener(listener) { onDownloadChanged = listener; } }
    },
    storage: {
      local: {
        async get(key) { return { [key]: stored[key] }; },
        async set(items) { Object.assign(stored, structuredClone(items)); }
      }
    }
  };

  await importBundledModule("src/entrypoints/extension-background.ts");

  return {
    downloads,
    tabMessages,
    stored,
    onDownloadChanged: (delta) => {
      const before = tabMessages.length;
      onDownloadChanged(delta);
      pending.add(before);
    },
    send: (message, sender = {}) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no response to ${JSON.stringify(message)}`)),
          2000
        );
        const async = onMessage(message, sender, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
        if (async !== true) {
          clearTimeout(timer);
          resolve(undefined);
        }
      }),
    /** The worker's listeners are fire-and-forget; give their promise chains a turn to run. */
    settled: async () => {
      for (let i = 0; i < 12; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-background-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?v=${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
