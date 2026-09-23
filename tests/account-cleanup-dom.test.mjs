import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-account-cleanup-dom-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(abs("src/features/account-cleanup/dom.ts"))};`,
      `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryAccountCleanupDom",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("reply discovery excludes an authored parent post", async () => {
  const result = await page.evaluate(() => {
    const article = (id, replyContext = false) => {
      const node = document.createElement("article");
      node.dataset.testid = "tweet";
      const name = document.createElement("div");
      name.dataset.testid = "User-Name";
      const author = document.createElement("a");
      author.href = "/DuderBroder";
      author.textContent = "@DuderBroder";
      name.append(author);
      node.append(name);
      if (replyContext) {
        const context = document.createElement("a");
        context.href = "/someone";
        context.textContent = "Replying to @someone";
        node.append(context);
      }
      const text = document.createElement("div");
      text.dataset.testid = "tweetText";
      text.textContent = `Fixture ${id}`;
      const status = document.createElement("a");
      status.href = `/DuderBroder/status/${id}`;
      status.append(document.createElement("time"));
      const more = document.createElement("button");
      more.dataset.testid = "caret";
      node.append(text, status, more);
      document.body.append(node);
      return node;
    };
    document.body.replaceChildren();
    article("100", false);
    article("200", true);
    return AviaryAccountCleanupDom.findAccountCleanupTargets(
      "replies",
      "DuderBroder",
      document
    ).map((target) => target.id);
  });

  assert.deepEqual(result, ["200"]);
});

test("delete menu selection fails closed and accepts X danger styling", async () => {
  const result = await page.evaluate(() => {
    const safeMenu = document.createElement("div");
    safeMenu.innerHTML = '<div role="menuitem"><span>Pin to profile</span></div>';
    const dangerMenu = document.createElement("div");
    dangerMenu.innerHTML = '<div role="menuitem"><span style="color: rgb(244, 33, 46)">Unknown locale</span></div>';
    document.body.replaceChildren(safeMenu, dangerMenu);
    return {
      safe: AviaryAccountCleanupDom.selectAccountCleanupDeleteMenuItem(safeMenu, window) !== null,
      danger: AviaryAccountCleanupDom.selectAccountCleanupDeleteMenuItem(dangerMenu, window) !== null
    };
  });

  assert.deepEqual(result, { safe: false, danger: true });
});

test("delete action waits for X menu and confirmation controls", async () => {
  const outcome = await page.evaluate(async () => {
    document.body.replaceChildren();
    const article = document.createElement("article");
    article.dataset.testid = "tweet";
    const status = document.createElement("a");
    status.href = "/DuderBroder/status/300";
    status.append(document.createElement("time"));
    const more = document.createElement("button");
    more.dataset.testid = "caret";
    more.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      const item = document.createElement("button");
      item.setAttribute("role", "menuitem");
      item.textContent = "Delete";
      item.addEventListener("click", () => {
        const confirm = document.createElement("button");
        confirm.dataset.testid = "confirmationSheetConfirm";
        confirm.addEventListener("click", () => article.remove());
        document.body.append(confirm);
      });
      menu.append(item);
      document.body.append(menu);
    });
    article.append(status, more);
    document.body.append(article);

    return AviaryAccountCleanupDom.performAccountCleanupTarget({
      category: "posts",
      kind: "delete",
      article,
      control: more,
      author: "DuderBroder",
      id: "300"
    });
  });

  assert.deepEqual(outcome, { status: "success" });
});

test("engagement routes expose only their active removal controls", async () => {
  const result = await page.evaluate(() => {
    const fixture = (id, testId) => {
      const article = document.createElement("article");
      article.dataset.testid = "tweet";
      const status = document.createElement("a");
      status.href = `/someone/status/${id}`;
      status.append(document.createElement("time"));
      const control = document.createElement("button");
      control.dataset.testid = testId;
      article.append(status, control);
      document.body.append(article);
    };
    document.body.replaceChildren();
    fixture("401", "unlike");
    fixture("402", "removeBookmark");
    fixture("403", "unretweet");
    return {
      likes: AviaryAccountCleanupDom.findAccountCleanupTargets("likes", "DuderBroder", document).map((target) => target.id),
      bookmarks: AviaryAccountCleanupDom.findAccountCleanupTargets("bookmarks", "DuderBroder", document).map((target) => target.id),
      reposts: AviaryAccountCleanupDom.findAccountCleanupTargets("reposts", "DuderBroder", document).map((target) => target.id)
    };
  });

  assert.deepEqual(result, {
    likes: ["401"],
    bookmarks: ["402"],
    reposts: ["403"]
  });
});

