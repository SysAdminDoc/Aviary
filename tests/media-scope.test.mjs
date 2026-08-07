import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function presentationCss() {
  const source = await readFile(
    path.join(root, "src/features/media/media-presentation.ts"),
    "utf8"
  );
  const open = "const PRESENTATION_CSS = `";
  return source.slice(source.indexOf(open) + open.length, source.lastIndexOf("`;"));
}

/**
 * The "Photos and videos" control is labelled for what it does, not what it was named for.
 *
 * `media.sensitive` reads like a sensitive-content control, and its blur and hide rules match
 * every `tweetPhoto` and video in the timeline. A user who picked "blur" got every image in their
 * timeline smeared and reasonably read it as images failing to load.
 *
 * Scoping the rules to genuinely sensitive media needs a capture containing some: `home.html` has
 * three photos and two videos with zero sensitive markers, and `status.html` has four with zero.
 * The one `contentDisclosureButton` in either file belongs to the composer toolbar, not a post.
 *
 * When that capture arrives and the rules are scoped, this test fails — which is the point. The
 * label should go back to naming sensitive media at the same moment the behaviour does.
 */
test("blur and hide affect every photo, so the control must not claim otherwise", async () => {
  const css = await presentationCss();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(root, "_decoded/home.html")).href, {
      waitUntil: "domcontentloaded"
    });

    const measured = await page.evaluate((styleText) => {
      const style = document.createElement("style");
      style.textContent = styleText;
      document.head.append(style);

      const photos = () => [
        ...document.querySelectorAll('article[data-testid="tweet"] [data-testid="tweetPhoto"]')
      ];
      document.documentElement.className = "av-sensitive-blur";
      const blurred = photos().filter((photo) => {
        const img = photo.querySelector("img");
        return img ? getComputedStyle(img).filter.includes("blur") : false;
      }).length;

      document.documentElement.className = "av-sensitive-hide";
      const hidden = photos().filter((photo) => getComputedStyle(photo).display === "none").length;

      return {
        total: photos().length,
        blurred,
        hidden,
        sensitiveMarkers: document.querySelectorAll(
          'article[data-testid="tweet"] [data-testid="contentDisclosureButton"]'
        ).length
      };
    }, css);

    assert.ok(measured.total >= 3, `expected photos in the fixture, found ${measured.total}`);
    assert.equal(
      measured.sensitiveMarkers,
      0,
      "the fixture has no sensitive media — if that changed, scope the rules and relabel"
    );
    assert.equal(measured.blurred, measured.total, "blur reaches every photo, sensitive or not");
    assert.equal(measured.hidden, measured.total, "hide reaches every photo, sensitive or not");

    // The label has to admit it.
    const panel = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");
    assert.match(panel, /"blur", "Blur every photo and video"/);
    assert.match(panel, /"hide", "Hide every photo and video"/);
  } finally {
    await browser.close();
  }
});

/**
 * A preset's description is the only thing a user reads before applying it, and applying one
 * rewrites their timeline. Two of them described changes they did not make, and one made a change
 * it did not describe.
 */
test("preset descriptions account for the settings that visibly change the timeline", async () => {
  const { PRESETS } = await import(await bundlePresets());

  for (const preset of PRESETS) {
    const description = preset.description.toLowerCase();
    if (preset.overrides.appearance?.hideCounts === true) {
      assert.match(
        description,
        /count/,
        `${preset.id} hides engagement counts without saying so`
      );
    }
    // Nothing may claim to act on sensitive media specifically: the build cannot tell sensitive
    // media apart, so any such claim is one it cannot keep.
    assert.ok(
      !description.includes("sensitive"),
      `${preset.id} claims to act on sensitive media, which the build cannot identify`
    );
  }
});

async function bundlePresets() {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { build } = await import("esbuild");
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-presets-"));
  const outfile = path.join(temp, "presets.mjs");
  await build({
    entryPoints: [path.join(root, "src/features/core/presets.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  return `${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`;
}
