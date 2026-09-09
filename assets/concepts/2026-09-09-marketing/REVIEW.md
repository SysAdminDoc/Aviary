# Aviary v1.49.4 marketing review

Reviewed September 9, 2026. This is a maintainer review, not an outside agency endorsement.

## What improved

The opening now says what Aviary does and offers a release download before asking anyone to build
it. The old README was mostly an implementation inventory, with screenshots from v1.47.0. Detailed
behavior remains in the feature and privacy references instead of overwhelming the installation path.

The install choices are materially different, so the comparison names them. Chromium is the most
complete path. Firefox remains an unsigned temporary add-on with a placeholder ID. Violentmonkey's
content mode cannot install the page-world observer. The README no longer implies that every
userscript manager offers the extension's full network protection and video discovery.

Extension removal and backup guidance now agree across the README, installation guide and privacy
manifest. The release's standalone README uses portable GitHub links for its images and guides.

## Brand decision

Keep the original bird. Its cyan silhouette reads on both light and dark surfaces, while the violet
tail and negative-space A give it an identity of its own. The size review covers 16, 32, 48, 128 and
192 pixels. Fine detail reduces at 16 pixels, but the silhouette remains recognizable. A generic
browser frame or shield would lose that distinction.

The new social card uses the same mark with a restrained type hierarchy. It doesn't add a mascot,
glossy effects, invented popularity figures or security credentials. Its HTML source is editable.
The PNG is saved in the repository; that does not mean GitHub's separate social-preview setting
has been uploaded or changed.

## Screenshot selection

| Material | Decision | Reason |
| --- | --- | --- |
| Presets, current extension | README lead image | Explains how a new user starts without implying a preset is enabled by default. |
| Appearance, current extension | README | Shows the controls and their real default state. |
| Export, current extension | README | Shows local formats and the capture choices behind archival claims. |
| Library and remaining destinations | Preserve in the archive | Useful reference, but an empty library doesn't demonstrate a populated collection. |
| Older themed timeline images | Preserve, not selected | Older version and sparse fixture content make them weaker evidence for this release. |
| Earlier capture attempts | Preserve with labels | Records the screens before the Library measurement fix rather than hiding the failed review. |

These are installed-extension captures on synthetic X fixtures. The selected screenshots preserve
actual UI text and timestamps. The visual-regression baselines use the repository's existing
diagnostic-text normalization; they are separately labeled and aren't presented as live account evidence.

## Verification and limits

The local release gate passed all 1,164 unit tests, 15 visual tests and all seven browser smoke
lanes before the final portable-README packaging change. The packaging change adds three passing
regression tests. Publication repeats the full release gate against the final clean commit.

Browser coverage includes Chrome 151, Firefox 155.0.1, Tampermonkey 5.5.0 and Violentmonkey 2.47.0
in disposable headless profiles. Checks cover storage restart and contention, permissions, route
changes, local integration fixtures and interrupted restore. All narrow and wide reflow lanes,
including 200% and 400% zoom, passed. The real Library screen now settles its storage measurement;
four affected light/dark baselines were reviewed and updated without changing the comparison threshold.

A source ZIP was extracted into a fresh folder with its own dependency installation. Type checking,
build and preflight passed, and both extension ZIPs plus userscript and metadata matched the main
build byte for byte. The previous archive's missing-icon failure is covered by a regression test
and a post-build check. The dependency audit reported no known advisories at review time.

No authenticated live-X session, production provider account, native clipboard, browser-store
installation or account action was tested. The current DOM reference remains May 19, 2026, with
the existing September 30 freshness-waiver expiry. It was not relabeled as a fresh capture.
Self-hosted CRX signing is not store approval or a promise to remove browser warnings.
