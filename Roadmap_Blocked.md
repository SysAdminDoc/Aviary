# Aviary blocked roadmap

Each item below requires a state that is absent from the privacy-safe `_decoded/` fixtures.
Read-only authenticated recon on 2026-08-13 resolved current promoted-post/trend/house-promo
contracts without exporting session data, but the inspected routes did not expose blocked-author,
self-repost, or sensitive-media examples. Those behaviors still cannot be built from a guess.

Passive GraphQL capture can produce better evidence than a full private-page screenshot: enabling
"Keep raw payloads" in Export and scrolling a disposable test timeline records the server's own
bounded post description. Any contributed fixture must be minimized and scrubbed before it enters
the repository.

## F032 — Hide blocked accounts again

Blocked pending an authenticated `_decoded/` home/status capture containing the current blocked-account markup. The existing public fixtures do not expose the required `[data-testid="userActions"]` blocked state, so shipping a predicate now would be speculative.

Re-entry condition: add the authenticated capture, verify the live selector, then implement and fixture-test the predicate while preserving the handle whitelist.

## F033 — Hide self-quotes and self-reposts

Blocked pending an authenticated `_decoded/` quote/thread capture containing the current repost attribution row. The existing fixtures do not expose the `Reposted by @<handle>` relationship needed for a reliable author-equality check.

Re-entry condition: add the authenticated capture, verify the social-context selector, then implement and fixture-test self-repost detection without broad text heuristics.

## Hide all reposts

Blocked on a fixture that contains a repost -- the roadmap entry that proposed this asserted the
public capture exposes the social-context row, and that is wrong. Measured: `socialContext`
appears 0 times in `_decoded/home.html` and `_decoded/status.html`, and so do the strings
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
status, and the media viewer), nine locales, six themes, keyboard/coarse-pointer modes, malformed
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
