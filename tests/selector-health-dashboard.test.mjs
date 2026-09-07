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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-selector-health-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { selectorHealthFeature, getSelectorHealthSnapshot, clearAdObservations } from ${JSON.stringify(path.join(root, "src/features/core/selector-health.ts").replace(/\\/g, "/"))};`,
      `export { getSelectorHealthForRoute, SURFACE_SELECTORS } from ${JSON.stringify(path.join(root, "src/platform/selectors.ts").replace(/\\/g, "/"))};`,
      `export { mountControlCenter } from ${JSON.stringify(path.join(root, "src/ui/control-center.ts").replace(/\\/g, "/"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviarySelectorHealth",
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

test("Trust shows current selector matches and clears a required-surface warning live", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    app.id = "react-root";
    const primary = document.createElement("main");
    primary.setAttribute("data-testid", "primaryColumn");
    const nav = document.createElement("a");
    nav.setAttribute("data-testid", "AppTabBar_Home");
    app.append(primary, nav);
    document.body.append(app);

    const settings = AviarySelectorHealth.cloneSettings(AviarySelectorHealth.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";
    const context = {
      route: { surface: "home" },
      settings,
      storage: {
        async get(_key, fallback) { return fallback; },
        async set() {},
        async remove() {}
      },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    await AviarySelectorHealth.selectorHealthFeature.init(context);
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    const panel = AviarySelectorHealth.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getSelectorHealth: () => AviarySelectorHealth.getSelectorHealthSnapshot()
    });
    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="trust"]').click();

    const read = (label) =>
      [...shadow.querySelectorAll(".av-row")]
        .find((row) => row.querySelector(".av-row-label")?.textContent === label)
        ?.querySelector(".av-row-description")?.textContent ?? null;
    const initial = {
      snapshot: AviarySelectorHealth.getSelectorHealthSnapshot(),
      summary: read("Selector health"),
      matches: read("Selector matches")
    };

    primary.remove();
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    shadow.querySelector(".av-panel").focus();
    panel.refresh();
    const degraded = {
      snapshot: AviarySelectorHealth.getSelectorHealthSnapshot(),
      summary: read("Selector health"),
      missing: read("Missing required surfaces"),
      affected: read("Affected features")
    };

    app.append(primary);
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    shadow.querySelector(".av-panel").focus();
    panel.refresh();
    const restored = {
      snapshot: AviarySelectorHealth.getSelectorHealthSnapshot(),
      summary: read("Selector health"),
      missing: read("Missing required surfaces")
    };
    panel.destroy();
    AviarySelectorHealth.selectorHealthFeature.destroy(context);
    return { initial, degraded, restored };
  });

  assert.equal(result.initial.snapshot.state, "healthy");
  assert.equal(result.initial.snapshot.requiredMatched, result.initial.snapshot.required);
  assert.equal(result.initial.snapshot.surfaces.find((item) => item.surface === "Grok").relevance, "optional");
  assert.match(result.initial.summary, /Healthy · home/);
  assert.match(result.initial.matches, /Primary column: stable/);

  assert.equal(result.degraded.snapshot.state, "degraded");
  assert.deepEqual(result.degraded.snapshot.missingRequired, ["Primary column"]);
  assert.match(result.degraded.summary, /Degraded · home/);
  assert.equal(result.degraded.missing, "Primary column");
  assert.match(result.degraded.affected, /Boot and timeline scope/);
  assert.equal(result.degraded.snapshot.lastTransition.from, "healthy");
  assert.equal(result.degraded.snapshot.lastTransition.to, "degraded");

  assert.equal(result.restored.snapshot.state, "healthy");
  assert.equal(result.restored.missing, "None");
  assert.match(result.restored.summary, /Healthy · home/);
  assert.equal(result.restored.snapshot.lastTransition.from, "degraded");
  assert.equal(result.restored.snapshot.lastTransition.to, "healthy");
});

