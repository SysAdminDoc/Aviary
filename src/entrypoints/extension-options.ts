/**
 * Options page controller.
 *
 * `chrome.permissions.request` only resolves from a user gesture on an extension page, and the
 * content script is not one. This page is that surface: it reports what is granted and lets the
 * user grant or revoke each optional permission. No network calls, no storage writes.
 */

export const MEDIA_ORIGINS = ["https://pbs.twimg.com/*", "https://video.twimg.com/*"];

interface PermissionRequest {
  permissions?: string[];
  origins?: string[];
}

interface CardWiring {
  request: PermissionRequest;
  stateId: string;
  grantId: string;
  revokeId: string;
  grantedLabel: string;
  missingLabel: string;
}

const CARDS: CardWiring[] = [
  {
    request: { permissions: ["downloads"] },
    stateId: "downloads-state",
    grantId: "downloads-grant",
    revokeId: "downloads-revoke",
    grantedLabel: "granted",
    missingLabel: "not granted"
  },
  {
    request: { origins: MEDIA_ORIGINS },
    stateId: "media-state",
    grantId: "media-grant",
    revokeId: "media-revoke",
    grantedLabel: "granted",
    missingLabel: "not granted"
  }
];

start();

function start(): void {
  if (typeof document === "undefined") {
    return;
  }
  showVersion();
  for (const card of CARDS) {
    wireCard(card);
  }
}

function showVersion(): void {
  const target = document.getElementById("version");
  const version = globalThis.chrome?.runtime?.getManifest?.()?.version;
  if (target && version) {
    target.textContent = `v${version}`;
  }
}

function wireCard(card: CardWiring): void {
  const grant = document.getElementById(card.grantId);
  const revoke = document.getElementById(card.revokeId);

  grant?.addEventListener("click", () => {
    void run(card, "request");
  });
  revoke?.addEventListener("click", () => {
    void run(card, "remove");
  });

  void refresh(card);
}

async function run(card: CardWiring, action: "request" | "remove"): Promise<void> {
  const permissions = globalThis.chrome?.permissions;
  if (!permissions) {
    setStatus("This browser did not expose the permissions API.");
    return;
  }
  try {
    const changed =
      action === "request"
        ? await permissions.request(card.request)
        : await permissions.remove(card.request);
    const granted = await refresh(card);
    if (action === "request") {
      setStatus(granted ? "Granted. Media saves through the browser now." : "Request dismissed — nothing changed.");
    } else {
      setStatus(changed && !granted ? "Revoked." : "Nothing to revoke.");
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function refresh(card: CardWiring): Promise<boolean> {
  const state = document.getElementById(card.stateId);
  const grant = document.getElementById(card.grantId) as HTMLButtonElement | null;
  const revoke = document.getElementById(card.revokeId) as HTMLButtonElement | null;
  const permissions = globalThis.chrome?.permissions;

  let granted = false;
  if (permissions?.contains) {
    try {
      granted = await permissions.contains(card.request);
    } catch {
      granted = false;
    }
  }

  if (state) {
    state.textContent = granted ? card.grantedLabel : card.missingLabel;
    state.setAttribute("data-granted", String(granted));
  }
  if (grant) grant.disabled = granted;
  if (revoke) revoke.disabled = !granted;
  return granted;
}

function setStatus(message: string): void {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = message;
  }
}
