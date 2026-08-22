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
 */

export class LocalOnlyError extends Error {
  constructor(what: string) {
    super(
      `${what} was blocked: Aviary is in local-only mode. Turn off "Local-only mode" in Trust to let configured integrations reach the network.`
    );
    this.name = "LocalOnlyError";
  }
}

let localOnly: () => boolean = () => false;

export function setLocalOnlyPolicy(predicate: () => boolean): void {
  localOnly = predicate;
}

/** Test seam: restores the permissive default so one spec cannot leak into the next. */
export function resetLocalOnlyPolicy(): void {
  localOnly = () => false;
}

export function isLocalOnly(): boolean {
  return localOnly();
}

/**
 * Throws when local-only mode is on. Called at each integration's entry point rather than at
 * every `fetch`, so a single request that fans out into several calls fails once, before any
 * credential is attached or any partial state is written.
 */
export function assertOutboundAllowed(what: string): void {
  if (localOnly()) {
    throw new LocalOnlyError(what);
  }
}
