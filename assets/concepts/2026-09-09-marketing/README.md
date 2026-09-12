# Aviary marketing archive

This folder records the v1.49.4 README and installation refresh on September 9, 2026.
The September 12 follow-up puts the approved evergreen share card at the top of the README exactly once. The first README check and the final render with current extension screenshots are preserved under `working-captures/readme-hero-v1.49.5/` and `working-captures/readme-hero-v1.49.5-final/`.
The original cyan and violet bird icon remains the product identity. No replacement logo was
selected. Its silhouette and negative-space A are more distinctive than a generic browser badge.

## Originals

`originals/manifest.json` lists every file at commit `586baf06b4d28abfd8b0c5dd5ffd20329b9a6859`.
All 769 Git blobs, including 352 images, were verified against that commit before archiving.
The original README, prompt pack and five icon sizes are also copied separately for inspection.
The existing `docs/mockups/`, `docs/audit/` and visual baselines remain in their original locations.

The full original-source ZIP is 113,912,607 bytes, larger than GitHub's individual-file limit.
Four ordered `.part` files preserve it without recompression. Concatenate them in numerical order
as binary data, then verify the assembled ZIP before extracting:

```text
SHA-256 de9e40c3e5a5012811745e2de7589cfa6fbaccbb1a2345fbdc1970e87072f2ac
```

The manifest records each part's size and SHA-256, plus the original Git blob hash for every
archived file. The archive is historical evidence, not the current installation package. It
contains only the original tracked tree, not private working notes or removed private history.

## Screenshot sets

`baseline-settings/` contains the 15 v1.49.3 captures taken before this refresh. The repository's
baseline harness normalizes dynamic diagnostic text in those images for visual comparison.
They are reference material, not current product screenshots.

`current-settings/` contains the v1.49.4 installed-extension captures and their capture manifest.
These preserve the rendered UI text without replacing diagnostic values or timestamps.
Screenshots use a disposable headless Chromium profile and the repository's synthetic X page.
No signed-in account, private messages or live personal timeline was used.

`working-captures/current-settings-v1.49.5/` contains the 15 rebuilt extension screens used for the hero follow-up. Presets, Appearance and Export are the selected current README images.

## Selection

The README uses Presets to explain the entry point, Appearance to show reversible reading
controls and Export to show useful local output. The complete capture set stays here, including
the screens not selected for the README. These are actual extension interfaces on a fixture,
not generated mockups of features that don't exist.

`working-captures/` also keeps the incomplete pre-fix attempts, the stuck Library screen, four
reviewed replacement Library baselines and README layout previews. The `readme-gfm-preview`
folder is an early API rendering with issue-style hard line breaks, not a capture of the live
repository page. The final Markdown preview uses file-style rendering.

The social preview in `docs/marketing/` pairs the unchanged icon with a short typographic layout.
It's promotional artwork, not a screenshot or a browser-store approval badge. Review details and
verification limits are recorded in [REVIEW.md](REVIEW.md).
