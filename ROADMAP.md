# Aviary ROADMAP

Version: `1.13.0`
Research date: 2026-05-19
Target repo: `C:\Users\--\repos\Twitter_Userscript`
Target sites: `x.com`, `twitter.com`, `mobile.twitter.com`, `pro.x.com`, `tweetdeck.twitter.com`
Implementation status: **v1.6.0 is implemented.** The release adds per-post hide-and-remember (F105): a Hide control on every post, a persisted `aviary.hiddenPosts.v1` store keyed by status id with a handle+text signature fallback, collapse of the owning `[data-testid="cellInnerDiv"]` row so the next post is promoted instead of leaving a gap, an undo toast, and a Control Center "Hidden posts" section. Earlier baseline summary:

> **v1.5.0 was implemented.** The release adds opt-in CheckpointStore retention (`aviary.retention.maxJobs`, `maxRecordsPerJob`, `maxAgeDays`), persisted Aria2 gid history with completion/error reconciliation, Bluesky image and Mastodon media uploads for explicit crossposts, the default-off "Attach last download" toggle, and a pinned Playwright 1.62.1 smoke workflow with cached browsers and isolated execution. F032/F033 still need authenticated `_decoded/` fixtures. Earlier baseline summary:

> **v1.3.0 was implemented:** A new `settings.integrations` envelope holds Aria2 / Bluesky / Mastodon / AI / semantic-search configuration; every integration defaults to disabled and only acts when the user provides credentials. `features/integrations/aria2.ts` adds a JSON-RPC client + `shouldHandoffToAria2` threshold check; `Downloader` now picks Aria2 first when enabled and the request exceeds `integrations.aria2.minBytes` (F056). `features/integrations/crosspost.ts` provides Bluesky AT-protocol `createSession` + `createRecord` and Mastodon `POST /api/v1/statuses` clients, surfaced as two Control Center actions that send the current composer text (F077). `features/integrations/ai-provider.ts` adds `runAiPrompt` with adapters for Anthropic Messages and OpenAI-compatible chat completions; the local AI command menu (`features/ai/command-menu.ts`) now routes prompts through the provider when the integration is enabled and copies the response to the clipboard — when it isn't, the prompt itself is copied (F083). `features/integrations/semantic-search.ts` adds `SemanticIndex` with on-demand embedding fetch + cosine ranking, persisted under `aviary.semanticIndex.v1` (F067). The Control Center "Integrations" section surfaces every endpoint / token field plus a "Test Aria2 connection", "Rebuild semantic index", semantic search input, and clear-index action. F099 Playwright live smoke still requires `playwright` + browser binaries and remains queued for v1.4+. Earlier baseline summary:

> **v1.2.0 was implemented:** Batch profile-media downloader walks every visible tweet and pipes photos / videos / GIFs / thumbnails through the existing queue with per-mode concurrency, history dedup, and audit logging (F048 + F049). `export/warc.ts` writes ISO-28500 WARC/1.1 records that wrap captured `ExportRecord` payloads + media URLs for archival tooling (F071). `export/external-targets.ts` renders the same records as clipboard Markdown / Obsidian frontmatter Markdown / Notion-friendly Markdown / raw JSON, surfaced as Control Center actions (F069). `ai/command-menu.ts` adds a tweet-toolbar AI button that opens a four-command menu (Translate / Summarize / Explain / Fact-check prompt) and copies the assembled prompt to the clipboard — no network calls, no API keys required (F082 baseline). F099 Playwright live smoke, F067 semantic search, F056 native companion + Aria2 handoff, and F077 crosspost still need third-party binaries / accounts / tokens; they remain queued for v1.3+. Earlier baseline summary:

> **v1.1.0 was implemented:** XLSX format ships via a tiny SpreadsheetML writer that reuses the STORE-only ZIP encoder (F058 finishing). `library/bookmarks.ts` adds a persisted bookmark library with tags / folders / reminders / due-time queries (F068). `export/network-capture.ts` ships a guarded passive `fetch` interceptor that records GraphQL response bodies into the CheckpointStore as a `capture-<operation>` job when `export.preserveRawPayloads` is `true`, caps payloads at 1.5 MB, scrubs `ct0` cookies and bearer tokens, and uninstalls cleanly on toggle (F091 stage 2). `composer/composer-snippets.ts` adds a Snippets button next to `[data-testid="toolBar"]` that opens a popover and inserts via `document.execCommand("insertText")` — no keyboard simulation (F075 insertion). F048/F049 batch media and F099 Playwright smoke remain queued for v1.2+. Blocked-account (F032) and self-repost (F033) filters stay deferred until authenticated fixtures land.

Earlier baseline summary:

> **v1.0.0** shipped competitor parity: Competitor-baseline parity lands as: 6 preset packs (Quiet Reader, Media Archivist, Creator, Researcher, Classic, Minimal) with a Control Center applier + delta describer (F104); 9-locale i18n bundle with translate / fallback / RTL direction reporting wired through an `av-rtl` / `av-ltr` HTML class + lang-aware tweet text direction CSS (F095 + F096); mobile + touch ergonomics module with `pointer:coarse` and `(max-width: 760px)` media-query classes, larger action targets, and a wider Control Center panel below 760px (F097); read-only Cleanup Review Queue with explicit `destructiveAllowed()` returning `false` by policy in v1.0.0, persisted through the storage gateway, never deleting account data (F079 / F080 safe slice). Media batch downloader (F048/F049) stays parked for v1.1+ since it requires walking long profile-media routes and live network capture. XLSX, F068 bookmark tags, F091 stage 2 (active GraphQL capture), composer insertion, and F099 Playwright also carry forward to v1.1+. Blocked-account (F032) and self-repost (F033) filters remain parked behind missing authenticated fixtures.

## Project Overview

Project name: `Aviary`

One-line pitch: a local-first, premium dark-mode X/Twitter enhancer that unifies the best control-panel, old-layout, media-download, export/archive, filtering, analytics, accessibility, and safety features into one reversible userscript-first product with an optional MV3 extension build.

Chosen vehicle:

| Vehicle | Role | Rationale |
|---|---|---|
| Userscript | Primary v1 delivery | Single-file portability, fast iteration, readable source, Greasy Fork/OpenUserJS distribution, direct SPA decoration, `unsafeWindow` hooks where available, and lower setup friction. |
| MV3 extension | Secondary build target | Required for Chrome/Firefox/Edge stores, `chrome.downloads`, optional permissions, `declarativeNetRequest`, side panel, context menus, background queues, and polished non-technical installation. |
| Native companion | Later optional add-on | Only justified for heavy media muxing, Aria2/gallery-dl/yt-dlp handoff, WARC/WACZ conversion, very large archive search, or local model workflows. Keep v1 valuable without it. |

Product philosophy to preserve:

| Principle | Roadmap implication |
|---|---|
| Dark premium UI only | Ship deep dark/OLED/dim palettes, glass-style panels where technically safe, dense mode, branded accent, and custom scrollbar. Do not add a light theme. |
| No keyboard shortcuts | Every command is visible as a button, menu item, toggle, or toast action. Competitor hotkey features are rejected or converted to pointer/touch affordances. |
| No confirmation dialogs | Use immediate action, progress, cancel, undo where possible, protected lists, and toasts. Destructive batch actions use a review queue, not modal confirmations. |
| Everything is reversible | Every feature exposes `init()` and `destroy()` and cleans DOM nodes, CSS classes, observers, timers, monkey patches, network hooks, and event listeners. |
| Stable selectors first | Prefer `data-testid`, `role`, `aria-*`, routes, and structural anchors. Hashed classes are health checks and fallbacks only. |
| Local-first privacy | No account tokens leave the browser. No telemetry by default. Imports, archives, settings, and logs stay local unless the user explicitly exports them. |
| Userscript readability | Single-file build must remain auditable, with source sections, version metadata, update URL, and no minified-only distribution. |
| TrustedTypes ready | All HTML injection goes through one policy wrapper. Prefer `createElement`/text nodes for host-page DOM. |

## State Of The Repo

Internal memo from Phase 0:

| Area | Current state |
|---|---|
| Git state | Git repository with the `origin` remote on GitHub; work lands as conventional commits on `main`. |
| Source code | TypeScript scaffold exists under `src/` with shared userscript/MV3 entry points, platform primitives, feature registry, and selector diagnostics. |
| Build system | npm with TypeScript and esbuild dev dependencies. `npm run verify` type-checks, runs tests, and builds userscript plus MV3 extension folders. |
| Top-level docs | `README.md`, `ROADMAP.md`, `PROJECT_STATE.md`, and `LICENSE` exist. |
| Runtime target | Browser-hosted JavaScript: readable userscript first, MV3 extension second. |
| Ground-truth fixtures | Two MHTML captures plus decoded HTML/CSS in `_decoded/`. These are the only local evidence for the current X DOM. |
| Current deliverable | v0.1.0 through **v1.6.0** are complete. v1.6.0 added per-post hide-and-remember with virtualizer-aware collapse, undo, and a Control Center management section. F032/F033 stay parked behind missing authenticated fixtures. |

Roadmap progress:

| Version | Status | Notes |
|---|---|---|
| v0.1.0 | Complete | License, README stub, TypeScript/esbuild scaffold, userscript/MV3 entries, feature registry, settings schema, TrustedTypes helper, selector-health feature, fixture tests, CI, and dependency policy are implemented. |
| v0.2.0 | Complete | Shadow DOM Control Center, persisted settings updates, theme foundation, document-start dark theme state, dim/OLED-compatible tokens, reduced motion, and focus/ARIA contract checks are implemented. |
| v0.3.0 | Complete | Layout declutter classes, sidebar/trends/Grok hiding, selected nav hiding, privacy manifest, and optional permission shell are implemented. |
| v0.4.0 | Complete | Filter engine (`src/features/filtering/`): per-tweet keyword/regex predicates, premium/verified action, photo/video/GIF media-type filter, route-scoped (`filter.surfaces`) timeline-position gating, whitelist, master toggle, hide/dim CSS states. Processes added tweet articles only, never scans the full document on each mutation, and reverses cleanly when filters are disabled or the feature is destroyed. F032 (blocked accounts) and F033 (self-reposts) are parked behind authenticated fixtures and surfaced as a Control Center readonly row. |
| v0.5.0 | Complete | One-click media (`src/features/media/`): per-tweet Save/Thumb buttons that normalize image URLs to `name=orig` (F041 + F043 baseline), templated filenames via `renderFilename` with `{handle}/{tweetId}/{mediaId}/{index}/{total}/{date}/{text}/{ext}` (F045), persisted dedup history with eviction (F046), in-memory job queue with status counts (F050), and video poster thumbnail download (F044). Userscript path uses `GM_download`; extension path messages the background service worker which dispatches `chrome.downloads` with `conflictAction: uniquify`; anchor fallback handles everything else. Buttons live only inside the tweet photo container and respect the master toggle. |
| v0.6.0 | Complete | Video / GIF download + media presentation: `video-extract.ts` picks the highest-bitrate variant from `<video>`/`<source>`, detects GIF-style players (loop+muted or `tweet_video/` URLs), and feeds the existing downloader/queue/history pipeline (F042). `media-presentation.ts` applies reversible sensitive (default/reveal/blur/hide) and media-layout (default/stacked/grid) classes from settings (F037 + F022). ZIP chunking (F047) and save-location memory (F051) are intentionally rolled into v0.7.0 with the export-core work where batch scale starts to matter. |
| v0.7.0 | Complete | Export core (`src/features/export/`): DOM-based passive collector for visible tweets, persisted CheckpointStore with record dedup (F057, F059), JSON/CSV/HTML/Markdown formatters (F058 — XLSX deferred to v0.8.0), from-scratch STORE-only ZIP encoder with IEEE-802.3 CRC32 (F047), passive GraphQL query-ID discovery over loaded scripts (F061), and Control Center actions for "Export visible tweets" and "Copy diagnostics" (F102). Save-folder hint (`media.lastSaveFolder`) is wired through into the ZIP filename and entry prefix (F051). Active fetch/XHR interception for full GraphQL response capture (F091) is intentionally deferred to v0.8.0 so the trust contract stays untouched in this release. |
| v0.8.0 | Complete | Archive completeness: collector extensions for image alt-text, polls, quote-tweet wrappers, embedded article cards, and Birdwatch context (F054 + F064). `collectProfileAbout` scrapes `/handle` route metadata (F063). `AuditLog` ring buffer records media downloads, exports, settings roundtrips, and diagnostic copies (F092). Settings import/export via JSON envelopes with normalization + version warnings (F009). XLSX and F091 stage 2 are explicitly rolled into v0.9.0+ since they need binary spreadsheet tooling and a network-interception trust review respectively. |
| v0.9.0 | Complete | Library + power UX (focused slice): `library/user-notes.ts` persists per-handle notes with reversible Note badges + Control Center editor (F027); `library/link-unshorten.ts` rewrites visible `t.co` redirects to their destinations and restores original text on destroy (F074); Control Center "Library" section adds a `composer.snippets` textarea editor (F075 editor). XLSX, F066 local search, F068 bookmark tags/folders/reminders, F091 stage 2, and the snippet-insertion path are explicitly deferred to v0.10.0+. |
| v0.10.0 | Complete | MV3 store hardening: `tools/build.mjs` produces STORE-only `dist/extension-{chrome,firefox}-v<version>.zip` archives (F100); `tools/preflight.mjs` enforces manifest version sync, no `<all_urls>`, no `unsafe-eval`/`wasm-eval`, no `eval()`/`new Function()` in compiled bundles, pinned devDependencies, and the source-policy contract (F089 + F090); `docs/INSTALL.md` + `docs/FAQ.md` document every install path and the privacy contract (F101). `npm run verify` chains `typecheck → test → build → preflight`. F099 Playwright smoke needs a separate dev dep and carries forward. |
| v0.11.0 | Complete | Advanced data + cleanup preview: `library/snapshots.ts` + feature module persist follower / following snapshots (F065); `export/zip-reader.ts` + `library/archive-import.ts` ingest official X archive ZIPs into the CheckpointStore (F070); `library/cleanup-preview.ts` reads-only classifies records by bucket and respects the whitelist (F079); `library/reports.ts` emits Markdown audit + snapshot diff + cleanup bundles (F072); `library/local-search.ts` indexes the CheckpointStore and is wired into the Control Center "Snapshots & Archive" section (F066). Carry-overs (XLSX, F068, F091 stage 2, composer insertion, F099 Playwright) roll to v1.0.0. |
| v1.0.0 | Complete | Beats every competitor baseline: 6-preset pack (Quiet Reader / Media Archivist / Creator / Researcher / Classic / Minimal) with delta describer (F104); 9-locale i18n bundle with translate + fallback + RTL/CJK direction (F095 + F096); mobile + touch ergonomics media queries with bigger action buttons and panel sizing (F097); read-only cleanup review queue with `destructiveAllowed() === false` by policy (F079 / F080 safe slice). F048 / F049 media batch downloader carries forward to v1.1+. |
| v1.1.0 | Complete | XLSX format via SpreadsheetML over the existing STORE-only ZIP encoder (F058 finishing); `library/bookmarks.ts` persisted library with tags / folders / reminders + due-time queries (F068); `export/network-capture.ts` guarded passive GraphQL interceptor (F091 stage 2) capped at 1.5 MB and auth-scrubbed; `composer/composer-snippets.ts` Snippets button + popover with `execCommand("insertText")` insertion into `[data-testid="tweetTextarea_0"]` (F075 insertion). F048/F049 media batch + F099 Playwright smoke remain queued. |
| v1.2.0 | Complete | Batch profile-media downloader F048/F049 (queue + concurrency + history dedup + audit), WARC export F071 (ISO-28500/1.1), external export targets F069 (clipboard Markdown / Obsidian frontmatter / Notion / raw JSON), AI command menu scaffold F082 (local prompt builder, clipboard-only — no API calls). |
| v1.3.0 | Complete | Integration scaffolds, all opt-in: Aria2 JSON-RPC handoff (F056), Bluesky AT-protocol + Mastodon crosspost (F077), provider-backed AI runner — Anthropic Messages / OpenAI / OpenAI-compatible (F083), semantic search with on-demand embedding fetch + cosine ranking (F067). Settings hold endpoint / API key fields per integration; URLs are validated and only `http://`/`https://` allowed. |
| v1.4.0 | Complete | Aria2 sweep + cancel (`aria2.tellActive`/`aria2.remove`), thread mode for Bluesky + Mastodon crosspost (`splitForThread`, `reply.root/parent` + `in_reply_to_id` chaining), `recentIntegrationErrors` audit-log readout, auto-embedding on every export (`integrations.semanticSearch.autoIndex`), Playwright smoke spec scaffold + `npm run smoke`. |

