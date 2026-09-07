import type { FeatureModule } from "../features/registry.ts";
import { AVIARY_VERSION } from "../platform/build-version.ts";

const HOST_ID = "av-control-center";
const NAV_SELECTOR = '[data-testid^="AppTabBar_"]';

/**
 * Small document-start shell for extension builds.
 *
 * The full Control Center is deliberately absent from the first content chunk. This extension-only
 * module keeps the X navigation affordance visible while the panel chunk is fetched after the user
 * asks for it. Userscript builds mount the full panel as they always did.
 */
export const controlCenterLauncherFeature: FeatureModule = {
  id: "core.controlCenterLauncher",
  title: "Control Center launcher",
  category: "core",

  init(ctx) {
    if (typeof document === "undefined" || document.getElementById(HOST_ID)) {
      return;
    }
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.avOwned = "true";
    host.dataset.avDraftState = "clean";
    host.dataset.avLoadState = "ready";
    host.dataset.avVersion = AVIARY_VERSION;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; display: block; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      button {
        box-sizing: border-box;
        min-height: 40px;
        max-width: 220px;
        padding: 0 16px;
        border: 1px solid rgba(29, 155, 240, 0.34);
        border-radius: 999px;
        background: rgba(29, 155, 240, 0.1);
        color: #e7e9ea;
        font: 700 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
        cursor: pointer;
      }
      button:hover { background: rgba(29, 155, 240, 0.18); }
      button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 3px; }
      button[aria-busy="true"] { cursor: progress; opacity: 0.72; }
      button[data-state="error"] { border-color: #f4212e; color: #ff8e96; }
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "av-launcher";
    button.textContent = "Aviary";
    button.setAttribute("aria-label", "Open Aviary controls");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");

    let loading: Promise<void> | undefined;
    const setError = (error: unknown): void => {
      button.dataset.state = "error";
      button.removeAttribute("aria-busy");
      button.disabled = false;
      button.textContent = "Aviary controls unavailable. Retry";
      button.setAttribute(
        "aria-label",
        `Aviary controls unavailable. Retry. ${error instanceof Error ? error.name : "load error"}`
      );
      host.dataset.avLoadError = error instanceof Error ? error.message : String(error);
      host.dataset.avLoadState = "error";
    };
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (loading) return;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "Loading Aviary…";
      button.setAttribute("aria-label", "Loading Aviary controls");
      host.dataset.avLoadState = "loading";
      loading = Promise.resolve(ctx.loadControlCenter?.()).then(
        () => undefined,
        (error: unknown) => {
          setError(error);
          loading = undefined;
          throw error;
        }
      );
      void loading.catch(() => undefined);
    });
    shadow.append(style, button);

    const state = { destroyed: false, observer: undefined as MutationObserver | undefined };
    const mount = (): void => {
      if (state.destroyed) return;
      const nav = document.querySelector<HTMLElement>(NAV_SELECTOR)?.closest<HTMLElement>("nav");
      if (nav) {
        if (host.parentElement !== nav) nav.append(host);
      } else if (!host.isConnected) {
        document.documentElement.append(host);
      }
    };
    const observer = new MutationObserver(mount);
    state.observer = observer;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    mount();
    launcherState.set(host, state);
  },

  destroy() {
    const host = document.getElementById(HOST_ID);
    const state = host ? launcherState.get(host) : undefined;
    if (state) state.destroyed = true;
    state?.observer?.disconnect();
    host?.remove();
  }
};

const launcherState = new WeakMap<HTMLElement, { destroyed: boolean; observer: MutationObserver | undefined }>();
