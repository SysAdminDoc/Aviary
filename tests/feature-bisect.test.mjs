import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The feature bisect: turning features off in halves until the one breaking the page is named.
 *
 * Two things can go wrong here and only one of them is visible in the search's own arithmetic.
 * The halving can name the wrong feature -- an off-by-one in which half survives an answer -- and
 * that is driven below against every candidate in turn, with an oracle standing in for the user.
 * The other is that "off" does not actually turn anything off: a search that suspends a feature
 * without running its `destroy` reports a culprit while the page never changed. That half is
 * driven against a booted Aviary on X's own markup, using the media controls as the thing the
 * page visibly gains and loses.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let context;
let page;
let temp;
let bundle;
let fixture;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-bisect-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { boot } from ${JSON.stringify(abs("src/main.ts"))};`,
      `export { BisectSession, FeatureBisect, bisectCandidates, describeBisectResult, BISECT_PROTECTED_FEATURES } from ${JSON.stringify(
        abs("src/features/core/feature-bisect.ts")
      )};`,
      `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryBisect",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  fixture = await readFile(path.join(root, "tests/smoke/current-x-home.html"), "utf8");
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/** A blank page: enough for the search's own arithmetic and for mounting the panel. */
async function blankPage() {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
}

/** A booted Aviary on X's captured home markup, with no background to talk to. */
async function bootOnX() {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("https://x.com/home", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture })
  );
  await context.route("**/*", (route) =>
    route.request().url() === "https://x.com/home"
      ? route.fallback()
      : route.fulfill({ status: 204, body: "" })
  );
  page = await context.newPage();
  await page.goto("https://x.com/home");
  await page.evaluate(() => {
    globalThis.chrome = { runtime: { async sendMessage() { return { ok: true }; } } };
  });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(async () => {
    window.__app = await AviaryBisect.boot({ source: "extension" });
    window.__bisect = new AviaryBisect.FeatureBisect();
  });
  await page.waitForTimeout(80);
}

test("whichever feature is broken, the search is the one that names it", async () => {
  await blankPage();

  const outcomes = await page.evaluate(() => {
    // Thirty-three ids, matching what a real boot registers, so the round budget being asserted
    // is the one a user would actually sit through.
    const ids = Array.from({ length: 33 }, (_, index) => `feature.${index}`);
    const results = [];
    for (const broken of ids) {
      const session = new AviaryBisect.BisectSession(ids);
      let rounds = 0;
      while (session.phase !== "done") {
        rounds += 1;
        if (rounds > 20) break;
        // The user's answer, decided by the one feature that is actually at fault: the page looks
        // right exactly when that feature is among the ones currently switched off.
        const fixed = session.disabled.includes(broken);
        session.answer(fixed ? "fixed" : "still-wrong");
      }
      results.push({
        broken,
        rounds,
        totalRounds: session.totalRounds,
        result: session.result,
        disabled: session.disabled.length
      });
    }
    return results;
  });

  assert.equal(outcomes.length, 33);
  for (const outcome of outcomes) {
    assert.deepEqual(
      outcome.result,
      { kind: "culprit", featureId: outcome.broken },
      `the search named ${JSON.stringify(outcome.result)} when ${outcome.broken} was the broken one`
    );
    assert.ok(
      outcome.rounds <= outcome.totalRounds,
      `${outcome.broken} took ${outcome.rounds} rounds against a promised ${outcome.totalRounds}`
    );
    assert.equal(outcome.disabled, 0, "a finished search must leave nothing switched off");
  }
  // 33 features: one round with everything off, then six halvings. Asserted as a number because
  // "about five rounds" is the claim the Trust copy makes to the user.
  assert.equal(outcomes[0].totalRounds, 7);
});