Original capture tree from research baseline:

```text
C:\Users\--\repos\Twitter_Userscript
|-- Home _ X.mhtml
|-- ROADMAP.md
|-- Status _ X.mhtml
`-- _decoded
    |-- home.00.cid_css-537e3a48-e7aa-423d-966a-081f8cfdf0f1_mhtml.blink.css
    |-- home.01.cid_css-8d327502-3c64-409c-b19b-61f18adcad45_mhtml.blink.css
    |-- home.02.cid_css-dec10014-71b1-421d-8685-9aa9b1234e8e_mhtml.blink.css
    |-- home.03.cid_css-c4da9c98-eadd-47df-8209-9755e36440f1_mhtml.blink.css
    |-- home.04.cid_css-18e730c4-c219-424c-b9cc-4a6bcd8be4ae_mhtml.blink.css
    |-- home.05.cid_css-e801a260-b105-4888-a877-47c31958ffd7_mhtml.blink.css
    |-- home.06.cid_css-4f2ad719-26e0-41f1-8153-4d62fe2c7ca4_mhtml.blink.css
    |-- home.07.cid_css-4a8d4aee-5d3f-4eff-9b0d-437403b38acf_mhtml.blink.css
    |-- home.08.cid_css-3879a3a4-39f9-4b83-a977-cec60aea6b33_mhtml.blink.css
    |-- home.09.cid_css-244fac10-3497-45d9-83a5-fa8bc275c0cb_mhtml.blink.css
    |-- home.10.cid_css-2c58579f-e602-4052-97bd-1c76624c1edc_mhtml.blink.css
    |-- home.html
    |-- status.00.cid_css-57ead825-c1f4-4fdf-9dda-7a14c89b9157_mhtml.blink.css
    |-- status.01.cid_css-31a3c85f-06a5-437b-8f65-46c7df105c0b_mhtml.blink.css
    |-- status.02.cid_css-fa80ef7c-29ac-4dab-abaa-0a6f6ec459b6_mhtml.blink.css
    |-- status.03.cid_css-5fa0a2a1-223f-4f33-9430-8ee4041200af_mhtml.blink.css
    |-- status.04.cid_css-76c640e3-5284-44fc-be52-6a6e265cc4d3_mhtml.blink.css
    |-- status.05.cid_css-d93bfd3e-6cb6-45ce-bf94-7b11ad905db6_mhtml.blink.css
    |-- status.06.cid_css-1c266179-0b24-4a7e-a39f-dd0ff1c9c183_mhtml.blink.css
    |-- status.07.cid_css-4d8473c4-30f3-419d-aa62-69ef11002ffc_mhtml.blink.css
    |-- status.08.cid_css-1fabc71c-971a-468a-ae35-b54a166c354a_mhtml.blink.css
    |-- status.09.cid_css-4cc12d5e-c247-4f52-9569-5787f15f2adf_mhtml.blink.css
    `-- status.html
```

Manifest/dependency fingerprint:

| Fingerprint | Result | Constraint |
|---|---|---|
| JavaScript/TypeScript source | None yet | The roadmap must define a future toolchain rather than refactor an existing one. |
| Package manager | None yet | Start with dependency-minimal userscript; add a locked Node toolchain only when moving to dual builds. |
| License | None present | Phase 0.1 must choose a license before publishing any code. MIT is compatible with many sources, but GPL-derived code must not be copied into MIT code. |
| Tests | None yet | First implementation phase must add fixture tests using local MHTML/decoded HTML. |
| CI | None yet | CI belongs in the first scaffold phase, but not this planning run. |
| Commit history | Unavailable | No recurring local pain points can be inferred from commits. Use competitor issues/community signals instead. |

TODO/FIXME scan:

| Scope | Result |
|---|---|
| Repo source/docs | No meaningful source TODOs exist because there is no source. |
| MHTML/decoded HTML/CSS | Raw text contains unrelated words like `placeholder` and base64 fragments; no repo-authored TODO/FIXME/HACK/XXX items were found. |

Hard technical constraints:

| Constraint | Impact |
|---|---|
| X DOM churn | Feature code must use selector lists, route-aware reapplication, fixture tests, and selector health reporting. |
| X API volatility | Internal GraphQL query IDs are volatile. Learn live from network responses and JS bundles; cache with expiry and fallback to passive capture. |
| Browser store policies | MV3 package cannot fetch or execute remote code. Userscript distribution must be readable and avoid obfuscated supply-chain risk. |
| X developer guidelines | Avoid auto-like, auto-follow, engagement farming, credential export, rate-limit abuse, or API-limit bypass claims. |
| Privacy expectations | Extension/userscript can see highly sensitive account state. Permissions must be narrow, local-only behavior must be explicit, and exports must be user-initiated. |
| Accessibility | No keyboard shortcuts does not remove keyboard accessibility. Controls still need focus management, ARIA, and touch targets. |

## Local DOM And API Reconnaissance

MHTML parse results:

| Capture | URL | HTML | CSS | Media parts | Embedded JS bodies |
|---|---:|---:|---:|---:|---:|
| `Home _ X.mhtml` | `https://x.com/home` | 315,084 bytes | 11 parts, 104,393 bytes | 27 | 0 |
| `Status _ X.mhtml` | `https://x.com/<account>/status/<id>` | 263,371 bytes | 10 parts, 104,319 bytes | 17 | 0 |

DOM inventory:

| Capture | Forms | Articles | Main | Aside | Nav | `data-testid` instances |
|---|---:|---:|---:|---:|---:|---:|
| Home | 1 | 9 | 1 | 2 | 4 | 231 across 78 unique ids |
| Status/conversation | 1 | 9 | 1 | 1 | 2 | 208 across 61 unique ids |

Key stable selectors observed:

```text
AppTabBar_Home_Link, AppTabBar_Explore_Link, AppTabBar_Notifications_Link,
AppTabBar_Follow_Link, AppTabBar_DirectMessage_Link, AppTabBar_Profile_Link,
AppTabBar_More_Menu, SideNav_NewTweet_Button, SideNav_AccountSwitcher_Button,
primaryColumn, sidebarColumn, tweet, tweetText, Tweet-User-Avatar, User-Name,
tweetPhoto, videoPlayer, videoComponent, reply, retweet, like, bookmark,
caret, icon-verified, trend, news_sidebar, UserCell, SearchBox_Search_Input,
GrokDrawer, GrokDrawerHeader, chat-drawer-root, chat-drawer-main, BottomBar,
tweetTextarea_0, tweetTextarea_0RichTextInputContainer, tweetButtonInline,
toolBar, fileInput, gifSearchButton, grokImgGen, createPollButton,
scheduleOption, geoButton, contentDisclosureButton, app-bar-back,
inline_reply_offscreen, birdwatch-pivot, icon-birdwatch-fill
```

Selector map:

| Surface | Stable selector | Fragile fallback observed | Churn risk | Implementation note |
|---|---|---|---|---|
| App root | `#react-root` | `body > div:first-child` | Medium | Root for readiness only; do not use as scan scope after boot. |
| Overlay/layers | `#layers` | `.r-1p0dtai.r-1d2f490` | High | Mount Control Center shadow host as sibling where possible, not inside X modals. |
| Primary column | `[data-testid="primaryColumn"]` | `.r-150rngu.r-16y2uox` | Medium | Main observer scope for timeline pages. |
| Sidebar | `[data-testid="sidebarColumn"]` | `.r-1ifxtd0.r-1udh08x` | High | Optional because sidebar collapses by viewport. |
| Feed tweets | `article[data-testid="tweet"]` | `article .css-175oi2r` | High | Process added articles only; add `data-av-processed`. |
| Tweet text | `[data-testid="tweetText"]` | `div[lang] span` under article | Medium | Extract text with fallback to article textContent. |
| Avatar/user | `[data-testid="Tweet-User-Avatar"]`, `[data-testid="User-Name"]` | link to `/{handle}` inside article | Medium | Needed for user filters, labels, exports. |
| Reply/repost/like/bookmark | `[data-testid="reply"]`, `[data-testid="retweet"]`, `[data-testid="like"]`, `[data-testid="bookmark"]` | button groups after tweet text | High | Add action buttons adjacent to stable action group. |
| More/caret | `[data-testid="caret"]` | `button[aria-label="More"]` | Medium | Menu augmentation target. |
| Composer | `[data-testid="tweetTextarea_0"]` | `div[role="textbox"][aria-label]` | High | Draft/thread features need Draft.js-aware insertion. |
| Composer toolbar | `[data-testid="toolBar"]` | button row below textbox | High | Attach visible controls without affecting X buttons. |
| Inline post button | `[data-testid="tweetButtonInline"]` | button with role and Post text | High | State-read only; avoid automation unless user clicks. |
| Media photo | `[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]` | `img[src*="format="]` | Medium | Prefer URL normalization to `name=orig`. |
| Video | `[data-testid="videoPlayer"]`, `[data-testid="videoComponent"]` | `video[src], div[aria-label*="Video"]` | High | Use network capture for variants; DOM alone is incomplete. |
| Search | `[data-testid="SearchBox_Search_Input"]` | `input[placeholder="Search"]` | Medium | Optional search helper source. |
| Trends/news | `[data-testid="trend"]`, `[data-testid="news_sidebar"]` | `aside section` | Medium | Hide/tune features should watch sidebar additions. |
| Nav | `[data-testid^="AppTabBar_"]`, `[data-testid="SideNav_NewTweet_Button"]` | `nav[aria-label] a[role="link"]` | High | Left-nav customization must support compact/mobile nav. |
| Notifications | `[data-testid="AppTabBar_Notifications_Link"]` | nav link href `/notifications` | Medium | Capture missing; route needs live fixture. |
| Messages | `[data-testid="AppTabBar_DirectMessage_Link"]` | nav link href `/messages` | High | Full-screen DM capture missing. |
| Grok | `[data-testid="GrokDrawer"]`, `[data-testid="grokImgGen"]` | `div[id*="grok"]` or text labels | High | Multiple competitors break here; isolate Grok tweaks. |
| Birdwatch/Community Notes | `[data-testid="birdwatch-pivot"]`, `[data-testid="icon-birdwatch-fill"]` | note text structure | Medium | Export and filter as contextual metadata. |

Design tokens and CSS signals:

| Token/signal | Observed value | Use |
|---|---|---|
| Brand blue | `rgb(29, 155, 240)` | Default accent. |
| OLED background | `rgb(0, 0, 0)` | Base for lights-out/OLED. |
| Dim/dark surfaces | `rgb(15, 20, 25)`, `rgb(22, 24, 28)` | Dim restoration and panel backgrounds. |
| Primary text | `rgb(231, 233, 234)`, `rgb(239, 243, 244)` | Contrast tokens. |
| Secondary text | `rgb(113, 118, 123)`, `rgb(83, 100, 113)` | Muted labels. |
| Borders | `rgb(47, 51, 54)` | Dense dividers. |
| Radius | Captured clip paths use `rx="16"` but repo rule caps text-bearing UI at 12px | Use 4/6/8/10/12 for Aviary panels; avoid pill/capsule chips. |
| Fonts | `TwitterChirp`, `TwitterChirpExtendedHeavy`, `Vazirmatn`, `Geist`, system fallback | Theme/font restoration. |
| z-index | X uses very high values up to `999999999` | Aviary overlay must use a controlled high z-index layer and avoid host z-index wars. |
| Custom properties | Mostly Sonner toast variables plus `--border-radius: 8px` | X is largely atomic/inline CSS; theme by variables where present and scoped overrides otherwise. |