test("a renamed post action bar signals once, opens Trust, and copies a content-free report", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    app.id = "react-root";
    const primary = document.createElement("main");
    primary.setAttribute("data-testid", "primaryColumn");
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const actions = document.createElement("div");
    actions.setAttribute("data-testid", "toolBar");
    actions.setAttribute("role", "group");
    article.append(actions);
    primary.append(article);
    const nav = document.createElement("a");
    nav.setAttribute("data-testid", "AppTabBar_Home");
    app.append(primary, nav);
    document.body.append(app);

    const settings = AviarySelectorHealth.cloneSettings(AviarySelectorHealth.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";
    const context = {
      route: { surface: "home" },
      settings,
      storage: {
        async get(_key, fallback) { return fallback; },
        async set() {},
        async remove() {}
      },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    await AviarySelectorHealth.selectorHealthFeature.init(context);
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    const reports = [];
    const panel = AviarySelectorHealth.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getSelectorHealth: () => AviarySelectorHealth.getSelectorHealthSnapshot(),
      copySelectorBreakReport: async () => {
        reports.push("Aviary selector break report\nBuild: 1.47.2\nRoute: home\nMissing surfaces:\n- Post actions (Media buttons, AI menu, composer snippets)\nFeature IDs:\n- media.buttons\n- ai.commandMenu\n- composer.snippets");
      }
    });
    context.refreshControlCenter = () => panel.refresh();
    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="trust"]').click();
    const read = (label) =>
      [...shadow.querySelectorAll(".av-row")]
        .find((row) => row.querySelector(".av-row-label")?.textContent === label)
        ?.querySelector(".av-row-description")?.textContent ?? null;

    actions.removeAttribute("data-testid");
    actions.removeAttribute("role");
    actions.setAttribute("data-testid", "renamedToolBar");
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    const firstDegraded = {
      snapshot: AviarySelectorHealth.getSelectorHealthSnapshot(),
      launcherState: host.dataset.avSelectorHealth,
      toast: document.querySelector("#av-feature-toast")?.shadowRoot?.textContent ?? ""
    };
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    const secondDegraded = {
      toastHosts: document.querySelectorAll("#av-feature-toast").length,
      missing: read("Missing required surfaces"),
      affected: read("Affected features"),
      copyButtons: [...shadow.querySelectorAll(".av-row")]
        .filter((row) => row.querySelector(".av-row-label")?.textContent === "Copy diagnostics")
        .length
    };
    shadow.querySelector(".av-panel").focus();
    panel.refresh();
    const copyRow = [...shadow.querySelectorAll(".av-row")]
      .find((row) => row.querySelector(".av-row-label")?.textContent === "Copy diagnostics");
    copyRow?.querySelector("button")?.click();
    await new Promise((resolve) => setTimeout(resolve));

    actions.setAttribute("data-testid", "toolBar");
    actions.setAttribute("role", "group");
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    shadow.querySelector(".av-panel").focus();
    panel.refresh();
    const restored = {
      state: AviarySelectorHealth.getSelectorHealthSnapshot().state,
      launcherState: host.dataset.avSelectorHealth,
      missing: read("Missing required surfaces")
    };

    actions.removeAttribute("data-testid");
    actions.removeAttribute("role");
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    const degradedAgain = {
      state: AviarySelectorHealth.getSelectorHealthSnapshot().state,
      launcherState: host.dataset.avSelectorHealth,
      toastHost: Boolean(document.getElementById("av-feature-toast"))
    };
    settings.media.buttons = false;
    settings.ai.commandMenu = false;
    settings.composer.snippets = [];
    await AviarySelectorHealth.selectorHealthFeature.apply(context);
    const featuresOff = {
      state: AviarySelectorHealth.getSelectorHealthSnapshot().state,
      missing: AviarySelectorHealth.getSelectorHealthSnapshot().missingRequired,
      launcherState: host.dataset.avSelectorHealth,
      selectorSummary: read("Selector health"),
      toastHost: Boolean(document.getElementById("av-feature-toast"))
    };
    settings.media.buttons = true;
    await AviarySelectorHealth.selectorHealthFeature.apply(context);
    settings.diagnostics.selectorHealth = false;
    await AviarySelectorHealth.selectorHealthFeature.apply(context);
    const diagnosticsOff = {
      state: AviarySelectorHealth.getSelectorHealthSnapshot().state,
      missing: AviarySelectorHealth.getSelectorHealthSnapshot().missingRequired,
      launcherState: host.dataset.avSelectorHealth,
      selectorSummary: read("Selector health"),
      toastHost: Boolean(document.getElementById("av-feature-toast"))
    };
    panel.destroy();
    AviarySelectorHealth.selectorHealthFeature.destroy(context);
    return { firstDegraded, secondDegraded, restored, degradedAgain, featuresOff, diagnosticsOff, report: reports[0] ?? "" };
  });

  assert.equal(result.firstDegraded.snapshot.state, "degraded");
  assert.deepEqual(result.firstDegraded.snapshot.missingRequired, ["Post actions"]);
  assert.equal(result.firstDegraded.launcherState, "degraded");
  assert.match(result.firstDegraded.toast, /Selector health/);
  assert.equal(result.secondDegraded.toastHosts, 1);
  assert.equal(result.secondDegraded.missing, "Post actions");
  assert.match(result.secondDegraded.affected, /Media buttons, AI menu, composer snippets/);
  assert.equal(result.secondDegraded.copyButtons, 1);
  assert.match(result.report, /Build: 1\.47\.2/);
  assert.match(result.report, /Route: home/);
  assert.match(result.report, /media\.buttons/);
  assert.doesNotMatch(result.report, /https?:\/\//);
  assert.doesNotMatch(result.report, /@/);
  assert.equal(result.restored.state, "healthy");
  assert.equal(result.restored.launcherState, "healthy");
  assert.equal(result.restored.missing, "None");
  assert.equal(result.degradedAgain.state, "degraded");
  assert.equal(result.degradedAgain.launcherState, "degraded");
  assert.equal(result.degradedAgain.toastHost, true);
  assert.equal(result.featuresOff.state, "healthy");
  assert.deepEqual(result.featuresOff.missing, []);
  assert.equal(result.featuresOff.launcherState, "healthy");
  assert.match(result.featuresOff.selectorSummary, /^Healthy/);
  assert.equal(result.featuresOff.toastHost, false);
  assert.equal(result.diagnosticsOff.state, "healthy");
  assert.deepEqual(result.diagnosticsOff.missing, []);
  assert.equal(result.diagnosticsOff.launcherState, "healthy");
  assert.equal(result.diagnosticsOff.selectorSummary, "Disabled");
  assert.equal(result.diagnosticsOff.toastHost, false);
});