test("Run stays off until the reader selects what to delete", async () => {
  const result = await page.evaluate(() => {
    document.body.replaceChildren();
    const profile = document.createElement("a");
    profile.dataset.testid = "AppTabBar_Profile_Link";
    profile.href = "/alice";
    document.body.append(profile);
    const handle = AviaryAccountCleanupDom.mountControlCenter({
      settings: AviaryAccountCleanupDom.cloneSettings(AviaryAccountCleanupDom.DEFAULT_SETTINGS),
      diagnostics: () => [],
      onChange: async () => {},
      onError() {},
      getAccountCleanupStatus: () => ({
        activeHandle: "alice",
        run: null,
        runningInThisTab: false,
        message: "No account cleanup has run."
      }),
      startAccountCleanup: async () => ({ ok: true })
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="account"]').click();
    const read = () => {
      const run = shadow.querySelector("[data-av-cleanup-primary]");
      const hint = shadow.querySelector("#av-cleanup-selection-hint");
      return {
        checked: [...shadow.querySelectorAll(".av-cleanup-category input")].filter((input) => input.checked).length,
        runEnabled: !run.disabled,
        describedBy: run.getAttribute("aria-describedby"),
        hint: hint?.textContent ?? null,
        ready: [...shadow.querySelectorAll(".av-cleanup-guidance")]
          .some((node) => node.textContent === "Ready to run on @alice.")
      };
    };
    const initial = read();
    shadow.querySelector(".av-cleanup-category input").click();
    const afterOne = read();
    shadow.querySelector(".av-cleanup-category input").click();
    const afterClear = read();
    handle.destroy();
    return { initial, afterOne, afterClear };
  });

  assert.deepEqual(result.initial, {
    checked: 0,
    runEnabled: false,
    describedBy: "av-cleanup-selection-hint",
    hint: "Select at least one kind of activity to enable Run.",
    ready: false
  });
  assert.deepEqual(result.afterOne, {
    checked: 1,
    runEnabled: true,
    describedBy: null,
    hint: null,
    ready: true
  });
  assert.deepEqual(result.afterClear, result.initial);
});

test("the Control Center starts deletion immediately from one Run button", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const profile = document.createElement("a");
    profile.dataset.testid = "AppTabBar_Profile_Link";
    profile.href = "/alice";
    document.body.append(profile);
    let runOptions = null;
    const handle = AviaryAccountCleanupDom.mountControlCenter({
      settings: AviaryAccountCleanupDom.cloneSettings(AviaryAccountCleanupDom.DEFAULT_SETTINGS),
      diagnostics: () => [],
      onChange: async () => {},
      onError() {},
      getAccountCleanupStatus: () => ({
        activeHandle: "alice",
        run: null,
        runningInThisTab: false,
        message: "No account cleanup has run."
      }),
      startAccountCleanup: async (options) => {
        runOptions = options;
        return { ok: true };
      }
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="account"]').click();
    // Nothing is selected on a fresh page, so choose every category the way a reader would.
    // Each change re-renders the section, which is why the inputs are queried again each time.
    const categoryCount = shadow.querySelectorAll(".av-cleanup-category input").length;
    for (let index = 0; index < categoryCount; index += 1) {
      shadow.querySelectorAll(".av-cleanup-category input")[index].click();
    }
    const primaryActions = [...shadow.querySelectorAll("[data-av-cleanup-primary]")];
    const button = primaryActions[0];
    const advanced = shadow.querySelector(".av-cleanup-advanced");
    const workspace = shadow.querySelector(".av-cleanup-workspace");
    const acknowledgement = shadow.querySelector(".av-cleanup-acknowledgement");
    const safetyNotice = shadow.querySelector(".av-cleanup-notice");
    const retiredActions = [...shadow.querySelectorAll("button")]
      .filter((candidate) =>
        candidate.textContent === "Preview selected" ||
        candidate.textContent === "Delete selected account data" ||
        candidate.textContent === "Run cleanup"
      ).length;
    const actionBeforeAdvanced = Boolean(
      workspace.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    const initialLabel = button.textContent;
    const initiallyEnabled = !button.disabled;
    button.click();
    const pendingLabel = button.textContent;
    const pendingBusy = button.getAttribute("aria-busy");
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.destroy();
    return {
      actionBeforeAdvanced,
      acknowledgementPresent: acknowledgement !== null,
      advancedOpen: advanced.open,
      initialLabel,
      initiallyEnabled,
      pendingBusy,
      pendingLabel,
      runOptions,
      primaryCount: primaryActions.length,
      retiredActions,
      safetyNoticePresent: safetyNotice !== null
    };
  });

  assert.equal(result.primaryCount, 1);
  assert.equal(result.initialLabel, "Run");
  assert.equal(result.initiallyEnabled, true);
  assert.equal(result.acknowledgementPresent, false);
  assert.equal(result.safetyNoticePresent, false);
  assert.equal(result.advancedOpen, false);
  assert.equal(result.actionBeforeAdvanced, true);
  assert.equal(result.retiredActions, 0);
  assert.equal(result.pendingLabel, "Starting deletion…");
  assert.equal(result.pendingBusy, "true");
  assert.deepEqual(result.runOptions.categories, {
    bookmarks: true,
    likes: true,
    reposts: true,
    replies: true,
    posts: true
  });
  assert.equal(result.runOptions.pacing, "balanced");
  assert.equal(result.runOptions.maxActions, 0);
});