test("still wrong with everything off is reported as not Aviary, not as a feature", async () => {
  await blankPage();

  const outcome = await page.evaluate(() => {
    const session = new AviaryBisect.BisectSession(["a", "b", "c", "d"]);
    const firstRound = { phase: session.phase, disabled: session.disabled };
    session.answer("still-wrong");
    return {
      firstRound,
      result: session.result,
      disabled: session.disabled,
      description: AviaryBisect.describeBisectResult(session.status())
    };
  });

  // The confirming round is what makes this answerable at all: without it the halving would run
  // to completion and name whichever feature the last split happened to isolate.
  assert.equal(outcome.firstRound.phase, "confirming");
  assert.deepEqual(outcome.firstRound.disabled, ["a", "b", "c", "d"]);
  assert.deepEqual(outcome.result, { kind: "not-aviary" });
  assert.deepEqual(outcome.disabled, [], "nothing may stay off once the answer is known");
  assert.match(outcome.description, /still wrong with every Aviary feature off/);
});

test("a search with nothing to test says so instead of naming something", async () => {
  await blankPage();

  const outcome = await page.evaluate(() => {
    const session = new AviaryBisect.BisectSession([]);
    return { phase: session.phase, result: session.result, totalRounds: session.totalRounds };
  });

  assert.equal(outcome.phase, "done");
  assert.deepEqual(outcome.result, { kind: "nothing-to-test" });
  assert.equal(outcome.totalRounds, 0);
});

test("abandoning names nobody and leaves nothing switched off", async () => {
  await blankPage();

  const outcome = await page.evaluate(() => {
    const session = new AviaryBisect.BisectSession(["a", "b", "c", "d", "e"]);
    session.answer("fixed");
    const midRound = { phase: session.phase, disabled: session.disabled, round: session.round };
    session.abandon();
    return { midRound, result: session.result, disabled: session.disabled };
  });

  assert.equal(outcome.midRound.phase, "narrowing");
  assert.ok(outcome.midRound.disabled.length > 0, "the round being abandoned had nothing off");
  assert.deepEqual(outcome.result, { kind: "abandoned" });
  assert.deepEqual(outcome.disabled, []);
});

test("suspending a feature runs its own destroy, and resuming puts the page back", async () => {
  await bootOnX();

  const observed = await page.evaluate(async () => {
    const app = window.__app;
    const count = () => document.querySelectorAll("[data-av-media-button]").length;
    const enabled = () => document.documentElement.classList.contains("av-media-buttons-enabled");
    const before = { buttons: count(), enabled: enabled() };

    await app.registry.suspend(app.context, ["media.buttons"]);
    const during = {
      buttons: count(),
      enabled: enabled(),
      active: app.registry.isActive("media.buttons"),
      suspended: app.registry.suspendedIds()
    };

    await app.registry.resume(app.context);
    await app.registry.applyAll(app.context, document);
    const after = {
      buttons: count(),
      enabled: enabled(),
      active: app.registry.isActive("media.buttons"),
      suspended: app.registry.suspendedIds()
    };
    return { before, during, after };
  });

  // The guard: if the fixture had no media the whole comparison would be 0 === 0 and a suspend
  // that did nothing would pass.
  assert.ok(observed.before.buttons > 0, "the fixture rendered no media controls to remove");
  assert.equal(observed.before.enabled, true);

  assert.equal(observed.during.buttons, 0, "suspending must run the feature's own teardown");
  assert.equal(observed.during.enabled, false);
  assert.equal(observed.during.active, false);
  assert.deepEqual(observed.during.suspended, ["media.buttons"]);

  assert.equal(observed.after.buttons, observed.before.buttons, "resume must put the controls back");
  assert.equal(observed.after.enabled, true);
  assert.equal(observed.after.active, true);
  assert.deepEqual(observed.after.suspended, []);
});