SPA and API signals:

| Signal | Evidence | Roadmap implication |
|---|---|---|
| Framework | `#react-root`, React-style generated DOM, Draft.js composer classes | Treat X as React SPA. Never assume full page loads. |
| Routing | Links/routes under `/home`, `/status`, `/notifications`, `/messages`, `/settings`, `/i/grok` | Hook history push/replace/popstate and re-run route feature registry. |
| State globals | Referenced bundles include `__INITIAL_STATE__`, `__FEATURE_SWITCH_MANIFEST__`, `__META_DATA__`, `__UG__`, `__SCRIPTS_LOADED__` | Use read-only diagnostics only; do not depend on private global shapes for core features. |
| GraphQL | Bundle scan found `/i/api/graphql/<queryId>/<operationName>` and many operation names | Build a passive endpoint/queryId learner with expiry and user-visible diagnostics. |
| Auth headers | Bundle references include `Authorization`, `x-csrf-token`, `x-twitter-auth-type`, `x-twitter-active-user`, `auth_token`, `ct0` | Never export secrets. Internal API calls must be user-initiated, rate-limited, and same-origin where possible. |
| Useful operations | `HomeTimeline`, `HomeLatestTimeline`, `TweetDetail`, `TweetResultByRestId`, `SearchTimeline`, `Bookmarks`, `BookmarkSearchTimeline`, `UserTweets`, `UserMedia`, `Likes`, `Followers`, `Following`, `MutedAccounts`, `BlockedAccountsAll`, `CreateBookmark`, `DeleteBookmark`, `CreateTweet`, `DeleteTweet`, repost/favorite ops, Birdwatch ops | Use for export, filtering, and user-requested actions only after live query discovery. |
| CSP/TrustedTypes | Captures do not expose a TrustedTypes-enforcing CSP, but Google/YouTube-like enforcement and modern X changes are possible | All HTML injection must route through a policy wrapper. Prefer DOM construction. |

## Research Coverage

Phase 1 source saturation covered:

| Required class | Coverage |
|---|---|
| Direct OSS competitors | 25+ GitHub repos and issue trackers, including control-panel, old layout, minimal theme, exporters, media downloaders, automation toolkits, bookmark archivers, and link rewriters. |
| Commercial/closed competitors | Cleanup tools, bookmark/search managers, media archivers, analytics/growth products, dim/theme products, multi-column dashboards. |
| Adjacent-domain projects | Web archiving, browser traffic capture, local-first archives, social media research collectors, FxTwitter/alternate embeds, userscript build tooling. |
| Awesome lists | Awesome userscripts, awesome Twitter tools, GitHub topics, undocumented API lists. |
| Community signal | Reddit, Stack Overflow, extension support threads, data hoarding threads, userscript requests, Chrome extension builder complaints. |
| Standards/specs/APIs | MV3, userScripts, DNR, content scripts, Trusted Types, MutationObserver, IndexedDB, OPFS, WebCrypto, X API docs and limits. |
| Academic/engineering/security | MV3 research, malicious extension research, social media archiving work, browser extension security papers/blogs, dependency security signals. |
| Dependency changelogs | No current repo deps. Candidate future deps reviewed: TypeScript, Dexie, JSZip; conclusion is "add only when needed, pin, audit, and avoid runtime dependency bloat in userscript." |
| Security advisories/CVEs | Browser extension XSS, malicious extension campaigns, remote JS inclusion risks, npm supply-chain incidents, Chrome extension-related CVEs. |

## Competitive Landscape

Ranked by a blended score of popularity, recency, direct fit, and roadmap relevance. Counts are point-in-time research values from 2026-05-19 where available.

| Rank | Tool | Source | Type | Popularity/activity | Best implementation to beat |
|---:|---|---|---|---|---|
| 1 | Control Panel for Twitter | GH01, GF04, STORE04, STORE06 | Extension + userscript | 2,521 GitHub stars; 14,394 Greasy Fork installs; active 2026-05 | Broad UI control surface, feature density, mobile/desktop support, active response to X churn. |
| 2 | OldTwitter | GH02 | Extension | 2,555 stars; pushed 2026-05-11; 263 open issues | Full replacement old client; fastest "classic Twitter" direction; deep custom client architecture. |
| 3 | Twitter Web Exporter | GH04 | Userscript | 2,409 stars; pushed 2026-05-12 | GraphQL interception and export breadth for tweets/bookmarks/lists/followers/DMs. |
| 4 | Media Harvest | GH05, STORE02, STORE07 | Extension | 985 stars; 90,000 Chrome users; active 2026-05 | One-click media download, custom filenames, sensitive reveal, thumbnail support, store polish. |
| 5 | Minimal Theme for X/Twitter | GH03, STORE01, STORE03 | Extension | 980 stars; 40,000 Chrome users; 7,222 Firefox users | Decluttering, timeline width, writer mode, navigation customization, cross-browser stores. |
| 6 | X/Twitter Content Backup Tool | STORE05 | Extension | 10,000 Chrome users | Batch media backup, original quality, XLSX export, custom filenames, Aria2 integration. |
| 7 | Twitter Media Downloader | GF05 | Userscript | 150,820 Greasy Fork installs; stale since 2024 | Legacy popularity for one-click media save. |
| 8 | X Cleaner | COM01 | Commercial extension | Paid tiers; updated site in 2026 | Account cleanup productization: scans, deletes, exports, archive import, protected items, scheduler, audit report. |
| 9 | X Dim Mode | STORE08 | Extension | 2,000+ installs; changelog v1.3.0 | CSS-variable theme restoration, custom hue picker, OS sync, X Pro/DM/settings coverage. |
| 10 | SuperX | COM11 | Commercial extension | 10,000+ users reported in store/search snippets | Analytics, scheduler, AI writing, interaction matrix, creator workflow. |
| 11 | Twitter/X media downloader by limbopro | GF08, OU03 | Userscript | 18,101 Greasy Fork installs; updated 2026-05 | Original images/videos/GIFs, per-user naming. |
| 12 | Twitter/X Media Downloader | GF09 | Userscript | 9,098 installs; updated 2026-04 | One-click downloads and ZIP packaging. |
| 13 | Twitter/X Media Batch Downloader | GH09, GF10 | Desktop/userscript/extension | 413 stars; Greasy Fork updated 2026-05 | Account media batch download, original quality, GUI, withheld media claims. |
| 14 | CleanX | GH11 | Userscript + extension | 87 stars; active 2025-11 | Country/region/language filtering, IndexedDB stats, profile About fetch. |
| 15 | Twitter Click'n'Save | GH06 | Userscript | 149 stars; active issues | One-click media buttons, direct links, visited links, duplicate history, hide sign-up/trends. |
| 16 | GoodTwitter2 | GH07 | Userscript | 520 stars | Legacy UI reshaping and old-look demand signal. |
| 17 | TwitterHD | GH08 | Userscript + extension | 97 stars | Force full-resolution image/video loads. |
| 18 | XActions | GH10 | Toolkit | 268 stars; active 2026 | Automation/CLI/MCP concept, analytics and local browser control; also a caution zone for spam risk. |
| 19 | xarchive | GH12 | MV3 extension | 10 stars; active 2026 | Zero-dependency unlimited bookmark export with folder assignments. |
| 20 | tweetxvault | GH14 | CLI archive | Active 2026 | Local LanceDB archive, query ID discovery, raw response preservation, semantic search. |
| 21 | Twibird | COM06 | Commercial/local extension | 2026 product site | Searchable likes/bookmarks, tags/folders, reminders, offline local data. |
| 22 | XSaved | COM07 | Extension | 2026 alpha/product site | Bookmark library, auto-clustering, export, local storage. |
| 23 | Tweet Media Archive | COM04 | Commercial extension | 2026 product site | Save X/Instagram media to Drive, Dropbox, or downloads. |
| 24 | X Media Downloader | COM02 | Commercial extension | 2026 product site | Pro batch limits, media scraping, original quality. |
| 25 | X Filter Pro | COM03 | Commercial extension | 2026 product site | AI feed summaries/filtering direction. |
| 26 | Hypefury/Typefully/Tweet Hunter class | COM10, COM11 | Commercial SaaS | Paid creator tools | Scheduling, thread drafts, analytics, AI writing, cross-posting. |
| 27 | ReDeck / OldTweetDeck class | STORE09, STORE10, R04 | Extension/dashboard | Recent 2026 community signal | TweetDeck-style multi-column power-user workflow. |
| 28 | Twitter-to-Bsky | OU02 | Userscript | OpenUserJS source | Crossposting to Bluesky/Mastodon from browser composer. |
| 29 | FxTwitter/FixupX | GH15 | Web service | Active OSS | Better share/embed URLs, polls/translations/videos in off-platform embeds. |
| 30 | Awesome userscript/tool lists | GH17, GH18, GH16 | Curated lists | High discovery value | Build/distribution patterns and undocumented API discovery references. |

Issue and complaint signals that should shape the roadmap:

| Signal | Sources | Product response |
|---|---|---|
| X DOM changes break selectors and features repeatedly | GH01 issues 857/884/885/886, GH03 issues 247/250/254, R09, R19 | Build selector health checks, MHTML fixtures, route smoke tests, and per-feature kill switches. |
| Users want dim back after X removed or changed display options | GH03 issue 254, STORE08, R10, R11 | Restore dim early with CSS variables and settings integration. |
| Media downloads fail due to filename, ZIP size, browser differences, DM videos, and missing audio | GH04 issue 137, GH05 issues 311/315/317, GH06 issues 37/53/56/57/59/60 | Build queue, chunked ZIPs, file templates, browser test matrix, DM support later, and clear failure diagnostics. |
| Bookmark/export tools need deleted-item handling, profile About data, quote/poll/space completeness, import/export across browsers | GH04 issues 128/130/133/135/136 | Make data model broader than visible tweets; preserve raw payloads and tombstones. |
| Users want follow/follower diffs and account intelligence | R02, COM01, GH13 | Add local snapshots and diffing after core export. |
| Bulk account cleanup is paywalled commercially | COM01, COM08, COM13, R15, R25 | Offer local, rate-limited, user-initiated cleanup with protected items. |
| API pricing/rate limits push developers to browser-local tools | P11, P12, R03, R07, R13, R19 | Avoid official API dependency for core product; rate-limit same-origin internal calls and use passive capture when possible. |
| Extension trust is fragile | A03, A04, A12, S09, R28 | Narrow permissions, no remote code, source maps, privacy manifest, local-only audit log. |

## Master Feature Catalog

Every item below is traceable to sources in the Appendix. "Prevalence" uses: `table-stakes`, `common`, `emerging`, `rare`, `leapfrog`, or `rejected`.