test("active cleanup replaces the primary action with only pause resume and stop controls", async () => {
  const result = await page.evaluate(() => {
    document.body.replaceChildren();
    const profile = document.createElement("a");
    profile.dataset.testid = "AppTabBar_Profile_Link";
    profile.href = "/alice";
    document.body.append(profile);
    const categories = { bookmarks: true, likes: false, reposts: false, replies: false, posts: false };
    let statusMessage = "Cleanup is running.";
    const run = {
      schema: 1,
      id: "cleanup-1",
      ownerId: "tab-1",
      account: "alice",
      status: "running",
      phase: "bookmarks",
      reason: null,
      plan: ["bookmarks"],
      stepIndex: 0,
      settings: { mode: "cleanup", categories, pacing: "careful", maxActions: 0 },
      stats: { bookmarks: { completed: 1, previewed: 0, failed: 0, skipped: 0 } },
      processed: { bookmarks: [] },
      failures: {},
      actionsThisSession: 1,
      startedAt: 1,
      updatedAt: 2,
      finishedAt: null,
      leaseUntil: 3
    };
    const handle = AviaryAccountCleanupDom.mountControlCenter({
      settings: AviaryAccountCleanupDom.cloneSettings(AviaryAccountCleanupDom.DEFAULT_SETTINGS),
      diagnostics: () => [],
      onChange: async () => {},
      onError() {},
      getAccountCleanupStatus: () => ({
        activeHandle: "alice",
        run,
        runningInThisTab: true,
        message: statusMessage
      }),
      pauseAccountCleanup: async () => ({ ok: true }),
      resumeAccountCleanup: async () => ({ ok: true }),
      stopAccountCleanup: async () => ({ ok: true })
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="account"]').click();
    const labels = () => [...shadow.querySelectorAll(".av-cleanup-buttons button")]
      .map((button) => button.textContent);
    const runningLabels = labels();
    const runningPrimaryCount = shadow.querySelectorAll("[data-av-cleanup-primary]").length;
    run.phase = "batch_pause";
    statusMessage = "Resting for 12 seconds after 60 actions. Deletion continues automatically.";
    handle.refresh();
    const restGuidance = shadow.querySelector(".av-cleanup-guidance").textContent;
    run.status = "paused";
    handle.refresh();
    const pausedLabels = labels();
    const pausedPrimaryCount = shadow.querySelectorAll("[data-av-cleanup-primary]").length;
    handle.destroy();
    return { pausedLabels, pausedPrimaryCount, restGuidance, runningLabels, runningPrimaryCount };
  });

  assert.deepEqual(result.runningLabels, ["Pause", "Stop"]);
  assert.equal(result.runningPrimaryCount, 0);
  assert.match(result.restGuidance, /Resting for 12 seconds.*Deletion continues automatically\./);
  assert.deepEqual(result.pausedLabels, ["Resume", "Stop"]);
  assert.equal(result.pausedPrimaryCount, 0);
});

test("a failed deletion start restores an enabled Run button", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const profile = document.createElement("a");
    profile.dataset.testid = "AppTabBar_Profile_Link";
    profile.href = "/alice";
    document.body.append(profile);
    let errors = 0;
    const handle = AviaryAccountCleanupDom.mountControlCenter({
      settings: AviaryAccountCleanupDom.cloneSettings(AviaryAccountCleanupDom.DEFAULT_SETTINGS),
      diagnostics: () => [],
      onChange: async () => {},
      onError() {
        errors += 1;
      },
      getAccountCleanupStatus: () => ({
        activeHandle: "alice",
        run: null,
        runningInThisTab: false,
        message: "No account cleanup has run."
      }),
      startAccountCleanup: async () => {
        throw new Error("Start failed");
      }
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="account"]').click();
    shadow.querySelector(".av-cleanup-category input").click();
    shadow.querySelector("[data-av-cleanup-primary]").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const button = shadow.querySelector("[data-av-cleanup-primary]");
    const response = {
      ariaBusy: button.getAttribute("aria-busy"),
      enabled: !button.disabled,
      errors,
      label: button.textContent
    };
    handle.destroy();
    return response;
  });

  assert.deepEqual(result, {
    ariaBusy: null,
    enabled: true,
    errors: 1,
    label: "Run"
  });
});