test("run against the live page, the search names the feature that is really changing it", async () => {
  await bootOnX();

  const outcome = await page.evaluate(async () => {
    const app = window.__app;
    const bisect = window.__bisect;
    // The oracle a user would be: "the page is wrong" means the media controls are on it. Nothing
    // here tells the search which feature that is -- it is read back off the document each round,
    // so a suspend that fails to tear the feature down changes the answers rather than being
    // invisible.
    const looksWrong = () => document.querySelectorAll("[data-av-media-button]").length > 0;

    const rounds = [];
    let status = await bisect.start(app.context);
    let guard = 0;
    while (status.phase !== "done" && guard++ < 20) {
      rounds.push({ round: status.round, off: status.disabled.length, wrong: looksWrong() });
      status = await bisect.answer(app.context, looksWrong() ? "still-wrong" : "fixed");
    }
    return {
      rounds,
      result: status.result,
      totalRounds: status.totalRounds,
      buttonsAfter: document.querySelectorAll("[data-av-media-button]").length,
      suspendedAfter: app.registry.suspendedIds(),
      description: AviaryBisect.describeBisectResult(status)
    };
  });

  assert.deepEqual(
    outcome.result,
    { kind: "culprit", featureId: "media.buttons" },
    `the live search reported ${JSON.stringify(outcome.result)}`
  );
  // The first round is what proves the teardown reached the page at all.
  assert.equal(outcome.rounds[0].wrong, false, "round one had every feature off and still saw controls");
  assert.ok(outcome.rounds.length <= outcome.totalRounds);
  assert.ok(outcome.buttonsAfter > 0, "the page must be exactly as it was once the answer is known");
  assert.deepEqual(outcome.suspendedAfter, []);
  assert.match(outcome.description, /media\.buttons/);
});

test("the panel and its language are never the ones turned off", async () => {
  await bootOnX();

  const observed = await page.evaluate(async () => {
    const app = window.__app;
    const bisect = window.__bisect;
    const candidates = AviaryBisect.bisectCandidates(app.registry);
    const everDisabled = new Set();
    const panelSeen = [];
    let status = await bisect.start(app.context);
    let guard = 0;
    while (status.phase !== "done" && guard++ < 20) {
      for (const id of status.disabled) everDisabled.add(id);
      // Read while features are off: checking after the search would find a panel that was torn
      // down and put back, which is exactly the failure this is meant to catch.
      panelSeen.push(Boolean(document.getElementById("av-control-center")?.shadowRoot));
      status = await bisect.answer(app.context, "still-wrong");
    }
    return {
      protectedIds: [...AviaryBisect.BISECT_PROTECTED_FEATURES],
      candidates,
      everDisabled: [...everDisabled],
      registered: app.registry.ids(),
      panelSeen,
      result: status.result
    };
  });

  // Named here rather than read from the constant: a test that iterates whatever the source
  // declares still passes when the source declares nothing.
  assert.deepEqual(observed.protectedIds, ["core.controlCenter", "core.i18n"]);
  for (const id of ["core.controlCenter", "core.i18n"]) {
    assert.ok(observed.registered.includes(id), `${id} is not a real feature id any more`);
    assert.ok(!observed.candidates.includes(id), `${id} was offered as a candidate`);
    assert.ok(!observed.everDisabled.includes(id), `${id} was switched off during the search`);
  }
  // Everything else that was running did get switched off, or the protection is hiding a search
  // that never turned anything off at all.
  assert.ok(observed.candidates.length > 20, `only ${observed.candidates.length} features were testable`);
  assert.deepEqual(observed.everDisabled.sort(), [...observed.candidates].sort());
  assert.ok(observed.panelSeen.length > 0);
  assert.ok(
    observed.panelSeen.every(Boolean),
    "the Control Center went away during a round it is supposed to be exempt from"
  );
  // Answering "still wrong" to a round with everything off is the not-Aviary path.
  assert.deepEqual(observed.result, { kind: "not-aviary" });
});

test("abandoning a live search restores every feature it had turned off", async () => {
  await bootOnX();

  const observed = await page.evaluate(async () => {
    const app = window.__app;
    const bisect = window.__bisect;
    const snapshot = () => ({
      classes: [...document.documentElement.classList].filter((name) => name.startsWith("av-")).sort(),
      buttons: document.querySelectorAll("[data-av-media-button]").length,
      active: app.registry.ids().filter((id) => app.registry.isActive(id))
    });

    const before = snapshot();
    await bisect.start(app.context);
    const allOff = snapshot();
    // Answer one round so the search is genuinely mid-narrowing rather than sitting on round one.
    await bisect.answer(app.context, "fixed");
    const midway = snapshot();
    const status = await bisect.cancel(app.context);
    await app.registry.applyAll(app.context, document);
    return { before, allOff, midway, after: snapshot(), status, idle: bisect.status() };
  });

  assert.ok(observed.before.active.length > 5, "nothing was running to abandon");
  assert.ok(observed.before.classes.length > 0, "no feature had marked the document to begin with");
  assert.ok(
    observed.allOff.active.length < observed.before.active.length,
    "starting the search turned nothing off"
  );
  assert.ok(
    observed.midway.active.length > observed.allOff.active.length,
    "answering a round put nothing back"
  );

  assert.deepEqual(observed.after.active, observed.before.active);
  assert.deepEqual(observed.after.classes, observed.before.classes);
  assert.equal(observed.after.buttons, observed.before.buttons);
  assert.deepEqual(observed.status.result, { kind: "abandoned" });
  assert.equal(observed.idle.phase, "idle", "a cancelled search must not linger in the panel");
});