| ID | Feature | Category | Description | Sources | Seen in / best signal | Prevalence |
|---|---|---|---|---|---|---|
| F001 | Feature registry lifecycle | Dev-experience | Every feature has `init`, `apply`, `destroy`, settings dependency list, observer scope, and diagnostics. | L01-L04, P04-P06 | Required by local philosophy and SPA churn | table-stakes |
| F002 | Control Center settings panel | UX | Shadow-DOM settings overlay with categories, toggles, immediate apply, search, import/export, and toasts. | GH01, GH03, COM01, L04 | Control Panel breadth plus commercial UX | table-stakes |
| F003 | Document-start anti-FOUC | UX/performance | Apply early body/html classes and theme CSS before X paints where userscript manager supports it. | P03, P04, STORE08, L04 | X Dim Mode and userscript best practice | common |
| F004 | Selector health dashboard | Observability/testing | Surface which stable selectors are live, which fallbacks are active, and which features are degraded. | GH01 issues, GH03 issues, L01-L03 | Repeated X churn complaints | emerging |
| F005 | TrustedTypes-safe DOM | Security | Central policy wrapper and DOM creation helpers for all injection sinks. | P05, P01, A03 | Platform hardening | table-stakes |
| F006 | MutationObserver router | Performance | Observe primary column/sidebar/layers, process added nodes only, and route features by page type. | P06, R20, L01-L03 | Stack Overflow x.com DOM guidance | table-stakes |
| F007 | Internal API rate limiter | Reliability | Per-operation token buckets, 429 backoff, and visible queue state. | P11, P12, P13, GH11 issue 3, COM01 | X rate limits and cleanup products | table-stakes |
| F008 | Versioned local storage schema | Data/migration | One schema for settings, labels, export jobs, history, snapshots, and migrations. | P07, D01, COM06, GH14 | Dexie/IndexedDB direction | table-stakes |
| F009 | Settings import/export | Migration | Export/import JSON settings with version migration and conflict report. | GH04 issue 130, GH03, COM01 | Cross-browser import requests | common |
| F010 | Privacy manifest | Security/docs | Plain-language local-only data map: what is read, stored, exported, and never transmitted. | STORE01, STORE02, S09, A12 | Store privacy disclosures and extension trust issues | table-stakes |
| F011 | Restore Dim theme | UX/accessibility | Recreate X's removed dim/dark-blue mode and expose native-like display setting. | STORE08, GH03 issue 254, R10, R11 | X Dim Mode | table-stakes |
| F012 | Custom dark palettes | UX/accessibility | OLED, dim, graphite, plum, midnight, and custom dark hue presets only. | STORE08, GH01, GF01 | X Dim Mode custom hue | common |
| F013 | Dense mode | UX | Tighten vertical spacing, action rows, sidebars, and composer chrome for power users. | GH01, GH03, L04 | Control Panel/Minimal Theme | common |
| F014 | Timeline width and border controls | UX | Adjustable primary column width, border removal, media-safe max widths. | STORE01, GH03 | Minimal Theme | table-stakes |
| F015 | Nav/sidebar item hiding | UX | Hide or reorder Premium, Grok, Jobs, Creator Studio, Communities, Business, Ads, footer, search, post button. | GH01, GH03, GF01, STORE01 | Control Panel and Minimal Theme | table-stakes |
| F016 | Trends/news/sidebar hiding | UX/filtering | Hide or collapse trends, news, "who to follow", subscriptions, footers, and promoted side modules. | GH01, GH03, GF01, GH06 | Control Panel/Minimal Theme/Click'n'Save | table-stakes |
| F017 | Promoted/suggested content hiding | Filtering/privacy | Remove promoted posts, suggested posts, topics, "Discover more", and algorithmic insertions. | GH01, GH03, GH19, STORE01 | Tweak New Twitter / Control Panel | table-stakes |
| F018 | Count hiding | UX/privacy | Hide view counts, vanity counts, likes/repost/reply counts, or show only on hover. | GH03, STORE01, GH01 | Minimal Theme | common |
| F019 | Writer mode | UX | Composer-focused mode that hides the rest of the app while drafting posts/threads. | STORE01, GH03, COM10 | Minimal Theme and creator tools | common |
| F020 | Classic/old layout skin | UX | Optional old Twitter-inspired layout layer without replacing the full client. | GH02, GH07, R16, R20 | OldTwitter/GoodTwitter2 | common |
| F021 | Multi-column dashboard | UX/power | TweetDeck-style columns for home, lists, search, profile, notifications, bookmarks. | STORE09, STORE10, R04 | ReDeck/OldTweetDeck | emerging |
| F022 | Media layout toggle | UX/media | Toggle between X media grid and sideways scroll/stacked media per tweet. | GH01 issue 687 | Direct feature request | emerging |
| F023 | Chat/DM layout guard | UX/reliability | Prevent control panels or compact CSS from covering DM actions and composer buttons. | GH03 issues 250/257 | Minimal Theme issues | common |
| F024 | Grok hiding and control | UX/privacy | Hide Grok nav/drawer/buttons, or replace Grok button with safe local command menu. | GH01, GH03 issue 249, GF13, GF14, GH23 | Un-Grok/Grok Commander | common |
| F025 | Font and visual restoration | UX | Restore Chirp/system font choices, icon tinting, compose icon color, and dim display tokens. | GH01 issue 883/884, STORE08 | Competitor breakage issues | emerging |
| F026 | Keyword and regex filters | Filtering/moderation | Hide/highlight posts by keyword, regex, phrase list, language, and source route. | GF01, R18, GH01 | Enhanced post hiders | table-stakes |
| F027 | User notes, tags, aliases | Data/UX | Attach private notes/tags to accounts; search/filter by them; optional WebDAV later. | GF01, COM06 | "Add notes to user" and bookmark managers | emerging |
| F028 | Country/region/language filters | Filtering | Filter or highlight posts by profile About country/region/language/script. | GH11 | CleanX | rare |
| F029 | Verified/Premium filters | Filtering | Hide, dim, badge, or threshold posts by Premium/verified state. | GH01, R20, GH23 | Control Panel/Good Old Bird/Un-Grok class | common |
| F030 | Engagement threshold filters | Filtering | Hide or highlight replies/posts below engagement or above viral thresholds. | COM01, R20, R23 | Good Old Bird/reply sort tools | emerging |
| F031 | Reply sorting and quality tools | UX/filtering | Auto-select best reply sort where X exposes it; annotate reply quality locally. | R14, R23 | Community reply-management complaint | emerging |
| F032 | Hide blocked accounts again | Filtering | Restore hiding posts from blocked accounts when X regresses behavior. | GH01 issue 886 | Control Panel request | emerging |
| F033 | Hide self-quotes/self-reposts | Filtering | Hide author self-quotes, self-replies, or repetitive repost chains. | GH01 issues, GF01 | Control Panel requests | emerging |
| F034 | Anti-spam/porn block assist | Moderation | One-click block/mute spam/scam/porn accounts in replies with batch queue. | GF19, GF18, COM01 | Twitter Block Porn/With Love | common |
| F035 | Block/mute likers/reposters | Moderation | User-initiated queue to block or mute accounts who liked/reposted a target post. | GF18, COM01 | Twitter Block With Love | common |
| F036 | Whitelist/protected accounts/items | Safety | Never hide/delete/download-overwrite protected accounts, tweets, or bookmarks. | COM01, GH11 issue 2 | X Cleaner protected items; CleanX whitelist | table-stakes |
| F037 | Sensitive content controls | UX/media | Auto-reveal, always hide, or blur sensitive media with per-surface settings. | GH05, GF17, STORE02 | Media Harvest and media scripts | common |
| F038 | GIF/media-type filter | Filtering/media | Hide GIF/video/photo posts on media tabs or feeds by media type. | R18, GF01 | Userscript request | emerging |
| F039 | Timeline read position sync | UX/offline | Track last-read tweet IDs per route/list/profile and restore position. | GF11 | Timeline Sync | rare |
| F040 | Timeline source/sort enforcement | UX/reliability | Prefer Following/latest/chronological route choices and detect X changing defaults. | GH01 issue 857, GH03 issues 247/251 | Control Panel and Minimal Theme issues | common |
| F041 | Original image download | Media | Add visible buttons to save `pbs.twimg.com/media` images in original quality. | GF06, GH06, GF08, GF09 | Download Original Picture | table-stakes |
| F042 | Video/GIF download | Media | Download tweet videos/GIFs from discovered variants; expose errors clearly. | GH05, GH06, GF05, GF08, GF09 | Media Harvest and media scripts | table-stakes |
| F043 | Force HD media playback | Media | Prefer highest-quality images/videos for viewing, not only downloads. | GF07, GH08 | Video Quality Fixer/TwitterHD | common |
| F044 | Thumbnail download | Media | Download video thumbnails separately. | STORE02, STORE05 | Media Harvest / Content Backup | common |
| F045 | Filename and folder templates | Media/data | Template fields for handle, display name, tweet id, media index, date, text hash, extension, and subdirectories. | GH05 issues 225/315/317, GF17, STORE05 | Media Harvest and Content Backup | table-stakes |
| F046 | Duplicate history/download log | Media/data | Local history to avoid duplicate downloads and sync/clear history. | GH06, GF17, STORE05 | Click'n'Save and Japanese media downloader | common |
| F047 | ZIP packaging and chunking | Media/reliability | Package multi-media posts and batch jobs into chunks; avoid >500 item ZIP failures. | GH04 issue 137, GF09, STORE05, D02 | Exporter ZIP issue and JSZip limits | table-stakes |
| F048 | Batch profile media download | Media | Download profile/media-tab images and videos with filters and queue. | GH09, GF10, STORE05, COM02, R16 | Content Backup and Batch Downloader | common |
| F049 | Media filters and limits | Media | Batch filters for date, likes, reposts, views, media type, withheld state, and max count. | STORE05, COM02, COM01 | Commercial media/export tools | common |
| F050 | Queue, concurrency, cancel, retry | Reliability/media | Visible job queue with pause/cancel/retry/backoff and per-item errors. | COM01, STORE05, GH05 issues | Commercial polish and failure issues | table-stakes |
| F051 | Save location memory | UX/media | Remember last selected folder/path label where browser APIs allow it. | GH05 issue 317 | Media Harvest request | common |
| F052 | Mobile ZIP support | Mobile/media | Mobile-friendly media bundling and share/download flow. | GF17 | Japanese media downloader | rare |
| F053 | DM media support | Media/privacy | Download DM videos/images only after dedicated DM fixture and privacy review. | GH06 issue 56, COM01 | Click'n'Save issue and cleanup tools | later |
| F054 | Alt text/poll/space metadata export | Accessibility/data | Preserve alt text, poll choices, spaces/audio metadata where X payload exposes them. | GH04 issue 133, GH15, GH14 | Exporter request and FxTwitter | emerging |
| F055 | Tweet/thread screenshot capture | Media/export | Capture tweets/threads to image/PDF locally with copy/download buttons. | R17, A08 | Screenshot userscript and social capture docs | common |
| F056 | Native companion and Aria2 handoff | Integrations/media | Optional handoff for very large jobs, HLS muxing, resumable downloads. | STORE05, GH09, R07 | Content Backup Aria2; HAR archiver | later |
| F057 | Broad data export | Data/export | Export tweets, bookmarks, lists, likes, followers/following, muted/blocked, DMs where safe. | GH04, GH12, COM01, COM06 | Twitter Web Exporter and X Cleaner | table-stakes |
| F058 | Export formats | Data/export | JSON, CSV, HTML, Markdown, XLSX, and self-contained viewer where appropriate. | GH04, STORE05, GH12, COM01, COM06 | Exporter, Content Backup, xarchive | table-stakes |
| F059 | Incremental sync and resume | Data/reliability | Crash-safe checkpointed sync and resumable backfills. | GH14, COM06, GH04 issues | tweetxvault and Twibird | common |
| F060 | Raw GraphQL response preservation | Data/reliability | Store raw response pages beside parsed records for future parser recovery. | GH14, GH04, R07 | tweetxvault/HAR archiver | leapfrog |
| F061 | Query ID auto-discovery | Data/reliability | Scrape referenced bundles/passive network to refresh operation query IDs. | GH14, L01-L03 | tweetxvault and local bundle scan | leapfrog |
| F062 | Deleted/tombstone handling | Data/export | Preserve bookmark/tweet references even after deletion, suspension, or unavailable payload. | GH04 issue 135, R28, COM12 | Exporter deleted bookmark issue | emerging |
| F063 | Profile About export | Data | Export location, website, join date, birth date, business/category, username changes where visible. | GH04 issue 128, GH11, GH02 issue 1268 | Exporter/CleanX/OldTwitter issues | common |
| F064 | Quotes, polls, spaces, articles | Data | Capture attached quote/repost wrappers, polls, spaces, articles, notes, and community context. | GH04 issues 133/136, GH15 | Exporter and FxTwitter | common |
| F065 | Follower/following snapshots and diff | Data/analytics | Snapshot lists and compare unfollows, disappeared accounts, new followers/following. | GH13, R02, COM01 | twitter-web-exporter-diff | emerging |
| F066 | Local full-text search | Data/offline | Search exported/bookmarked/liked content locally. | COM06, COM07, GH14 | Twibird/XSaved/tweetxvault | common |
| F067 | Optional semantic search | Data/AI | Local or user-key vector search over archives; disabled by default. | GH14, COM06, A07 | tweetxvault hybrid search; TwiXplorer | later |
| F068 | Tags, folders, reminders | Data/UX | Organize bookmarks/saved posts with tags, folders, notes, saved filters, reminders. | COM06, COM07, GH12, R12 | Twibird/XSaved/xarchive | common |
| F069 | External export targets | Integrations | Export to Notion/Obsidian/Drive/Dropbox/Downloads by explicit action. | COM04, COM06, COM08 | Tweet Media Archive/Twibird/Social Archiver | later |
| F070 | Official X archive import | Migration/data | Import official X archive ZIP to merge old tweets/media with local archive and cleanup jobs. | COM01, GH14, COM12 | X Cleaner/tweetxvault | common |
| F071 | WARC/WACZ/HAR preservation mode | Data/research | Optional evidence-grade archive export for researchers and data hoarders. | R07, A05, A08, A06 | HAR archiver/Tidal Tales/Zeeschuimer/NARA | later |
| F072 | Checksums/provenance/PDF reports | Data/observability | Checksums, source URL, capture time, run report, and PDF cleanup/export reports. | COM01, A08, GH14 | X Cleaner PDF report and archiving practice | emerging |
| F073 | Clean share links | UX/privacy | Copy x.com/twitter.com/fxtwitter/vxtwitter/fixupx URLs and strip tracking params. | GH15, GH21, GH22, GF15, OU02 | FxTwitter, auto-fxtwitter, Alternative Share URL | common |
| F074 | Direct link unshortening | UX/privacy | Replace `t.co` and redirect wrappers with direct destination display/copy where visible. | GH06, GF03 | Click'n'Save and Direct links out | common |
| F075 | Composer drafts/templates | UX/power | Local snippets, draft labels, reusable templates, and composer-safe insertion. | COM10, STORE01 | Creator tools and Writer Mode | common |
| F076 | Thread composer support | UX/power | Improve thread drafting and creation flow without background auto-posting. | GH02 issue 1269, COM10 | OldTwitter request and creator tools | emerging |
| F077 | Crosspost to Bluesky/Mastodon | Integrations | User-initiated crosspost from composer to user-configured accounts. | OU02, R13, COM10 | twitter-to-bsky | later |
| F078 | User-initiated schedule/publish queue | Automation | Local scheduled reminders or extension-assisted publish queue with explicit user action. | COM10, COM01, R13, P12 | Hypefury/Typefully class; X guidelines caution | under consideration |
| F079 | Account cleanup scan/delete | Data/safety | Scan tweets, retweets, likes, bookmarks, DMs, lists; queue user-requested deletions. | COM01, COM08, COM13, R15 | X Cleaner/TweetManager/TweetXDelete | later |
| F080 | Mass unfollow/block/mute | Moderation/safety | Review-first, rate-limited queues for unfollow/block/mute with protected accounts. | COM01, R25, GF18 | X Cleaner and community unfollow tools | later |
| F081 | Account audit | Analytics/privacy | Identify non-reciprocal follows, fans, inactive/ghost followers, sensitive posts. | COM01, R02 | X Cleaner/twe diff requests | later |
| F082 | Local AI/Grok command menu | UX/AI | Replace or augment Grok buttons with fact-check, translate, explain, and custom prompts. | GF13, GF14, GH23, COM03 | Grok Commander and X Filter Pro direction | under consideration |
| F083 | Translate and summarize | Accessibility/AI | User-triggered local/browser or user-key summaries/translations of posts/threads. | GF14, GH15, COM03, A07 | Grok Commander, FxTwitter, TwiXplorer | under consideration |
| F084 | Account metadata badges | Data/UX | Show join year, location, device/source hints, account notes, username-change counts. | GH11, GF01, GF03 | CleanX/Xbout class | emerging |
| F085 | Notification/digest tools | UX/data | Local digest of notifications, mentions, saved searches, and account changes. | COM10, COM01, R14 | Creator/dashboard products | later |
| F086 | Optional permissions per feature | Security/distribution | MV3 asks for extra permissions only when a user enables a feature that needs them. | P01, P03, R28, A02 | MV3 best practice and community concern | table-stakes |
| F087 | Local-only no telemetry | Privacy | Default product sends nothing to third parties; any external integrations are opt-in and documented. | STORE01, STORE02, COM01, S09 | Store privacy disclosures and security research | table-stakes |
| F088 | Encrypted local vault | Security/data | Optional WebCrypto encryption for archives/notes/settings exports. | P09, P07, R27 | WebCrypto/IndexedDB storage concerns | under consideration |
| F089 | Permission/dependency audit | Security/dev-experience | CI and release checklist for permissions, remote code, dependencies, lockfile, licenses. | A03, A04, A12, D02, D03 | Extension and npm supply-chain research | table-stakes |
| F090 | CSP/MV3 review hardening | Security/distribution | No remote code, no inline eval, store-compliant CSP, explicit host permissions. | P01-P04, A01, A02 | Chrome docs and MV3 research | table-stakes |
| F091 | Least-privilege network capture | Security/privacy | Passive same-origin capture of X responses; never persist cookies/auth headers. | GH04, GH14, P12, S09 | Exporter/tweetxvault with guidelines caution | table-stakes |
| F092 | Local action audit log | Observability/privacy | User-visible local log of downloads, hides, exports, deletions, API calls, failures. | COM01, A12, S09 | Cleanup reports and extension trust issues | common |
| F093 | Reduced motion | Accessibility | Respect `prefers-reduced-motion`; disable shimmer/spring/stagger animations. | P04, STORE08, L04 | Accessibility baseline | table-stakes |
| F094 | Contrast and ARIA tests | Accessibility/testing | Token contrast checks, labelled icon buttons, focus trap for active overlay, no hidden overlay pointer capture. | P05, P06, STORE01 | Platform and product quality | table-stakes |
| F095 | Localization framework | i18n | Extract strings, support initial English plus future community translations. | GH02 locales, STORE08 10-language note | OldTwitter/X Dim Mode | common |
| F096 | RTL/CJK wrapping | i18n/accessibility | Avoid overflow in CJK/RTL and Grok/chat long text; use logical properties. | GH03 issue 248, L01-L03 | Minimal Theme issue | common |
| F097 | Mobile/touch accessibility | Mobile/accessibility | Touch-friendly panels, responsive nav hooks, mobile userscript/browser support. | GH01, GF17, OU01 | Control Panel mobile and mobile ZIP scripts | common |
| F098 | MHTML fixture tests | Testing | Parse local captures in tests and assert selectors/actions remain valid. | L01-L03, P06 | Local repo ground truth | table-stakes |
| F099 | Playwright/live smoke tests | Testing | Optional live checks for home/status/profile/settings under test account; screenshots for regressions. | P04, R20, GH01 issues | Browser extension regression pattern | common |
| F100 | Dual packaging | Distribution | Produce readable userscript and MV3 extension ZIP from shared source. | P01-P04, GH03, GH05, GH12, GH17 | Cross-store competitors | table-stakes |
| F101 | README/install/FAQ | Docs/distribution | GitHub README with install paths, privacy model, feature matrix, troubleshooting, and source links. | GH01, GH03, GH05, OU01 | Competitor docs | table-stakes |
| F102 | Support diagnostics | Dev-experience/docs | Copy diagnostics: version, enabled features, selectors, route, browser, user manager, recent errors. | GH01 support flow, GH05 issues | Competitor support burden | common |
| F103 | Dependency update policy | Security/dev-experience | Pin exact deps, use lockfile, changelog review, Snyk/npm audit, avoid stale libs in runtime. | D01-D03, A12 | JSZip/Dexie/TypeScript and npm incidents | table-stakes |
| F104 | Feature preset packs | UX | Presets: "Quiet Reader", "Media Archivist", "Creator", "Researcher", "Classic", "Minimal". | GH01, GH03, COM06, COM10 | Control-panel breadth made approachable | emerging |
| R001 | Auto-like/follow/impression farming | Rejected | Automation to inflate engagement or auto-interact with accounts. | GH10, P12, R13 | Contradicts X guidelines and trust model | rejected |
| R002 | CAPTCHA/solver bypass | Rejected | Solver or account-lock bypass. | GH02 issues 1231/1097/1253, P12 | High account and policy risk | rejected |
| R003 | Cloud sync by default | Rejected | Upload archives/settings/tokens to Aviary servers by default. | S09, A12, COM06 | Contradicts local-first philosophy | rejected |
| R004 | Light theme | Rejected | Light palette or system light-mode support. | L04, STORE08 | Contradicts house style | rejected |
| R005 | Keyboard shortcuts | Rejected | Hotkeys for download, copy, navigation, or commands. | STORE02, STORE05, GH02 | Contradicts repo rule; use visible controls | rejected |
| R006 | Raw hashed selectors as primary | Rejected | Build features primarily around X obfuscated class names. | L01-L03, GH01 issues | Too fragile | rejected |
| R007 | Unbounded scraping | Rejected | Infinite background crawling without user action, rate limits, or stop controls. | P11-P13, R03, R07 | Account and platform risk | rejected |
| R008 | Credential/session export | Rejected | Export auth cookies, `ct0`, bearer tokens, or headers. | P12, S09, A12 | Severe privacy/security risk | rejected |

