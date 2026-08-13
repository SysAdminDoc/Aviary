# Research — Aviary for X

Date: 2026-08-13 — replaces prior research.

## Executive summary

Aviary is a local-first desktop X/Twitter userscript and Chrome/Firefox MV3 extension. This pass
used a user-authenticated, isolated in-app browser session for read-only production reconnaissance,
then exercised the built project against sanitized local fixtures. The session remained isolated;
no cookies, tokens, private response bodies, handles, or feed screenshots were exported.

The highest-impact confirmed gaps were advertising leakage, current-route drift, and a settings UI
whose dense card grid obscured state and dependencies. v1.18.0 adds default-on document-start ad
protection, repairs current route contracts, and rebuilds all 13 Control Center destinations plus
the extension options page as one desktop operations cockpit. Native promoted records are delivered
inside the essential HomeTimeline response, so Aviary suppresses their rendering but cannot claim
their bytes were absent. The separately initiated promoted-content logger is prevented before its
request is issued.

The v1.19.0 follow-up adds Noir, an opt-in premium desktop skin. A local-only live preview on the
authenticated Home route confirmed the current semantic anchors for the navigation rail, timeline,
composer, media, search, news, recommendations, and Grok surfaces. Only Aviary's CSS and root theme
marker were inserted for the preview; the page was restored afterward and no feed screenshot,
cookie, token, response body, or private content was exported.

Live Home also confirmed that the active AppTabBar link currently has no `aria-current` marker.
Noir therefore derives its own `data-av-active-route` state from same-origin link paths on each
feature pass and removes every marker when Off or destroyed; the authenticated preview measured
the Home marker, active gradient, and unchanged horizontal geometry before restoring the page.

## Live snapshot

Observed 2026-08-13 at 1440×900 in X dark theme with an authenticated account. Recon was read-only.

| Surface | Current pattern/state | Contract result |
|---|---|---|
| Home / Following | `/home`, tab state inside the route | Verified virtualized timeline, delayed insertion, native sponsored article, promoted trend, and house promo |
| Profile | `/handle`, `/handle/with_replies`, `/media`, `/highlights`, `/articles` | Changed: current collection tabs are path segments; repaired route classification |
| Status | `/handle/status/:id` | Verified article/detail surface and current primary column |
| Search | `/search?q=…` | Verified SPA route and timeline results surface |
| Notifications | `/notifications` | Verified SPA route and current primary column |
| Chat | `/i/chat` and PIN-recovery child route | Changed from the historical messages assumption; repaired route classification |
| Grok | `/i/grok` | Verified first-party product surface and house-promo links |
| X settings | `/settings/account` | Changed: this page intentionally has no `primaryColumn`; health no longer treats that as failure |

The production app is client-rendered and virtualizes timeline cells. Hard loads create the shell,
then first-party data and placements arrive asynchronously. History/router navigation replaces
route-specific subtrees without a document reload. Reliable features therefore need document-start
setup plus idempotent observation and route reconciliation; a one-shot DOM scan is insufficient.

## Current DOM and data contract

| Contract | 2026-08-13 status and context | Consumer / decision |
|---|---|---|
| `article[data-testid="tweet"]` | Verified on Home, profile, status, and search | Bounded post owner for filters, controls, and native-ad removal |
| `[data-testid="cellInnerDiv"]` | Verified around timeline articles | Collapse this owner to avoid an empty virtualized row |
| `[data-testid="primaryColumn"]` | Verified on content routes; intentionally missing on X settings | Route-aware selector health, not a global requirement |
| `[data-testid="trend"]` | Verified in the Home sidebar | A promoted label inside this owner identifies the removable trend row |
| `[data-testid="placementTracking"]` | Changed meaning: also wraps organic media and a first-party module | Explicitly rejected as an advertising predicate |
| Exact `Ad` label inside an article | Verified on a native sponsored Home record | One signal; bounded by the article and reinforced by tracking/policy links where present |
| `twclid=` or `ad.doubleclick.net` link inside article | Verified on the native sponsored record | Strong tracking-link evidence; the observed DoubleClick value was a link target, not proof of a loaded third-party resource |
| Paid-partnership policy link | Verified on a partnership record | Stable policy-link evidence without matching arbitrary post copy |
| `aside[role="complementary"]` with Grok/Premium product links | Verified on Home | Bounded first-party house-promo owner |
| Visible pre-roll copy (`Video will play after ad`, `Skip Ad…`) | Verified on a video state | Suppress the owning video/article container; transport remains operator-trace gated |
| HomeTimeline GraphQL | Verified as essential first-party feed transport containing organic and sponsored records | Never block broadly; native-ad transport is inseparable |
| `/i/api/1.1/promoted_content/log.json` | Verified successful first-party XHR before Aviary | Exact separable logger blocked by the document-start page agent |