test("the Trust section asks the question, takes the answer, and names the culprit", async () => {
  await blankPage();

  const rendered = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryBisect.cloneSettings(AviaryBisect.DEFAULT_SETTINGS);
    // The real runner, over a registry stub that records what it is asked to turn off. The panel
    // is therefore wired to the same object the app wires it to, not to a reimplementation of the
    // search that could agree with the rows while the product disagrees.
    const ids = ["alpha", "beta", "gamma", "delta"];
    const off = new Set();
    const registry = {
      ids: () => ids,
      isActive: (id) => !off.has(id),
      title: (id) => `Feature ${id}`,
      suspendedIds: () => ids.filter((id) => off.has(id)),
      suspend: async (_ctx, wanted) => {
        for (const id of wanted) off.add(id);
        return [...wanted];
      },
      resume: async (_ctx, wanted) => {
        for (const id of wanted ?? [...off]) off.delete(id);
        return [];
      }
    };
    const applied = [];
    const ctx = {
      registry,
      auditLog: { record: async () => {} },
      requestApply: () => applied.push([...off])
    };
    const bisect = new AviaryBisect.FeatureBisect();

    const panel = AviaryBisect.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getBisectStatus: () => bisect.status(),
      startBisect: () => bisect.start(ctx),
      answerBisect: (verdict) => bisect.answer(ctx, verdict),
      cancelBisect: () => bisect.cancel(ctx),
      featureTitle: (id) => registry.title(id)
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="trust"]').click();

    const click = async (label) => {
      const button = [...shadow.querySelectorAll(".av-button")].find(
        (candidate) => candidate.textContent === label
      );
      if (!button) throw new Error(`missing action: ${label}`);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    const text = () => shadow.querySelector(".av-content").textContent;
    // "beta" is the one at fault: the page looks right exactly when beta is among those off.
    const answerFor = () => (off.has("beta") ? "The page looks right now" : "The page is still wrong");

    const idle = text();
    await click("Find the feature breaking this page");
    const round1 = { text: text(), off: [...off] };
    await click(answerFor());
    const round2 = { text: text(), off: [...off] };
    await click(answerFor());
    const round3 = { text: text(), off: [...off] };
    await click(answerFor());
    const done = text();
    const result = bisect.status().result;
    const leftOff = [...off];
    panel.destroy();
    return { idle, round1, round2, round3, done, result, leftOff, applied };
  });

  assert.match(rendered.idle, /Find the feature breaking this page/);
  assert.doesNotMatch(rendered.idle, /The page looks right now/, "the answers appear only mid-search");

  assert.match(rendered.round1.text, /Round 1 of 3/);
  assert.match(rendered.round1.text, /All 4 features are off/);
  assert.deepEqual(rendered.round1.off.sort(), ["alpha", "beta", "delta", "gamma"]);

  assert.match(rendered.round2.text, /Round 2 of 3/);
  assert.equal(rendered.round2.off.length, 2, "a halving round must turn half of them back on");
  assert.match(rendered.round3.text, /Round 3 of 3/);
  assert.match(rendered.round3.text, /Still suspected/, "the last suspects are named while there are few");

  assert.deepEqual(rendered.result, { kind: "culprit", featureId: "beta" });
  assert.match(rendered.done, /Feature beta is what changed this page/);
  assert.match(rendered.done, /Search again/);
  assert.doesNotMatch(rendered.done, /The page is still wrong/, "a finished search stops asking");
  assert.deepEqual(rendered.leftOff, [], "the culprit is named, not left switched off");
  assert.ok(rendered.applied.length >= 4, "every round must ask the page to be re-applied");
});