## Gap Analysis And Prioritization

Scoring: impact and effort are 1 low to 5 high. Tier meanings: `Now` is v0.1-v0.3 foundation and early usable product; `Next` is v0.4-v0.7 parity expansion; `Later` is v0.8+ or extension-specific; `Under Consideration` needs live-site/legal/security validation; `Rejected` is intentionally excluded.

| ID | Fit | Impact | Effort | Risk | Dependencies | Novelty | Tier | Placement rationale |
|---|---:|---:|---:|---|---|---|---|---|
| F001 | 5 | 5 | 3 | Low | None | Parity | Now | Without lifecycle discipline, the feature-dense scope becomes unmaintainable. |
| F002 | 5 | 5 | 4 | Medium | F001, F008 | Parity | Now | Settings is the product surface and must land before many toggles. |
| F003 | 5 | 4 | 2 | Low | F011 | Parity | Now | Theme changes must avoid paint flash from the first release. |
| F004 | 5 | 4 | 3 | Low | F006, F098 | Leapfrog | Now | Competitor failures show selector diagnostics are a durable advantage. |
| F005 | 5 | 5 | 2 | Low | F001 | Parity | Now | Cheap early security foundation that prevents future unsafe patterns. |
| F006 | 5 | 5 | 3 | Medium | F001 | Parity | Now | Core SPA handling gates nearly every DOM feature. |
| F007 | 5 | 5 | 3 | Medium | F008 | Parity | Now | Any export or cleanup work needs a safe operation queue. |
| F008 | 5 | 5 | 3 | Medium | None | Parity | Now | Settings, downloads, labels, snapshots, migrations, and logs need one schema. |
| F009 | 5 | 3 | 2 | Low | F008 | Parity | Next | Useful after real settings exist. |
| F010 | 5 | 4 | 2 | Low | F086, F087 | Leapfrog | Now | Trust is a differentiator in this extension category. |
| F011 | 5 | 5 | 2 | Low | F003 | Parity | Now | High-demand, low-risk first visible win. |
| F012 | 5 | 4 | 3 | Low | F011 | Parity | Now | Builds on dim restoration and house style. |
| F013 | 5 | 4 | 3 | Medium | F002, F006 | Parity | Next | Useful, but needs selector and settings foundation first. |
| F014 | 5 | 4 | 2 | Low | F002 | Parity | Now | Table-stakes Minimal Theme parity and simple CSS scope. |
| F015 | 5 | 5 | 3 | Medium | F006 | Parity | Now | One of the clearest competitor baseline features. |
| F016 | 5 | 5 | 2 | Low | F006 | Parity | Now | High-impact declutter feature with stable selectors. |
| F017 | 5 | 5 | 4 | Medium | F006, F026 | Parity | Next | Needs filtering engine and regression coverage. |
| F018 | 5 | 3 | 2 | Low | F006 | Parity | Next | Common declutter option after basic hide controls. |
| F019 | 5 | 4 | 3 | Medium | F002, F075 | Parity | Next | Valuable after composer-safe insertion is understood. |
| F020 | 4 | 4 | 5 | High | F013, F014, F100 | Parity | Later | Full old-client replacement is too expensive; skin only after core parity. |
| F021 | 4 | 5 | 5 | High | F057, F066, F100 | Leapfrog | Later | Strong power-user value but needs extension architecture and data model. |
| F022 | 5 | 3 | 3 | Medium | F006, F041 | Parity | Next | Direct competitor issue and bounded media UI work. |
| F023 | 5 | 3 | 3 | Medium | Missing DM capture | Parity | Next | Needs DM capture before shipping broadly. |
| F024 | 5 | 4 | 3 | Medium | F006, F082 optional | Parity | Now | Grok clutter appears in captures and competitors. |
| F025 | 5 | 3 | 3 | Medium | F011 | Parity | Next | Fixes frequent visual regressions after theme base is in place. |
| F026 | 5 | 5 | 3 | Medium | F006, F008 | Parity | Now | Core moderation engine unlocks multiple categories. |
| F027 | 5 | 4 | 4 | Medium | F008, F066 | Leapfrog | Next | Private notes/tags are under-served and align with local-first. |
| F028 | 4 | 3 | 4 | Medium | F063, F007 | Parity | Later | Useful but network-heavy and region inference is brittle. |
| F029 | 5 | 4 | 3 | Low | F026 | Parity | Next | Common request and straightforward once filter predicates exist. |
| F030 | 4 | 3 | 4 | Medium | F057, F007 | Leapfrog | Later | Reply quality requires payload counts and careful UX. |
| F031 | 4 | 4 | 4 | Medium | F057, live reply sort | Leapfrog | Later | Valuable, but current X reply sorting must be validated live. |
| F032 | 5 | 4 | 3 | Medium | F026 | Parity | Next | Direct current feature request. |
| F033 | 5 | 3 | 3 | Medium | F026 | Parity | Next | Useful noise reduction once tweet relation parsing exists. |
| F034 | 5 | 4 | 4 | High | F007, F036 | Parity | Later | Bulk moderation needs safeguards and rate limiting. |
| F035 | 4 | 4 | 4 | High | F007, F036 | Parity | Later | High risk if too automated; keep user-initiated. |
| F036 | 5 | 5 | 2 | Low | F008 | Parity | Now | Safety rail needed before any destructive or hiding feature. |
| F037 | 5 | 3 | 3 | Medium | F006, F041 | Parity | Next | Common media option, but sensitive content handling needs care. |
| F038 | 4 | 3 | 3 | Low | F026, F041 | Parity | Next | Direct userscript request; simple predicate after media detection. |
| F039 | 5 | 4 | 3 | Medium | F008, F006 | Parity | Next | Distinct QoL feature with clear source. |
| F040 | 5 | 5 | 4 | Medium | F006, live route tests | Parity | Next | High user value, but X sort controls change often. |
| F041 | 5 | 5 | 2 | Low | F006 | Parity | Now | Media download is one of the largest demand clusters. |
| F042 | 5 | 5 | 4 | Medium | F061, F050 | Parity | Next | Video/GIF needs network discovery and robust queueing. |
| F043 | 5 | 4 | 3 | Medium | F006 | Parity | Next | Common and bounded, but video variants are brittle. |
| F044 | 5 | 3 | 2 | Low | F042 | Parity | Next | Natural add-on once video metadata exists. |
| F045 | 5 | 5 | 3 | Medium | F008, F041 | Parity | Now | Competitor issues show naming is essential, not polish. |
| F046 | 5 | 4 | 3 | Low | F008, F041 | Parity | Now | Prevents duplicates and supports download trust. |
| F047 | 5 | 5 | 4 | Medium | F050, F058 | Parity | Next | Required for robust batch export and media jobs. |
| F048 | 5 | 5 | 5 | High | F042, F050, F061 | Parity | Later | High-value but large; ship after one-click media is stable. |
| F049 | 5 | 4 | 3 | Medium | F048 | Parity | Later | Batch filters depend on batch engine. |
| F050 | 5 | 5 | 4 | Medium | F007, F008 | Parity | Now | Queue is shared by media, export, and cleanup. |
| F051 | 4 | 3 | 3 | Medium | F050, browser APIs | Parity | Next | Direct issue but browser support differs. |
| F052 | 4 | 3 | 4 | Medium | F047 | Parity | Later | Mobile media support is useful but not foundational. |
| F053 | 3 | 3 | 5 | High | Missing DM capture, F087 | Parity | Under Consideration | DM media is sensitive and capture coverage is missing. |
| F054 | 5 | 4 | 4 | Medium | F057, F061 | Parity | Next | Important for accessibility and complete exports. |
| F055 | 5 | 4 | 4 | Medium | F006, F057 | Parity | Later | Popular but rendering fidelity takes testing. |
| F056 | 4 | 4 | 5 | Medium | F050, F100 | Leapfrog | Later | Keep optional; userscript must remain useful without it. |
| F057 | 5 | 5 | 5 | Medium | F007, F008, F061 | Parity | Next | Major product pillar; after core engine and queue. |
| F058 | 5 | 5 | 3 | Low | F057 | Parity | Next | Export formats are table-stakes once data exists. |
| F059 | 5 | 5 | 4 | Medium | F008, F057 | Parity | Next | Required for large exports and reliability. |
| F060 | 5 | 4 | 4 | Medium | F057, F088 optional | Leapfrog | Later | Strong recovery value but storage-heavy. |
| F061 | 5 | 5 | 5 | High | F006, F007 | Leapfrog | Next | Volatile X query IDs make this a strategic differentiator. |
| F062 | 5 | 4 | 4 | Medium | F057, F060 | Leapfrog | Later | Useful for archive integrity after broad export exists. |
| F063 | 5 | 4 | 3 | Medium | F057, F061 | Parity | Next | Direct issue and useful for filtering/labels. |
| F064 | 5 | 4 | 4 | Medium | F057, F061 | Parity | Later | Completeness upgrade after base exporter. |
| F065 | 5 | 4 | 4 | Medium | F057, F008 | Parity | Later | Clear demand, but snapshot scale and privacy need care. |
| F066 | 5 | 5 | 4 | Medium | F057, F008 | Parity | Later | Search becomes valuable after archive volume exists. |
| F067 | 4 | 3 | 5 | High | F066, local model/user key | Leapfrog | Under Consideration | Powerful but dependency/privacy costs are high. |
| F068 | 5 | 5 | 4 | Medium | F066, F027 | Parity | Later | Bookmark/library value after export/search foundations. |
| F069 | 4 | 3 | 4 | Medium | F057, F087 | Parity | Later | Integrations are opt-in and not v1 core. |
| F070 | 5 | 4 | 4 | Medium | F057, F008 | Parity | Later | Strong cleanup/archive bridge, but archive schema varies. |
| F071 | 4 | 4 | 5 | Medium | F060, F056 optional | Leapfrog | Later | Research-grade value, not needed for mainstream v1. |
| F072 | 4 | 3 | 3 | Low | F050, F057 | Parity | Later | Useful for reports once batch jobs exist. |
| F073 | 5 | 4 | 2 | Low | F002 | Parity | Now | Easy, useful, privacy-aligned, and widely sourced. |
| F074 | 5 | 3 | 3 | Low | F006 | Parity | Next | Common link hygiene after share controls. |
| F075 | 5 | 4 | 4 | Medium | F002, composer fixture | Parity | Next | Fits creator workflow but needs composer safety. |
| F076 | 5 | 4 | 4 | Medium | F075 | Parity | Later | Direct request; thread UI is more complex than snippets. |
| F077 | 4 | 3 | 4 | Medium | External tokens, F087 | Parity | Later | Useful for creators, but integrations are not core. |
| F078 | 3 | 4 | 5 | High | P12 review, F007 | Parity | Under Consideration | Scheduling can violate policy if implemented as automation. |
| F079 | 4 | 5 | 5 | High | F007, F036, F057 | Parity | Later | Commercially valuable, but destructive and rate-limited. |
| F080 | 4 | 4 | 5 | High | F036, F079 | Parity | Later | Keep review-first and rate-limited. |
| F081 | 4 | 4 | 5 | Medium | F065, F057 | Parity | Later | Good value once relationship snapshots exist. |
| F082 | 4 | 3 | 4 | Medium | F024, F087 | Parity | Under Consideration | Useful but AI/Grok integrations need privacy and policy review. |
| F083 | 4 | 3 | 5 | Medium | F082 or local model | Parity | Under Consideration | Avoid cloud defaults; local/user-key only. |
| F084 | 5 | 3 | 3 | Medium | F063 | Parity | Next | Account context enriches filters and labels. |
| F085 | 4 | 3 | 4 | Medium | F057, F066 | Leapfrog | Later | Useful after archive/search foundations. |
| F086 | 5 | 5 | 3 | Low | F100 | Parity | Now | Required for store trust and least privilege. |
| F087 | 5 | 5 | 2 | Low | F010 | Parity | Now | Foundational promise and store/privacy differentiator. |
| F088 | 4 | 3 | 5 | Medium | F008, F057 | Leapfrog | Under Consideration | Useful for sensitive archives, but key UX is hard. |
| F089 | 5 | 5 | 3 | Low | F100 | Parity | Now | Dependency and extension supply-chain risk is high. |
| F090 | 5 | 5 | 3 | Low | F100 | Parity | Now | Must be designed in before store builds. |
| F091 | 5 | 5 | 4 | Medium | F057, F061 | Leapfrog | Next | Enables exports while protecting secrets. |
| F092 | 5 | 4 | 3 | Low | F008 | Parity | Next | Builds trust and improves support. |
| F093 | 5 | 4 | 2 | Low | F002 | Parity | Now | Cheap accessibility baseline for premium motion. |
| F094 | 5 | 5 | 3 | Low | F002 | Parity | Now | Prevents visually polished but inaccessible UI. |
| F095 | 5 | 3 | 3 | Low | F002 | Parity | Next | X is global; extract strings early before UI grows. |
| F096 | 5 | 3 | 2 | Low | F002 | Parity | Now | Direct bug signal and low implementation cost. |
| F097 | 5 | 4 | 4 | Medium | F002, mobile fixture | Parity | Next | Supports mobile userscript and responsive extension users. |
| F098 | 5 | 5 | 3 | Low | None | Leapfrog | Now | Local captures are the repo's strongest asset. |
| F099 | 5 | 4 | 4 | Medium | F100, test account | Parity | Later | Important before store release, but not first scaffold. |
| F100 | 5 | 5 | 5 | Medium | F001, F089, F090 | Parity | Now | Dual packaging is a core product decision. |
| F101 | 5 | 4 | 3 | Low | F100 | Parity | Next | Required before distribution. |
| F102 | 5 | 3 | 3 | Low | F004, F092 | Parity | Next | Reduces support drag from X churn. |
| F103 | 5 | 5 | 2 | Low | F100 | Parity | Now | Current repo has no deps; set policy before adding them. |
| F104 | 5 | 3 | 3 | Low | F002 | Leapfrog | Later | Helps users navigate feature density after categories mature. |
| R001 | 1 | 1 | 3 | High | None | Misfit | Rejected | Violates guidelines and invites suspension. |
| R002 | 1 | 1 | 5 | High | None | Misfit | Rejected | Account/security bypass is not a product feature. |
| R003 | 1 | 2 | 4 | High | None | Misfit | Rejected | Contradicts local-first trust promise. |
| R004 | 1 | 1 | 2 | Low | None | Misfit | Rejected | Contradicts explicit dark-only style. |
| R005 | 1 | 1 | 2 | Low | None | Misfit | Rejected | Contradicts explicit no-keyboard-shortcuts rule. |
| R006 | 1 | 1 | 2 | High | None | Misfit | Rejected | Breaks under X class churn. |
| R007 | 1 | 2 | 4 | High | None | Misfit | Rejected | Conflicts with rate limits and user control. |
| R008 | 1 | 1 | 2 | Critical | None | Misfit | Rejected | Credential export is unacceptable. |