No generated `r-*` class, positional child chain, or localized free-form post text was promoted to a
contract. Ad labels are matched through a bounded locale list and structural owner checks.

## Advertising surface and request map

| Placement | Route / insertion | Request or transport | Current behavior | Remaining proof |
|---|---|---|---|---|
| Native sponsored timeline article | Home; delayed/virtualized and reinserted after SPA return | Record shares HomeTimeline GraphQL with organic content | Article and owning virtualizer cell are suppressed on cold fixture load and delayed/SPA insertion | Direct authenticated build injection is unavailable in the in-app browser |
| Paid partnership | Timeline article | First-party record; policy link is the stable DOM discriminator | Owning article/cell suppressed; minimized synthetic fixture is retained | Additional real locale/state captures remain operator-gated |
| Promoted trend | Home complementary sidebar | First-party sidebar data | Matching `[data-testid="trend"]` row suppressed | Direct authenticated build injection unavailable |
| Grok/Premium house promo | Home complementary rail | First-party product content | Bounded promo aside/card suppressed; ordinary navigation remains | New product URLs need selector-health visibility |
| Video pre-roll | Video player inside timeline/article | Request hostname/initiator not safely correlated in this pass | Visible ad owner suppressed | UNVERIFIED whether creative transport is separable; broad media-host blocking is unsafe |
| Promoted-content event logger | Home; XHR after sponsored exposure | `x.com/i/api/1.1/promoted_content/log.json` | Userscript `fetch`/XHR/`sendBeacon` receive an empty local response; extension DNR blocks the exact request before connection | Browser-owned Chrome and Firefox loopback probes pass |
| Tracking/affiliate destinations | Link inside sponsored article (`twclid`, observed DoubleClick target) | Navigation target, not observed page-load resource | Removed with the sponsored owner; no broad host block | Do not claim a third-party request was loaded without network evidence |

The exact page-world logger guard installs before persisted settings resolve so a cold page cannot
win a race. The extension now adds a second, browser-owned boundary: one dynamic rule whose cheap
path regex is constrained by exact X/Twitter request domains and synchronized to `privacy.blockAds`.
Disposable Chrome and Firefox builds add the feedback permission only in the test profile; both
real runtimes prove the exact logger match, four negative controls, disable/re-enable persistence,
and that a blocked logger never reaches a loopback network endpoint. The structural feature remains
reversible and MutationObserver/route safe.

The dated fixture corpus under `tests/fixtures/ad-corpus/` is deliberately not a clipped production
page. Five sub-1.5 KB documents retain only the structural selectors, exact contract labels, two
allowlisted policy/product links, and synthetic copy. A static privacy gate rejects scripts, styles,
resource URLs, credentials, handles, and account/tweet-shaped ids; Chromium then exercises cold
paint, delayed insertion, virtualizer ownership, opt-out/re-enable, pre-roll recovery, and SPA
reinsertion while proving organic `placementTracking`, trends, asides, and video remain visible.

## Platform and security assessment

