/**
 * Options page controller.
 *
 * A content-script click cannot request extension permissions directly. This page is the durable
 * management surface: it reports what is granted and lets the user grant or revoke each optional
 * permission. The native media context-menu click can request download access inline as a second
 * browser-owned gesture. No network calls, no storage writes.
 */

export const MEDIA_ORIGINS = ["https://pbs.twimg.com/*", "https://video.twimg.com/*"];

/**
 * Only the strings this page uses, injected at build time from the one catalog.
 *
 * The page is a separate document with no FeatureContext, so it cannot call `ft()`. Importing
 * PANEL_CATALOG would put roughly 240KB of translations into a page that otherwise ships a few
 * KB and is opened rarely, so tools/build.mjs reads the `data-i18n` keys out of options.html and
 * defines just those. One source of truth, and the page stays small.
 */
declare const __AVIARY_OPTIONS_I18N__: Record<string, Record<string, string>>;

const CATALOG: Record<string, Record<string, string>> =
  typeof __AVIARY_OPTIONS_I18N__ === "undefined" ? {} : __AVIARY_OPTIONS_I18N__;

let locale = "en";

function translate(english: string): string {
  return CATALOG[locale]?.[english] ?? english;
}

const RTL_LOCALES = new Set(["ar", "he"]);

/** Reads the locale the Control Center saved, through whichever backend this build has. */
async function readLocale(): Promise<string> {
  try {
    const stored = await globalThis.chrome?.storage?.local?.get("aviary.settings.v1");
    const settings = stored?.["aviary.settings.v1"] as { i18n?: { locale?: unknown } } | undefined;
    const code = settings?.i18n?.locale;
    return typeof code === "string" && code.length > 0 ? code : "en";
  } catch {
    return "en";
  }
}

function applyTranslations(): void {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]"))) {
    const english = node.dataset.i18n;
    if (english) {
      node.textContent = translate(english);
    }
  }
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

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
  /** Card-specific, because host access and download access do different things. */
  grantedMessage: string;
}

const CARDS: CardWiring[] = [
  {
    request: { permissions: ["downloads"] },
    stateId: "downloads-state",
    grantId: "downloads-grant",
    revokeId: "downloads-revoke",
    grantedLabel: "granted",
    missingLabel: "not granted",
    grantedMessage: "Granted. Media saves through the browser now."
  },
  {
    request: { origins: MEDIA_ORIGINS },
    stateId: "media-state",
    grantId: "media-grant",
    revokeId: "media-revoke",
    grantedLabel: "granted",
    missingLabel: "not granted",
    grantedMessage: "Granted. Aviary can read full-size media directly for exports now."
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
  // After wiring, so the state labels a card writes are re-rendered in the chosen locale.
  void readLocale().then((code) => {
    locale = code;
    applyTranslations();
    for (const card of CARDS) {
      void refresh(card);
    }
  });
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
    setStatus(translate("This browser did not expose the permissions API."));
    return;
  }
  try {
    const changed =
      action === "request"
        ? await permissions.request(card.request)
        : await permissions.remove(card.request);
    const granted = await refresh(card);
    if (action === "request") {
      setStatus(granted ? translate(card.grantedMessage) : translate("Request dismissed — nothing changed."));
    } else {
      setStatus(changed && !granted ? translate("Revoked.") : translate("Nothing to revoke."));
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
    state.textContent = translate(granted ? card.grantedLabel : card.missingLabel);
    state.setAttribute("data-granted", String(granted));
  }
  if (grant) grant.disabled = granted;
  if (revoke) revoke.disabled = !granted;
  updatePermissionHealth();
  return granted;
}

function updatePermissionHealth(): void {
  const target = document.getElementById("granted-count");
  if (!target) return;
  target.textContent = String(
    document.querySelectorAll<HTMLElement>('.state[data-granted="true"]').length
  );
}

function setStatus(message: string): void {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = message;
  }
}
