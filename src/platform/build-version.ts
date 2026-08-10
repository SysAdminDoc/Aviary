/** Build-time version shared by user-facing artifacts that do not have a manifest API. */
declare const __AVIARY_VERSION__: string;

export const AVIARY_VERSION =
  typeof __AVIARY_VERSION__ === "undefined" ? "dev" : __AVIARY_VERSION__;
