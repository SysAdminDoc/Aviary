/**
 * The oldest browsers Aviary's extension build supports, and why.
 *
 * One place, because the floor had been three: a number in each manifest and a sentence in
 * `docs/INSTALL.md`, none of which knew about the others. That matters more than it sounds --
 * the floor is what decides whether a platform feature can be used directly or needs a detection
 * branch, and a floor nobody can point at is one that gets rediscovered per feature.
 *
 * ## Chrome 102
 *
 * The manifest's `"world": "MAIN"` content script and `optional_host_permissions` are both
 * available at 102. Aviary does not use `chrome.scripting` document targeting or another newer
 * API to justify the old 116 floor. Declarative Net Request session rules and tab IDs are older.
 *
 * ## Firefox 140
 *
 * Firefox 140.15 received security fixes on 2026-09-01 and remains the oldest supported ESR line
 * in this release decision. The `"world": "MAIN"` declaration arrived earlier, in Firefox 128,
 * but 140 keeps the supported floor on a maintained ESR without excluding that release. Firefox
 * 153 is the current ESR line and Firefox 155 is the current stable tested by the smoke lane.
 * Raising the floor to 153 would incorrectly label Firefox 140 unsupported just because 153 exists.
 *
 * ## The rule that follows from the floor
 *
 * A platform feature is used directly only if it is available at *both* floors. Anything newer
 * carries a runtime detection branch and a fallback, and `PLATFORM_FEATURE_FLOORS` records which
 * of the two is true for each one, so the answer is looked up rather than re-derived. Versions
 * verified against webstatus.dev / MDN on 2026-08-17.
 */

export const CHROME_FLOOR = "102";
export const FIREFOX_FLOOR = "140.0";

export interface PlatformFeatureFloor {
  feature: string;
  chrome: number;
  firefox: number;
  /** True when the feature is available at both floors and needs no detection branch. */
  underFloor: boolean;
}

export const PLATFORM_FEATURE_FLOORS: readonly PlatformFeatureFloor[] = [
  { feature: ":has()", chrome: 105, firefox: 121, underFloor: false },
  { feature: "Popover API", chrome: 116, firefox: 125, underFloor: false },
  { feature: "Web Locks", chrome: 69, firefox: 96, underFloor: true },
  { feature: "content-visibility", chrome: 85, firefox: 130, underFloor: true },
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
