import {
  clearSessionAdRule,
  isAdRuleSyncMessage,
  pruneSessionAdRules,
  removeLegacyDynamicAdRule,
  syncSessionAdRule,
  type ExtensionAdRuleApi
} from "../extension/ad-rule.ts";
import {
  isBackgroundDiagnosticsRequest,
  readBackgroundDiagnostics,
  recordBackgroundDiagnostic
} from "../extension/background-diagnostics.ts";
import {
  DOWNLOAD_STATE_MESSAGE,
  isDownloadQueryMessage,
  type DownloadQueryResponse
} from "../extension/download-state.ts";
import {
  MEDIA_CONTEXT_DOWNLOAD_MESSAGE,
  MEDIA_CONTEXT_MENU_ID,
  MEDIA_CONTEXT_MENU_TITLE,
  MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE,
  X_DOCUMENT_PATTERNS,
  isSupportedXDocumentUrl
} from "../extension/media-context-menu.ts";
import {
  handleDurableStorageRequest,
  isDurableStorageRequest
} from "../extension/durable-storage-api.ts";
import { createIndexedDbStorageBackend } from "../platform/durable-storage.ts";
import {
  ExtensionStorageFenceAuthority,
  isExtensionStorageFenceRequest
} from "../extension/storage-fence.ts";

const runtime = globalThis.chrome?.runtime;
const extensionApi = globalThis.chrome as unknown as ExtensionAdRuleApi | undefined;
const contextMenus = globalThis.chrome?.contextMenus;
const tabs = globalThis.chrome?.tabs;
const scripting = (globalThis.chrome as typeof globalThis.chrome & {
  scripting?: {
    executeScript?(details: {
      target: { tabId: number };
      files: string[];
    }): Promise<unknown>;
  };
})?.scripting;
// The only IndexedDB constructor in the extension build. Content and options use the typed runtime
// protocol above, so their host/extension documents never open a second storage authority.
const durableStorageBackend = createIndexedDbStorageBackend();
const storageFenceAuthority = new ExtensionStorageFenceAuthority();
const DOWNLOAD_TRACKING_KEY = "aviary.downloadTracking.v2";
const DOWNLOAD_TERMINAL_KEY = "aviary.downloadTerminal.v1";
/** Bounded: every entry is one explicit user download, and each is cleared at its terminal state. */
const DOWNLOAD_TRACKING_LIMIT = 64;
/** Terminal receipts are retained so a fallback can answer for its original report id. */
const DOWNLOAD_TERMINAL_LIMIT = 64;
const PANEL_CHUNK_RESOURCE = "chunks/extension-panel.js";
/** One reconciliation per worker lifetime is enough; a failed pass may be retried by a lifecycle event. */
let sessionReconciliation: Promise<void> | null = null;
type BackgroundTaskCode =
  | "session-reconcile"
  | "context-menu-install"
  | "context-menu-startup"
  | "tab-close"
  | "tab-navigation"
  | "context-menu-download"
  | "download-completion"
  | "download-fallback";

/**
 * A download the browser accepted but has not finished.
 *
 * `downloads.download()` resolves as soon as the browser takes the request, which is a handoff and
 * not a saved file -- a transfer interrupted ten seconds later had already been reported as Saved.
 * This is what lets the terminal state get back to the tab that asked for it.
 *
 * `reportId` is the id the content script was told about. A fallback retry starts a *new* download
 * with a new id, so without it the tab would never hear the outcome of the transfer it is waiting
 * on.
 */
interface TrackedDownload {
  reportId: number;
  tabId: number | null;
  filename: string;
  fallbackUrls: string[];
}

interface TerminalDownloadReceipt {
  reportId: number;
  state: "complete" | "interrupted";
  error?: string;
  updatedAt: number;
}

const trackedDownloads = new Map<number, TrackedDownload>();
const terminalReceipts = new Map<number, TerminalDownloadReceipt>();
/** Terminal events can beat the async tracking write by one event-loop turn. */
const terminalBeforeTracking = new Map<number, { state: "complete" | "interrupted"; error?: string }>();
/** Prevent duplicate onChanged/search reports after a worker has already finalized an id. */
const handledTerminalIds = new Set<number>();
const terminalWork = new Map<number, Promise<void>>();
/** Keeps a terminal event from racing the storage write that records its tab and fallback list. */
const trackingWork = new Map<number, Promise<void>>();
/** Serializes read-modify-write tracking updates for concurrent downloads in one worker. */
let trackingStoreTail: Promise<void> = Promise.resolve();