## Architecture

Recommended future repository layout:

```text
Twitter_Userscript/
|-- README.md
|-- ROADMAP.md
|-- LICENSE
|-- package.json
|-- pnpm-lock.yaml
|-- tsconfig.json
|-- vite.config.ts
|-- src/
|   |-- userscript.meta.ts
|   |-- main.ts
|   |-- platform/
|   |   |-- dom.ts
|   |   |-- selectors.ts
|   |   |-- trusted-types.ts
|   |   |-- route.ts
|   |   |-- observer.ts
|   |   |-- storage.ts
|   |   |-- rate-limit.ts
|   |   |-- network-capture.ts
|   |   `-- diagnostics.ts
|   |-- ui/
|   |   |-- control-center.ts
|   |   |-- toast.ts
|   |   |-- components.ts
|   |   `-- styles.ts
|   |-- features/
|   |   |-- appearance/
|   |   |-- filtering/
|   |   |-- media/
|   |   |-- export/
|   |   |-- composer/
|   |   |-- privacy/
|   |   `-- accessibility/
|   |-- data/
|   |   |-- schema.ts
|   |   |-- migrations.ts
|   |   |-- archive-model.ts
|   |   `-- serializers.ts
|   `-- extension/
|       |-- manifest.chrome.json
|       |-- manifest.firefox.json
|       |-- background.ts
|       |-- content.ts
|       `-- sidepanel.ts
|-- fixtures/
|   |-- home.mhtml
|   |-- status.mhtml
|   |-- decoded/
|   `-- selector-baselines.json
|-- tests/
|   |-- selectors.test.ts
|   |-- features-smoke.test.ts
|   |-- storage-migrations.test.ts
|   |-- media-url.test.ts
|   `-- security.test.ts
`-- dist/
    |-- aviary.user.js
    |-- aviary.chrome.zip
    `-- aviary.firefox.zip
```

Core contracts:

```ts
type FeatureContext = {
  route: RouteState;
  settings: Settings;
  selectors: SelectorRegistry;
  storage: StorageGateway;
  limiter: RateLimiter;
  diagnostics: Diagnostics;
  toast: ToastBus;
};

type FeatureModule = {
  id: string;
  title: string;
  category: FeatureCategory;
  defaultEnabled: boolean;
  init(ctx: FeatureContext): void | Promise<void>;
  apply?(ctx: FeatureContext, root: ParentNode, addedNodes?: Node[]): void;
  destroy(ctx: FeatureContext): void | Promise<void>;
  getStatus?(): FeatureStatus;
};
```

Observer strategy:

| Scope | Features | Rule |
|---|---|---|
| `document.documentElement` | document-start classes, theme, global variables | Write once, update on settings changes. |
| `[data-testid="primaryColumn"]` | feed, tweet, media, filtering, export buttons | Observe childList/subtree; process added nodes only. |
| `[data-testid="sidebarColumn"]` | trends, recommendations, search sidebar | Observe only when sidebar exists. |
| `#layers` | modals, media viewer, menus, Grok drawer | Observe lightly; disconnect when route lacks overlays. |
| Composer container | drafts, writer mode, thread support | Dedicated observer because Draft.js changes frequently. |

Network/API strategy:

| Layer | Use | Rule |
|---|---|---|
| Passive capture | Export/archive parsing, query ID discovery | Wrap `fetch`/XHR in page context where userscript manager allows; never persist auth headers. |
| Same-origin GraphQL calls | User-requested export, metadata fetch, cleanup queue | Use discovered operation/query ID, `x-csrf-token` from page context only in memory, token-bucket limiter, exponential backoff. |
| Official X API | Optional future user-provided key workflows | Do not require for core product because costs/rate limits are volatile. |
| Extension background | Downloads, optional permissions, DNR, side panel | MV3 only; no remote code; keep service worker stateless and checkpoint jobs in storage. |

Settings root key: `aviary.settings.v1`

Settings schema outline:

| Key | Default | Category | Feature IDs |
|---|---:|---|---|
| `appearance.theme` | `dim` | Appearance | F011, F012 |
| `appearance.denseMode` | `false` | Appearance | F013 |
| `appearance.timelineWidth` | `default` | Appearance | F014 |
| `appearance.hideBorders` | `false` | Appearance | F014 |
| `appearance.hideCounts` | `false` | Appearance | F018 |
| `appearance.restoreChirp` | `false` | Appearance | F025 |
| `layout.hideNavItems` | `[]` | Layout | F015 |
| `layout.hideRightSidebar` | `true` | Layout | F016 |
| `layout.hideTrends` | `true` | Layout | F016 |
| `layout.hideGrok` | `true` | Layout/privacy | F024 |
| `layout.writerMode` | `false` | Composer | F019 |
| `filter.enabled` | `false` | Filtering | F026 |
| `filter.keywordRules` | `[]` | Filtering | F026 |
| `filter.regexRules` | `[]` | Filtering | F026 |
| `filter.premiumRule` | `off` | Filtering | F029 |
| `filter.blockedAccounts` | `hide` | Filtering | F032 |
| `filter.whitelist` | `[]` | Filtering/safety | F036 |
| `filter.mediaTypes` | `{}` | Filtering/media | F038 |
| `media.buttons` | `true` | Media | F041, F042 |
| `media.preferOriginalImages` | `true` | Media | F041, F043 |
| `media.filenameTemplate` | `{handle}_{tweetId}_{index}` | Media | F045 |
| `media.downloadHistory` | `true` | Media | F046 |
| `media.zipChunkSize` | `250` | Media | F047 |
| `jobs.concurrentDownloads` | `3` | Jobs | F050 |
| `jobs.rateLimitMode` | `conservative` | Jobs | F007, F050 |
| `export.enabled` | `false` | Export | F057 |
| `export.formats` | `["json","csv","html"]` | Export | F058 |
| `export.preserveRawPayloads` | `false` | Export | F060 |
| `export.autoDiscoverQueryIds` | `true` | Export | F061 |
| `links.cleanShareButtons` | `true` | Privacy/links | F073 |
| `links.expandTco` | `false` | Privacy/links | F074 |
| `composer.snippets` | `[]` | Composer | F075 |
| `privacy.localOnly` | `true` | Privacy | F087 |
| `privacy.telemetry` | `false` | Privacy | F087 |
| `privacy.auditLog` | `true` | Observability | F092 |
| `accessibility.reduceMotion` | `system` | Accessibility | F093 |
| `accessibility.highContrast` | `false` | Accessibility | F094 |
| `i18n.locale` | `en` | i18n | F095 |
| `diagnostics.selectorHealth` | `true` | Observability | F004 |

Settings panel spec:

| Group | Controls |
|---|---|
| Appearance | Theme selector, accent swatch, dense mode toggle, width slider, border/count toggles, font restoration. |
| Layout | Nav item checklist, right sidebar/trends/news/Grok toggles, media layout toggle, writer mode. |
| Filtering | Enable switch, keyword/regex table, premium/verified rule, blocked-account rule, media-type filters, whitelist editor. |
| Media | Media buttons, original quality, filename template builder, duplicate history, ZIP chunk size, queue concurrency. |
| Export | Export targets, formats, raw payload option, query discovery status, archive import. |
| Links | Clean link buttons, fxtwitter/vxtwitter/fixupx options, t.co display. |
| Composer | Snippets, thread mode, templates. |
| Privacy & Security | Local-only status, optional permissions, audit log, encrypted vault, privacy manifest. |
| Accessibility & Language | Reduced motion, contrast mode, locale, text wrapping. |
| Diagnostics | Selector health, route state, enabled features, recent errors, copy support bundle. |

