import type { FilterAction, FilterMediaKey, FilterSurface, MediaLayout } from "../../platform/settings";

export const MEDIA_LAYOUT_OPTIONS: Array<[MediaLayout, string]> = [
  ["default", "Default grid"],
  ["stacked", "Stacked"],
  ["grid", "Strict grid"]
];

export const FILTER_ACTION_OPTIONS: Array<[FilterAction, string]> = [
  ["off", "Off"],
  ["hide", "Hide"],
  ["dim", "Dim"]
];

export const FILTER_SURFACE_LABELS: Record<FilterSurface, string> = {
  home: "Home",
  status: "Status",
  profile: "Profile",
  search: "Search",
  notifications: "Notifications",
  messages: "Messages"
};

export const FILTER_MEDIA_LABELS: Record<FilterMediaKey, string> = {
  photo: "Photos",
  video: "Videos",
  gif: "GIFs"
};

export const HIDE_NAV_ITEM_IDS = new Set([
  "premium",
  "home",
  "explore",
  "notifications",
  "follow",
  "chat",
  "messages",
  "grok",
  "history",
  "studio",
  "profile",
  "more"
]);