- Chrome's content-script model allows `document_start` execution before ordinary page scripts and
  DOM construction, which is the earliest common userscript/MV3 layer used here. See
  [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
  (accessed 2026-08-13).
- Manifest V3 `declarativeNetRequest` now supplies browser-level defense in depth for extension
  builds. Aviary uses `declarativeNetRequestWithHostAccess`, an exact path regex plus request-domain
  constraints, and no shipped feedback permission. See
  [Chrome DNR](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
  and [MDN DNR](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest)
  (accessed 2026-08-13).
- Base extension permissions are `storage` and host-scoped
  `declarativeNetRequestWithHostAccess`; downloads and media hosts remain optional. No `<all_urls>`,
  `webRequest`, remote code, telemetry, credential export, or private-body fixture was added.
  Firefox uses a supported MV3 event page and an enabled empty static ruleset for Firefox 128–132's
  documented dynamic-rule persistence edge. Chrome's current permission guidance favors the narrowest required declarations:
  [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
  (accessed 2026-08-13).
- The page-world bridge remains a hostile-input boundary. Existing URL/operation/body limits,
  budgets, and redaction remain necessary; ad protection does not expand bridge data collection.

## Settings-page matrix and selected ImageGen direction

ImageGen produced a separate 1440×900 desktop `ui-mockup` for every destination using the same dark
charcoal operations-cockpit system. Mockups are design references; the shipped interface is HTML,
CSS, and TypeScript. Implemented screenshots were captured at 1440×900 and 1920×1080, with a
geometry gate for viewport escape, horizontal overflow, and clipped controls. Overlay comparisons
are stored under `docs/audit/2026-08-13/settings-parity/`.

| Destination | Selected mockup | Implemented capture |
|---|---|---|
| Presets | `docs/mockups/2026-08-13/control-center-presets.png` | `settings-after/control-center-presets-1440x900.png` |
| Appearance | `docs/mockups/2026-08-13/control-center-appearance.png` | `settings-after/control-center-appearance-1440x900.png` |
| Layout | `docs/mockups/2026-08-13/control-center-layout.png` | `settings-after/control-center-layout-1440x900.png` |
| Filtering | `docs/mockups/2026-08-13/control-center-filtering.png` | `settings-after/control-center-filtering-1440x900.png` |
| Hidden posts | `docs/mockups/2026-08-13/control-center-hidden.png` | `settings-after/control-center-hidden-1440x900.png` |
| Performance | `docs/mockups/2026-08-13/control-center-performance.png` | `settings-after/control-center-performance-1440x900.png` |
| Media | `docs/mockups/2026-08-13/control-center-media.png` | `settings-after/control-center-media-1440x900.png` |
| Export | `docs/mockups/2026-08-13/control-center-export.png` | `settings-after/control-center-export-1440x900.png` |
| Library | `docs/mockups/2026-08-13/control-center-library.png` | `settings-after/control-center-library-1440x900.png` |
| Snapshots | `docs/mockups/2026-08-13/control-center-snapshots.png` | `settings-after/control-center-snapshots-1440x900.png` |
| Integrations | `docs/mockups/2026-08-13/control-center-integrations.png` | `settings-after/control-center-integrations-1440x900.png` |
| Backup & Audit | `docs/mockups/2026-08-13/control-center-backup.png` | `settings-after/control-center-backup-1440x900.png` |
| Trust | `docs/mockups/2026-08-13/control-center-trust.png` | `settings-after/control-center-trust-1440x900.png` |
| Extension permissions | `docs/mockups/2026-08-13/extension-options.png` | `settings-after/extension-options-1440x900.png` |

Real setting keys, defaults, permission buttons, validation, and action callbacks were preserved.
The generated boards sometimes implied decorative row icons or a single page-level Save bar that
the current behavior does not yet support; correct semantics and accessible native controls won.
That remaining transactional improvement is recorded in ROADMAP rather than faked visually.

## Desktop journey conclusions

- Discovery: grouped rail headings and a persistent search affordance make 13 destinations easier
  to scan than the old equal-weight card grid.
- Editing: the footer now says when changes are unsaved; independent drafts remain visible, and
  search/section changes cannot silently strand the active edit.
- Dependencies: filters, hidden posts, original-quality media, and optional permissions explain
  their disabled or grant-dependent state next to the control.
- Recovery: Trust reset copy accurately preserves local libraries and returns to the default
  ad-free baseline instead of promising literal untouched X.
- Permission journey: the extension page summarizes granted/optional counts before listing the two
  reversible permission groups, with explicit status and live region feedback.
- Accessibility: modal focus containment, focus-visible states, semantic native controls, RTL
  catalog coverage, and reduced-motion behavior remain in the automated contract. Mobile design
  and mobile claims are intentionally outside this desktop pass.

## Competitive and community evidence

- [Hide X.com Ads](https://chromewebstore.google.com/detail/hide-xcom-ads/bapmhjebfdbdpjjfafnkfidijkjlkakf)
  demonstrates demand for a narrowly focused promoted-post/upsell remover. Its store listing was
  checked 2026-08-13; adoption/review values are time-sensitive and are not product guarantees.
- [X Filter Pro](https://xfilterpro.com/) combines ad blocking, focus mode, and account/keyword/
  engagement filtering. Aviary's advantage is a readable local-first build, reversible controls,
  archive tooling, and explicit provider boundaries rather than a hosted subscription workflow.
- [Better X](https://betterxtwitter.com/) and [TidyFeed](https://tidyfeed.app/home) reinforce demand
  for calmer feeds and discoverable declutter controls. Their public feature pages were reviewed
  2026-08-13; implementation claims were not treated as independent proof.
- Current public discussion reports growing frustration with ad load even among paid users, but
  community posts are sentiment only. Product decisions here are grounded in observed DOM/network
  contracts, not anecdotes.
- X documents promoted content as reportable advertising, confirming that native paid placements
  are a first-class site concept: [Reporting X Ads](https://help.x.com/en/safety-and-security/reporting-x-ads)
  (accessed 2026-08-13).

No native X feature made an Aviary subsystem safely redundant. X bookmarks and lists do not replace
the local annotated library, truthful offline exports, profile-scoped backup, or reversible local
filters, so no mature feature was removed merely because a similarly named native control exists.

## Priority disposition

### Follow-up — shipped in 1.19.0

1. Premium Noir desktop theme with semantic current-X anchors and reversible Off behavior.
2. Search-shell and live news-card refinements measured against the authenticated Home DOM.
3. Deterministic Noir capture and regression coverage at 1440×900 and 1920×1080.
4. Seven-mode, nine-locale release-matrix coverage with full 793-string catalog parity.

### Now — shipped in 1.18.0

1. Document-start ad logger prevention and structural suppression of every evidenced desktop ad
   surface; impact 5, effort M, hook risk medium.
2. Current `/i/chat`, profile-tab, and settings-route repairs; impact 4, effort S, hook risk low.
3. Complete 14-surface settings redesign and capture gate; impact 5, effort L, visual risk medium.
4. Explicit draft/dependency/permission state and accurate reset copy; impact 4, effort M, risk low.
5. Recursive UI i18n extraction with full nine-locale catalog parity; impact 4, effort S, risk low.

### Next — active roadmap

1. Transactional page-level Save/Revert for Control Center edits.
2. Local-only ad contract drift diagnostics with no content retention.
3. Desktop visual-regression coverage across settings themes and material states.

### Blocked / rejected

- Direct authenticated built-extension verification, video pre-roll request correlation,
  blocked-author filtering, self-repost filtering, and sensitive-media scoping have explicit
  re-entry evidence requirements in `Roadmap_Blocked.md`.
- Broad HomeTimeline, `x.com`, `pbs.twimg.com`, or `video.twimg.com` blocking is rejected because it
  would damage essential feed/media behavior.
- `placementTracking`-only removal is rejected because current organic content uses it.
- Mobile redesign, mobile navigation, and phone/tablet screenshot work are rejected by the desktop
  product scope.

The most likely next break is an X label/link/owner change that leaves native ads inside a normal
tweet article. The hardening path is a minimized dated fixture corpus plus local selector-health
telemetry, not a broader generated-class or text selector.
