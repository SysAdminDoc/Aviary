# Aviary ROADMAP

Version: `1.47.2`

Date: 2026-09-07

Actionable incomplete work only. `Roadmap_Blocked.md` remains the source for tasks that require a fresh authenticated X capture, distribution identity, or another external environment.

## Research-Driven Additions

### P1, Next

### P2, Later

### P3, Under Consideration

- [ ] F292, P3: Export a static personal archive with RSS
  Why: Tweetback and Nitter validate independent local reading and feeds, while Aviary already has captured records, thread relationships, local media references, and a standalone viewer.
  Evidence: `src/features/export/viewer.ts`, `src/features/library/`; https://github.com/tweetback/tweetback; https://github.com/zedeus/nitter
  Touches: export formatters, viewer routes, thread reconstruction, RSS generator, ZIP packaging and tests
  Acceptance: one local export produces a static index, per-post pages, reconstructed thread links, copied media when bytes exist, explicit placeholders when they do not, and valid RSS 2.0; every page opens with network disabled; canonical links point to the original X URL while archive navigation stays local; repeated export is deterministic apart from the declared generated time.
  Complexity: L
  Depends: F288.

- [ ] F315, P3: Emit an ActivityStreams 2.0 outbox alongside the local export
  Why: there is no converged cross-platform social-archive format to adopt, and the standards work has moved to IETF working groups that have shipped nothing usable. AS2 is the one widely parseable social-post schema with existing tooling, it is what Mastodon's own account export emits, and mapping to it costs one layer over records Aviary already holds.
  Evidence: https://docs.joinmastodon.org/user/moving/ (account archive is Activity Streams 2.0 JSON; note that Mastodon imports only the social graph, never posts, so this is an interop output rather than a migration path), https://dtinit.org/blog/2026/08/18/ietf-work-data-portability (PDPArchive is a mail, calendar, and contacts format still in a working group); `src/features/export/formatters.ts`, `src/features/export/types.ts`
  Touches: `src/features/export/formatters.ts`, `src/features/export/export-feature.ts`, export panel copy, `tests/export.test.mjs`, `tests/export-truthfulness.test.mjs`
  Acceptance: one export produces a valid AS2 `OrderedCollection` outbox whose items are `Create` activities wrapping `Note` objects with `id`, `published`, `content`, `attributedTo`, `inReplyTo` where known, and `attachment` entries pointing at the media files in the same package; a post whose original is unavailable is represented as a tombstone rather than omitted silently; the export states plainly that AS2 is an interop format and that no major platform currently imports posts from it; repeated export is deterministic apart from the declared generated time.
  Complexity: M
  Depends: F292, which builds the static export this shares its record mapping with.

## Research-Driven Additions (2026-09-05)

### P2, Later

### P1, Next

## Research-Driven Additions (2026-09-06)

### P1, Next

### P2, Later