test("Trust surfaces content-free ad-contract drift and resets its bounded history", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    app.id = "react-root";
    app.innerHTML = `
      <main data-testid="primaryColumn">
        <div data-testid="cellInnerDiv" data-ad-fixture="native">
          <article data-testid="tweet"><div data-testid="placementTracking"></div><div data-testid="toolBar" role="group"></div><span>Ad</span></article>
        </div>
        <div data-testid="videoPlayer" data-ad-fixture="video"><span>Video will play after ad</span></div>
      </main>
      <a data-testid="AppTabBar_Home"></a>
      <div data-testid="trend" data-ad-fixture="trend"><span>Promoted by Example Sponsor</span></div>
      <aside aria-label="Subscribe to Premium" data-ad-fixture="house"></aside>
    `;
    document.body.append(app);

    const values = new Map();
    const storage = {
      async get(key, fallback) { return structuredClone(values.get(key) ?? fallback); },
      async set(key, value) { values.set(key, structuredClone(value)); },
      async remove(key) { values.delete(key); }
    };
    const settings = AviarySelectorHealth.cloneSettings(AviarySelectorHealth.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";
    const warnings = [];
    const context = {
      route: { surface: "home" },
      settings,
      storage,
      diagnostics: { info() {}, warn(message, detail) { warnings.push({ message, detail }); }, error() {} }
    };
    await AviarySelectorHealth.selectorHealthFeature.init(context);
    const observed = AviarySelectorHealth.getSelectorHealthSnapshot();

    for (const node of document.querySelectorAll("[data-ad-fixture]")) node.remove();
    await AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    const missing = AviarySelectorHealth.getSelectorHealthSnapshot();

    const panel = AviarySelectorHealth.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getSelectorHealth: () => AviarySelectorHealth.getSelectorHealthSnapshot(),
      clearAdObservations: async () => AviarySelectorHealth.clearAdObservations(storage)
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="trust"]').click();
    const read = (label) =>
      [...shadow.querySelectorAll(".av-row")]
        .find((row) => row.querySelector(".av-row-label")?.textContent === label)
        ?.querySelector(".av-row-description")?.textContent ?? null;
    const driftRow = read("Ad contract drift");
    const countRow = read("Ad marker counts");
    const resetRow = [...shadow.querySelectorAll(".av-row")]
      .find((row) => row.querySelector(".av-row-label")?.textContent === "Reset ad observations");
    resetRow.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve));
    const reset = {
      snapshot: AviarySelectorHealth.getSelectorHealthSnapshot(),
      observations: read("Ad observations"),
      retained: read("Retained ad observations"),
      drift: read("Ad contract drift")
    };
    const persisted = JSON.stringify([...values.entries()]);
    panel.destroy();
    AviarySelectorHealth.selectorHealthFeature.destroy(context);
    return { observed, missing, driftRow, countRow, reset, persisted, warnings };
  });

  assert.deepEqual(result.observed.adObservations.counts, {
    native: 1,
    trend: 1,
    housePromo: 1,
    video: 1
  });
  assert.equal(result.observed.state, "healthy");
  assert.equal(result.missing.state, "degraded");
  assert.deepEqual(result.missing.adObservations.missingContracts, [
    "native",
    "trend",
    "housePromo",
    "video"
  ]);
  assert.match(result.driftRow, /Native, Trend, House promo, Video/);
  assert.match(result.countRow, /Native 0 · Trend 0 · House promo 0 · Video 0/);
  assert.equal(result.warnings.at(-1).message, "Ad contract health degraded");
  assert.equal(result.persisted, "[]");
  assert.equal(result.reset.snapshot.state, "healthy");
  assert.equal(result.reset.observations, "None");
  assert.equal(result.reset.retained, "0");
  assert.equal(result.reset.drift, null);
});

