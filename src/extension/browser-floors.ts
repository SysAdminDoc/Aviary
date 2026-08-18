/**
 * The oldest browsers Aviary's extension build supports, and why.
 *
 * One place, because the floor had been three: a number in each manifest and a sentence in
 * `docs/INSTALL.md`, none of which knew about the others. That matters more than it sounds --
 * the floor is what decides whether a platform feature can be used directly or needs a detection
 * branch, and a floor nobody can point at is one that gets rediscovered per feature.
 *
 * ## Chrome 116
 *
 * The manifest's `"world": "MAIN"` content script, which is how Aviary observes X's own loaded
 * network responses without originating a request. Chrome shipped it in 111 and shipped the
 * `documentId`/`world` combination Aviary relies on in 116.
 *
 * ## Firefox 128
 *
 * The same `"world": "MAIN"` declaration, plus MV3 event-page backgrounds. 128 is also an ESR
 * line, and that is the deciding half of the choice: Aviary is sideloaded rather than distributed
 * through a store, and the people most likely to sideload a local-first tool are the people most
 * likely to be on ESR. Raising the floor to pick up `URLPattern` (142), `@scope` (146) or the
 * Navigation API (147) would buy a few lines of detection branch at the cost of excluding them,
 * which is the wrong trade for this project.
 *
 * ## The rule that follows from the floor
 *
 * A platform feature is used directly only if it is available at *both* floors. Anything newer
 * carries a runtime detection branch and a fallback, and `PLATFORM_FEATURE_FLOORS` records which
 * of the two is true for each one, so the answer is looked up rather than re-derived. Versions
 * verified against webstatus.dev / MDN on 2026-08-17.
 */

export const CHROME_FLOOR = "116";
export const FIREFOX_FLOOR = "128.0";

export interface PlatformFeatureFloor {
  feature: string;
  chrome: number;
  firefox: number;
  /** True when the feature is available at both floors and needs no detection branch. */
  underFloor: boolean;
}

export const PLATFORM_FEATURE_FLOORS: readonly PlatformFeatureFloor[] = [
  { feature: ":has()", chrome: 105, firefox: 121, underFloor: true },
  { feature: "Popover API", chrome: 116, firefox: 125, underFloor: true },
  { feature: "Web Locks", chrome: 69, firefox: 96, underFloor: true },
  { feature: "content-visibility", chrome: 85, firefox: 130, underFloor: false },
  { feature: "RegExp.escape", chrome: 136, firefox: 134, underFloor: false },
  { feature: "URLPattern", chrome: 95, firefox: 142, underFloor: false },
  { feature: "@scope", chrome: 118, firefox: 146, underFloor: false },
  { feature: "Navigation API", chrome: 102, firefox: 147, underFloor: false }
];

/** Whether a listed feature can be used without a detection branch at the declared floors. */
export function isUnderFloor(feature: string): boolean {
  const entry = PLATFORM_FEATURE_FLOORS.find((candidate) => candidate.feature === feature);
  return entry?.underFloor ?? false;
}
