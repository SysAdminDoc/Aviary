const NOTICE_ID = "av-boot-notice";

/**
 * A boot failure used to be invisible: `data-av-ready="error"` went on `<html>` and nothing else
 * happened, so a user saw an enhancer that silently did nothing and had no reason to look, let
 * alone anything to report.
 *
 * This runs when the rest of Aviary did not, so it assumes nothing: no settings, no theme tokens,
 * no feature context, and no `<body>` (boot starts at document-start, and the failure can precede
 * the body element). It attaches to whichever root exists and styles itself entirely inside its own
 * shadow tree.
 */
export function showBootFailureNotice(reason: string): void {
  if (typeof document === "undefined" || document.getElementById(NOTICE_ID)) {
    return;
  }
  const parent = document.body ?? document.documentElement;
  if (!parent) {
    return;
  }

  const host = document.createElement("div");
  host.id = NOTICE_ID;
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.insetInlineEnd = "16px";
  host.style.insetBlockEnd = "16px";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .card {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      max-width: 380px;
      padding: 12px 14px;
      border: 1px solid #f4212e;
      border-radius: 12px;
      background: #15181c;
      color: #e7e9ea;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.45;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }
    .body { flex: 1; }
    .title { font-weight: 700; margin-bottom: 2px; }
    .reason {
      margin-top: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: #8b98a5;
      overflow-wrap: anywhere;
    }
    button {
      flex: none;
      min-width: 44px;
      min-height: 28px;
      border: 1px solid #536471;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; }
  `;

  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "alert");

  const body = document.createElement("div");
  body.className = "body";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Aviary failed to start";
  const copy = document.createElement("div");
  copy.textContent = "X is unaffected. Reload the page to try again.";
  const detail = document.createElement("div");
  detail.className = "reason";
  detail.textContent = reason;
  body.append(title, copy, detail);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => host.remove());

  card.append(body, dismiss);
  shadow.append(style, card);
  parent.append(host);
}

export function removeBootFailureNotice(): void {
  document.getElementById(NOTICE_ID)?.remove();
}
