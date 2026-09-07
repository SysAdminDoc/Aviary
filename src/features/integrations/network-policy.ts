/**
 * `privacy.localOnly` is the product's default posture: nothing Aviary does reaches the network
 * except the integrations the user configured. It defaulted to `true` while every integration
 * happily made requests, so the setting and the behaviour disagreed about what was promised.
 *
 * Where the line is drawn, because the panel copy has to be able to state it: this covers every
 * request Aviary originates to somewhere the page was not already talking to -- Aria2, Bluesky,
 * Mastodon, an AI provider, an embedding endpoint. It does not cover fetching a photo or a video
 * from X's own CDN to save it, which is the same host the page loaded that media from and is the
 * one thing the media features exist to do. Guarding that would leave the flagship feature dead on
 * every fresh install, since this setting is on by default.
 *
 * The policy lives at module scope rather than being threaded through every client signature,
 * because the integration entry points take narrow config objects (an Aria2 endpoint, a Bluesky
 * service) and have no view of settings. `main.ts` installs it once at boot; the predicate is
 * read fresh on every call, so toggling the setting takes effect immediately.
 *
 * Until it is installed, nothing goes out. The module used to start permissive and rely on
 * `main.ts` reaching its install line, which sits after storage, profile, diagnostics, usage and
 * the settings load -- so the default contradicted the setting it enforces, and any future caller
 * that ran earlier would have been allowed out with the user's Local-only mode switched on. The
 * refusal below names the missing installation rather than the setting, because a boot-order bug
 * reported as "Local-only mode blocked this" sends the reader to a switch that is not the problem.
 */

/**
 * No policy has been installed yet, so no outbound work may happen.
 *
 * Deliberately not a `LocalOnlyError`: this is a boot-order fault in Aviary, not a decision the
 * user made, and the two must not be reported as the same thing.
 */
export class NetworkPolicyNotInstalledError extends Error {
  constructor(what: string) {
    super(
      `${what} was blocked: Aviary's outbound network policy has not been installed yet. This is a ` +
        "startup fault in Aviary, not the Local-only mode setting."
    );
    this.name = "NetworkPolicyNotInstalledError";
  }
}

export class LocalOnlyError extends Error {
  constructor(what: string) {
    super(
      `${what} was blocked: Aviary is in local-only mode. Turn off "Local-only mode" in Trust to let configured integrations reach the network.`
    );
    this.name = "LocalOnlyError";
  }
}

const SHARED_POLICY_KEY = "__AVIARY_LOCAL_ONLY__";
type PolicyGlobal = typeof globalThis & {
  [SHARED_POLICY_KEY]?: () => boolean;
};

/** `null` until a policy is installed. Nothing outbound is permitted while it is null. */
let localOnly: (() => boolean) | null = null;

export function setLocalOnlyPolicy(predicate: () => boolean): void {
  localOnly = predicate;
  // The extension's document-start bundle and its on-demand panel are separate IIFEs. Keep this
  // tiny live policy on their shared isolated-world global so panel actions cannot silently revert
  // to the permissive default after the user turns Local-only mode back on.
  (globalThis as PolicyGlobal)[SHARED_POLICY_KEY] = predicate;
}

/**
 * Test seam: uninstalls the policy so one spec cannot leak into the next.
 *
 * This used to restore a permissive default, which meant every test that cleaned up afterwards
 * left the module in the state this item exists to remove -- and a test could pass while proving
 * the opposite of the contract. A spec that needs outbound work allowed says so explicitly with
 * `setLocalOnlyPolicy(() => false)`.
 */
export function resetLocalOnlyPolicy(): void {
  localOnly = null;
  delete (globalThis as PolicyGlobal)[SHARED_POLICY_KEY];
}

/** Whether a policy has been installed at all. */
export function localOnlyPolicyInstalled(): boolean {
  return localOnly !== null || typeof (globalThis as PolicyGlobal)[SHARED_POLICY_KEY] === "function";
}

/**
 * Whether Local-only mode is on.
 *
 * With no policy installed this answers `true`, so the display surfaces that read it show the
 * restrictive state rather than promising a network they are not allowed to use. Callers that
 * must distinguish "off" from "not installed" ask `localOnlyPolicyInstalled()`.
 */
export function isLocalOnly(): boolean {
  const shared = (globalThis as PolicyGlobal)[SHARED_POLICY_KEY];
  if (shared) return shared();
  return localOnly === null ? true : localOnly();
}

/**
 * Throws when local-only mode is on. Called at each integration's entry point rather than at
 * every `fetch`, so a single request that fans out into several calls fails once, before any
 * credential is attached or any partial state is written.
 */
export function assertOutboundAllowed(what: string): void {
  if (!localOnlyPolicyInstalled()) {
    throw new NetworkPolicyNotInstalledError(what);
  }
  if (isLocalOnly()) {
    throw new LocalOnlyError(what);
  }
}
