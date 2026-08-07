# Aviary blocked roadmap

## F032 — Hide blocked accounts again

Blocked pending an authenticated `_decoded/` home/status capture containing the current blocked-account markup. The existing public fixtures do not expose the required `[data-testid="userActions"]` blocked state, so shipping a predicate now would be speculative.

Re-entry condition: add the authenticated capture, verify the live selector, then implement and fixture-test the predicate while preserving the handle whitelist.

## F033 — Hide self-quotes and self-reposts

Blocked pending an authenticated `_decoded/` quote/thread capture containing the current repost attribution row. The existing fixtures do not expose the `Reposted by @<handle>` relationship needed for a reliable author-equality check.

Re-entry condition: add the authenticated capture, verify the social-context selector, then implement and fixture-test self-repost detection without broad text heuristics.

## settings.privacy.encryptVault — encrypt local data at rest

Blocked on a key-custody decision, which is a product call rather than an implementation detail.
WebCrypto can encrypt the CheckpointStore, snapshots and audit log easily enough; the question is
where the key lives. Deriving it from a user passphrase means an unlock step on every page load
and permanent data loss if the passphrase is forgotten — a real UX and support commitment.
Storing the key in the same `chrome.storage.local` / `localStorage` the ciphertext sits in
protects nothing: any script that can read one can read the other, and so can anyone with the
browser profile on disk.

Shipping the second option would be worse than shipping nothing, because the toggle would claim a
protection the product does not have. The setting stays schema-only and unexposed until the
custody model is chosen.

Re-entry condition: decide passphrase-derived (with the unlock UX and an explicit "forgotten
passphrase means unrecoverable data" warning) versus dropping the key from the schema. Then
implement against that decision — and state the threat model it does and does not cover.
