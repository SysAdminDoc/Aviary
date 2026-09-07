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
  { id: "presets", title: "Presets", group: "Start", summary: "Local controls for a quieter X.", icon: "presets" },
  { id: "appearance", title: "Appearance", group: "Reading", summary: "Use stronger borders and text contrast.", icon: "appearance" },
  { id: "layout", title: "Layout", group: "Reading", summary: "Reduce trends, recommendations, and footer noise.", icon: "layout" },
  { id: "filtering", title: "Filtering", group: "Reading", summary: "Master switch for keyword, regex, premium, and media filters.", icon: "filtering" },
  { id: "catchup", title: "Catch-up", group: "Reading", summary: "Review posts Aviary has already rendered, with no new requests.", icon: "catchup" },
  { id: "hidden", title: "Hidden posts", group: "Reading", summary: "Keep posts you hid collapsed so the next post rises to the top.", icon: "hidden" },
  { id: "performance", title: "Performance", group: "Reading", summary: "Stops decoding timeline video once it leaves the screen, and resumes it when it comes back. A video you paused yourself stays paused.", icon: "performance" },
  { id: "media", title: "Media", group: "Data", summary: "Adds Download and Thumb buttons to post photos and video thumbnails.", icon: "media" },
  { id: "export", title: "Export", group: "Data", summary: "Accumulate posts visible on the active page for the next export run.", icon: "export" },
  { id: "library", title: "Library", group: "Data", summary: "Save, search, organize, and revisit posts in a local bookmark library.", icon: "library" },
  { id: "snapshots", title: "Snapshots & Archive", group: "Data", summary: "Walks UserCell rows on the current page. Open a /handle/followers view first.", icon: "snapshots" },
  { id: "integrations", title: "Integrations", group: "Advanced", summary: "Send large media downloads to a self-hosted Aria2 JSON-RPC endpoint.", icon: "integrations" },
  { id: "backup", title: "Backup & Audit", group: "Advanced", summary: "Downloads your preferences as JSON. API keys and passwords are replaced with a placeholder, so the file is safe to share; importing it here keeps the credentials already saved on this machine.", icon: "backup" },
  { id: "trust", title: "Trust", group: "Advanced", summary: "Settings stay in this browser.", icon: "trust" }
] as const satisfies readonly ControlCenterSectionManifest[];

export type ControlCenterSectionId = (typeof CONTROL_CENTER_SECTION_MANIFEST)[number]["id"];
