# Aviary Privacy Manifest

Updated: 2026-05-19

## Defaults

Aviary is local-first.

- No telemetry.
- No remote code.
- No analytics endpoint.
- No credential export.
- No default cloud sync.
- No hidden third-party requests.

## Data Stored Locally

| Data | Storage | Purpose |
|---|---|---|
| Settings | userscript storage, `chrome.storage.local`, or `localStorage` fallback | Persist visible preferences. |
| Selector diagnostics | in-memory only in v0.3.0 | Help diagnose X DOM churn. |
| Protected accounts/items | settings schema | Prevent future destructive or hiding workflows from acting on protected entries. |

## Data Never Stored

- X auth cookies.
- `ct0` CSRF token.
- Bearer tokens.
- Raw request headers.
- Passwords.

## Optional Permissions

The MV3 manifest declares optional permissions for future media-download work. Those permissions are not requested or used by the v0.3.0 runtime.

## User Control

Every feature must be reversible. Disabling a feature must remove classes, style nodes, observers, timers, DOM nodes, and event listeners it created.