## Phased Build Plan

| Status | Version | Phase | Features | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|
| Complete | v0.1.0 | Repo scaffold and safety rails | License, README stub, userscript/MV3 shared TypeScript scaffold, feature registry F001, settings schema F008, TrustedTypes F005, dependency policy F103, fixture tests F098 | None | `npm run verify` passes; build produces readable `aviary.user.js`; tests parse both local captures; no remote code; no runtime dependencies. |
| Complete | v0.2.0 | Control Center and theme foundation | Settings panel F002, anti-FOUC F003, dim F011, dark palettes F012, width/border controls F014, reduced motion F093, ARIA/contrast F094 | v0.1.0 | Userscript bundle applies a dark theme state at document-start, mounts a Shadow DOM panel, persists toggles, and destroys cleanly. |
| Complete | v0.3.0 | Layout declutter | Nav/sidebar hiding F015/F016, Grok hiding F024, protected list F036, selector health F004, optional permissions shell F086, privacy manifest F010/F087 | v0.2.0 | Home/status fixture contracts pass; layout hiding is class-scoped and reversible; diagnostics reports selector state; optional permissions stay narrow. |
| Complete | v0.4.0 | Filter engine | Keyword/regex F026, premium/verified F029, media-type filter F038, timeline-position scope F039 (blocked/self-repost filters F032/F033 deferred until authenticated fixtures) | v0.3.0 | Added tweet articles only are processed, the master toggle disables all CSS effects without reload, and rule generation re-evaluation never scans the full document per mutation. |
| Complete | v0.5.0 | One-click media | Original image F041, filename templates F045, duplicate history F046, queue F050, HD viewing baseline F043, thumbnail F044 | v0.4.0 | Image downloads use original quality, filenames are deterministic, duplicate history works, queue exposes failures, and the BG service worker bridges `chrome.downloads`. |
| Complete | v0.6.0 | Video / GIF + media presentation | Video/GIF F042, sensitive controls F037, media layout F022 (F047 ZIP chunking + F051 save location deferred to v0.7.0 with batch/export work) | v0.5.0 | Video downloads work on captured/live tweets where variants are discoverable; presentation toggles reverse cleanly via destroy and a master class swap. |
| Complete | v0.7.0 | Export core | Broad export F057, JSON/CSV/HTML/Markdown F058, incremental resume F059, query discovery F061, support diagnostics F102, ZIP chunking F047, save location F051 (XLSX + F091 deferred) | v0.6.0 | Visible tweets are collected, persisted to a CheckpointStore, formatted as JSON/CSV/HTML/MD, and bundled into a STORE-only ZIP under the configured folder hint; query IDs are scraped from loaded scripts; diagnostics copy to clipboard. |
| Complete | v0.8.0 | Archive completeness | Alt text/polls F054, profile About F063, quote/article wrappers F064, action audit log F092, settings import/export F009 (XLSX + F091 stage 2 carry forward to v0.9.0) | v0.7.0 | Export records preserve contextual metadata and produce migration-safe settings. |
| Complete | v0.9.0 | Library + power UX (focused) | Notes/tags F027, direct link unshortening F074, composer snippet editor F075 (insertion deferred). F066 local search, F068 bookmark tags/folders/reminders, XLSX, F091 stage 2 carry forward to v0.10.0+. | v0.8.0 | User can label accounts/posts and clean visible `t.co` redirects without network side effects. |
| Complete | v0.10.0 | MV3 store hardening | Dual packaging F100, install/FAQ docs F101, CSP/MV3 hardening F090, permission + dependency audit F089 (F099 Playwright smoke + XLSX/F066/F068/F091 stage 2/composer insertion deferred) | v0.9.0 | Chrome and Firefox ZIP builds pass the store-preflight checklist. |
| Complete | v0.11.0 | Advanced data + cleanup preview | Follower diffs F065, official archive import F070, cleanup scan preview F079 (read-only), reports F072, F066 local search (XLSX, F068, F091 stage 2, composer insertion, F099 Playwright carry forward) | v0.10.0 | Account data can be scanned and previewed with protected items; destructive actions remain disabled by default. |
| Complete | v1.0.0 | Beats every competitor baseline | Cleanup queue F079/F080 (read-only by policy), presets F104, mobile/touch F097, i18n F095/F096 (F048/F049 media batch + XLSX + F068 + F091 stage 2 + composer insertion + F099 Playwright carry forward) | v0.11.0 | Aviary matches or exceeds direct competitor table-stakes features while preserving the privacy / accessibility / fixture / preflight gates. |
| Complete | v1.1.0 | Carry-over closeout | XLSX F058, bookmark library F068, F091 stage 2 passive GraphQL capture, F075 composer snippet insertion (F048/F049 media batch + F099 Playwright queued for v1.2+) | v1.0.0 | Optional features ship behind explicit opt-in toggles; passive capture scrubs `ct0`/Bearer; composer never simulates keystrokes. |
| Complete | v1.2.0 | Batch media + WARC + external targets + AI scaffold | F048/F049 batch downloader, F071 WARC, F069 external targets, F082 AI command menu (local prompt builder) | v1.1.0 | All actions are explicit, opt-in, and either copy-to-clipboard or write a local file; no network calls without a user-configured key. |
| Complete | v1.3.0 | Integration scaffolds | F056 Aria2 handoff, F077 Bluesky + Mastodon crosspost, F083 AI provider runner, F067 semantic search scaffold | v1.2.0 | Each defaults disabled and only acts when the user supplies credentials. All URLs go through the same `urlValue` validator that rejects non-`http(s)` schemes. |
| Complete | v1.4.0 | Live smoke scaffold + polish | F099 Playwright spec scaffold (no auto-install), Aria2 sweep/cancel, threaded crosspost, integration error readout, auto-embedding on export | v1.3.0 | Every action stays explicit and opt-in; the smoke spec no-ops without the optional `playwright` dep. |

## Risks And Open Questions

| Risk/question | Impact | Mitigation |
|---|---|---|
| Missing local fixtures for profile, settings, notifications, DMs, search, lists, communities, media modal, Grok open state | Selector/API plan incomplete for those surfaces | First implementation work should add captures before building those features. |
| X internal GraphQL query IDs churn | Export/media features break | Passive query discovery, expiry, diagnostics, and graceful degradation. |
| X may detect extension/userscript interference | Account risk | Avoid automation, avoid credential export, minimize API calls, use user-initiated operations, keep rate limits conservative. |
| MV3 service workers are non-persistent | Background queues can lose memory state | Persist all queue state/checkpoints in IndexedDB/chrome.storage; workers are stateless executors. |
| ZIP/media memory pressure | Browser crashes on large batches | Chunk ZIPs, stream where possible, cap concurrency, support native companion later. |
| Store review rejects broad permissions | Distribution delay | Optional permissions, feature-gated prompts, privacy manifest, source maps, no remote code. |
| GPL competitor code contamination | Licensing risk | Use sources for behavior ideas only; do not copy GPL code into MIT-compatible implementation. |
| AI/Grok features blur privacy line | Trust risk | Keep under consideration until local/user-key-only design and disclosure are ready. |
| Destructive cleanup can harm users | Trust and safety risk | Review queues, protected items, undo where possible, audit log, no confirmation dialogs but clear progress/cancel. |
| Accessibility conflict with "no shortcuts" | Keyboard users still need operability | No custom shortcuts, but maintain natural tab/focus/activation semantics. |

## Definition Of Done

`v1.0.0` is done when:

| Area | Required outcome |
|---|---|
| Competitor parity | Aviary covers the safe union of Control Panel, Minimal Theme, Media Harvest, Twitter Web Exporter, major Greasy Fork media scripts, CleanX, link rewriters, dim restorers, and bookmark/export tools. |
| Clear leapfrogs | Selector health, local privacy manifest, reversible lifecycle, query ID discovery, fixture tests, support diagnostics, and local audit log are shipped. |
| Privacy | No telemetry, no remote code, no credential export, no default cloud sync, no hidden third-party calls. |
| Safety | Every feature has `destroy()`, every batch job is rate-limited and cancellable, and destructive operations protect whitelisted items. |
| Accessibility | Control Center passes contrast/ARIA/reduced-motion checks, supports CJK/RTL wrapping, and remains operable without custom shortcuts. |
| Reliability | MHTML fixture tests, storage migration tests, media URL tests, and live smoke tests pass for Chrome, Edge, Firefox, and at least one userscript manager. |
| Distribution | Readable userscript, Chrome MV3 ZIP, Firefox MV3 ZIP, README, privacy notes, support diagnostics, and versioned release notes are produced. |
| Documentation | README explains install paths, feature categories, local-first design, permissions, troubleshooting, and known X churn risks. |

## Appendix A - Source Index

Local sources:

| ID | URL/path | Use |
|---|---|---|
| L01 | `C:\Users\--\repos\Twitter_Userscript\Home _ X.mhtml` | Home DOM, CSS, route, selectors. |
| L02 | `C:\Users\--\repos\Twitter_Userscript\Status _ X.mhtml` | Status/conversation DOM, CSS, media, selectors. |
| L03 | `C:\Users\--\repos\Twitter_Userscript\_decoded\home.html`, `status.html`, CSS files | Decoded ground-truth HTML/CSS fixtures. |
| L04 | Prior `ROADMAP.md` in this repo before v0.0.2 rewrite | Preserved project philosophy and initial selector/API findings. |

Direct OSS competitors and lists:

| ID | URL | Use |
|---|---|---|
| GH01 | https://github.com/insin/control-panel-for-twitter | Direct competitor, features, issues, stars/activity. |
| GH02 | https://github.com/dimdenGD/OldTwitter | Old-layout competitor, issues, full-client architecture. |
| GH03 | https://github.com/typefully/minimal-twitter | Minimal/de-clutter competitor, issues, store support. |
| GH04 | https://github.com/prinsss/twitter-web-exporter | Export/userscript competitor, issues, GraphQL export model. |
| GH05 | https://github.com/EltonChou/TwitterMediaHarvest | Media downloader competitor, issues, changelog/store links. |
| GH06 | https://github.com/AlttiRi/twitter-click-and-save | Userscript media/link/history competitor, issues. |
| GH07 | https://github.com/Bl4Cc4t/GoodTwitter2 | Legacy UI userscript competitor. |
| GH08 | https://github.com/DavidBuchanan314/TwitterHD | HD media userscript/extension competitor. |
| GH09 | https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader | Batch media downloader competitor. |
| GH10 | https://github.com/nirholas/XActions | Automation toolkit competitor/cautionary source. |
| GH11 | https://github.com/theesfeld/CleanX | Country/region/language filter competitor. |
| GH12 | https://github.com/sytelus/xarchive | Bookmark export MV3 competitor. |
| GH13 | https://github.com/uybixd/twitter-web-exporter-diff | Follower/following diff fork. |
| GH14 | https://github.com/lhl/tweetxvault | Local archive/query discovery/semantic search adjacent tool. |
| GH15 | https://github.com/allnodes/FxTwitter | Alternate embed/share URL adjacent project. |
| GH16 | https://github.com/fa0311/AwesomeTwitterUndocumentedAPI | Undocumented API/source discovery list. |
| GH17 | https://github.com/awesome-scripts/awesome-userscripts | Userscript ecosystem/build/distribution list. |
| GH18 | https://github.com/hridaydutta123/awesome-twitter-tools | Twitter tools awesome list. |
| GH19 | https://github.com/mcpower/tweak-new-twitter | Historical de-clutter/filter competitor. |
| GH20 | https://github.com/maxox/xMediaDownloader | x.com media downloader fork and breakage source. |
| GH21 | https://github.com/ItsRqtl/auto-fxtwitter | Copy-link rewriting competitor. |
| GH22 | https://github.com/thevenuz/xify | fxtwitter/vxtwitter link rewriting competitor. |
| GH23 | https://github.com/hotheadhacker/un-grok | Grok-removal competitor. |

Userscript directories:

| ID | URL | Use |
|---|---|---|
| GF01 | https://greasyfork.org/en/scripts/by-site/x.com?sort=total_installs | Popular x.com userscripts and install counts. |
| GF02 | https://greasyfork.org/en/scripts/by-site/x.com?sort=updated | Recently updated x.com userscripts. |
| GF03 | https://greasyfork.org/en/scripts/by-site/twitter.com?sort=total_installs | Popular twitter.com legacy userscripts. |
| GF04 | https://greasyfork.org/scripts/387773-control-panel-for-twitter | Control Panel userscript details. |
| GF05 | https://greasyfork.org/scripts/423001-twitter-media-downloader | Legacy media downloader details. |
| GF06 | https://greasyfork.org/scripts/396746-download-original-picture | Original image download details. |
| GF07 | https://greasyfork.org/scripts/399827-video-quality-fixer-for-x-twitter | Video quality fixer details. |
| GF08 | https://greasyfork.org/scripts/478651 | limbopro media userscript details. |
| GF09 | https://greasyfork.org/scripts/529453-twitter-x-media-downloader | Media downloader with ZIP packaging. |
| GF10 | https://greasyfork.org/scripts/523157-twitter-x-media-batch-downloader | Batch media userscript. |
| GF11 | https://greasyfork.org/scripts/517767-twitter-x-timeline-sync | Timeline read-position sync. |
| GF12 | https://greasyfork.org/scripts/558276-x-com-enhanced-gallery | Enhanced gallery/media viewer. |
| GF13 | https://greasyfork.org/scripts/569963-grok-fact-checker | Grok fact-check command concept. |
| GF14 | https://greasyfork.org/scripts/569964-x-twitter-grok-commander | Grok command menu/prompt templates. |
| GF15 | https://greasyfork.org/scripts/491145-x-twitter-alternative-share-url | Alternate share URL button. |
| GF16 | https://greasyfork.org/scripts/569424-twitter-x-media-copy-download | Media copy/download buttons. |
| GF17 | https://greasyfork.org/scripts/528890 | Mobile-aware media batch/download history. |
| GF18 | https://greasyfork.org/scripts/398540-twitter-block-with-love | Block/mute users who like/repost target post. |
| GF19 | https://greasyfork.org/scripts/470359-twitter-block-porn | Spam/porn reply blocking. |
| OU01 | https://openuserjs.org/group/twitter | OpenUserJS Twitter group. |
| OU02 | https://openuserjs.org/scripts/59de44955ebd/twitter-to-bsky | Crosspost userscript. |
| OU03 | https://openuserjs.org/scripts/pparker1930/Twitter%28X%29%E1%B4%BE%CB%A1%E1%B5%98%CB%A2%2B%2B%2B_Youtube%E1%B4%BE%CB%A1%E1%B5%98%CB%A2%2B%2B%2B | Twitter Plus userscript features. |
| OU04 | https://openuserjs.org/scripts/decayed/Universal_Media_Downloader_-_Local_Server_%28YouTube%2C_TikTok%2C_Instagram_%2B_All_Sites%29 | Local-server media downloader pattern. |

