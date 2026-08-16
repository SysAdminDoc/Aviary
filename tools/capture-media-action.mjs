import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  root,
  process.argv[2] ?? "docs/audit/2026-08-16/media-download-action.png"
);
const viewportWidth = Number.parseInt(process.argv[3] ?? "1100", 10);
const viewportHeight = Number.parseInt(process.argv[4] ?? "760", 10);
const temp = await mkdtemp(path.join(tmpdir(), "aviary-media-action-"));
const bundle = path.join(temp, "media-action.js");

try {
  await build({
    stdin: {
      contents: `
        export { mediaButtonsFeature } from "./src/features/media/media-buttons";
        export { DEFAULT_SETTINGS } from "./src/platform/settings";
      `,
      resolveDir: root
    },
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryMediaCapture",
    platform: "browser",
    target: "chrome116",
    logLevel: "silent"
  });

  await mkdir(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: viewportWidth, height: viewportHeight },
    deviceScaleFactor: 1
  });
  await page.route("https://pbs.twimg.com/media/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2d5475"/><stop offset=".5" stop-color="#8b5d7b"/><stop offset="1" stop-color="#e0a05b"/></linearGradient></defs>
        <rect width="1200" height="675" fill="url(#g)"/><circle cx="920" cy="180" r="95" fill="#ffd9a0" opacity=".85"/><path d="M0 535L260 330l190 155 190-220 310 300 250-120v230H0z" fill="#111923" opacity=".75"/>
      </svg>`
    })
  );
  await page.setContent(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><style>
      *{box-sizing:border-box} body{margin:0;background:#000;color:#e7e9ea;font:15px/1.35 Inter,Arial,sans-serif}
      main{width:min(660px,calc(100vw - 24px));margin:48px auto;border:1px solid #2f3336;border-radius:12px;overflow:hidden;background:#000}
      .top{height:54px;padding:16px;border-bottom:1px solid #2f3336;font-size:20px;font-weight:800}
      article{padding:16px;border-bottom:1px solid #2f3336}
      .identity{display:flex;gap:10px;align-items:center}.avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#1d9bf0,#9c6ade)}
      .name{font-weight:750}.handle,.time{color:#71767b}.copy{margin:10px 0 12px 54px;font-size:16px}
      [data-testid="tweetPhoto"]{position:relative;margin-left:54px;border:1px solid #2f3336;border-radius:14px;overflow:hidden;height:285px}
      [data-testid="tweetPhoto"] img{display:block;width:100%;height:100%;object-fit:cover}
      [role="group"]{display:flex;align-items:center;justify-content:space-between;margin:10px 0 0 44px;min-height:40px;color:#71767b}
      .native{appearance:none;border:0;background:transparent;color:#71767b;display:flex;align-items:center;gap:7px;min-width:48px;height:36px;padding:0 8px;font:600 13px Inter,Arial,sans-serif}
      .native span{font-size:17px;color:#8b98a5}.caption{margin:18px 16px;color:#8b98a5;font-size:13px}
      @media(max-width:520px){main{margin:12px auto}.copy{margin-left:0}[data-testid="tweetPhoto"]{margin-left:0;height:240px}[role="group"]{margin-left:0}.native{min-width:36px;padding:0 4px}.caption{display:none}}
    </style></head><body><main><div class="top">Home</div>
      <article data-testid="tweet">
        <div class="identity"><div class="avatar"></div><div><span class="name">Aviary Studio</span> <span class="handle">@aviary</span> · <span class="time">2m</span></div></div>
        <a href="/aviary/status/1234567890" hidden></a>
        <div data-testid="User-Name"><a href="/aviary" hidden></a></div>
        <div class="copy" data-testid="tweetText">A high-resolution photo, ready to save at original quality.</div>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/AviaryCapture?format=jpg&name=small" alt="Mountain landscape"></div>
        <div role="group" aria-label="Post actions">
          <button class="native" data-testid="reply"><span>○</span> 18</button>
          <button class="native"><span>↻</span> 42</button>
          <button class="native"><span>♡</span> 326</button>
          <button class="native"><span>▱</span> 12K</button>
          <button class="native"><span>⌑</span></button>
        </div>
      </article><div class="caption">Aviary inserts one clear action into the post's native control row; the media overlay remains available for single-asset saves.</div>
    </main></body></html>`);
  await page.addScriptTag({ path: bundle });
  await page.evaluate(async () => {
    const settings = structuredClone(AviaryMediaCapture.DEFAULT_SETTINGS);
    const storage = {
      async get(_key, fallback) { return fallback; },
      async set() { return undefined; }
    };
    await AviaryMediaCapture.mediaButtonsFeature.init({
      settings,
      storage,
      route: { surface: "home", path: "/home", href: "https://x.com/home" },
      diagnostics: {
        info() { return undefined; },
        warn() { return undefined; },
        error() { return undefined; }
      },
      auditLog: { record() { return undefined; } },
      requestApply() { return undefined; }
    });
  });
  await page.screenshot({ path: output });
  await browser.close();
  console.log(path.relative(root, output));
} finally {
  await rm(temp, { recursive: true, force: true });
}
