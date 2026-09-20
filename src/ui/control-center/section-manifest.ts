/** The single section contract shared by the Control Center and accessibility checks. */
export type SectionIcon =
  | "presets"
  | "appearance"
  | "layout"
  | "filtering"
  | "catchup"
  | "hidden"
  | "performance"
  | "media"
  | "export"
  | "library"
  | "account"
  | "snapshots"
  | "integrations"
  | "backup"
  | "trust";

export interface ControlCenterSectionManifest {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly summary: string;
  readonly icon: SectionIcon;
}

export const CONTROL_CENTER_SECTION_MANIFEST = [
  { id: "presets", title: "Quick setup", group: "Start here", summary: "Choose a ready-made setup or jump to a common task.", icon: "presets" },
  { id: "appearance", title: "Look & feel", group: "Everyday", summary: "Change colors, spacing, text, and the numbers shown on posts.", icon: "appearance" },
  { id: "layout", title: "Page cleanup", group: "Everyday", summary: "Hide ads and parts of X you do not use.", icon: "layout" },
  { id: "filtering", title: "Content filters", group: "Everyday", summary: "Hide or dim posts by words, media, account badges, or page.", icon: "filtering" },
  { id: "media", title: "Downloads", group: "Everyday", summary: "Set up download buttons, quality, filenames, and queues.", icon: "media" },
  { id: "library", title: "Saved posts", group: "Your data", summary: "Search and manage posts stored in this browser.", icon: "library" },
  { id: "export", title: "Import & export", group: "Your data", summary: "Capture posts on the page and download portable copies.", icon: "export" },
  { id: "account", title: "Delete X activity", group: "Your data", summary: "Preview first, then remove selected activity from the signed-in X account.", icon: "account" },
  { id: "catchup", title: "Catch up", group: "More tools", summary: "Review posts Aviary already saw without asking X for more.", icon: "catchup" },
  { id: "hidden", title: "Hidden posts", group: "More tools", summary: "Choose where hidden posts stay hidden, or bring them back.", icon: "hidden" },
  { id: "performance", title: "Video playback", group: "More tools", summary: "Pause videos after they leave the screen.", icon: "performance" },
  { id: "snapshots", title: "X archive", group: "More tools", summary: "Import an official X archive or compare follower snapshots.", icon: "snapshots" },
  { id: "integrations", title: "Connections", group: "More tools", summary: "Set up optional local services and AI providers.", icon: "integrations" },
  { id: "backup", title: "Backup & reset", group: "More tools", summary: "Back up local data, restore it, or reset Aviary.", icon: "backup" },
  { id: "trust", title: "Privacy & diagnostics", group: "More tools", summary: "See what stays local and check whether Aviary still works with X.", icon: "trust" }
] as const satisfies readonly ControlCenterSectionManifest[];

export type ControlCenterSectionId = (typeof CONTROL_CENTER_SECTION_MANIFEST)[number]["id"];
