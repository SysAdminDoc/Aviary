# Aviary blocked roadmap

Each item below requires a state that is absent from the privacy-safe `_decoded/` fixtures.
Read-only authenticated recon on 2026-08-13 resolved current promoted-post/trend/house-promo
contracts without exporting session data, but the inspected routes did not expose blocked-author,
self-repost, or sensitive-media examples. Those behaviors still cannot be built from a guess.

Passive GraphQL capture can produce better evidence than a full private-page screenshot: enabling
"Keep raw payloads" in Export and scrolling a disposable test timeline records the server's own
bounded post description. Any contributed fixture must be minimized and scrubbed before it enters
the repository.

## F134 (operator half), produce a refreshed authenticated capture

The tooling landed 2026-08-15 and changed shape on 2026-09-07 (F306): `npm run capture:decode`
turns a saved MHTML into a scrubbed page **outside** the repository, that page is measured into
`_decoded/dom-schema.json` and then deleted, and preflight warns then fails past the declared
90-day ceiling on `derivedFrom.capturedOn`. What cannot be automated is the capture itself, it
requires a signed-in X session, and nothing in this repository logs in or fetches.

**Every "measured: N hits" figure below was taken against the 2026-05-19 saved pages, which no
longer exist in the working tree.** The schema records the surfaces Aviary depends on; it does not
record the absence of surfaces it does not, so none of those measurements can be re-checked without
a fresh capture. They are historical readings, dated, not facts about X today.

The current captures are dated **2026-05-19**. Everything below that says "measured: N hits" was
measured against that date, and X shipped a media redesign on 2026-08-11/08-13 that no capture here
contains. A single refreshed pair (Home plus a conversation route) would let every measurement in
this file be re-run, and would likely settle several of them.

Re-entry condition: the operator follows "Refreshing the capture set" in CLAUDE.md. Then re-run each
measurement, record it with the new date, and move whatever the capture now supports back into
ROADMAP.md. The waiver in `captures.json` expires 2026-09-30, after which preflight fails rather
than warns, deliberately, so the deadline is real.

## F283, authenticate the adaptive quality comparison

The observed-adaptive yt-dlp handoff is implemented and covered by scrubbed fixtures. Direct
progressive MP4 remains the zero-setup default, while an observed `video.twimg.com` manifest can be
sent to an authenticated loopback helper with only the manifest URL, filename, and fixed format
policy. The repository does not claim that an adaptive rendition is higher quality until a signed-in
X capture records both progressive and adaptive metadata for the same post.

Re-entry condition: capture a privacy-safe, authenticated post that exposes the progressive and
adaptive renditions together, record dimensions, bitrate, MIME, and container evidence, then compare
the saved outputs without exporting cookies, bearer tokens, post URLs, or response bodies. Promote
the quality claim only when the observed adaptive stream is demonstrably better and the merged file is
playable without a required transcode.

## F139, Restore what X's August 2026 media redesign changed

X replaced the 2x2 multi-image grid with a carousel (2026-08-11) and removed the desktop profile
media grid, defaulting the Media tab to Videos and moving Likes into a dropdown (2026-08-13). These
are the two highest-engagement X-UI complaint threads of that window -- 235 points/82 comments and
61 points/17 comments -- both explicitly asking for an extension that reverts them, and every
incumbent is idle or in maintenance. The carousel additionally fails to render media on Firefox 153,
which nothing currently fixes.

Blocked on the same capture as everything else here: no fixture in this repository postdates
2026-05-19, so the containers, markers and heading shapes of the new layout are all unknown. Working
community fixes name two flags -- `rweb_media_carousel_enabled` and
`responsive_web_profile_redesign_enabled` -- which moves F115 from discovery to verification but
does not make a third-party scriptlet into evidence this project accepts.

