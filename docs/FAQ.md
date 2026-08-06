# FAQ

## Does Aviary talk to any server?

No. Every feature in v0.9.0 runs locally:

- Settings, media history, export checkpoints, audit log, and account notes live in browser storage.
- Media downloads use the browser's native `chrome.downloads`, the userscript manager's `GM_download`, or a plain anchor click.
- Exports produce a STORE-only ZIP that the browser downloads. Nothing is sent over the network from Aviary itself.

The only outbound traffic Aviary triggers is fetching image / video URLs the *user* selected when clicking Save. Those requests inherit the user's cookies because the browser handles them like any other resource load.

## A button stopped working after an X update — what should I do?

1. Open the Control Center and check the **Selector health** row.
2. If a critical surface (App root, Primary column) is reported as degraded, X likely renamed a `data-testid`. Aviary's filter / media features use stable IDs first and CSS fallbacks second, so most regressions are visual rather than fatal.
3. Click **Copy diagnostics** in the Control Center and paste the JSON into a bug report. It includes the active route, the diagnostic event log, and your locale — never auth state.

## Why no keyboard shortcuts?

Aviary's house style avoids hotkeys: every command must be reachable via a visible button, menu item, or toggle. Keyboard accessibility (tab order, ARIA labels, focus management) is still honored everywhere.

## Why no light theme?

By project policy. Aviary ships deep-dark, Lights-out, Graphite, Plum, and Midnight palettes. If your OS forces a light scheme, the Control Center will still render dark.

## Where did my dim mode go after X removed it?

The "Restore dim" theme is the default. Open the Control Center → Appearance → Theme = Dim.

## How do I export everything I'm seeing?

1. Open the Control Center → **Export** section.
2. Pick the formats you want (`json`, `csv`, `html`, `markdown`). XLSX is queued for v0.10.0+.
3. Toggle **Capture visible tweets** on.
4. Scroll through the timeline / profile / thread you want to archive.
5. Press **Export visible tweets**. Aviary bundles the configured formats into a STORE-only ZIP using the **Save folder hint** as the archive root.

## Aviary downloaded an image but the filename is wrong / generic

Cross-origin downloads using the anchor-tag fallback inherit the server's `Content-Disposition` filename. Install Tampermonkey (which uses privileged `GM_download` with explicit filenames) or grant the extension's optional `downloads` permission for the deterministic filename behavior described in the README.

## I want to back up my settings

Control Center → **Backup & Audit** → **Export settings**. You'll receive a versioned JSON envelope. Paste the contents back into the **Import settings (JSON)** textarea on another browser to restore.

## What's the audit log?

A capped, persisted ring buffer of local actions (downloads, exports, settings round-trips, diagnostic copies). It never leaves the browser. Clear it any time from the same section.

## What about blocked accounts and self-reposts?

The filter engine reserves `filter.blockedAccounts` and `filter.selfRepost`, but the home / status MHTML captures in this repo don't include the markup needed to detect either reliably. Once an authenticated capture lands in `_decoded/`, the predicates light up and the parked Control Center row goes away.

## Will Aviary ever post tweets, follow accounts, or like content for me?

No. The roadmap explicitly rejects auto-like / auto-follow / engagement-farming features (R001). Every action Aviary takes is initiated by an explicit user click.
