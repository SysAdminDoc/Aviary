# Recent X userscript review

Reviewed on September 20, 2026 against Greasy Fork's recently updated X and Twitter listings.
This is a product comparison, not a source-code import. Aviary keeps its own implementation and
MIT license.

## What changed in Aviary

| Idea found in maintained scripts | Aviary implementation | Reason for the design |
| --- | --- | --- |
| Restore a feed after using Back | **Restore position after Back** stores a short-lived route snapshot, visible post ids, and offsets in tab session storage. Wheel, touch, pointer, or keyboard scrolling cancels restoration immediately. | Absolute scroll offsets alone drift while X rebuilds a virtual timeline. Post anchors give the restore a stable target without fighting the reader. |
| Expand long posts automatically | **Expand long posts automatically** clicks only an exact, localized Show more control owned by the outer post. It waits until scrolling settles and ignores quoted posts and action bars. | Broad text matching can open unrelated controls, including content inside a quote. The narrower rule avoids that. |
| Copy every direct media URL from a post | **Show Copy media links** adds a separate post action. It copies the best direct photo, GIF, video, audio, and caption URLs, one per line, and excludes quoted or card media. | Copying uses the same ownership and quality selection as Download, so the two actions cannot disagree about which files belong to a post. |

All three settings are off by default. **Quiet Reader** enables the two reading aids. **Media
Archivist** enables the copy action.

## Scripts reviewed

- [Greasy Fork's updated X listing](https://greasyfork.org/en/scripts/by-site/x.com?sort=updated)
  supplied the current comparison set.
- [Twitter / X Media Copy & Download](https://greasyfork.org/en/scripts/569424-twitter-x-media-copy-download)
  combines direct-link copying, downloads, filename templates, local history, bookmarks, and a
  media-focused interface. Aviary already had downloads, templates, duplicate history, local
  bookmarks, themes, post-link rewriting, and selective per-asset controls. The direct media-link
  action was the useful missing piece.
- [X Timeline Return Position Fix](https://greasyfork.org/en/scripts/592256-x-timeline-return-position-fix)
  treats Back restoration as a short, cancellable operation instead of continuously forcing the
  scroll position. Aviary follows that product rule with its own route and post-anchor model.
- [BetterX](https://greasyfork.org/en/scripts/588748)
  groups automatic post expansion, navigation defaults, downloads, and local history. Aviary
  already covered the latter three areas. Automatic expansion was added with stricter ownership
  checks around quoted posts.
- [X Media Ripper](https://greasyfork.org/en/scripts/596434-x-media-ripper) emphasizes filename
  control and ZIP downloads. Aviary already supplies filename fields, post-level downloads,
  persistent queues, ZIP exports, and download history. Its GPL source was not reused.
- [CleanX](https://greasyfork.org/en/scripts/596145-cleanx) focuses on removing distracting page
  surfaces. Aviary's Page cleanup and Content filters pages already offer the broader equivalent.
- [X Gallery Mode](https://greasyfork.org/en/scripts/594985-x-gallery-mode) turns profile media into
  a focused browsing surface. Aviary has grid and stacked media layouts, but not a dedicated
  profile gallery.
- [X Post to Image Card](https://greasyfork.org/en/scripts/595869-x-%E8%B4%B4%E6%96%87%E8%BD%AC%E5%9B%BE%E5%8D%A1)
  creates a pasteable picture of a post. Aviary can export records and media, but it does not yet
  render a share card.

## Decisions

The Back restore, long-post expansion, and media-link copy features were added because each fixes a
frequent action with a small, reversible control. One-click block, mute, and unfollow actions were
not added. Those change account relationships and are too easy to trigger from a dense post action
bar. Sensitive-content and age-gate bypasses were also rejected because they can reveal material a
reader did not ask Aviary to show.

The next implementation candidates are a profile media gallery and a local post-to-image card.
Both need dedicated accessibility, attribution, and visual-regression work rather than another
small action in the existing post bar.
