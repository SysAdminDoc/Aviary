import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-drafts-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mountControlCenter } from ${JSON.stringify(path.join(root, "src/ui/control-center.ts").replace(/\\/g, "/"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`,
      `export { localeDirection, supportedLocales, translateText } from ${JSON.stringify(path.join(root, "src/platform/i18n.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryDrafts",
    platform: "browser",
    target: "es2022",
    define: { __AVIARY_VERSION__: JSON.stringify("test") },
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("one sticky save commits a page atomically and guards section and search navigation", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryDrafts.cloneSettings(AviaryDrafts.DEFAULT_SETTINGS);
    const before = AviaryDrafts.cloneSettings(settings);
    let saves = 0;
    const handle = AviaryDrafts.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {
        saves += 1;
      },
      onError: () => undefined
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="integrations"]').click();

    const row = (label) =>
      [...shadow.querySelectorAll(".av-row")].find((candidate) => candidate.dataset.avLabel === label);
    const input = (label) => row(label)?.querySelector("input");
    const write = (control, value) => {
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

    const endpoint = input("Aria2 endpoint");
    const handoff = input("Aria2 handoff");
    const secret = input("Aria2 RPC secret");
    write(endpoint, "http://draft.invalid:6800");
    handoff.click();
    write(secret, "secret-draft");
    await settle();

    const staged = {
      liveUnchanged: JSON.stringify(settings) === JSON.stringify(before),
      status: shadow.querySelector(".av-status").textContent,
      state: shadow.querySelector(".av-status").dataset.state,
      saveDisabled: shadow.querySelector(".av-transaction-save").disabled,
      revertDisabled: shadow.querySelector(".av-transaction-revert").disabled,
      rowCommitButtons: [...shadow.querySelectorAll(".av-row button")]
        .map((button) => button.textContent)
        .filter((label) => label === "Save" || label === "Save list")
    };

    shadow.querySelector('[data-av-section="layout"]').click();
    const search = shadow.querySelector(".av-search-input");
    search.value = "theme";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const guarded = {
      section: shadow.querySelector(".av-section").dataset.avSection,
      query: search.value,
      status: shadow.querySelector(".av-status").textContent,
      focused: shadow.activeElement?.getAttribute("aria-label")
    };

    shadow.querySelector(".av-transaction-save").click();
    await settle();
    const committed = {
      section: shadow.querySelector(".av-section").dataset.avSection,
      state: shadow.querySelector(".av-status").dataset.state,
      endpoint: settings.integrations.aria2.endpoint,
      secret: settings.integrations.aria2.secret,
      handoff: settings.integrations.aria2.enabled,
      focused: shadow.activeElement?.getAttribute("aria-label"),
      saveDisabled: shadow.querySelector(".av-transaction-save").disabled,
      revertDisabled: shadow.querySelector(".av-transaction-revert").disabled
    };
    handle.destroy();
    return { staged, guarded, committed, saves, beforeHandoff: before.integrations.aria2.enabled };
  });

  assert.deepEqual(result.staged, {
    liveUnchanged: true,
    status: "Unsaved changes",
    state: "dirty",
    saveDisabled: false,
    revertDisabled: false,
    rowCommitButtons: []
  });
  assert.equal(result.guarded.section, "integrations");
  assert.equal(result.guarded.query, "");
  assert.match(result.guarded.status, /Save or revert/);
  assert.equal(result.guarded.focused, "Aria2 endpoint");
  assert.deepEqual(result.committed, {
    section: "integrations",
    state: "saved",
    endpoint: "http://draft.invalid:6800",
    secret: "secret-draft",
    handoff: !result.beforeHandoff,
    focused: "Aria2 RPC secret",
    saveDisabled: true,
    revertDisabled: true
  });
  assert.equal(result.saves, 1);
});

test("validation blocks all writes, failed persistence keeps the draft, and retry or revert recovers", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryDrafts.cloneSettings(AviaryDrafts.DEFAULT_SETTINGS);
    const before = AviaryDrafts.cloneSettings(settings);
    let attempts = 0;
    let failWrites = true;
    const handle = AviaryDrafts.mountControlCenter({
      settings,
      diagnostics: () => [],
      getIntegrationUsage: () => ({
        networkAllowed: true,
        ai: { requests: 0, bytes: 0, dailyLimitBytes: 0 },
        embedding: { requests: 0, records: 0, bytes: 0, dailyLimitBytes: 0 }
      }),
      onChange: async () => {
        attempts += 1;
        if (failWrites) throw new Error("simulated storage failure");
      },
      onError: () => undefined
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="integrations"]').click();

    const row = (label) =>
      [...shadow.querySelectorAll(".av-row")].find((candidate) => candidate.dataset.avLabel === label);
    const input = (label) => row(label)?.querySelector("input");
    const write = (control, value) => {
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

    write(input("Aria2 endpoint"), "http://retry.invalid:6800");
    write(input("AI max request bytes"), "5000001");
    shadow.querySelector(".av-transaction-save").click();
    await settle();
    const invalid = {
      attempts,
      liveUnchanged: JSON.stringify(settings) === JSON.stringify(before),
      status: shadow.querySelector(".av-status").textContent,
      focused: shadow.activeElement?.getAttribute("aria-label"),
      endpoint: input("Aria2 endpoint").value
    };

    write(input("AI max request bytes"), "4096");
    shadow.querySelector(".av-transaction-save").click();
    await settle();
    const failed = {
      attempts,
      liveUnchanged: JSON.stringify(settings) === JSON.stringify(before),
      status: shadow.querySelector(".av-status").textContent,
      state: shadow.querySelector(".av-status").dataset.state,
      endpoint: input("Aria2 endpoint").value,
      maxBytes: input("AI max request bytes").value,
      focused: shadow.activeElement?.getAttribute("aria-label"),
      saveDisabled: shadow.querySelector(".av-transaction-save").disabled
    };
    shadow.querySelector('[data-av-section="layout"]').click();
    const failureGuardSection = shadow.querySelector(".av-section").dataset.avSection;

    failWrites = false;
    shadow.querySelector(".av-transaction-save").click();
    await settle();
    const retried = {
      attempts,
      endpoint: settings.integrations.aria2.endpoint,
      maxBytes: settings.integrations.ai.maxRequestBytes,
      state: shadow.querySelector(".av-status").dataset.state,
      focused: shadow.activeElement?.getAttribute("aria-label")
    };

    const handoffBefore = settings.integrations.aria2.enabled;
    input("Aria2 handoff").click();
    await settle();
    const liveBeforeRevert = settings.integrations.aria2.enabled;
    shadow.querySelector(".av-transaction-revert").click();
    const reverted = {
      liveUnchanged: settings.integrations.aria2.enabled === handoffBefore && liveBeforeRevert === handoffBefore,
      control: input("Aria2 handoff").checked,
      state: shadow.querySelector(".av-status").dataset.state,
      saveDisabled: shadow.querySelector(".av-transaction-save").disabled,
      focused: shadow.activeElement?.closest(".av-row")?.dataset.avLabel
    };
    shadow.querySelector('[data-av-section="layout"]').click();
    reverted.sectionAfterNavigation = shadow.querySelector(".av-section").dataset.avSection;
    handle.destroy();
    return { invalid, failed, failureGuardSection, retried, reverted, handoffBefore };
  });

  assert.deepEqual(result.invalid, {
    attempts: 0,
    liveUnchanged: true,
    status: "Fix invalid values before saving.",
    focused: "AI max request bytes",
    endpoint: "http://retry.invalid:6800"
  });
  assert.deepEqual(result.failed, {
    attempts: 1,
    liveUnchanged: true,
    status: "Could not save settings. Try again.",
    state: "error",
    endpoint: "http://retry.invalid:6800",
    maxBytes: "4096",
    focused: "AI max request bytes",
    saveDisabled: false
  });
  assert.equal(result.failureGuardSection, "integrations");
  assert.deepEqual(result.retried, {
    attempts: 2,
    endpoint: "http://retry.invalid:6800",
    maxBytes: 4096,
    state: "saved",
    focused: "AI max request bytes"
  });
  assert.deepEqual(result.reverted, {
    liveUnchanged: true,
    control: result.handoffBefore,
    state: "saved",
    saveDisabled: true,
    focused: "Aria2 handoff",
    sectionAfterNavigation: "layout"
  });
});

test("a failed mixed page save rolls back external note writes with the settings object", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryDrafts.cloneSettings(AviaryDrafts.DEFAULT_SETTINGS);
    const snippetsBefore = [...settings.composer.snippets];
    const notes = { alice: "original" };
    let failWrites = true;
    const handle = AviaryDrafts.mountControlCenter({
      settings,
      diagnostics: () => [],
      getUserNotes: () => ({ ...notes }),
      setUserNote: async (handle, note) => {
        const key = handle.toLowerCase();
        if (note.length > 0) notes[key] = note;
        else delete notes[key];
      },
      onChange: async () => {
        if (failWrites) throw new Error("simulated settings failure");
      },
      onError: () => undefined
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="library"]').click();
    const row = (label) =>
      [...shadow.querySelectorAll(".av-row")].find((candidate) => candidate.dataset.avLabel === label);
    const write = (control, value) => {
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

    write(row("Account notes").querySelector("textarea"), "bob: draft note");
    write(row("Composer snippets").querySelector("textarea"), "draft snippet");
    shadow.querySelector(".av-transaction-save").click();
    await settle();
    const failed = {
      notes: { ...notes },
      snippets: [...settings.composer.snippets],
      noteDraft: row("Account notes").querySelector("textarea").value,
      snippetDraft: row("Composer snippets").querySelector("textarea").value,
      state: shadow.querySelector(".av-status").dataset.state
    };

    failWrites = false;
    shadow.querySelector(".av-transaction-save").click();
    await settle();
    const retried = {
      notes: { ...notes },
      snippets: [...settings.composer.snippets],
      state: shadow.querySelector(".av-status").dataset.state
    };
    handle.destroy();
    return { failed, retried, snippetsBefore };
  });

  assert.deepEqual(result.failed, {
    notes: { alice: "original" },
    snippets: result.snippetsBefore,
    noteDraft: "bob: draft note",
    snippetDraft: "draft snippet",
    state: "error"
  });
  assert.deepEqual(result.retried, {
    notes: { bob: "draft note" },
    snippets: ["draft snippet"],
    state: "saved"
  });
});

test("all destinations share one clean transaction bar and all locales translate its controls", async () => {
  const result = await page.evaluate(() => {
    document.body.replaceChildren();
    const settings = AviaryDrafts.cloneSettings(AviaryDrafts.DEFAULT_SETTINGS);
    const handle = AviaryDrafts.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => undefined,
      onError: () => undefined
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    const destinations = [...shadow.querySelectorAll(".av-nav-item")].map((item) => item.dataset.avSection);
    const destinationStates = destinations.map((id) => {
      shadow.querySelector(`[data-av-section="${id}"]`).click();
      return {
        id,
        section: shadow.querySelector(".av-section")?.dataset.avSection,
        bars: shadow.querySelectorAll(".av-transaction-bar").length,
        saveDisabled: shadow.querySelector(".av-transaction-save").disabled,
        revertDisabled: shadow.querySelector(".av-transaction-revert").disabled
      };
    });
    handle.destroy();

    const locales = AviaryDrafts.supportedLocales().map((locale) => {
      const localized = AviaryDrafts.cloneSettings(AviaryDrafts.DEFAULT_SETTINGS);
      localized.i18n.locale = locale.code;
      const localizedHandle = AviaryDrafts.mountControlCenter({
        settings: localized,
        diagnostics: () => [],
        onChange: async () => undefined,
        onError: () => undefined
      });
      const localizedHost = document.getElementById("av-control-center");
      const localizedShadow = localizedHost.shadowRoot;
      const state = {
        code: locale.code,
        dir: localizedHost.dir,
        save: localizedShadow.querySelector(".av-transaction-save").textContent,
        revert: localizedShadow.querySelector(".av-transaction-revert").textContent,
        expectedSave: AviaryDrafts.translateText(locale.code, "Save"),
        expectedRevert: AviaryDrafts.translateText(locale.code, "Revert")
      };
      localizedHandle.destroy();
      return state;
    });
    return { destinations, destinationStates, locales };
  });

  assert.deepEqual(result.destinations, [
    "presets",
    "appearance",
    "layout",
    "filtering",
    "catchup",
    "hidden",
    "performance",
    "media",
    "export",
    "library",
    "snapshots",
    "integrations",
    "backup",
    "trust"
  ]);
  for (const state of result.destinationStates) {
    assert.deepEqual(state, {
      id: state.id,
      section: state.id,
      bars: 1,
      saveDisabled: true,
      revertDisabled: true
    });
  }
  assert.equal(result.locales.length, 9);
  for (const locale of result.locales) {
    assert.equal(locale.dir, AviaryDraftsDirection(locale.code));
    assert.equal(locale.save, locale.expectedSave);
    assert.equal(locale.revert, locale.expectedRevert);
  }
});

test("profile and import controls remain immediate actions outside the settings transaction", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryDrafts.cloneSettings(AviaryDrafts.DEFAULT_SETTINGS);
    let switches = 0;
    let creates = 0;
    let imports = 0;
    const handle = AviaryDrafts.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => undefined,
      onError: () => undefined,
      getProfileStatus: () => ({
        activeId: "one",
        activeLabel: "One",
        legacyDataAvailable: false,
        profiles: [
          { id: "one", label: "One", kind: "offline" },
          { id: "two", label: "Two", kind: "offline" }
        ]
      }),
      switchProfile: async () => {
        switches += 1;
        return { ok: true };
      },
      createProfile: async () => {
        creates += 1;
        return { ok: true };
      },
      importSettings: async () => {
        imports += 1;
        return { applied: false, warnings: [], errors: ["fixture"] };
      }
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    const row = (label) =>
      [...shadow.querySelectorAll(".av-row")].find((candidate) => candidate.dataset.avLabel === label);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

    shadow.querySelector('[data-av-section="trust"]').click();
    const profileName = row("New profile").querySelector("input");
    profileName.value = "Archive";
    profileName.dispatchEvent(new Event("input", { bubbles: true }));
    row("New profile").querySelector("button").click();
    const profileSelect = row("Switch profile").querySelector("select");
    profileSelect.value = "two";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const profileState = {
      creates,
      switches,
      saveDisabled: shadow.querySelector(".av-transaction-save").disabled,
      newProfileAction: row("New profile").querySelector("button").textContent
    };

    shadow.querySelector('[data-av-section="backup"]').click();
    const importRow = row("Import settings (JSON)");
    const payload = importRow.querySelector("textarea");
    payload.value = "{}";
    payload.dispatchEvent(new Event("input", { bubbles: true }));
    importRow.querySelector("button").click();
    await settle();
    const importState = {
      imports,
      saveDisabled: shadow.querySelector(".av-transaction-save").disabled,
      action: row("Import settings (JSON)").querySelector("button").textContent
    };
    handle.destroy();
    return { profileState, importState };
  });

  assert.deepEqual(result.profileState, {
    creates: 1,
    switches: 1,
    saveDisabled: true,
    newProfileAction: "Apply"
  });
  assert.deepEqual(result.importState, { imports: 1, saveDisabled: true, action: "Import" });
});

function AviaryDraftsDirection(code) {
  return code === "ar" || code === "he" ? "rtl" : "ltr";
}
