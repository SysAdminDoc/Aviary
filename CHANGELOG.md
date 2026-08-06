# Changelog

## 1.6.0 - 2026-08-06

- Added a per-post Hide control that remembers the post locally and keeps it collapsed on every later visit, so the next post is promoted instead of leaving a gap.
- Added the `aviary.hiddenPosts.v1` store with status-id keys, a handle+text signature fallback for posts without a `/status/` link, oldest-first eviction at a configurable cap, and a 20-deep session undo stack.
- Added an undo toast after each hide, plus Control Center "Undo last hide", per-post Restore for the eight most recent hides, and "Clear hidden posts".
- Added the Control Center "Hidden posts" section: master switch, per-post button toggle, per-route activation chips, and the remembered-post cap.
- Added `post.hide`, `post.unhide`, and `post.hide.cleared` audit actions.

## 1.5.0 - 2026-08-03

- Added opt-in CheckpointStore retention controls for maximum jobs, records per job, and job age, with boot-time and new-job sweeps.
- Added persisted Aria2 gid history and cross-session duplicate suppression, including completion/error reconciliation through `aria2.tellStatus`.
- Added explicit Bluesky image upload and Mastodon media upload for the last successful Aviary download, including first-post-only thread attachment.
- Added the default-off “Attach last download” Control Center toggle.
- Added pinned Playwright 1.62.1 smoke CI with cached browser binaries and isolated Xvfb execution; local smoke profiles are temporary and cleaned up.
- Kept F032/F033 blocked pending authenticated `_decoded/` fixtures.