Stores, commercial products, and closed competitors:

| ID | URL | Use |
|---|---|---|
| STORE01 | https://chromewebstore.google.com/detail/minimal-theme-for-twitter/pobhoodpcipjmedfenaigbeloiidbflp | Minimal Theme Chrome listing, users/features/version. |
| STORE02 | https://chromewebstore.google.com/detail/media-harvest-x-twitter-m/hpcgabhdlnapolkkjpejieegfpehfdok | Media Harvest Chrome listing. |
| STORE03 | https://addons.mozilla.org/en-US/firefox/addon/minimaltwitter/ | Minimal Theme Firefox listing. |
| STORE04 | https://addons.mozilla.org/en-US/firefox/addon/control-panel-for-twitter/ | Control Panel Firefox listing. |
| STORE05 | https://chromewebstore.google.com/detail/x-content-backup-tool-x-m/dcpelmafllhhdcbiegigphjnbgnolkgm | X/Twitter Content Backup Tool listing. |
| STORE06 | https://chrome-stats.com/d/kpmjjdhbcfebfjgdnpjagcndoelnidfj/download | Control Panel version/update signal. |
| STORE07 | https://chrome-stats.com/d/hpcgabhdlnapolkkjpejieegfpehfdok | Media Harvest version/review signal. |
| STORE08 | https://xdim.app/ | X Dim Mode features/changelog. |
| STORE09 | https://oldtweetdeck.org/ | OldTweetDeck multi-column demand. |
| STORE10 | https://chromewebstore.google.com/detail/redeck-%E2%80%93-x-twitter-pro-mu/kbipcnjpdpicihheehhcmjmgdlaffbfi | ReDeck multi-column extension signal. |
| COM01 | https://x-cleaner.app/ | Commercial cleanup/account audit/paywall feature map. |
| COM02 | https://xmediadownloader.com/ | Commercial media downloader and Pro limits. |
| COM03 | https://xfilterpro.com/ | AI filtering/summary competitor. |
| COM04 | https://tweetmediaarchive.com/ | Drive/Dropbox media archive product. |
| COM05 | https://xtract.media/ | Advanced downloader/AI workflow competitor. |
| COM06 | https://twibird.com/ | Bookmark/likes search and organization product. |
| COM07 | https://www.xsaved.com/ | Bookmark library/export competitor. |
| COM08 | https://social-archive.org/ | Local social archive adjacent product. |
| COM09 | https://tweetmanager.app/en | Bulk delete/rate-limit/pricing competitor. |
| COM10 | https://hypefury.com/features-pricing/ | Creator scheduling/analytics feature set. |
| COM11 | https://use-xlab.com/compare | Commercial creator-tool comparison/pricing. |
| COM12 | https://contextbolt.com/blog/export-twitter-bookmarks/ | Bookmark export methods and API cap discussion. |
| COM13 | https://tweetxdelete.com/ | Bulk deletion competitor. |

Community and support signal:

| ID | URL | Use |
|---|---|---|
| R01 | https://www.reddit.com/r/Twitter/comments/1rwvife/error_some_privacy_related_extensions_may_cause/ | Extension breakage/privacy warning around Media Harvest. |
| R02 | https://www.reddit.com/r/Twitter/comments/1rmluwe/i_made_a_userscript_that_tracks/ | Follower/following snapshot diff demand. |
| R03 | https://www.reddit.com/r/automation/comments/1tc9x0q/looking_for_a_reliable_twitterx_scraping_api_for/ | X scraping/rate-limit frustration. |
| R04 | https://www.reddit.com/r/chrome_extensions/comments/1tf7wcx/i_built_a_tweetdeckstyle_multicolumn_extension/ | ReDeck multi-column extension demand. |
| R05 | https://www.reddit.com/r/Twitter/comments/1sei1rn/the_x_algorithm_is_genuinely_fucked_and_im_tired/ | Algorithm/feed quality complaint. |
| R06 | https://www.reddit.com/r/DataHoarder/comments/1jx1iea/xtwitter_scraping_options_2025/ | Data hoarding/export options and network parsing. |
| R07 | https://www.reddit.com/r/DataHoarder/comments/1prqgoa/archive_twitterx_media_without_the_api_harbased/ | HAR-based archiving approach. |
| R08 | https://www.reddit.com/r/Twitter/comments/1tc69ik/isnt_there_a_project_going_on_that_gives_you_x/ | Demand for premium/customization alternative. |
| R09 | https://www.reddit.com/r/Twitter/comments/1pnoncx/control_panel_not_working/ | Control Panel breakage after X changes. |
| R10 | https://www.reddit.com/r/Twitter/comments/1r2af6j/did_they_just_get_rid_of_dim/ | Dim removal complaint and workaround discussion. |
| R11 | https://www.reddit.com/r/uBlockOrigin/comments/1r2ev6n/x_just_got_rid_of_the_dark_blue_color_scheme/ | Userstyle/extension dim restoration signal. |
| R12 | https://www.reddit.com/r/u_AlbatrossDependent93/comments/1tecnia/i_built_a_free_chrome_extension_to_organize/ | Bookmark organization product signal. |
| R13 | https://www.reddit.com/r/chrome_extensions/comments/1rchs9f/i_built_a_zeroaccess_extension_for_x_twitter/ | Local browser extension vs API cost/security signal. |
| R14 | https://www.reddit.com/r/socialmedia/comments/1sql9ux/i_compared_xtwitter_management_tools_honest/ | Reply management comparison. |
| R15 | https://www.reddit.com/r/chrome_extensions/comments/1n9p784/i_made_a_chrome_extension_to_mass_delete_tweets/ | Mass deletion pain point. |
| R16 | https://www.reddit.com/r/DataHoarder/comments/1fdovxq/looking_for_a_twitterx_media_downloader_bulkbatch/ | Bulk media downloader demand. |
| R17 | https://www.reddit.com/r/Twitter/comments/1jz94ir/i_created_a_tampermonkey_script_to_easily_screenshot_twitterx_posts_and_capture_entire_threads/ | Screenshot/thread capture userscript. |
| R18 | https://www.reddit.com/r/userscripts/comments/1sua7we/request_gif_posts_blocker_for_xtwitter_at_least/ | GIF/media filter request. |
| R19 | https://www.reddit.com/r/Twitter/comments/1ct5utd/url_change_to_xcom_broke_a_bunch_of_my_extensions/ | x.com migration breakage. |
| R20 | https://stackoverflow.com/questions/78661948/chrome-extension-update-dom-on-x-com-twitter | MutationObserver/content-script approach for x.com. |
| R21 | https://stackoverflow.com/questions/77023902/how-to-access-modify-dom-elements-in-chrome-extension-manifest-v3-content-scri | MV3 content script DOM access reference. |
| R22 | https://www.reddit.com/r/chrome_extensions/comments/1sa93sz/i_got_tired_of_paid_x_unfollow_extensions_so_i/ | Review-first unfollow workflow signal. |
| R23 | https://www.reddit.com/r/chrome_extensions/comments/1njlxyx/i_made_a_simple_chrome_extension_that_sorts_twitterx_replies_by_likes/ | Reply sorting by likes signal. |
| R24 | https://www.reddit.com/r/chrome_extensions/comments/1t9vuxw/i_built_a_chrome_extension_to_save_xtwitter_posts/ | Local swipe-file/save-post workflow signal. |
| R25 | https://www.reddit.com/r/techsupport/comments/1cj1kt7/question_is_there_anything_to_mass_remove_retweets/ | Retweet cleanup demand. |
| R26 | https://www.reddit.com/r/webdev/comments/1rn206u/is_indexeddb_actually_viable_in_2026_or_am_i/ | IndexedDB/Dexie storage tradeoff signal. |
| R27 | https://www.reddit.com/r/webdev/comments/ywt3fj/security_difference_between_localstorage_and_indexeddb/ | Browser storage security discussion. |
| R28 | https://www.reddit.com/r/chrome_extensions/comments/1s69b2s/minimizing_permissions_for_chrome_extension/ | Optional permissions and trust UX. |

Platform, standards, and API docs:

| ID | URL | Use |
|---|---|---|
| P01 | https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3 | MV3 background/service worker/remote code constraints. |
| P02 | https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest | DNR constraints and extension network strategy. |
| P03 | https://developer.chrome.com/docs/extensions/reference/api/userScripts | Chrome userScripts API. |
| P04 | https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts | Content script worlds and injection model. |
| P05 | https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API | TrustedTypes and injection sink rules. |
| P06 | https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe | MutationObserver behavior. |
| P07 | https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API | IndexedDB storage model. |
| P08 | https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system | OPFS for large local data. |
| P09 | https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto | WebCrypto encryption primitives. |
| P10 | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts | Firefox MV3 userScripts API. |
| P11 | https://docs.x.com/x-api/fundamentals/rate-limits | Official X API rate limits. |
| P12 | https://docs.x.com/developer-guidelines | X developer guidelines and prohibited automation. |
| P13 | https://help.x.com/en/rules-and-policies/x-limits | X platform account/action limits. |

Academic, engineering, dependency, and security sources:

| ID | URL | Use |
|---|---|---|
| A01 | https://arxiv.org/abs/2404.08310 | Manifest V3 ecosystem analysis. |
| A02 | https://arxiv.org/abs/2507.13926 | Developer insight on MV3 privacy/security. |
| A03 | https://arxiv.org/abs/2505.19456 | JavaScript inclusion risks in browser extensions. |
| A04 | https://arxiv.org/abs/2512.10029 | Malicious GenAI Chrome extension behavior. |
| A05 | https://arxiv.org/abs/2409.01880 | Browser extension archiving for ephemeral social media. |
| A06 | https://medialab.sciencespo.fr/en/tools/zeeschuimer/ | Browser traffic capture for social media research. |
| A07 | https://www.pure.ed.ac.uk/ws/portalfiles/portal/483223108/AlHaririEtalCSCW2024TwiXplorer.pdf | Twitter/X narrative exploration and analysis UI. |
| A08 | https://www.archives.gov/records-mgmt/resources/socialmediacapture.pdf | Social media capture/archive practices. |
| A09 | https://security.snyk.io/package/npm/jszip | JSZip maintenance/security signal. |
| A10 | https://github.com/dexie/Dexie.js/releases | Dexie release/changelog signal. |
| A11 | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html | TypeScript 5.9 release notes. |
| A12 | https://cybernews.com/security/chrome-extensions-flagged-for-stealing-user-data/ | 2026 malicious Chrome extension campaign. |
| A13 | https://www.island.io/browser-extension-security/browser-extension-security-defending-against-network-request-manipulation | Extension network manipulation risk. |
| A14 | https://nvd.nist.gov/vuln/detail/CVE-2026-40451 | Chrome extension XSS vulnerability example. |
| A15 | https://arxiv.org/abs/2604.17668 | JavaScript/npm dependency vulnerability propagation. |

## Appendix B - Self-Audit

Mandatory Phase 5 checks:

| Check | Result |
|---|---|
| Full roadmap re-read | Passed after rewrite. Sections align from repo state to sources to features to tiers to phases. |
| Every item traceable to Appendix | Passed. Feature rows include source IDs, and every source ID maps to a URL/path. |
| Every tier placement justified | Passed. Gap table includes fit, impact, effort, risk, dependencies, novelty, tier, and one-sentence rationale for each item. |
| Required categories covered | Passed: security, accessibility, i18n/l10n, observability/telemetry, testing, docs, packaging, plugin/preset ecosystem, mobile, offline/resilience, multi-user/collab-adjacent sharing, migration, upgrade strategy. |
| Thin categories consciously handled | Multi-user/collab is intentionally limited to export/share targets and not live collaboration because local-first privacy is the core philosophy. Plugin ecosystem is expressed as feature registry/presets, not third-party arbitrary code for v1. |
| Duplicate items removed | Passed. Feature IDs are unique; rejects are not repeated in Now/Next/Later. |
| Hostile-review concerns addressed | Passed. The roadmap calls out missing fixtures, API volatility, store review, account risk, dependency supply chain, and destructive-operation safety. |
| Disk write confirmed | This file is `C:\Users\--\repos\Twitter_Userscript\ROADMAP.md`. |

## Competitor Gaps — 2026-08-07 research pass

Sourced from the userscript indexes (Greasy Fork itself edge-blocks automated clients, so the
listing was read through userscript.zone plus targeted search). Ranked by how often the capability
shows up in high-install scripts against how much of it Aviary already has.

## Audit Findings — 2026-08-06 (not fixed in this pass)

Raised during the full engineering/UX/security audit of v1.6.0. Items fixed in that pass are
in CHANGELOG.md; these are the ones left open, with the reason each was not taken.


## Audit Findings — 2026-08-07 (audit-only pass; not fixed)

Baseline at `409f846`: `tsc` clean, 188/188 tests pass, build+preflight green. Findings are
ordered P1 → P3; each was verified as described in its Evidence line. Verification harnesses ran
read-only (Playwright against `_decoded/home.html` and scratch pages); no source was changed.