/** Returned to the content script when `downloads` has not been granted yet. */
export const DOWNLOAD_PERMISSION_CODE = "downloads-permission-missing";

runtime?.onInstalled?.addListener(() => {
  // The old build owned one extension-global dynamic rule. Remove it on both install and update;
  // the first content script in each X tab installs its own session rule after resolving profile
  // settings. Session rules cannot be restored from a global preference without recreating the
  // very cross-tab race this migration fixes.
  scheduleSessionReconciliation("session-reconcile");
  settleBackgroundTask(installMediaContextMenu(), "context-menu-install");
});

runtime?.onStartup?.addListener(() => {
  // Session rules are not carried across browser sessions. Pruning still matters for a worker
  // restart, where session rules survive while a tab may have closed before the worker woke.
  scheduleSessionReconciliation("session-reconcile");
  settleBackgroundTask(installMediaContextMenu(), "context-menu-startup");
});

tabs?.onRemoved?.addListener((tabId) => {
  if (extensionApi) {
    settleBackgroundTask(clearSessionAdRule(extensionApi, tabId), "tab-close");
  }
});

tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  // `status: loading` covers reloads and same-tab navigations before a new content script can
  // reconcile. The URL check covers an already-loaded tab that leaves X without a loading event.
  if (
    !extensionApi ||
    (changeInfo.status !== "loading" &&
      (typeof changeInfo.url !== "string" || isSupportedXUrl(changeInfo.url)))
  ) {
    return;
  }
  settleBackgroundTask(clearSessionAdRule(extensionApi, tabId), "tab-navigation");
});

// No popup: the toolbar button opens the durable permission-management surface. The native media
// context-menu action can also request download access from its own explicit user gesture.
scheduleSessionReconciliation("session-reconcile");

globalThis.chrome?.action?.onClicked?.addListener(() => {
  void openOptions();
});

contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId !== MEDIA_CONTEXT_MENU_ID || typeof tab?.id !== "number") {
    return;
  }
  const tabId = tab.id;
  const documentUrl = typeof info.pageUrl === "string" ? info.pageUrl : tab.url;
  if (!isSupportedXDocumentUrl(documentUrl)) {
    return;
  }

  // `permissions.request()` has to begin inside a user gesture. Calling it synchronously from
  // the native context-menu click preserves that gesture; checking first with an awaited
  // `permissions.contains()` would lose it in some Chromium builds.
  let permissionRequest: Promise<boolean>;
  try {
    permissionRequest =
      globalThis.chrome?.permissions?.request({ permissions: ["downloads"] }) ??
      Promise.resolve(false);
  } catch {
    permissionRequest = Promise.resolve(false);
  }

  settleBackgroundTask(
    permissionRequest.then((granted) =>
      sendContextDownloadMessage(
        tabId,
        granted ? MEDIA_CONTEXT_DOWNLOAD_MESSAGE : MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE,
        documentUrl
      )
    ),
    "context-menu-download"
  );
});

globalThis.chrome?.downloads?.onChanged?.addListener((delta) => {
  if (delta.state?.current === "complete") {
    settleBackgroundTask(
      settleDownloadOnce(delta.id, () => finishDownload(delta.id, "complete")),
      "download-completion"
    );
  } else if (delta.state?.current === "interrupted") {
    settleBackgroundTask(
      settleDownloadOnce(delta.id, () => retryDownloadFallback(delta.id, delta.error?.current)),
      "download-fallback"
    );
  }
});

runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (isExtensionStorageFenceRequest(message)) {
    storageFenceAuthority.handle(message).then(
      (response) => sendResponse(response),
      (error: unknown) =>
        sendResponse({ ok: false, error: errorMessage(error), code: "storage-fence-lost" })
    );
    return true;
  }
  if (isDurableStorageRequest(message)) {
    if (!durableStorageBackend) {
      sendResponse({ ok: false, error: "Extension durable storage is unavailable" });
      return false;
    }
    handleDurableStorageRequest(message, durableStorageBackend, storageFenceAuthority).then(
      (response) => sendResponse(response),
      (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
  if (isBackgroundDiagnosticsRequest(message)) {
    readBackgroundDiagnostics(durableStorageBackend).then(
      (events) => sendResponse({ ok: true, events }),
      () => sendResponse({ ok: false, events: [], error: "Background diagnostics are unavailable" })
    );
    return true;
  }
  if (isAdRuleSyncMessage(message)) {
    if (!extensionApi) {
      sendResponse({ ok: false, enabled: message.enabled, error: "extension APIs unavailable" });
      return false;
    }
    // Content scripts get their owner from sender.tab. Privileged options pages may target a tab
    // explicitly, so an explicit id takes precedence when present.
    const tabId = message.tabId ?? tabIdOf(sender);
    if (tabId === undefined || tabId === null) {
      sendResponse({ ok: false, enabled: message.enabled, error: "tab context unavailable" });
      return false;
    }
    syncSessionAdRule(extensionApi, tabId, message.enabled).then(
      () => sendResponse({ ok: true, enabled: message.enabled }),
      (error: unknown) =>
        sendResponse({ ok: false, enabled: message.enabled, error: errorMessage(error) })
    );
    return true;
  }
  if (isType(message, "AVIARY_PING")) {
    sendResponse({ ok: true, product: "aviary" });
    return false;
  }
  if (isType(message, "AVIARY_LOAD_PANEL")) {
    const tabId = tabIdOf(sender);
    const resource = (message as { resource?: unknown }).resource;
    if (
      tabId === undefined ||
      tabId === null ||
      resource !== PANEL_CHUNK_RESOURCE ||
      !scripting?.executeScript
    ) {
      sendResponse({ ok: false, error: "Aviary panel injection is unavailable" });
      return false;
    }
    // A synchronous acknowledgement keeps the message channel compatible with the callback API
    // present at the Chromium floor. The content script then waits for the injected global, so an
    // in-flight or failed executeScript call cannot be mistaken for a ready panel.
    sendResponse({ ok: true });
    void scripting.executeScript({ target: { tabId }, files: [PANEL_CHUNK_RESOURCE] }).catch((error: unknown) => {
      console.error("[aviary] panel injection failed", errorMessage(error));
    });
    return false;
  }
  if (isType(message, "AVIARY_DOWNLOAD_CAPABILITY")) {
    hasDownloadPermission().then(
      (granted) => sendResponse({ ok: true, granted }),
      () => sendResponse({ ok: true, granted: false })
    );
    return true;
  }
  if (isDownloadQueryMessage(message)) {
    queryDownload(message.id).then(
      (response) => sendResponse(response),
      (error: unknown) =>
        sendResponse({ ok: false, id: message.id, error: errorMessage(error) })
    );
    return true;
  }
  if (isType(message, "AVIARY_OPEN_OPTIONS")) {
    openOptions().then(
      (opened) => sendResponse({ ok: opened }),
      (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
  if (isDownload(message)) {
    handleDownload(message, tabIdOf(sender)).then(
      (result) => sendResponse(result),
      (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
  return false;
});

function isType<T extends string>(message: unknown, type: T): message is { type: T } {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === type;
}

/** Reconciles legacy global state and removes rules for tabs no longer present. */
async function reconcileSessionRules(): Promise<void> {
  if (!extensionApi) {
    return;
  }
  await removeLegacyDynamicAdRule(extensionApi);
  const liveTabIds = await listLiveTabIds();
  if (liveTabIds === null) {
    return;
  }
  await pruneSessionAdRules(extensionApi, liveTabIds);
}

function scheduleSessionReconciliation(lifecycle: BackgroundTaskCode): void {
  if (sessionReconciliation) {
    return;
  }
  const task = reconcileSessionRules();
  sessionReconciliation = task.catch((error: unknown) => {
    sessionReconciliation = null;
    throw error;
  });
  settleBackgroundTask(sessionReconciliation, lifecycle);
}

async function listLiveTabIds(): Promise<number[] | null> {
  if (typeof tabs?.query !== "function") {
    return null;
  }
  try {
    const openTabs = await tabs.query({});
    return openTabs
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id >= 0);
  } catch {
    // Cleanup must not prevent content scripts from installing a fresh session rule.
    return null;
  }
}

function isSupportedXUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "pro.x.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

async function installMediaContextMenu(): Promise<void> {
  if (!contextMenus) {
    return;
  }

  // This extension owns one context-menu item. Clear first so unpacked reloads and updates cannot
  // leave duplicate entries behind; the callback form works on the Chrome 102 minimum as well as
  // Firefox, while newer Chromium also returns a Promise.
  await new Promise<void>((resolve) => {
    try {
      contextMenus.removeAll(() => resolve());
    } catch {
      resolve();
    }
  });

  contextMenus.create(
    {
      id: MEDIA_CONTEXT_MENU_ID,
      title: MEDIA_CONTEXT_MENU_TITLE,
      contexts: ["all"],
      documentUrlPatterns: [...X_DOCUMENT_PATTERNS]
    },
    () => {
      // Reading lastError suppresses Chrome's unchecked-error warning if a browser rejects a
      // document pattern. The preflight and background tests still enforce the intended item.
      void runtime?.lastError;
    }
  );
}

async function sendContextDownloadMessage(tabId: number, type: string, documentUrl: string): Promise<void> {
  const tabs = globalThis.chrome?.tabs;
  if (!tabs?.sendMessage) {
    return;
  }
  await tabs.sendMessage(tabId, { type, documentUrl });
}

function isDownload(message: unknown): message is {
  type: "AVIARY_DOWNLOAD";
  url: string;
  fallbackUrls?: string[];
  filename: string;
} {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as {
    type?: unknown;
    url?: unknown;
    fallbackUrls?: unknown;
    filename?: unknown;
  };
  return (
    candidate.type === "AVIARY_DOWNLOAD" &&
    typeof candidate.url === "string" &&
    (candidate.fallbackUrls === undefined ||
      (Array.isArray(candidate.fallbackUrls) &&
        candidate.fallbackUrls.length <= 3 &&
        candidate.fallbackUrls.every((url) => typeof url === "string"))) &&
    typeof candidate.filename === "string"
  );
}

async function hasDownloadPermission(): Promise<boolean> {
  if (!globalThis.chrome?.downloads) {
    return false;
  }
  const permissions = globalThis.chrome?.permissions;
  if (!permissions?.contains) {
    return true;
  }
  try {
    return await permissions.contains({ permissions: ["downloads"] });
  } catch {
    return false;
  }
}

async function openOptions(): Promise<boolean> {
  if (typeof runtime?.openOptionsPage !== "function") {
    return false;
  }
  await runtime.openOptionsPage();
  return true;
}

async function handleDownload(
  message: {
    url: string;
    fallbackUrls?: string[];
    filename: string;
  },
  tabId: number | null
): Promise<{ ok: boolean; id?: number; pending?: boolean; error?: string; code?: string }> {
  if (!(await hasDownloadPermission())) {
    return {
      ok: false,
      code: DOWNLOAD_PERMISSION_CODE,
      error: "downloads permission not granted"
    };
  }
  const downloads = globalThis.chrome?.downloads;
  if (!downloads) {
    return { ok: false, code: DOWNLOAD_PERMISSION_CODE, error: "downloads permission not granted" };
  }
  const candidates = [message.url, ...(message.fallbackUrls ?? [])]
    .filter((url, index, all) => /^https?:\/\//i.test(url) && all.indexOf(url) === index)
    .slice(0, 4);
  let lastError = "download failed";
  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index]!;
    try {
      const id = await downloads.download({
        url,
        filename: message.filename,
        conflictAction: "uniquify"
      });
      await trackDownload(id, {
        reportId: id,
        tabId,
        fallbackUrls: candidates.slice(index + 1),
        filename: message.filename
      });
      // A very fast transfer can reach a terminal state before the handoff response leaves this
      // worker. Reconcile after the durable tracking record exists so that event is not lost.
      try {
        await queryDownload(id);
      } catch {
        // The handoff is still tracked. A later onChanged event or query can settle it; a transient
        // search failure must not make this path launch another copy from the next candidate.
      }
      // `pending` is the whole point: the browser has taken the request, and nothing yet knows
      // whether the bytes arrive. The tab waits for AVIARY_DOWNLOAD_STATE before saying Saved.
      return { ok: true, id, pending: true };
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * An interrupted transfer: try the next quality candidate, and only give up out loud.
 *
 * The retry inherits `reportId`, so whatever the tab is waiting on is what it eventually hears
 * about -- a fallback that succeeds reports the original request complete, and one that has no
 * candidates left reports it interrupted rather than leaving the button spinning forever.
 */
async function retryDownloadFallback(downloadId: number, error?: string): Promise<void> {
  await waitForTracking(downloadId);
  const pending = await readTrackedDownload(downloadId);
  const downloads = globalThis.chrome?.downloads;
  if (!pending) {
    rememberTerminalBeforeTracking(downloadId, "interrupted", error);
    return;
  }
  await clearTrackedDownload(downloadId);
  if (downloads) {
    for (let index = 0; index < pending.fallbackUrls.length; index += 1) {
      const url = pending.fallbackUrls[index]!;
      try {
        const id = await downloads.download({
          url,
          filename: pending.filename,
          conflictAction: "uniquify"
        });
        await trackDownload(id, {
          reportId: pending.reportId,
          tabId: pending.tabId,
          fallbackUrls: pending.fallbackUrls.slice(index + 1),
          filename: pending.filename
        });
        // The fallback can finish before the original query returns. Reconcile its retained
        // browser record now so the original report id gets a terminal receipt before Resume can
        // mistake the interrupted primary for a fresh download.
        try {
          await queryDownload(id);
        } catch {
          // Keep the tracked fallback alive. A transient search failure must not advance to a
          // second fallback while this browser request may still be in progress.
        }
        return;
      } catch {
        // Try the next bounded candidate. The original candidate order is quality order.
      }
    }
  }
  await recordTerminalReceipt(downloadId, pending, "interrupted", error);
  await reportDownloadState(pending, "interrupted", error);
}

async function finishDownload(downloadId: number, state: "complete"): Promise<void> {
  await waitForTracking(downloadId);
  const tracked = await readTrackedDownload(downloadId);
  if (!tracked) {
    rememberTerminalBeforeTracking(downloadId, state);
    return;
  }
  await recordTerminalReceipt(downloadId, tracked, state);
  await clearTrackedDownload(downloadId);
  await reportDownloadState(tracked, state);
}

/** Serializes the onChanged path with the post-handoff/search reconciliation path. */
function settleDownloadOnce(downloadId: number, task: () => Promise<void>): Promise<void> {
  if (handledTerminalIds.has(downloadId)) {
    return Promise.resolve();
  }
  const existing = terminalWork.get(downloadId);
  if (existing) {
    return existing;
  }
  const work = task()
    .then(() => {
      if (!terminalBeforeTracking.has(downloadId)) {
        rememberHandledTerminal(downloadId);
      }
    })
    .finally(() => {
      terminalWork.delete(downloadId);
    });
  terminalWork.set(downloadId, work);
  return work;
}

function rememberHandledTerminal(downloadId: number): void {
  handledTerminalIds.add(downloadId);
  while (handledTerminalIds.size > DOWNLOAD_TRACKING_LIMIT * 2) {
    const oldest = handledTerminalIds.values().next().value;
    if (oldest === undefined) break;
    handledTerminalIds.delete(oldest);
  }
}

function rememberTerminalBeforeTracking(
  downloadId: number,
  state: "complete" | "interrupted",
  error?: string
): void {
  if (handledTerminalIds.has(downloadId)) return;
  if (!terminalBeforeTracking.has(downloadId)) {
    terminalBeforeTracking.set(downloadId, { state, ...(error ? { error } : {}) });
  }
  while (terminalBeforeTracking.size > DOWNLOAD_TRACKING_LIMIT) {
    const oldest = terminalBeforeTracking.keys().next().value;
    if (oldest === undefined) break;
    terminalBeforeTracking.delete(oldest);
  }
}

/** Reads Chrome/Firefox's retained record without relying on the worker's memory. */
async function queryDownload(downloadId: number): Promise<DownloadQueryResponse> {
  const retainedReceipt = await readTerminalReceipt(downloadId);
  if (retainedReceipt) {
    return {
      ok: true,
      id: downloadId,
      state: retainedReceipt.state,
      ...(retainedReceipt.error ? { error: retainedReceipt.error } : {})
    };
  }
  const downloads = globalThis.chrome?.downloads;
  if (!downloads?.search) {
    // Both Chrome and Firefox expose downloads.search. A lightweight test double or an older
    // embedded host cannot prove what happened, so the content page will keep the job paused
    // rather than guessing and creating a duplicate transfer.
    return { ok: false, id: downloadId, error: "downloads.search is unavailable" };
  }
  const records = await downloads.search({ id: downloadId });
  const record = records.find((item) => item.id === downloadId);
  if (!record) {
    await clearTrackedDownload(downloadId);
    return { ok: true, id: downloadId, state: "missing" };
  }
  if (record.state === "complete") {
    await reconcileDownload(downloadId, "complete");
    return { ok: true, id: downloadId, state: "complete" };
  }
  if (record.state === "interrupted") {
    await reconcileDownload(downloadId, "interrupted", record.error);
    const terminal = await readTerminalReceipt(downloadId);
    if (terminal) {
      return {
        ok: true,
        id: downloadId,
        state: terminal.state,
        ...(terminal.error ? { error: terminal.error } : {})
      };
    }
    // The background fallback keeps reporting the original id. Once it has started, the retained
    // queue entry must keep waiting on that id instead of launching a duplicate primary request.
    if (await hasTrackedReport(downloadId)) {
      return { ok: true, id: downloadId, state: "in_progress" };
    }
    return {
      ok: true,
      id: downloadId,
      state: "interrupted",
      ...(record.error ? { error: record.error } : {})
    };
  }
  return { ok: true, id: downloadId, state: "in_progress" };
}

async function reconcileDownload(
  downloadId: number,
  state?: "complete" | "interrupted",
  error?: string
): Promise<void> {
  const early = terminalBeforeTracking.get(downloadId);
  if (early) {
    terminalBeforeTracking.delete(downloadId);
    state ??= early.state;
    error ??= early.error;
  }
  if (state === "complete") {
    await settleDownloadOnce(downloadId, () => finishDownload(downloadId, "complete"));
  } else if (state === "interrupted") {
    const reason = error;
    await settleDownloadOnce(downloadId, () => retryDownloadFallback(downloadId, reason));
  }
}

/**
 * Tells the tab that asked. Best effort by nature: the tab may have navigated away, in which case
 * nothing is left there that was waiting to hear it.
 */
async function reportDownloadState(
  tracked: TrackedDownload,
  state: "complete" | "interrupted",
  error?: string
): Promise<void> {
  const tabs = globalThis.chrome?.tabs;
  if (!tabs?.sendMessage || tracked.tabId === null) {
    return;
  }
  try {
    await tabs.sendMessage(tracked.tabId, {
      type: DOWNLOAD_STATE_MESSAGE,
      id: tracked.reportId,
      state,
      ...(error ? { error } : {})
    });
  } catch {
    // No receiver in that tab any more.
  }
}

/**
 * Keeps the logical report id replayable when a fallback browser id finishes and is then cleared.
 * The browser retains each physical record, but the queue only knows the original id it handed to
 * the page. A bounded receipt bridges that identity across worker suspension and fallback hops.
 */
async function recordTerminalReceipt(
  downloadId: number,
  tracked: TrackedDownload,
  state: "complete" | "interrupted",
  error?: string
): Promise<void> {
  // A direct download's browser record is already queryable by its own id. Receipts are for the
  // logical report id that survives a fallback hop; retaining direct ids would turn a later
  // missing browser record into a false terminal result.
  if (downloadId === tracked.reportId) return;
  const receipt: TerminalDownloadReceipt = {
    reportId: tracked.reportId,
    state,
    updatedAt: Date.now(),
    ...(error ? { error: error.slice(0, 240) } : {})
  };
  terminalReceipts.set(tracked.reportId, receipt);
  trimTerminalReceipts();
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) return;
  await enqueueTrackingMutation(async () => {
    try {
      const stored = await readStoredTerminalReceipts();
      stored[String(receipt.reportId)] = receipt;
      await storage.set({ [DOWNLOAD_TERMINAL_KEY]: capTerminalReceipts(stored) });
    } catch {
      // The in-memory receipt still covers this worker lifetime. The browser record remains the
      // fallback authority if this write fails before suspension.
    }
  });
}

function trimTerminalReceipts(): void {
  while (terminalReceipts.size > DOWNLOAD_TERMINAL_LIMIT) {
    const oldest = terminalReceipts.keys().next().value;
    if (oldest === undefined) break;
    terminalReceipts.delete(oldest);
  }
}

async function readTerminalReceipt(reportId: number): Promise<TerminalDownloadReceipt | undefined> {
  const local = terminalReceipts.get(reportId);
  if (local) return local;
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) return undefined;
  try {
    const stored = await readStoredTerminalReceipts();
    const receipt = stored[String(reportId)];
    if (receipt) {
      terminalReceipts.set(reportId, receipt);
      trimTerminalReceipts();
    }
    return receipt;
  } catch {
    return undefined;
  }
}

async function readStoredTerminalReceipts(): Promise<Record<string, TerminalDownloadReceipt>> {
  const stored = await globalThis.chrome?.storage?.local?.get(DOWNLOAD_TERMINAL_KEY);
  const raw = stored?.[DOWNLOAD_TERMINAL_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const valid: Record<string, TerminalDownloadReceipt> = {};
  for (const [id, value] of Object.entries(raw)) {
    const candidate = value as Partial<TerminalDownloadReceipt>;
    if (
      /^\d+$/.test(id) &&
      typeof candidate.reportId === "number" &&
      Number.isSafeInteger(candidate.reportId) &&
      candidate.reportId >= 0 &&
      (candidate.state === "complete" || candidate.state === "interrupted") &&
      typeof candidate.updatedAt === "number" &&
      Number.isFinite(candidate.updatedAt)
    ) {
      valid[id] = {
        reportId: candidate.reportId,
        state: candidate.state,
        updatedAt: candidate.updatedAt,
        ...(typeof candidate.error === "string" && candidate.error.length > 0
          ? { error: candidate.error.slice(0, 240) }
          : {})
      };
    }
  }
  return capTerminalReceipts(valid);
}

function capTerminalReceipts(
  stored: Record<string, TerminalDownloadReceipt>
): Record<string, TerminalDownloadReceipt> {
  const ids = Object.keys(stored).sort((left, right) => {
    return stored[left]!.updatedAt - stored[right]!.updatedAt || Number(left) - Number(right);
  });
  if (ids.length <= DOWNLOAD_TERMINAL_LIMIT) return stored;
  const kept: Record<string, TerminalDownloadReceipt> = {};
  for (const id of ids.slice(ids.length - DOWNLOAD_TERMINAL_LIMIT)) {
    kept[id] = stored[id]!;
  }
  return kept;
}

function tabIdOf(sender: unknown): number | null {
  const tab = (sender as { tab?: { id?: unknown } } | undefined)?.tab;
  return typeof tab?.id === "number" ? tab.id : null;
}

/**
 * Persisted, not just held in memory: a service worker is suspended between the handoff and the
 * `onChanged` that reports the terminal state, and an in-memory map does not survive that.
 */
async function trackDownload(downloadId: number, pending: TrackedDownload): Promise<void> {
  trackedDownloads.set(downloadId, pending);
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    await reconcileDownload(downloadId);
    return;
  }
  const write = enqueueTrackingMutation(async () => {
    try {
      const stored = await readStoredDownloadTracking();
      stored[String(downloadId)] = pending;
      await storage.set({ [DOWNLOAD_TRACKING_KEY]: capTracking(stored) });
    } catch {
      // The in-memory entry still covers the current service-worker lifetime.
    }
  });
  trackingWork.set(downloadId, write);
  try {
    await write;
  } finally {
    if (trackingWork.get(downloadId) === write) {
      trackingWork.delete(downloadId);
    }
  }
  // Do not await an already-running terminal task here. That task may be waiting for this write to
  // finish, and awaiting it would form a cycle. The handoff caller reconciles after this returns.
  if (terminalBeforeTracking.has(downloadId)) {
    void reconcileDownload(downloadId);
  }
}

async function waitForTracking(downloadId: number): Promise<void> {
  const pending = trackingWork.get(downloadId);
  if (pending) {
    await pending;
  }
}

async function hasTrackedReport(reportId: number): Promise<boolean> {
  for (const pending of trackedDownloads.values()) {
    if (pending.reportId === reportId) return true;
  }
  try {
    const stored = await readStoredDownloadTracking();
    return Object.values(stored).some((pending) => pending.reportId === reportId);
  } catch {
    return false;
  }
}

async function readTrackedDownload(downloadId: number): Promise<TrackedDownload | undefined> {
  const local = trackedDownloads.get(downloadId);
  if (local) {
    return local;
  }
  try {
    const stored = await readStoredDownloadTracking();
    const pending = stored[String(downloadId)];
    if (pending) {
      trackedDownloads.set(downloadId, pending);
    }
    return pending;
  } catch {
    return undefined;
  }
}

async function clearTrackedDownload(downloadId: number): Promise<void> {
  await waitForTracking(downloadId);
  trackedDownloads.delete(downloadId);
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return;
  }
  await enqueueTrackingMutation(async () => {
    try {
      const stored = await readStoredDownloadTracking();
      if (stored[String(downloadId)] === undefined) {
        return;
      }
      delete stored[String(downloadId)];
      await storage.set({ [DOWNLOAD_TRACKING_KEY]: stored });
    } catch {
      // Cleanup is best effort; entries are bounded by explicit user downloads.
    }
  });
}

function enqueueTrackingMutation(task: () => Promise<void>): Promise<void> {
  const write = trackingStoreTail.then(task);
  trackingStoreTail = write.catch(() => undefined);
  return write;
}

/** Oldest first, so a browser that never reports a terminal state cannot grow this without end. */
function capTracking(stored: Record<string, TrackedDownload>): Record<string, TrackedDownload> {
  const ids = Object.keys(stored).sort((a, b) => Number(a) - Number(b));
  if (ids.length <= DOWNLOAD_TRACKING_LIMIT) {
    return stored;
  }
  const kept: Record<string, TrackedDownload> = {};
  for (const id of ids.slice(ids.length - DOWNLOAD_TRACKING_LIMIT)) {
    kept[id] = stored[id]!;
  }
  return kept;
}

async function readStoredDownloadTracking(): Promise<Record<string, TrackedDownload>> {
  const stored = await globalThis.chrome?.storage?.local?.get(DOWNLOAD_TRACKING_KEY);
  const raw = stored?.[DOWNLOAD_TRACKING_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const valid: Record<string, TrackedDownload> = {};
  for (const [id, value] of Object.entries(raw)) {
    const candidate = value as Partial<TrackedDownload>;
    if (
      /^\d+$/.test(id) &&
      typeof candidate.filename === "string" &&
      typeof candidate.reportId === "number" &&
      (candidate.tabId === null || typeof candidate.tabId === "number") &&
      Array.isArray(candidate.fallbackUrls) &&
      candidate.fallbackUrls.length <= 3 &&
      candidate.fallbackUrls.every(
        (url) => typeof url === "string" && /^https?:\/\//i.test(url)
      )
    ) {
      valid[id] = {
        reportId: candidate.reportId,
        tabId: candidate.tabId ?? null,
        filename: candidate.filename,
        fallbackUrls: candidate.fallbackUrls
      };
    }
  }
  return valid;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function settleBackgroundTask(task: Promise<unknown>, lifecycle: BackgroundTaskCode): void {
  void task.catch((error: unknown) => {
    recordBackgroundDiagnostic(durableStorageBackend, lifecycle);
    console.warn(`Aviary background task failed during ${lifecycle}: ${errorMessage(error)}`);
  });
}
