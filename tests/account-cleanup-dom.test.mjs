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

test("the Control Center unlocks deletion only for the exact account phrase", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const profile = document.createElement("a");
    profile.dataset.testid = "AppTabBar_Profile_Link";
    profile.href = "/alice";
    document.body.append(profile);
    const categories = { bookmarks: true, likes: true, reposts: true, replies: true, posts: true };
    const stats = Object.fromEntries(
      Object.keys(categories).map((category) => [category, {
        completed: 0,
        previewed: 1,
        failed: 0,
        skipped: 0
      }])
    );
    const run = {
      schema: 1,
      id: "preview-1",
      ownerId: "tab-1",
      account: "alice",
      status: "complete",
      phase: "complete",
      reason: null,
      plan: ["bookmarks", "likes", "reposts", "replies", "posts"],
      stepIndex: 5,
      settings: { mode: "preview", categories, pacing: "careful", maxActions: 0 },
      stats,
      processed: { bookmarks: [], likes: [], reposts: [], replies: [], posts: [] },
      failures: {},
      actionsThisSession: 5,
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 2,
      leaseUntil: 0
    };
    let received = null;
    const handle = AviaryAccountCleanupDom.mountControlCenter({
      settings: AviaryAccountCleanupDom.cloneSettings(AviaryAccountCleanupDom.DEFAULT_SETTINGS),
      diagnostics: () => [],
      onChange: async () => {},
      onError() {},
      getAccountCleanupStatus: () => ({
        activeHandle: "alice",
        run,
        runningInThisTab: false,
        message: "Preview complete. No X account data was changed."
      }),
      startAccountCleanup: async (options) => {
        received = options;
        return { ok: true };
      },
      startAccountCleanupPreview: async () => ({ ok: true }),
      clearAccountCleanupRecord: async () => ({ ok: true })
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="account"]').click();
    const input = shadow.querySelector(".av-cleanup-acknowledgement");
    const button = Array.from(shadow.querySelectorAll("button"))
      .find((candidate) => candidate.textContent === "Delete selected account data");
    const initiallyDisabled = button.disabled;
    input.value = "DELETE @bob";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const wrongDisabled = button.disabled;
    input.value = "DELETE @alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const exactEnabled = !button.disabled;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.destroy();
    return { initiallyDisabled, wrongDisabled, exactEnabled, received };
  });

  assert.equal(result.initiallyDisabled, true);
  assert.equal(result.wrongDisabled, true);
  assert.equal(result.exactEnabled, true);
  assert.equal(result.received.previewId, "preview-1");
  assert.equal(result.received.acknowledgement, "DELETE @alice");
});
