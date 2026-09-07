# What this changes

<!-- One or two sentences. Why, not just what. -->

## Evidence

<!--
Selector or DOM work needs an observation that contains the thing it matches.
`_decoded/dom-schema.json` is the ground truth, and the generated fixtures come from it; a rule
written from a screenshot or a forum post is a guess, and this repository keeps those in
Roadmap_Blocked.md instead of shipping them.

Name the schema surface and the marker, or state that this change touches no selector.
-->

## Checks

- [ ] `npm run verify` passes (typecheck, lint, tests, build, preflight)
- [ ] New user-facing copy goes through `t()` / `ft()`, and `node tools/i18n-extract.mjs --write`
      then `node tools/i18n-sync.mjs <additions.json>` was run — the sync rewrites the catalog in
      manifest order, so an unharvested string is silently dropped
- [ ] Every feature this touches still fully reverses itself in `destroy`
- [ ] No `innerHTML`, no keyboard shortcuts, no `backdrop-filter` (preflight and the source
      contracts both reject these)
- [ ] A setting that claims something has a reader for it; a default that claims something is true
- [ ] CHANGELOG.md updated if the change is user-facing