Re-entry condition: the refreshed capture (see F134's operator half), then verify each flag write
applies before X's first read and actually changes the rendered layout. Flag names belong in a data
file that can be updated without a rebuild, never compiled into a feature, and a flag that no longer
exists must degrade loudly through selector health rather than silently doing nothing.

## F032, Hide blocked accounts again

Blocked pending an authenticated `_decoded/` home/status capture containing the current blocked-account markup. The existing public fixtures do not expose the required `[data-testid="userActions"]` blocked state, so shipping a predicate now would be speculative.

Re-entry condition: add the authenticated capture, verify the live selector, then implement and fixture-test the predicate while preserving the handle whitelist.

## F033, Hide self-quotes and self-reposts

Blocked pending an authenticated `_decoded/` quote/thread capture containing the current repost attribution row. The existing fixtures do not expose the `Reposted by @<handle>` relationship needed for a reliable author-equality check.

Re-entry condition: add the authenticated capture, verify the social-context selector, then implement and fixture-test self-repost detection without broad text heuristics.

## Hide all reposts

Blocked on a fixture that contains a repost -- the roadmap entry that proposed this asserted the
public capture exposes the social-context row, and that is wrong. Measured: `socialContext`
appeared 0 times in the 2026-05-19 Home and conversation captures, and so did the strings
"reposted" and "retweeted" (case-insensitive). Neither capture contains a single repost, so there
is nothing to build a predicate against and nothing to fixture-test it with.

This is the same blocker as F033 (self-reposts): one privacy-safe capture of a real repost would
unblock both at once.

Re-entry condition: add a `_decoded/` capture containing a repost, confirm the marker against it,
then implement as a `filter.repostRule` FilterAction alongside `premiumRule`, and fixture-test
that an original post carrying a quote-tweet is untouched.

## Scope the media display modes to genuinely sensitive media

`media.sensitive` reads as a sensitive-content control, and its blur and hide rules match every
`[data-testid="tweetPhoto"]`, `videoPlayer` and `videoComponent` in the timeline -- nothing in them
tests whether X marked the media sensitive. In v1.12.1 the control was relabelled to say what it
does ("Blur every photo and video") rather than shipping a scope it does not have.

Blocked on a capture containing sensitive media. Measured across both fixtures: `home.html` holds
3 photos and 2 videos, `status.html` 2 and 2, and neither contains a single sensitive item. The
one `[data-testid="contentDisclosureButton"]` in either file sits in the composer toolbar
(`toolBar` -> `primaryColumn`), not inside any `article[data-testid="tweet"]` -- it is the control
for marking your *own* post sensitive, not a media overlay. So the existing `av-sensitive-reveal`
rule, which hides that testid inside an article, matches nothing that has ever been captured.

Re-entry condition: add a `_decoded/` capture containing sensitive media, confirm what marks it
(an overlay wrapper, an `aria-label`, a disclosure button inside the media container), then stamp
the owning media container with a `data-av-*` attribute from the feature and scope the CSS to that
attribute. Then relabel the control back to naming sensitive media --
`tests/media-scope.test.mjs` fails at that moment, which is what forces the copy to follow.

## Settings that normalize but nothing reads

An unread-settings sweep (probe self-checked against a key known to be read, so a broken regex
could not report everything as dead) found five. `timelineWidth` and `restoreChirp` were wired in
v1.9.0, and `privacy.encryptVault` was removed in v1.12.0 rather than implemented (see
CHANGELOG.md for why). Two remain, both waiting on the same capture:

- `filter.selfRepost` -- F033. Needs a capture containing a self-repost. Already defaults to
  `"off"`, so it claims nothing while it waits.
- `filter.blockedAccounts` -- the *feature* still needs a capture containing X's blocked-account
  placeholder row. The *claim* is fixed: it defaulted to `"hide"`, so every install carried a
  filter the engine never applied and every settings export published that claim. It defaults to
  `"off"` now, and `tests/settings-claims.test.mjs` fails any filter action that defaults to
  something active while nothing reads it.

Re-entry condition for both: an authenticated, privacy-safe `_decoded/` capture containing the
blocked-author placeholder and self-repost attribution. One deliberately prepared fixture can
settle both items.

## Release matrix lanes requiring external environments

The deterministic matrix is covered in `tests/release-matrix.test.mjs` and the fixture smoke lane:
all supported routes (including profile collection subroutes, Notifications, Messages, Search,
status, and the media viewer), nine locales, seven themes, keyboard/coarse-pointer modes, malformed
state/provider bodies, Unicode byte caps, ZIP expansion limits, and route subscription teardown /
reboot are exercised without credentials.

The following release lanes remain blocked and are intentionally not represented as green CI:

- Direct execution of the built userscript/MV3 extension inside an authenticated X session, plus
  real composer/crosspost attachment responses. The 2026-08-13 in-app browser session allowed
  read-only DOM/route recon but cannot side-load an unpacked extension or export its session; the
  isolated Playwright profile can load the build but is unauthenticated. Re-entry requires an
  operator-authenticated disposable extension profile, without copying cookies or private bodies.
- Video pre-roll request correlation. Visible pre-roll markers were observed on 2026-08-13 and
  their owning containers are suppressed, but no privacy-safe trace proved whether the creative
  uses a separable endpoint or the same first-party video transport as organic media. Re-entry
  requires an operator trace containing hostname, resource type, and initiator with tokens and
  response bodies omitted; broad `video.twimg.com` blocking is prohibited.
- Tampermonkey and Violentmonkey page-world access, plus Firefox/Safari and screen-reader checks.
  These require the named browser/manager combinations installed on an operator workstation.
- A successful optional download-permission grant followed by revoke. The Chromium external lane
  verifies the initial refusal and grant surface, but its temporary extension profile cannot claim
  a user-approved grant/revoke result.

Re-entry procedure: build with `npm run build`, run `npm run test:matrix`, then run `npm run smoke`
with the disposable authenticated fixture/profile or the target browser manager. Capture the route,
locale/theme, nested dialog/menu, permission state, and console/page-error result for each lane;
promote a lane only after its evidence is checked into `_decoded/` or the external smoke fixture.

## Hide "More From This Author"

X injects a "More From This Author" module between replies (reported July 2026; Control Panel for
Twitter shipped a toggle for it in v4.23.0). The sibling module on the same routes, "Discover
more", was present in the 2026-05-19 conversation capture and is handled by
`src/features/layout/thread-recommendations.ts`, which matches a bounded heading label inside a
`cellInnerDiv` on a conversation route.

Blocked because neither capture contains "More From This Author". Measured: the string appears 0
times in the 2026-05-19 captures. Its heading text, its owning element, and
whether it even uses the same `h2[role="heading"]` boundary shape as "Discover more" are all
unknown, and a guess would be exactly the speculative selector this repository refuses to ship.

Re-entry condition: add a `_decoded/` capture containing the module, confirm the heading element and
its exact copy, then add the label to `HEADING_LABELS` in
`src/features/layout/thread-recommendations.ts` and extend
`tests/thread-recommendations.test.mjs` with the captured shape. If it does not use a heading
boundary, the feature needs a second predicate rather than a new string.

Localized heading labels have the same gate: only "Discover more" is verified, so other X UI
languages currently keep the module. Each added locale needs a capture proving its copy.

## Detect X's ad-blocker warning surface

X began testing a warning in July 2026 that tells browser users an ad blocker is preventing
"Personalized Timelines" and steers them off the For You tab. Aviary now separates the observable
half of its ad protection behind `privacy.networkShield`, so a user who meets that warning can drop
to structural-only hiding without losing ad suppression.

What is blocked is the *automatic* part: detecting the warning and reporting it in Trust. The
warning is behind a limited rollout, appears in no `_decoded/` capture, and its container, copy, and
whether it carries any stable test id are all unknown. A selector written from a news screenshot is
exactly the speculative contract this repository refuses.

Re-entry condition: an operator-authenticated session that actually renders the warning, captured
privacy-safely into `_decoded/`. Then add it to `SURFACE_SELECTORS`, report it through selector
health beside the ad-contract observations, and offer the shield toggle from that notice.

Also unverified: whether Aviary's exact promoted-logger block is what triggers the warning at all.
It may key on uBlock-scale request blocking that Aviary does not do. Do not claim causation in UI
copy without a session that demonstrates the warning appearing and disappearing with the toggle.

Updated 2026-08-15, a testable hypothesis now exists. The fix that propagated through the July 2026
reports does not hide anything; it *allowlists* two XHRs, `x.com/i/api/1.1/flow/viewer.json` and
`x.com/i/api/*/viewer_context.json`. If that is right, the trigger is a probe request failing rather
than an ad rendering, which would put Aviary's single-logger refusal outside it. Two further details
worth carrying into the session: the detection does not always present as the banner, the same
reports describe "An error has occurred but it's not your fault", a blank feed, and search returning
nothing, all of which read as an X outage, and it appears account-scoped rather than universal,
so one account seeing nothing proves nothing. In at least one report the actual cause was a second
content blocker installed alongside the first. All community claim; one devtools session settles it.
ROADMAP.md F153 covers the half that can be proved without the warning: that Aviary refuses neither
probe.

## F115, "Restore old X" feature-flag reversion

X ships UI experiments behind bootstrap feature flags, and through 2026 the uBlock Origin community
has been rewriting them by hand to undo each redesign, restoring the profile media grid, disabling
the image carousel, turning off the profile redesign. Nobody productizes it, and Aviary's page-world
agent is architecturally the right layer: the extension declares `"world": "MAIN"` for `page.js`, so
it can reach page globals before first paint, and rewriting a bootstrap flag issues no request and
so stays on the safe side of the ban-risk line.

Blocked on evidence, not on design. Measured: `__INITIAL_STATE__` and `featureSwitch` appear 0 times
in the 2026-05-19 Home and conversation captures, those captures were
decoded DOM without page scripts. So the container's real name, its shape, whether it is writable
before X reads it, and the exact flag names are all unknown here. The flag names circulating in
community threads are third-party reports, not something this repository can verify, and a wrong
write to bootstrap state breaks the application rather than degrading gracefully the way a missed
CSS selector does.

Shipping the mechanism with an empty verified-flag list is also rejected: a toggle that claims to
restore a layout while matching nothing is exactly the false-claim class `tests/settings-claims.test.mjs`
exists to prevent.

Re-entry condition: capture the bootstrap state object from an authenticated session (name, nesting,
and the flags for media grid / image carousel / profile redesign), confirm a write applied before
X's first read actually changes the rendered layout, then add one toggle per verified flag with
selector-health style drift reporting for a flag name that disappears. Each flag needs its own live
verification; one working flag does not vouch for the next.

Updated 2026-08-15: two flag names are no longer unknown. Working community fixes for X's August
2026 redesign name `rweb_media_carousel_enabled` (a uBO scriptlet setting it false under both
`defaultConfig` and `user.config`, restoring the 2x2 image grid) and
`responsive_web_profile_redesign_enabled` (a trusted `$replace=` filter restoring the desktop
profile media grid). That moves the remaining unknown from *discovery* to *verification*: the
container's real name and nesting still need one authenticated session, and third-party scriptlets
are not evidence this repository accepts on their own. Note the second one requires uBO's "Allow
trusted filters", which most users will never enable, an in-page flip is a materially better answer
than the workaround the community currently has, which is the strongest argument for finishing this
item. See ROADMAP.md F139.

## F125, Distribution decision, real Firefox add-on id, update story

The Firefox manifest ships `browser_specific_settings.gecko.id` as the placeholder
`aviary@example.local`, which AMO will not accept, and neither manifest carries an `update_url`.
The userscript's `@updateURL` now resolves to the declared repository (fixed 2026-08-14), but that
repository is private, so the raw URL answers 404 and no installed copy can ever see an update.
`docs/INSTALL.md` states this plainly rather than implying a working channel.

Blocked on an operator decision, not on engineering: whether Aviary is published (AMO / Chrome Web
Store / Greasy Fork) or stays a private personal build. That single answer determines the real
add-on id, whether the repository becomes publicly readable, whether `@updateURL` should point at
raw GitHub or a release asset, and whether store listing assets are needed at all. Choosing one and
implementing it would be inventing a product decision.

Re-entry condition: the operator states the intended distribution. Then mint a stable add-on id,
point the update URLs at the decided channel, update `docs/INSTALL.md`'s update section, and, if
public, prepare listing assets and confirm the privacy disclosures match the Chrome Web Store
policy that took effect 2026-08-01.

Updated 2026-08-15: three constraints to plan for rather than discover at submission. AMO caps the
manifest `name` at 50 characters and Edge at 45 (Chrome does not enforce one), and AMO now requires
an explicit `data-collection-permissions` declaration, verify both against MDN before writing the
listing, since the developer report they come from corrected itself once. Chrome additionally offers
to skip review for updates that only change *safe static* `declarativeNetRequest` rules, which is an
argument for expressing ad suppression as static rules where it can be. Separately, ROADMAP.md F152
must land first: the repository was renamed and the update URLs still name the old path, so
publishing before that fix ships a dead update channel. `awesome-scripts/awesome-userscripts` is
active and lists no enhancer of this class, so a listing there is available the moment this is
decided.

## Proving the video-quality setting actually changes delivered quality

`performance.forceVideoQuality` rewrites an HLS master playlist to its highest rendition. The
rewrite itself is well covered, master-vs-media playlists, AVERAGE-BANDWIDTH ranking, single-variant
pass-through, and the counter it increments is now shown in Media, so a user can see whether it
ever fires for them.

What remains unproven is whether X's player hands Aviary such a playlist at all. The page agent
patches `fetch`, `XMLHttpRequest`, and `sendBeacon` in the page world; a player that fetches its
manifest inside a worker never passes through any of them, which is exactly how Kick's IVS player
behaves. No capture in this repository contains an `.m3u8` request, because the `_decoded/` fixtures
are DOM without network traffic.

Rather than delete a mechanism that may work or keep a label that promised an outcome, the row was
renamed to describe the action ("Pin video playlists to their best rendition") and now reports
`Playlists rewritten: N this session`. A user can answer the question for their own browser even
while this repository cannot.

Re-entry condition: an operator session on live X with a video post open and the setting on. If the
counter stays at zero, X is not routing playlists through a path Aviary can reach and the setting
should be removed with a migration. If it rises, record the request shape in `## Learned` and the
claim can be strengthened to name the effect.

## F121, Articles / longform filter

X's Articles surface draws steady complaint as an AI-slop vector, and the filter rule language
added in v1.23 is the natural home for it: one more field, or one predicate the rules can name.

Blocked on evidence. Measured: `twitterArticle`, `/i/article`, `article_card`, and `longform` each
appeared 0 times in the 2026-05-19 captures. The only `article`-bearing test
ids in either capture are `news_sidebar_article_*`, which belong to the right-rail news module,
a different surface, already covered by Hide trends. So the container, the marker, and whether an
Article even renders as a timeline cell are all unknown here.

Filtering on the word "article" in post text is explicitly rejected: it would hide ordinary posts
that happen to discuss articles, which is the broad-text-fragment failure the ad contracts already
refuse.

Re-entry condition: add a `_decoded/` capture containing an Article in a timeline, identify the
owning cell and its marker, then expose it as a rule field (`kind is article`) so it composes with
the existing rule language rather than becoming a separate toggle. Fixture-test that an ordinary
post carrying a link is untouched.

## F130, Relationship badges (follows you / mutual)

Blocked on evidence. Measured: "follows you" appeared 0 times in the 2026-05-19 Home and
conversation captures. The only follow-related test ids in either capture were `<userId>-follow`,
which mark the Follow *button*, an action, not a relationship. Inferring "you do not follow this
account" from the presence of that button is wrong twice over: the button also appears inside
Who-to-follow modules, and its absence has several causes.

Re-entry condition: a capture containing X's own relationship indicator on a post or hovercard,
or the relationship field inside a captured timeline payload. Either is passively available and so
stays on the safe side of the ban-risk line, but neither exists here today.

## F132, Ad labels beyond the nine covered languages

X ships far more UI languages than the nine Aviary has ad labels for. In an uncovered language the
exact-label test can never match, so native sponsored posts are simply not suppressed.

The silent half of that is fixed: `adLabelLanguageSupported()` reads the `lang` attribute X sets on
the document, and Trust now states plainly when the current UI language has no labels, rather than
leaving the user to assume protection they do not have.

Adding the languages themselves is blocked. X's exact ad-label strings cannot be invented: a guessed
translation either never matches, or, worse, matches ordinary prose, since the test is an exact
full-text comparison against a span. No capture in this repository shows X's interface in any
language other than English.

Re-entry condition: for each language, a capture of X in that UI language containing a sponsored
post, or X's own published localization strings. Add the label, add a fixture to the ad corpus, and
extend `LABELLED_LANGUAGES` in the same commit, the test that pairs the two lists will fail if a
language is claimed as covered without a label to back it.

## F183, Stop advertising an update channel that answers 404

The bandwidth half shipped 2026-08-18: the build now emits `dist/aviary.meta.js` and `@updateURL`
points at it, so a poll transfers under a kilobyte instead of the whole script (F197). What remains
is that both raw URLs answer 404 because the repository is private, and neither remaining option is
an engineering call. Omitting the update URLs entirely asserts that Aviary has no update channel;
having preflight verify reachability puts a network request inside a gate that is otherwise fully
offline, and would fail every local run until the repository is readable.

Re-entry condition: F125's distribution decision. If Aviary is published, the URLs start resolving
and nothing needs doing. If it stays private, decide whether the metablock should omit them and say
so in `docs/INSTALL.md`, which already states the 404 plainly.

## F184, Remove real-user captures from the fixture set and its history

The working-tree half is done. F306 replaced the saved captures with `_decoded/dom-schema.json` and
a generator, and the MHTML, decoded HTML and extracted stylesheets were deleted on 2026-09-07. No
test reads a saved page any more, and `tests/fixtures.test.mjs` fails if one comes back.

What remains is history. The captures of a named account's post, handle and body text are still in
every commit before that deletion, so removing them means a `git-filter-repo` rewrite and a force
push over branch protection on the only copy of the project's history.

Re-entry condition: the rewrite itself, on a quiet tree, with the backup bundle under
`_claude-backups/Aviary-prepublic-2026-09-06/` verified first. It no longer has to wait for a
replacement capture, because no selector is proved against those files.

## F201, Re-verify batch media download against X's Photos/Videos split

X split the profile Media tab into Photos and Videos and dropped the 3-column grid around
2026-08-13..16. Competing downloaders report this broke batch collection specifically, and Media
Harvest reports its Likes-tab button broke when Likes moved into History. Aviary's "Download all
visible media" walks rendered tweets, so it is exposed to the same change.

No fixture can answer it: every capture in `_decoded/` predates the redesign, which is the same
blocker as F134. Guessing at the new structure would ship exactly the speculative selector this
repository refuses.

Re-entry condition: verify during F134's authenticated capture session rather than booking a second
one, open the current Photos and Videos tabs with the built artifact loaded and exercise the batch
action.

## F237, The DOM observation expires on 2026-09-30 and the build gate fails with it

`npm run preflight` passes today with a warning: `_decoded/dom-schema.json` records an observation
made on 2026-05-19, 111 days old against a 90-day ceiling, waived only until 2026-09-30. After that
the gate fails, and until the observation is refreshed no selector claim in the project can be
re-measured against anything.

F306 changed what the failure costs, not whether it happens. The fixtures are generated now, so a
stale schema no longer means stale files in the tree, and regenerating them deliberately does not
move the date. The observation itself is still 111 days old.

Nothing here can be fixed from this machine. The capture half of the procedure in CLAUDE.md needs a
signed-in X session, which is the same blocker as F134 and F201.

Re-entry condition: take it in the same operator capture session as F134 and F201 rather than
booking a third. Take the captures, measure them into `dom-schema.json`, set
`derivedFrom.capturedOn`, then re-run every "measured: N hits" claim in this file against them and
record the new date, including the claims that stay blocked. Delete the decoded pages afterwards.
Do it before 2026-09-30, not at a release.

## The Firefox packaged smoke lane cannot run on this machine

`tests/smoke/dnr-firefox.smoke.mjs` is the only lane that proves the built Firefox add-on behaves
in a real Firefox, and it does not complete here. F295's persistence assertion was added to it and
is therefore unverified on that engine, while its Chromium twin passes.

What was tried on 2026-09-05:

1. Ran the lane: it exited immediately with "geckodriver is unavailable".
2. Installed geckodriver 0.37.1 from Mozilla's official release
   (`geckodriver-v0.37.1-win64.zip`, sha256 `DFED9315ABE8D2FBC1B6161A2EE8002452E79CF05EE92FDC653A4E26BC35EDD8`)
   to `C:\tools\geckodriver\` and set `GECKODRIVER_BINARY`. `geckodriver --version` reports
   `0.37.1 (300705c65d1b 2026-07-17)`.
3. Re-ran twice. Both runs hung with **zero output** for over 300s and spawned no visible
   geckodriver process, so the failure is before the lane prints anything.

Three hypotheses, none yet tested:

- The machine had 11 user Firefox processes running. geckodriver launches a fresh profile without
  `-no-remote`, so it may be attaching to the running instance and waiting forever.
- The lane installs a refusing loopback proxy, and this machine runs default-deny outbound
  firewalling, which can turn a refused CONNECT into a silent stall rather than an error.
- Other agents' test suites were saturating the CPU, so the WebDriver handshake may be exceeding an
  internal wait that has no diagnostic.

Re-entry condition: run it with the operator's Firefox closed, or point `AVIARY_FIREFOX_BINARY` at
a dedicated Firefox install and pass `-no-remote`. If it still hangs, instrument
`WebDriverClient.start` to log before the session request rather than guessing which of the three
it is. Everything else in F295 is verified, including the packaged Chromium lane.