test("current settings pages do not require the timeline-only primary column", async () => {
  const result = await page.evaluate(() => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    app.id = "react-root";
    const nav = document.createElement("nav");
    const link = document.createElement("a");
    link.setAttribute("data-testid", "AppTabBar_Home_Link");
    nav.append(link);
    app.append(nav);
    document.body.append(app);
    return AviarySelectorHealth.getSelectorHealthForRoute(document, "settings");
  });

  const primary = result.find((item) => item.surface === "Primary column");
  const appRoot = result.find((item) => item.surface === "App root");
  const navigation = result.find((item) => item.surface === "Navigation");
  assert.equal(primary.relevance, "inapplicable");
  assert.equal(appRoot.relevance, "required");
  assert.equal(navigation.relevance, "required");
});

test("every selector names the feature that breaks when it stops matching", async () => {
  const SURFACE_SELECTORS = await page.evaluate(() => window.AviarySelectorHealth.SURFACE_SELECTORS);

  // Trust reports these names to a user trying to find out which feature X just broke, so a
  // selector without one leaves them with "something is degraded" and nowhere to go. The field was
  // optional with an if-chain behind it that answered a generic "Aviary surface" for anything the
  // field omitted -- the arrangement its own comment claimed to have replaced.
  const unowned = SURFACE_SELECTORS.filter(
    (entry) => typeof entry.feature !== "string" || entry.feature.trim().length === 0
  );
  assert.deepEqual(
    unowned.map((entry) => entry.surface),
    [],
    "every surface selector must declare its owning feature"
  );

  assert.ok(
    !SURFACE_SELECTORS.some((entry) => entry.feature === "Aviary surface"),
    "the generic fallback label must not survive as a declared value"
  );
});
