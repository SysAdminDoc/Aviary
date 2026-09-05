import {
  type AviarySettings,
  type FilterAction,
  type FilterSurface,
  type MediaLayout,
  type ReduceMotionMode,
  FILTER_SURFACES,
  isThemeId,
  cloneSettings
} from "../platform/settings.ts";
import { FILTER_SURFACE_LABELS } from "./control-center/constants.ts";
import { buildBackupRows, buildIntegrationRows, buildTrustRows } from "./control-center/sections/advanced.ts";
import { buildExportRows, buildLibraryRows, buildMediaRows, buildSnapshotRows } from "./control-center/sections/data.ts";
import { buildAppearanceRows, buildCatchUpRows, buildFilterRows, buildHiddenPostRows, buildLayoutRows, buildPerformanceRows } from "./control-center/sections/reading.ts";
import { buildPresetRows } from "./control-center/sections/presets.ts";
import type {
  DraftCommit,
  DraftRollback,
  LocalizedCopy,
  PanelContext,
  PanelState,
  RowCommitMode
} from "./control-center/panel-context.ts";
import { hasTranslation, localeDirection, translateText } from "../platform/i18n.ts";
import type { RetentionPolicy } from "../features/export/jobs.ts";
import type { WaczSigningStatus } from "../features/export/wacz-signing.ts";
import type { BookmarkInput, BookmarkRecord } from "../features/library/bookmarks.ts";
import type { OfflineQueryHit } from "../features/library/query-model.ts";
import type {
  UnderTheHoodParseResult,
  UnderTheHoodStatus
} from "../features/library/under-the-hood.ts";
import type { RuleSetImportMode, RuleSetImportPlan, RuleSetImportPreview } from "../features/filtering/rules.ts";

/**
 * Stamped in by `tools/build.mjs` so a reload shows at a glance which build is running.
 * Both artifacts get it: the extension could read `chrome.runtime.getManifest()`, but the
 * userscript has no such API, and one define keeps the two in step.
 */
declare const __AVIARY_VERSION__: string;

const AVIARY_VERSION = typeof __AVIARY_VERSION__ === "undefined" ? "dev" : __AVIARY_VERSION__;


import type { DiagnosticEvent } from "../platform/diagnostics.ts";
import type { StorageStatus } from "../platform/storage.ts";
import type { ProfileStatus } from "../platform/profile.ts";
import type { LibraryBackupPreview, LibraryBackupRestoreResult } from "../features/core/library-backup.ts";
import type { IntegrationUsageStatus } from "../features/integrations/usage.ts";
import type { BisectStatus, BisectVerdict } from "../features/core/feature-bisect.ts";

export interface MediaStatus {
  historySize: number;
  historyMatches: {
    identity: number;
    exact: number;
    perceptual: number;
  };
  lastHistoryMatch: "identity" | "exact" | "perceptual" | null;
  completed: number;
  failed: number;
  opened?: number;
  duplicate: number;
  running: number;
  queued?: number;
  paused?: number;
  cancelled?: number;
  batch?: {
    id: string;
    status: "running" | "paused" | "cancelling";
    total: number;
    enqueued: number;
    downloaded: number;
    started: number;
    opened: number;
    duplicate: number;
    failed: number;
  };
}

export interface ExportStatus {
  jobCount: number;
  knownQueries: number;
  jobs?: Array<{
    jobId: string;
    status: "queued" | "running" | "paused" | "cancelled" | "failed" | "completed";
    recordCount: number;
    surface: string;
    startedAt: string;
    error?: string;
  }>;
}

export interface ExportResultSummary {
  records: number;
  filename: string;
  /** How many ZIPs the run produced; more than one when media.zipChunkSize split it. */
  files?: number;
}

export interface CapturedThreadResultSummary {
  records: number;
  threads: number;
  filename: string;
}

export type { IntegrationUsageStatus };

export interface ArchiveImportStatus {
  jobs: Array<{
    jobId: string;
    filename: string;
    status: "queued" | "running" | "paused" | "cancelled" | "failed" | "completed";
    filesParsed: number;
    recordCount: number;
    warningCount: number;
    errorCount: number;
    error?: string;
  }>;
}

export interface SelectorHealthStatus {
  enabled: boolean;
  route: string;
  state: "healthy" | "degraded";
  required: number;
  requiredMatched: number;
  optional: number;
  optionalMatched: number;
  missingRequired: string[];
  optionalMissing: string[];
  fallbackMatches: Array<{ surface: string; selector: string }>;
  affectedFeatures: string[];
  surfaces: Array<{
    surface: string;
    relevance: "required" | "optional" | "inapplicable";
    matched: "stable" | "fallback" | "missing";
    matchedSelector: string | null;
  }>;
  lastTransition: {
    at: string;
    from: "healthy" | "degraded" | null;
    to: "healthy" | "degraded";
    route: string;
  } | null;
  adObservations: {
    lastObservedAt: string | null;
    lastRoute: string | null;
    counts: {
      native: number;
      trend: number;
      housePromo: number;
      video: number;
    };
    retained: number;
    missingContracts: Array<"native" | "trend" | "housePromo" | "video">;
    degradedReason: string | null;
  };
}

export interface ControlCenterOptions {
  settings: AviarySettings;
  diagnostics: () => DiagnosticEvent[];
  getStorageStatus?: () => StorageStatus;
  onChange: () => Promise<void>;
  onError: (message: string, error: unknown) => void;
  getProfileStatus?: () => ProfileStatus;
  createProfile?: (label: string) => Promise<{ ok: boolean; error?: string }>;
  switchProfile?: (profileId: string) => Promise<{ ok: boolean; error?: string }>;
  adoptLegacyProfileData?: () => Promise<{ moved: number; skipped: number }>;
  getMediaStatus?: () => MediaStatus;
  clearMediaHistory?: () => Promise<void>;
  exportMediaHistory?: (options: { from: string | null; to: string | null }) => Promise<{
    records: number;
    files: number;
    filenames: string[];
  }>;
  getExportStatus?: () => ExportStatus;
  pauseExportJob?: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
  resumeExportJob?: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
  cancelExportJob?: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
  runExport?: () => Promise<ExportResultSummary>;
  rebuildThreads?: () => Promise<CapturedThreadResultSummary>;
  copyDiagnostics?: () => Promise<void>;
  exportSettings?: () => Promise<void>;
  exportLibraryBackup?: () => Promise<{ filename: string; collections: number; bytes: number }>;
  previewLibraryRestore?: (payload: string) => Promise<LibraryBackupPreview>;
  restoreLibraryBackup?: (
    payload: string,
    options: { dryRun: boolean; signal: AbortSignal }
  ) => Promise<LibraryBackupRestoreResult>;
  /** Restores Aviary's defaults without touching saved local collections. */
  resetSettings?: () => Promise<void>;
  importSettings?: (payload: string) => Promise<{ applied: boolean; warnings: string[]; errors: string[] }>;
  getAuditSize?: () => number;
  /**
   * Reports whether Aviary actually reached the page's own network layer, and what it has done
   * there. The counts matter as much as the toggle: an installed hook that never fires looks
   * exactly like a hook that does not work.
   */
  getPageHooks?: () => {
    reachable: boolean;
    reason: string;
    blockedBeacons: number;
    blockedAdRequests: number;
    hiddenPlacements: number;
    suppressedVideoAds: number;
    rewrittenPlaylists: number;
  };
  getSelectorHealth?: () => SelectorHealthStatus;
  clearAdObservations?: () => Promise<void>;
  clearSeenPosts?: () => Promise<void>;
  getCatchUpStatus?: () => { records: number; tracking: boolean };
  openCatchUp?: () => { count: number };
  getAdLabelLanguage?: () => { language: string; supported: boolean };
  getUserColors?: () => Record<string, string>;
  setUserColor?: (handle: string, color: string) => Promise<void>;
  exportFilterRules?: () => Promise<{ filename: string; rules: number }>;
  previewFilterRuleImport?: (payload: string, currentRules: readonly string[]) => RuleSetImportPreview;
  applyFilterRuleImport?: (payload: string, mode: RuleSetImportMode) => Promise<RuleSetImportPlan>;
  getFilterRuleErrors?: () => Array<{
    line: number;
    message: string;
    /** Which editor the line is numbered against: the rule DSL, or the raw regex list. */
    origin?: "rules" | "regex";
    source?: string;
  }>;
  getExpiredFilterRules?: () => Array<{ title: string | null; source: string; expiredAt: number }>;
  /** Restarts every expired rule's own window from now. Resolves with how many were renewed. */
  renewFilterRules?: () => Promise<number>;
  getSavedDiagnostics?: () => { total: number; errors: number; newestAt: string | null };
  clearSavedDiagnostics?: () => Promise<void>;
  clearAuditLog?: () => Promise<void>;
  getRetentionPolicy?: () => RetentionPolicy;
  saveRetentionPolicy?: (policy: RetentionPolicy) => Promise<void>;
  getUserNotes?: () => Record<string, string>;
  setUserNote?: (handle: string, note: string) => Promise<void>;
  clearUserNotes?: () => Promise<void>;
  getBookmarkStatus?: () => BookmarkStatus;
  exportBookmarks?: () => Promise<{ records: number; files: number; filenames: string[] }>;
  getUnderTheHoodStatus?: () => UnderTheHoodStatus;
  importUnderTheHood?: (payload: string) => Promise<UnderTheHoodParseResult>;
  exportUnderTheHood?: () => Promise<{ filename: string; reports: number; bytes: number }>;
  searchBookmarks?: (query: string) => BookmarkRecord[];
  offlineSearch?: (query: string) => OfflineQueryHit[];
  offlineSemanticSearch?: (query: string) => Promise<OfflineQueryHit[]>;
  getCapturedMediaCount?: (query: string, filterKind?: "all" | "photo" | "video" | "thumbnail" | "audio" | "subtitle") => number;
  runCapturedMediaBatch?: (query: string, filterKind?: "all" | "photo" | "video" | "thumbnail" | "audio" | "subtitle") => Promise<{
    total: number;
    downloaded: number;
    started: number;
    opened: number;
    duplicate: number;
    failed: number;
    cancelled?: boolean;
  }>;
  updateBookmark?: (id: string, input: BookmarkInput) => Promise<BookmarkRecord | null>;
  removeBookmark?: (id: string) => Promise<boolean>;
  clearBookmarks?: () => Promise<void>;
  listPresets?: () => Array<{
    id: string;
    label: string;
    description: string;
    highlights?: Array<{ label: string; value: string }>;
  }>;
  applyPreset?: (id: string) => Promise<{ applied: boolean; changes: string[] }>;
  listLocales?: () => Array<{ code: string; label: string; direction: "ltr" | "rtl" }>;
  setLocale?: (code: string) => Promise<void>;
  getCleanupQueueSize?: () => { total: number; queued: number; approved: number; skipped: number };
  enqueueCleanupReview?: () => Promise<{ added: number; protected: number }>;
  clearCleanupQueue?: () => Promise<void>;
  pauseMediaBatch?: () => { ok: boolean; error?: string };
  resumeMediaBatch?: () => { ok: boolean; error?: string };
  cancelMediaBatch?: () => { ok: boolean; error?: string };
  resumePendingMediaJobs?: () => Promise<{
    total: number;
    downloaded: number;
    started: number;
    opened: number;
    duplicate: number;
    failed: number;
    cancelled: boolean;
  }>;
  retryFailedMediaJobs?: () => Promise<{
    total: number;
    downloaded: number;
    started: number;
    opened: number;
    duplicate: number;
    failed: number;
    cancelled: boolean;
  }>;
  runMediaBatch?: () => Promise<{
    total: number;
    downloaded: number;
    started: number;
    opened: number;
    duplicate: number;
    failed: number;
    cancelled?: boolean;
  }>;
  getIntegrationUsage?: () => IntegrationUsageStatus | undefined;
  clearIntegrationUsage?: () => Promise<void>;
  downloadWarc?: () => Promise<{ records: number }>;
  getWaczEstimate?: () => { records: number; estimatedBytes: number };
  downloadWacz?: (options?: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  }) => Promise<{ records: number; bytes: number; filename: string }>;
  getWaczSigningStatus?: () => WaczSigningStatus;
  downloadSignedWacz?: (options?: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  }) => Promise<{
    records: number;
    bytes: number;
    filename: string;
    fingerprint: string;
  }>;
  exportWaczSigningKey?: () => Promise<{ filename: string; fingerprint: string }>;
  replaceWaczSigningKey?: () => Promise<WaczSigningStatus>;
  exportToTarget?: (
    target: "clipboard-markdown" | "obsidian" | "notion" | "raw-json"
  ) => Promise<{ target: string; records: number; copied?: boolean }>;
  crosspost?: (target: "bluesky" | "mastodon", options: { asThread: boolean }) => Promise<{ ok: boolean; url?: string; error?: string; posts?: number }>;
  listAria2Active?: () => Promise<Array<{ gid: string; status: string; totalLength: number; completedLength: number; path: string }>>;
  cancelAria2?: (gid: string) => Promise<{ ok: boolean; error?: string }>;
  recentIntegrationErrors?: () => Array<{ at: string; kind: string; message: string }>;
  rebuildSemanticIndex?: () => Promise<{
    added: number;
    skipped: number;
    errors: number;
    total: number;
    dropped: number;
    blocked?: number;
  }>;
  semanticSearchQuery?: (
    query: string
  ) => Promise<Array<{ tweetId: string | null; handle: string | null; text: string; score: number }>>;
  clearSemanticIndex?: () => Promise<void>;
  pingAria2?: () => Promise<{ ok: boolean; error?: string }>;
  getIntegrationStatus?: () => {
    aria2: { enabled: boolean; configured: boolean };
    bluesky: { enabled: boolean; configured: boolean };
    mastodon: { enabled: boolean; configured: boolean };
    ai: { enabled: boolean; configured: boolean };
    semanticSearch: { enabled: boolean; configured: boolean; indexed: number };
  };
  captureSnapshot?: (
    kind: "followers" | "following"
  ) => Promise<{ count: number; handle: string; reachedEnd: boolean } | null>;
  getSnapshotStatus?: () => { total: number; latestAt: string | null; latestKind: string | null; latestCount: number };
  diffLatestSnapshot?: (
    kind: "followers" | "following",
    handle: string
  ) => { onlyLater: number; onlyEarlier: number; inBoth: number; partial: boolean } | null;
  clearSnapshots?: () => Promise<void>;
  importArchive?: (file: File) => Promise<{
    records: number;
    warnings: number;
    errors: number;
    recognizedFiles?: number;
    skippedFiles?: number;
    malformedFiles?: number;
    archiveLinksExpanded?: number;
    corpusLinksExpanded?: number;
    participantIdsResolved?: number;
    participantIdsUnresolved?: number;
  }>;
  getArchiveImportStatus?: () => ArchiveImportStatus;
  getArchiveLibraryStatus?: () => {
    hasImport: boolean;
    authoredPosts: number;
    likes: number;
    directMessages: number;
    media: number;
    followers: number;
    following: number;
    lists: number;
    profile: number;
    account: number;
    repairs: {
      archiveLinksExpanded: number;
      corpusLinksExpanded: number;
      participantIdsResolved: number;
      participantIdsUnresolved: number;
    };
  };
  pauseArchiveImport?: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
  resumeArchiveImport?: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
  cancelArchiveImport?: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
  retryArchiveImport?: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
  searchArchive?: (query: string) => Array<{ handle: string | null; tweetId: string | null; text: string; score: number }>;
  downloadReport?: () => Promise<void>;
  /**
   * The feature bisect: turn features off in halves until the one breaking the page is named.
   * Absent when the host cannot reach the registry, in which case the Trust section says nothing
   * about it rather than offering an action that cannot run.
   */
  getBisectStatus?: () => BisectStatus;
  startBisect?: () => Promise<BisectStatus>;
  answerBisect?: (verdict: BisectVerdict) => Promise<BisectStatus>;
  cancelBisect?: () => Promise<BisectStatus>;
  describeBisect?: () => string;
  featureTitle?: (featureId: string) => string;
  getHiddenPostsStatus?: () => HiddenPostsStatus;
  undoLastHide?: () => Promise<{ restored: boolean; handle: string | null }>;
  unhidePost?: (key: string) => Promise<boolean>;
  clearHiddenPosts?: () => Promise<number>;
}

export interface HiddenPostSummary {
  key: string;
  handle: string | null;
  text: string;
  hiddenAt: string;
}

export interface HiddenPostsStatus {
  total: number;
  updatedAt: string | null;
  recent: HiddenPostSummary[];
}

export interface BookmarkStatus {
  total: number;
  due: number;
  tags: string[];
  folders: string[];
  mirrored?: number;
}

/** One entry in the settings rail: a heading group, a title, and the rows it owns. */
interface PanelSection {
  id: string;
  title: string;
  group: string;
  summary: string;
  icon: SectionIcon;
  accent: string;
  build: () => HTMLElement[];
}

type SectionIcon =
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

type DraftControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface DraftHooks {
  update(control: DraftControl, label: string, dirty: boolean): void;
  register(control: DraftControl, label: string, commit: () => DraftCommit): void;
  stage(change: () => Promise<void>): void;
  guard(): boolean;
}

/** English row labels are stable identifiers; visible group titles still pass through t(). */
const SECTION_GROUP_BREAKS: Record<string, Array<{ before: string; title: string }>> = {
  presets: [
    { before: "Quiet Reader", title: "Preset packs" },
    { before: "Locale", title: "Language" }
  ],
  appearance: [
    { before: "Theme", title: "Display" },
    { before: "High contrast", title: "Accessibility" }
  ],
  layout: [
    { before: "Ad-free mode", title: "Ad protection" },
    { before: "Hide right sidebar", title: "Page chrome" },
    { before: "Open Following instead of For you", title: "Reading flow" },
    { before: "Hide navigation items", title: "Navigation" }
  ],
  filtering: [
    { before: "Enable filters", title: "Filter status" },
    { before: "Keyword rules", title: "Rules" },
    { before: "Premium / verified posts", title: "Content types" },
    { before: "Active on", title: "Routes" }
  ],
  catchup: [{ before: "Open catch-up digest", title: "Digest" }],
  hidden: [
    { before: "Hide dismissed posts", title: "Status" },
    { before: "Active on", title: "Coverage" },
    { before: "Maximum remembered posts", title: "Retention" },
    { before: "Hidden posts stored", title: "Recovery" }
  ],
  performance: [{ before: "Pause video that scrolls out of view", title: "Playback" }],
  media: [
    { before: "Show download buttons", title: "On-post controls" },
    { before: "Filename template", title: "File naming" },
    { before: "Match visually similar images", title: "Duplicate matching" },
    { before: "Duplicate history", title: "Batch behavior" },
    { before: "Download all visible media", title: "Queue actions" },
    { before: "Download status", title: "Queue status" }
  ],
  export: [
    { before: "Capture visible posts", title: "Capture" },
    { before: "Export formats", title: "Package" },
    { before: "Save folder hint", title: "Destination" },
    { before: "Export visible posts", title: "Jobs" },
    { before: "Preservation archive", title: "Preservation" }
  ],
  library: [
    { before: "Search all local collections", title: "Universal search" },
    { before: "Local bookmarks", title: "Bookmarks" },
    { before: "Show the AI button on posts", title: "Post tools" },
    { before: "Account notes", title: "Writing tools" }
  ],
  snapshots: [
    { before: "Snapshots stored", title: "Live snapshots" },
    { before: "Imported collections", title: "Official archive" },
    { before: "Search captured records", title: "Search & reports" }
  ],
  integrations: [
    { before: "Aria2 handoff", title: "Connections" },
    { before: "AI provider", title: "Intelligence" },
    { before: "Recent integration errors", title: "Health" }
  ],
  backup: [
    { before: "Reset all preferences", title: "Preferences" },
    { before: "Export full library backup", title: "Library backup" },
    { before: "Keep a local action log", title: "Audit history" }
  ],
  trust: [
    { before: "Storage", title: "Privacy boundary" },
    { before: "Page access", title: "Page hooks" },
    { before: "Telemetry", title: "Local data" },
    { before: "Panel language", title: "Compatibility" }
  ]
};

export interface ControlCenterHandle {
  destroy(): void;
  refresh(): void;
}

export function mountControlCenter(options: ControlCenterOptions): ControlCenterHandle {
  const existing = document.getElementById("av-control-center");
  existing?.remove();
  document.getElementById("av-control-center-nav")?.remove();

  // Set before any chrome is built, so the header is localized on the very first paint.
  panelLocale = options.settings.i18n.locale;
  resetCoverageTally();

  const host = document.createElement("div");
  host.id = "av-control-center";
  host.dataset.avOwned = "true";
  host.dir = localeDirection(panelLocale);
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CONTROL_CENTER_CSS;

  const shell = el("div", "av-shell");
  const launcher = button("Aviary", "av-launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "av-control-panel");
  launcher.setAttribute("aria-haspopup", "dialog");
  // Avoid a bottom-corner flash while the current X navigation is being discovered.
  launcher.hidden = true;

  const navLauncherHost = document.createElement("div");
  navLauncherHost.id = "av-control-center-nav";
  navLauncherHost.dataset.avOwned = "true";
  navLauncherHost.dir = localeDirection(panelLocale);
  const navLauncherShadow = navLauncherHost.attachShadow({ mode: "open" });
  const navLauncherStyle = document.createElement("style");
  navLauncherStyle.textContent = NAV_LAUNCHER_CSS;
  const navLauncher = document.createElement("button");
  navLauncher.type = "button";
  navLauncher.className = "av-nav-launcher";
  navLauncher.setAttribute("aria-expanded", "false");
  navLauncher.setAttribute("aria-haspopup", "dialog");
  navLauncher.setAttribute("aria-label", t("Aviary settings"));
  const navLauncherPill = el("span", "av-nav-launcher-pill");
  const navLauncherLabel = el("span", "av-nav-launcher-label", t("Aviary"));
  navLauncherPill.append(navLauncherIcon(), navLauncherLabel);
  navLauncher.append(navLauncherPill);
  navLauncherShadow.append(navLauncherStyle, navLauncher);

  const overlay = el("div", "av-overlay");
  overlay.setAttribute("aria-hidden", "true");
  // The wrapper remains the accessibility state marker used by the surrounding X chrome. The
  // dialog itself owns the native top layer and light-dismiss behavior.
  overlay.toggleAttribute("inert", true);

  const panel = el("section", "av-panel");
  panel.id = "av-control-panel";
  panel.setAttribute("popover", "auto");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("Aviary settings"));
  panel.setAttribute("aria-modal", "true");
  panel.tabIndex = -1;

  const header = el("header", "av-panel-header");
  const titleWrap = el("div", "av-title-wrap");
  const titleRow = el("div", "av-title-row");
  const title = el("h2", "av-title", t("Aviary"));
  title.id = "av-control-title";
  panel.setAttribute("aria-labelledby", title.id);
  // Data, not copy: never routed through t(), and never counted against locale coverage.
  const version = el("span", "av-version", `v${AVIARY_VERSION}`);
  titleRow.append(title, version);
  const subtitle = el("p", "av-subtitle", t("Local controls for a quieter X."));
  titleWrap.append(titleRow, subtitle);

  const close = button("Close", "av-button av-button-secondary");
  close.type = "button";

  const status = el("div", "av-status", t("Saved locally"));
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.dataset.state = "saved";
  host.dataset.avSaveState = "saved";

  const transactionBar = el("footer", "av-transaction-bar");
  const transactionActions = el("div", "av-transaction-actions");
  const revertDraftButton = button("Revert", "av-button av-button-secondary av-transaction-revert");
  revertDraftButton.type = "button";
  revertDraftButton.disabled = true;
  const saveDraftButton = button("Save", "av-button av-button-primary av-transaction-save");
  saveDraftButton.type = "button";
  saveDraftButton.disabled = true;
  transactionActions.append(revertDraftButton, saveDraftButton);
  transactionBar.append(status, transactionActions);

  /**
   * The search field lives in the chrome rather than the body. `render()` replaces the body
   * wholesale, so a field inside it would lose focus and its caret on every keystroke; keeping
   * it out here means typing survives a re-render with no restoration logic at all.
   */
  const searchBar = el("div", "av-searchbar");
  const search = document.createElement("input");
  search.type = "search";
  search.className = "av-search-input";
  search.placeholder = t("Search settings");
  search.setAttribute("aria-label", t("Search settings"));
  search.spellcheck = false;
  searchBar.append(searchIcon(), search);
  header.append(titleWrap, searchBar, close);

  const body = el("div", "av-panel-body");
  panel.append(header, body, transactionBar);
  overlay.append(panel);
  shell.append(launcher, overlay);
  shadow.append(style, shell);

  let open = false;
  let dirtyWhileBusy = false;
  /** Which section the content pane is showing. Survives a re-render via the closure. */
  let activeSectionId = "presets";
  /** Non-empty means the content pane shows matches from every section instead of one. */
  let searchQuery = "";
  /** Search, backup, and restore state survives section rebuilds and settings saves. */
  const panelState: PanelState = {
    bookmarkQuery: "",
    libraryQuery: "",
    unifiedSemantic: false,
    pendingFilterRuleImport: "",
    pendingFilterRulePreview: null,
    pendingLibraryBackupPayload: null,
    pendingLibraryBackupPreview: null,
    libraryRestoreRunning: false,
    libraryRestoreAbort: null
  };
  const draftSettings = cloneSettings(options.settings);
  const panelOptions: ControlCenterOptions = { ...options, settings: draftSettings };
  const dirtyControls = new Set<DraftControl>();
  const draftCommits = new Map<DraftControl, { label: string; commit: () => DraftCommit }>();
  let stagingDepth = 0;
  let transactionSaving = false;
  let lastDraftMessage = "Saved locally";
  let lastChangedLabel: string | null = null;
  /** English source of whatever the status line shows, so a locale change can re-translate it. */
  let lastStatusEnglish = "Saved locally";
  let lastStatusValues: Record<string, string | number> = {};
  let bodyWasInert = false;
  let focusTrapAttached = false;
  let mountedPrimaryNav: HTMLElement | null = null;
  let launcherMountDestroyed = false;
  let launcherReconcileQueued = false;

  const findPrimaryNav = (): HTMLElement | null => {
    const tab = document.querySelector<HTMLElement>('[data-testid^="AppTabBar_"]');
    return tab?.closest<HTMLElement>("nav") ?? null;
  };

  const syncNavLauncherLayout = (nav: HTMLElement): void => {
    const width = nav.getBoundingClientRect().width;
    navLauncherHost.dataset.avCompact = String(width > 0 && width < 120);
  };

  const navResizeObserver = typeof ResizeObserver === "undefined"
    ? undefined
    : new ResizeObserver(() => {
      if (mountedPrimaryNav?.isConnected) syncNavLauncherLayout(mountedPrimaryNav);
    });

  const destroyLauncherMount = (): void => {
    if (launcherMountDestroyed) return;
    launcherMountDestroyed = true;
    launcherObserver?.disconnect();
    navResizeObserver?.disconnect();
    navLauncherHost.remove();
    mountedPrimaryNav = null;
  };

  const reconcileLauncherMount = (): void => {
    if (launcherMountDestroyed || !host.isConnected) return;
    const nav = findPrimaryNav();
    if (!nav) {
      navResizeObserver?.disconnect();
      navLauncherHost.remove();
      mountedPrimaryNav = null;
      launcher.hidden = false;
      return;
    }

    launcher.hidden = true;
    if (navLauncherHost.parentElement !== nav) {
      navResizeObserver?.disconnect();
      nav.append(navLauncherHost);
      mountedPrimaryNav = nav;
      navResizeObserver?.observe(nav);
    }
    syncNavLauncherLayout(nav);
  };

  const queueLauncherReconcile = (): void => {
    if (launcherReconcileQueued || launcherMountDestroyed) return;
    launcherReconcileQueued = true;
    queueMicrotask(() => {
      launcherReconcileQueued = false;
      reconcileLauncherMount();
    });
  };

  const launcherObserver = new MutationObserver(() => {
    if (!host.isConnected) {
      destroyLauncherMount();
      return;
    }
    if (!navLauncherHost.isConnected) queueLauncherReconcile();
  });
  launcherObserver.observe(document.documentElement, { childList: true, subtree: true });

  const launcherForFocus = (): HTMLButtonElement =>
    navLauncherHost.isConnected ? navLauncher : launcher;

  const modalFocusables = (): HTMLElement[] =>
    Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((node) => {
      if (node.hasAttribute("disabled") || node.getAttribute("aria-hidden") === "true") {
        return false;
      }
      return node.getClientRects().length > 0;
    });

  const handlePanelKeyDown = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.key !== "Tab") return;

    const focusables = modalFocusables();
    if (focusables.length === 0) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }

    const active = shadow.activeElement as HTMLElement | null;
    const index = active ? focusables.indexOf(active) : -1;
    if (event.shiftKey && (active === panel || index <= 0)) {
      event.preventDefault();
      focusables[focusables.length - 1]!.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === panel || index === focusables.length - 1 || index < 0)) {
      event.preventDefault();
      focusables[0]!.focus({ preventScroll: true });
    }
  };

  const handleModalFocusIn = (event: FocusEvent): void => {
    if (!open) return;
    const target = event.target;
    // Document-level focus events are retargeted to the shadow host. Use the composed path so
    // focusing a rebuilt action inside the modal is not mistaken for focus leaving the dialog.
    if (event.composedPath().includes(panel) || (target instanceof Node && panel.contains(target))) return;
    event.stopPropagation();
    panel.focus({ preventScroll: true });
  };

  panel.addEventListener("keydown", handlePanelKeyDown);
  type NativePopover = HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  const nativePanel = panel as NativePopover;
  const setOpen = (value: boolean, fromNative = false): void => {
    if (open === value) {
      if (value) panel.focus({ preventScroll: true });
      return;
    }
    open = value;
    launcher.setAttribute("aria-expanded", String(open));
    navLauncher.setAttribute("aria-expanded", String(open));
    overlay.setAttribute("aria-hidden", String(!open));
    const firstRunNotice = document.getElementById("av-first-run");
    if (firstRunNotice) firstRunNotice.hidden = open;
    // The panel's own `:not(:popover-open)` rule hides it; `inert` is what keeps the closed
    // panel's ~137 controls out of the tab order rather than merely invisible.
    overlay.toggleAttribute("inert", !open);
    panel.toggleAttribute("inert", !open);
    if (!fromNative) {
      try {
        if (open) nativePanel.showPopover?.();
        else nativePanel.hidePopover?.();
      } catch {
        // Both manifest floors ship the Popover API, and an engine without it drops the
        // `:not(:popover-open)` rule at parse time, so the authored display applies and the panel
        // works. The only shape this covers is a host that has the selector but not the methods,
        // which no shipping engine does -- and that shape is the bad one: the rule would hide the
        // panel while `inert` is on <body> and focus is inside, leaving nothing visible and no way
        // out. The class is what makes that state recoverable rather than a lockout.
        panel.classList.toggle("av-popover-unavailable", open);
      }
    }
    if (open) {
      bodyWasInert = document.body?.hasAttribute("inert") ?? false;
      document.body?.setAttribute("inert", "");
      document.addEventListener("focusin", handleModalFocusIn, true);
      focusTrapAttached = true;
      // Repaint anything that went stale while the panel was closed.
      if (dirtyWhileBusy && !transactionDirty() && !transactionSaving) {
        dirtyWhileBusy = false;
        render();
      }
      panel.focus({ preventScroll: true });
    } else {
      if (document.body) {
        if (bodyWasInert) document.body.setAttribute("inert", "");
        else document.body.removeAttribute("inert");
      }
      if (focusTrapAttached) {
        document.removeEventListener("focusin", handleModalFocusIn, true);
        focusTrapAttached = false;
      }
      launcherForFocus().focus({ preventScroll: true });
    }
  };

  panel.addEventListener("toggle", (event) => {
    const nextState = (event as Event & { newState?: string }).newState === "open";
    if (nextState !== open) {
      setOpen(nextState, true);
    }
  });

  /**
   * A rebuild replaces every row, which destroys half-typed input and moves focus. Page
   * mutations must never do that to someone mid-edit, so a refresh requested while the
   * panel is closed or focused is deferred until it is safe.
   */
  const transactionDirty = (): boolean => dirtyControls.size > 0;

  const updateTransactionButtons = (): void => {
    const disabled = !transactionDirty() || transactionSaving;
    saveDraftButton.disabled = disabled;
    revertDraftButton.disabled = disabled;
    // ARIA booleans are the strings "true"/"false"; an empty value falls back to the default, so
    // `toggleAttribute` here meant the save never announced itself as busy to assistive technology.
    if (transactionSaving) {
      transactionBar.setAttribute("aria-busy", "true");
    } else {
      transactionBar.removeAttribute("aria-busy");
    }
    host.dataset.avDraftState = transactionSaving ? "saving" : transactionDirty() ? "dirty" : "clean";
  };

  const isBusy = (): boolean => {
    if (transactionDirty() || transactionSaving) {
      return true;
    }
    const active = shadow.activeElement;
    if (!active) {
      return false;
    }
    return active !== panel;
  };

  const setStatus = (message: string): void => {
    lastStatusEnglish = message;
    lastStatusValues = {};
    status.textContent = t(message);
    status.dataset.state = statusState(message);
    host.dataset.avSaveState = status.dataset.state;
    updateTransactionButtons();
  };

  const setStatusCopy = (source: string, values: Record<string, string | number>): void => {
    lastStatusEnglish = source;
    lastStatusValues = { ...values };
    status.textContent = formatCopy(t(source), lastStatusValues);
    status.dataset.state = statusState(source);
    host.dataset.avSaveState = status.dataset.state;
    updateTransactionButtons();
  };

  const statusState = (source: string): "saved" | "dirty" | "saving" | "error" => {
    if (source === "Saving...") return "saving";
    if (source === "Unsaved changes" || source.startsWith("Save or revert")) return "dirty";
    if (/could not|failed|error|invalid/i.test(source)) return "error";
    return "saved";
  };

  const draftHooks: DraftHooks = {
    update(control, label, dirty) {
      if (dirty) {
        dirtyControls.add(control);
        lastChangedLabel = label;
      } else {
        dirtyControls.delete(control);
      }
      setStatus(transactionDirty() ? "Unsaved changes" : "Saved locally");
    },
    register(control, label, commit) {
      draftCommits.set(control, { label, commit });
    },
    stage(change) {
      stagingDepth += 1;
      void change()
        .catch((error: unknown) => {
          try {
            options.onError("Control Center could not stage settings", error);
          } catch {
            // A diagnostic sink cannot be allowed to strand the transaction controls.
          }
          setStatus("Could not save settings. Try again.");
        })
        .finally(() => {
          stagingDepth = Math.max(0, stagingDepth - 1);
          updateTransactionButtons();
        });
    },
    guard() {
      return holdDirtyDraft();
    }
  };

  const holdDirtyDraft = (): boolean => {
    if (!transactionDirty() && !transactionSaving) return false;
    setStatus("Save or revert your changes before leaving this section.");
    const firstDirty = [...dirtyControls].find((control) => control.isConnected);
    (firstDirty ?? saveDraftButton).focus({ preventScroll: true });
    return true;
  };

  /** Disabled buttons lose focus in Chromium, so remember the action row across a refresh. */
  let pendingActionFocus: string | null = null;
  let pendingActionLabel: string | null = null;

  /**
   * A row's identity across rebuilds: its section title, its label, and its position among the
   * focusable controls of that row. Every row is rebuilt from the same settings object in the
   * same order, so this survives a render even though the nodes do not.
   */
  const focusIdentity = (node: Element | null): string | null => {
    if (!node || !body.contains(node)) {
      return null;
    }
    const row = node.closest(".av-row");
    const sectionTitle = node.closest(".av-section")?.querySelector(".av-section-title")?.textContent ?? "";
    const label = row?.querySelector(".av-row-label")?.textContent ?? "";
    const scope: ParentNode = row ?? body;
    const index = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).indexOf(
      node as HTMLElement
    );
    if (label) {
      return `row|${sectionTitle}|${label}|${node.tagName}|${index}`;
    }
    return `path|${positionalPath(body, node)}`;
  };

  const findByIdentity = (identity: string): HTMLElement | null => {
    for (const candidate of Array.from(body.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))) {
      if (focusIdentity(candidate) === identity) {
        return candidate;
      }
    }
    return null;
  };

  const findActionButton = (label: string): HTMLButtonElement | null => {
    const expected = t(label);
    return (
      Array.from(body.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent === expected && !candidate.disabled
      ) ?? null
    );
  };

  /**
   * All action rows share one rejection boundary. A handler may still catch an expected failure
   * itself when it has more useful copy, but a new action cannot leak an unhandled rejection or
   * leave its button disabled just because its first implementation forgot that boundary.
   */
  const actionRow = (
    label: string,
    description: LocalizedCopy,
    onClick: () => Promise<void>,
    failureMessage = "Action failed."
  ): HTMLElement =>
    buildActionRow(
      label,
      description,
      async () => {
        if (holdDirtyDraft()) return;
        await onClick();
      },
      (error) => {
        try {
          options.onError(`${label} failed`, error);
        } catch {
          // Error reporting is diagnostic plumbing; it must never create a second rejected action.
        }
        setStatus(failureMessage);
      },
      (button) => {
        pendingActionFocus = focusIdentity(button);
        pendingActionLabel = label;
      },
      (button) => {
        if (pendingActionFocus && (!shadow.activeElement || shadow.activeElement === panel)) {
          const target = button.isConnected
            ? button
            : findByIdentity(pendingActionFocus) ?? (pendingActionLabel ? findActionButton(pendingActionLabel) : null);
          if (!target) return;
          target.focus({ preventScroll: true });
          pendingActionFocus = null;
          pendingActionLabel = null;
        }
      }
    );

  const render = (): void => {
    if (!transactionDirty()) {
      replaceSettings(draftSettings, options.settings);
      draftCommits.clear();
      dirtyWhileBusy = false;
    }
    // Every render replaces every row, so the caret has to be put back deliberately —
    // otherwise saving a setting drops focus to the document.
    const active = shadow.activeElement as HTMLElement | null;
    const identity = focusIdentity(active) ?? pendingActionFocus;
    const selection = captureSelection(active);
    // `body` is the grid that holds the rail and the content pane; it is `overflow: hidden` and
    // never scrolls, so reading its scrollTop restored nothing. Both children scroll, and both
    // are replaced below, so both have to be measured here and put back afterwards.
    const contentScrollTop = body.querySelector(".av-content")?.scrollTop ?? 0;
    const navScrollTop = body.querySelector(".av-nav")?.scrollTop ?? 0;
    // Every dirty control is carried across the rebuild on the same row identity the focus restore
    // below already relies on, because the rebuild replaces the nodes `dirtyControls` points at.
    //
    // The two kinds need different handling. A registered control (text, secret, integer,
    // textarea) holds the typed value only on the node, so the value travels with it and its
    // rebuilt row re-registers the commit closure. A toggle or select already wrote itself into
    // `draftSettings` and its rebuilt row renders from there, so only its membership of the dirty
    // set has to be restored -- without that the transaction looks empty and the save is refused.
    const pendingDrafts = [...dirtyControls]
      .filter((control) => control.isConnected)
      .map((control) => ({
        identity: focusIdentity(control),
        value: control.value,
        registered: draftCommits.has(control)
      }))
      .filter(
        (entry): entry is { identity: string; value: string; registered: boolean } =>
          entry.identity !== null
      );
    // Anything that cannot be re-found below is genuinely gone; starting from empty is what stops a
    // detached node keeping the Save button lit over an edit that no longer exists.
    dirtyControls.clear();

    panelLocale = draftSettings.i18n.locale;
    host.dir = localeDirection(panelLocale);
    resetCoverageTally();
    // Chrome is built once at mount, so a locale change has to repaint it explicitly.
    title.textContent = t("Aviary");
    subtitle.textContent = t("Local controls for a quieter X.");
    close.textContent = t("Close");
    launcher.textContent = t("Aviary");
    navLauncherLabel.textContent = t("Aviary");
    navLauncher.setAttribute("aria-label", t("Aviary settings"));
    navLauncherHost.dir = localeDirection(panelLocale);
    panel.setAttribute("aria-label", t("Aviary settings"));
    // Chrome outside `body` survives the re-render, which is the point — but that also means
    // nothing repaints it on a locale change unless it is done here.
    search.placeholder = t("Search settings");
    search.setAttribute("aria-label", t("Search settings"));
    revertDraftButton.textContent = t("Revert");
    saveDraftButton.textContent = t("Save");
    // The status line keeps its English source so a locale change can re-translate whatever it
    // is currently showing, rather than stranding the last toast in the previous language.
    status.textContent = formatCopy(t(lastStatusEnglish), lastStatusValues);

    // Mirrored onto the host because shadow content cannot see the page-level motion class.
    host.dataset.avMotion = prefersReducedMotion(draftSettings) ? "reduce" : "full";
    navLauncherHost.dataset.avMotion = host.dataset.avMotion;
    host.dataset.avColorMode = controlCenterColorMode(draftSettings);
    reconcileLauncherMount();
    const registry = sectionRegistry();
    if (!registry.some((entry) => entry.id === activeSectionId)) {
      activeSectionId = registry[0]?.id ?? "presets";
    }
    const activeEntry = registry.find((entry) => entry.id === activeSectionId) ?? registry[0];
    panel.style.setProperty("--av-page-accent", activeEntry?.accent ?? "rgb(77, 199, 255)");
    body.replaceChildren(buildNav(registry), buildContent(registry));

    // Filled after the body exists so the number counts the render that just happened,
    // including the rows drawn after this one.
    const coverage = body.querySelector(`.${COVERAGE_ROW_CLASS} .av-row-description`);
    if (coverage) {
      coverage.textContent = coverageSummary();
    }

    // Restored onto the freshly built panes, not the container: saving a setting halfway down a
    // long section used to throw the reader back to its first row.
    const content = body.querySelector(".av-content");
    if (content) content.scrollTop = contentScrollTop;
    const rail = body.querySelector(".av-nav");
    if (rail) rail.scrollTop = navScrollTop;
    for (const pending of pendingDrafts) {
      const control = findByIdentity(pending.identity) as DraftControl | null;
      if (!control) continue;
      // Only a registered control needs its value put back, and only onto a row that registered a
      // commit closure of its own -- re-finding a different kind of control at the same identity
      // would otherwise write a value the row does not mean.
      if (pending.registered) {
        if (!draftCommits.has(control)) continue;
        control.value = pending.value;
      }
      dirtyControls.add(control);
    }
    if (identity || pendingActionLabel) {
      const target = (identity ? findByIdentity(identity) : null) ?? (pendingActionLabel ? findActionButton(pendingActionLabel) : null);
      if (target) {
        target.focus({ preventScroll: true });
        restoreSelection(target, selection);
        pendingActionFocus = null;
        pendingActionLabel = null;
      }
    }
  };

  const panelContext: PanelContext = {
    options: panelOptions,
    settings: draftSettings,
    state: panelState,
    t,
    formatCopy,
    localizedCopy,
    setStatus,
    setStatusCopy,
    save: (message) => save(message),
    render,
    guardDraft: holdDirtyDraft,
    actionRow,
    toggleRow: (label, description, checked, onChange) =>
      toggleRow(label, description, checked, onChange, draftHooks),
    selectRow: (label, value, rowOptions, onChange, description, translateOptions, mode) =>
      selectRow(label, value, rowOptions, onChange, description, translateOptions, draftHooks, mode),
    readonlyRow,
    dataRow,
    textInputRow: (label, description, value, onChange, mode, actionLabel) =>
      textInputRow(label, description, value, onChange, draftHooks, mode, actionLabel),
    secretInputRow: (label, description, value, onChange, mode) =>
      secretInputRow(label, description, value, onChange, draftHooks, mode),
    integerInputRow: (label, description, value, onChange, bounds, mode, actionLabel) =>
      integerInputRow(label, description, value, onChange, bounds, draftHooks, mode, actionLabel),
    textareaRow: (label, description, lines, onChange, actionLabel, mode) =>
      textareaRow(label, description, lines, onChange, actionLabel, draftHooks, mode),
    surfaceRow: (label, description, selected, onChange) =>
      surfaceRow(label, description, selected, onChange, draftHooks),
    bookmarkField,
    splitBookmarkTags,
    toDatetimeLocal,
    fromDatetimeLocal,
    coerceReduceMotion,
    coerceFilterAction,
    coerceLayout,
    formatBytes,
    defaultAiEndpoint,
    isThemeId,
    el,
    button,
    presetIcon,
    coverageRow: () => coverageRow(),
    storageHealthRow: () => storageHealthRow(),
    storageStatusRow: () => storageStatusRow(),
    beaconRows: () => beaconRows(),
    pageScopeReason: (code) => pageScopeReason(code),
    selectorHealthRows: () => selectorHealthRows(),
    selectorSummary: () => selectorSummary()
  };

  /**
   * The panel used to render all twelve sections into one column: 144 controls and roughly
   * nineteen screens of scrolling, with nothing to jump by. The registry lets the nav list the
   * sections and the content pane build only the one being looked at, so opening the panel
   * costs one section's worth of DOM instead of all of it.
   *
   * `group` is the heading a section sits under in the rail. Everyday reading controls come
   * first; the things most people touch once, if ever, sit under Advanced.
   */
  const sectionRegistry = (): PanelSection[] => [
    {
      id: "presets",
      title: "Presets",
      group: "Start",
      summary: "Local controls for a quieter X.",
      icon: "presets",
      accent: "rgb(72, 211, 193)",
      build: () => buildPresetRows(panelContext)
    },
    {
      id: "appearance",
      title: "Appearance",
      group: "Reading",
      summary: "Use stronger borders and text contrast.",
      icon: "appearance",
      accent: "rgb(72, 211, 193)",
      build: () => buildAppearanceRows(panelContext)
    },
    {
      id: "layout",
      title: "Layout",
      group: "Reading",
      summary: "Reduce trends, recommendations, and footer noise.",
      icon: "layout",
      accent: "rgb(72, 211, 193)",
      build: () => buildLayoutRows(panelContext)
    },
    {
      id: "filtering",
      title: "Filtering",
      group: "Reading",
      summary: "Master switch for keyword, regex, premium, and media filters.",
      icon: "filtering",
      accent: "rgb(72, 211, 193)",
      build: () => buildFilterRows(panelContext)
    },
    {
      id: "catchup",
      title: "Catch-up",
      group: "Reading",
      summary: "Review posts Aviary has already rendered, with no new requests.",
      icon: "catchup",
      accent: "rgb(72, 211, 193)",
      build: () => buildCatchUpRows(panelContext)
    },
    {
      id: "hidden",
      title: "Hidden posts",
      group: "Reading",
      summary: "Keep posts you hid collapsed so the next post rises to the top.",
      icon: "hidden",
      accent: "rgb(72, 211, 193)",
      build: () => buildHiddenPostRows(panelContext)
    },
    {
      id: "performance",
      title: "Performance",
      group: "Reading",
      summary: "Stops decoding timeline video once it leaves the screen, and resumes it when it comes back. A video you paused yourself stays paused.",
      icon: "performance",
      accent: "rgb(72, 211, 193)",
      build: () => buildPerformanceRows(panelContext)
    },
    {
      id: "media",
      title: "Media",
      group: "Data",
      summary: "Adds Download and Thumb buttons to post photos and video thumbnails.",
      icon: "media",
      accent: "rgb(72, 211, 193)",
      build: () => buildMediaRows(panelContext)
    },
    {
      id: "export",
      title: "Export",
      group: "Data",
      summary: "Accumulate posts visible on the active page for the next export run.",
      icon: "export",
      accent: "rgb(72, 211, 193)",
      build: () => buildExportRows(panelContext)
    },
    {
      id: "library",
      title: "Library",
      group: "Data",
      summary: "Save, search, organize, and revisit posts in a local bookmark library.",
      icon: "library",
      accent: "rgb(72, 211, 193)",
      build: () => buildLibraryRows(panelContext)
    },
    {
      id: "snapshots",
      title: "Snapshots & Archive",
      group: "Data",
      summary: "Walks UserCell rows on the current page. Open a /handle/followers view first.",
      icon: "snapshots",
      accent: "rgb(72, 211, 193)",
      build: () => buildSnapshotRows(panelContext)
    },
    {
      id: "integrations",
      title: "Integrations",
      group: "Advanced",
      summary: "Send large media downloads to a self-hosted Aria2 JSON-RPC endpoint.",
      icon: "integrations",
      accent: "rgb(72, 211, 193)",
      build: () => buildIntegrationRows(panelContext)
    },
    {
      id: "backup",
      title: "Backup & Audit",
      group: "Advanced",
      summary: "Downloads your preferences as JSON. API keys and passwords are replaced with a placeholder, so the file is safe to share; importing it here keeps the credentials already saved on this machine.",
      icon: "backup",
      accent: "rgb(72, 211, 193)",
      build: () => buildBackupRows(panelContext)
    },
    {
      id: "trust",
      title: "Trust",
      group: "Advanced",
      summary: "Settings stay in this browser.",
      icon: "trust",
      accent: "rgb(72, 211, 193)",
      build: () => buildTrustRows(panelContext)
    }
  ];

  const buildNav = (registry: PanelSection[]): HTMLElement => {
    const nav = el("nav", "av-nav");
    nav.setAttribute("aria-label", t("Settings sections"));

    let currentGroup = "";
    for (const entry of registry) {
      if (entry.group !== currentGroup) {
        currentGroup = entry.group;
        nav.append(el("p", "av-nav-group", t(currentGroup)));
      }
      const item = el("button", "av-nav-item", t(entry.title)) as HTMLButtonElement;
      item.type = "button";
      item.dataset.avSection = entry.id;
      item.style.setProperty("--av-page-accent", entry.accent);
      const selected = searchQuery.trim().length === 0 && entry.id === activeSectionId;
      item.classList.toggle("is-active", selected);
      // A rail of buttons is a tablist in behaviour; say so rather than leaving it to guesswork.
      item.setAttribute("aria-current", selected ? "true" : "false");
      item.addEventListener("click", () => {
        if (holdDirtyDraft()) return;
        activeSectionId = entry.id;
        // Choosing a section is an explicit "show me this", so drop any active filter.
        searchQuery = "";
        search.value = "";
        render();
      });
      nav.append(item);
    }
    return nav;
  };

  /**
   * Builds one section's rows, and turns a builder that throws into a row saying so.
   *
   * `FeatureRegistry` has always isolated per-feature failures; the panel did not isolate
   * per-section ones. A builder that threw took the whole render with it, so the rail item
   * appeared to do nothing: `activeSectionId` had already moved, the previous section stayed on
   * screen, and the status line still read "Saved locally". A destination that cannot be reached
   * and does not say why is worse than one that is visibly broken.
   */
  const buildSection = (entry: PanelSection): HTMLElement => {
    try {
      return section(entry, entry.build());
    } catch (error) {
      try {
        options.onError(`Control Center could not draw the ${entry.title} section`, error);
      } catch {
        // A diagnostic sink must never be the reason the panel cannot report a broken section.
      }
      const message = error instanceof Error ? error.message : String(error);
      return section(entry, [
        dataRow(
          "This section could not be drawn",
          `${t("The rest of the panel still works. Reported to diagnostics.")} ${message}`
        )
      ]);
    }
  };

  const buildContent = (registry: PanelSection[]): HTMLElement => {
    const content = el("div", "av-content");
    // Trimmed, because `searchResults` matches on the trimmed needle: a query of only spaces
    // passed this gate with an empty needle, `includes("")` matched every row, and all fourteen
    // sections were built at once -- per keystroke, and with the rail's aria-current cleared.
    if (searchQuery.trim().length > 0) {
      content.append(...searchResults(registry));
      return content;
    }
    const entry = registry.find((candidate) => candidate.id === activeSectionId) ?? registry[0]!;
    content.append(buildSection(entry));
    return content;
  };

  /**
   * Case and accents folded away, so a query typed the way people actually type finds the row.
   *
   * Matching is over the *translated* row text, which is the right call and is not changing here:
   * a reader searches for what they can see. But without folding, `es` needed `tema` to find a row
   * labelled "Tema" and `busqueda` found nothing at all against "Búsqueda" -- and typing accents is
   * exactly what a search box is used to avoid.
   */
  const foldForSearch = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");

  /**
   * Matching happens on the rendered row text rather than a separate keyword table, so a row
   * added later is searchable the moment it exists and a label edit cannot desynchronise from
   * its search terms. Sections are built once each here, which is the one render where paying
   * for the whole panel is the point.
   */
  const searchResults = (registry: PanelSection[]): HTMLElement[] => {
    const needle = foldForSearch(searchQuery);
    const out: HTMLElement[] = [];
    let matches = 0;

    for (const entry of registry) {
      let rows: HTMLElement[];
      try {
        rows = entry.build();
      } catch {
        // Reported when the section is opened; a search must not be the thing that surfaces it,
        // and must not stop at the first section that cannot be built.
        continue;
      }
      const hits = rows.filter((row) => foldForSearch(row.textContent ?? "").includes(needle));
      if (hits.length === 0) {
        continue;
      }
      matches += hits.length;
      out.push(section(entry, hits));
    }

    if (matches === 0) {
      const empty = el("div", "av-empty");
      empty.append(
        el("p", "av-empty-title", t("Nothing matches that search.")),
        el("p", "av-empty-hint", t("Try a shorter word, or pick a section on the left."))
      );
      return [empty];
    }
    return out;
  };











  const save = async (message: string): Promise<void> => {
    if (stagingDepth > 0 || transactionSaving) {
      lastDraftMessage = message;
      return;
    }
    setStatus("Saving...");
    try {
      await options.onChange();
      render();
      setStatus(message);
    } catch (error) {
      try {
        options.onError("Control Center could not save settings", error);
      } catch {
        // Keep the action recoverable even if diagnostics are unavailable.
      }
      setStatus("Could not save settings. Try again.");
    }
  };

  const focusChangedRow = (label: string | null): void => {
    if (!label) return;
    const row = Array.from(body.querySelectorAll<HTMLElement>(".av-row")).find(
      (candidate) => candidate.dataset.avLabel === label
    );
    row?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus({ preventScroll: true });
  };

  const commitDraft = async (): Promise<void> => {
    if (!transactionDirty() || transactionSaving) return;

    const controls = [...dirtyControls].filter((control) => control.isConnected);
    if (controls.length === 0) {
      // Every dirty control was detached and could not be recovered. Committing here would write
      // an unchanged draft and report "Saved locally" over an edit that no longer exists, which is
      // the one outcome worse than losing it.
      dirtyControls.clear();
      setStatus("That change could not be saved. Make it again and save.");
      return;
    }
    const invalid = controls.find((control) => !control.checkValidity());
    if (invalid) {
      setStatus("Fix invalid values before saving.");
      invalid.focus({ preventScroll: true });
      invalid.reportValidity();
      return;
    }

    const liveBefore = cloneSettings(options.settings);
    const focusLabel = lastChangedLabel;
    const rollbacks: DraftRollback[] = [];
    transactionSaving = true;
    setStatus("Saving...");

    try {
      for (const control of controls) {
        const entry = draftCommits.get(control);
        if (!entry) continue;
        const rollback = await entry.commit();
        if (typeof rollback === "function") rollbacks.push(rollback);
      }

      replaceSettings(options.settings, draftSettings);
      await options.onChange();

      dirtyControls.clear();
      draftCommits.clear();
      transactionSaving = false;
      replaceSettings(draftSettings, options.settings);
      render();
      setStatus(lastDraftMessage);
      focusChangedRow(focusLabel);
      lastChangedLabel = null;
      lastDraftMessage = "Saved locally";
    } catch (error) {
      replaceSettings(options.settings, liveBefore);
      for (const rollback of rollbacks.reverse()) {
        try {
          await rollback();
        } catch (rollbackError) {
          try {
            options.onError("Control Center could not roll back a failed page save", rollbackError);
          } catch {
            // Keep the original save failure visible even if diagnostic reporting also fails.
          }
        }
      }
      transactionSaving = false;
      try {
        options.onError("Control Center could not save settings", error);
      } catch {
        // The retry controls must recover even when diagnostic reporting is unavailable.
      }
      setStatus("Could not save settings. Try again.");
      focusChangedRow(focusLabel);
    }
  };

  const revertDraft = (): void => {
    if (!transactionDirty() || transactionSaving) return;
    const focusLabel = lastChangedLabel;
    replaceSettings(draftSettings, options.settings);
    dirtyControls.clear();
    draftCommits.clear();
    lastChangedLabel = null;
    lastDraftMessage = "Saved locally";
    render();
    setStatus("Saved locally");
    focusChangedRow(focusLabel);
  };

  saveDraftButton.addEventListener("click", () => {
    void commitDraft();
  });
  revertDraftButton.addEventListener("click", revertDraft);

  const coverageRow = (): HTMLElement => {
    const row = dataRow("Panel language", "");
    row.classList.add(COVERAGE_ROW_CLASS);
    return row;
  };

  const coverageSummary = (): string => {
    const label =
      options.listLocales?.().find((entry) => entry.code === panelLocale)?.label ?? panelLocale;
    if (renderedStrings === 0) {
      return label;
    }
    const percent = Math.round((translatedStrings / renderedStrings) * 100);
    if (translatedStrings === renderedStrings) {
      return `${label}: every panel string translated (${renderedStrings}).`;
    }
    return `${label}: ${translatedStrings} of ${renderedStrings} panel strings translated (${percent}%). The rest fall back to English.`;
  };

  /**
   * A full storage backend used to degrade to "changes quietly stop sticking", which reads as a
   * bug rather than a full disk. The stores now report failed writes to diagnostics; this row
   * is where that becomes visible without asking the user to copy a diagnostics blob.
   */
  const storageHealthRow = (): HTMLElement => {
    const failures = options
      .diagnostics()
      .filter((event) => event.level === "error" && event.message.includes("failed to save"));
    if (failures.length === 0) {
      return readonlyRow("Saving", "Working. Every change has been written.");
    }
    const last = failures[failures.length - 1]?.message ?? "";
    return dataRow(
      "Saving",
      `${t("Some changes could not be saved. The browser store may be full.")} ${last} (${failures.length})`
    );
  };

  const storageStatusRow = (): HTMLElement => {
    const status = options.getStorageStatus?.();
    if (!status) {
      return readonlyRow("Storage", "Settings stay in this browser.");
    }
    const backend =
      status.backend === "indexeddb"
        ? "IndexedDB"
        : status.backend === "indexeddb-fallback"
          ? "IndexedDB fallback"
          : status.backend === "userscript-manager"
            ? "Userscript manager"
          : "Browser storage";
    const usage = status.usageBytes === null ? "usage unavailable" : `${formatBytes(status.usageBytes)} used`;
    const quota = status.quotaBytes === null ? "quota unavailable" : `${formatBytes(status.quotaBytes)} available`;
    const error = status.lastError ? ` · ${status.lastError}` : "";
    // A fallback session's writes live only in the legacy store until the next healthy boot
    // folds them in. Saying so is the difference between "storage looks odd" and knowing
    // that this session's changes are waiting on a reload.
    const pending =
      status.pendingWrites > 0
        ? ` · ${status.pendingWrites} change${status.pendingWrites === 1 ? "" : "s"} waiting for the next reload`
        : "";
    // Usage and quota alone answered "how much have I stored" while leaving out "and can the
    // browser delete it". Best-effort is the default state, so the sentence has to be plain
    // rather than a status word nobody outside the spec knows the consequence of.
    const persistence =
      status.persistence === "persisted"
        ? t("Kept: the browser will not clear this library to reclaim space.")
        : status.persistence === "best-effort"
          ? t("Best effort: the browser may clear this library when disk space runs low. Keep a backup.")
          : t("The browser did not say whether it will keep this library. Keep a backup.");
    return dataRow(
      "Storage",
      `${backend} · schema v${status.schemaVersion} · ${usage} · ${quota} · ${status.migratedKeys} stores migrated${pending}${error} · ${persistence}`
    );
  };

  /**
   * The honest readout for the page-world hooks.
   *
   * Two things can go wrong that a toggle alone would hide: the browser or userscript manager may
   * not give Aviary the page's own network layer at all, and the hook may be live but idle. The
   * first is reported as a failure with its reason, the second as a plain count.
   */
  const beaconRows = (): HTMLElement[] => {
    if (!options.getPageHooks) {
      return [];
    }
    const hooks = options.getPageHooks();
    const rows = [
      dataRow(
        "Page access",
        hooks.reachable ? t("Connected to the page") : pageScopeReason(hooks.reason)
      )
    ];
    if (hooks.reachable && options.settings.privacy.blockAnalyticsBeacons) {
      rows.push(dataRow("Beacons refused", String(hooks.blockedBeacons)));
    }
    if (options.settings.privacy.blockAds) {
      const prerolls =
        hooks.suppressedVideoAds > 0 ? ` · ${hooks.suppressedVideoAds} pre-rolls suppressed` : "";
      rows.push(
        dataRow(
          "Ad protection",
          `${hooks.hiddenPlacements} placements removed · ${hooks.blockedAdRequests} logging calls refused${prerolls}`
        )
      );
    }
    return rows;
  };

  /**
   * Turns the bridge's reason code into a sentence.
   *
   * The bridge reports a code rather than prose because it lives in the platform layer, which has
   * no locale — a sentence built there would render in English in every translated build.
   */
  const pageScopeReason = (code: string): string => {
    if (code === "no-page-scope") {
      return t("This userscript manager does not give Aviary access to the page itself.");
    }
    if (code === "agent-absent") {
      return t("This browser did not load Aviary's page script.");
    }
    if (code === "agent-taken") {
      return t(
        "Aviary's page script is loaded, but something else answered it first, most likely another extension. Network-level ad protection is not under Aviary's control on this page."
      );
    }
    return t("Unavailable in this browser.");
  };

  const selectorSummary = (): string => {
    const last = [...options.diagnostics()].reverse().find((event) => event.message.includes("Selector"));
    // Translated like every other sentence the panel shows. A diagnostics message that has one
    // is passed through as it came; this fallback is authored copy and was leaking English.
    return last?.message ?? t("Monitoring active");
  };

  const selectorHealthRows = (): HTMLElement[] => {
    const health = options.getSelectorHealth?.();
    if (!health) {
      return [dataRow("Selector health", selectorSummary())];
    }
    if (!health.enabled) {
      return [dataRow("Selector health", "Disabled")];
    }
    if (health.required === 0) {
      return [dataRow("Selector health", selectorSummary())];
    }

    // These labels are conditional on the structured callback, so register them for the catalog
    // even in the extractor's capability-minimal render.
    t("Selector matches");
    t("Missing required surfaces");
    t("Optional surfaces missing");
    t("Fallback selectors in use");
    t("Affected features");
    t("Last selector transition");
    t("Ad observations");
    t("Ad marker counts");
    t("Ad contract drift");
    t("Retained ad observations");
    t("Native");
    t("Trend");
    t("House promo");
    t("Video");

    const rows = [
      dataRow(
        "Selector health",
        `${health.state === "healthy" ? "Healthy" : "Degraded"} · ${health.route} · ${health.requiredMatched}/${health.required} required · ${health.optionalMatched}/${health.optional} optional`
      ),
      dataRow(
        "Selector matches",
        health.surfaces
          .filter((surface) => surface.relevance !== "inapplicable")
          .map((surface) => `${surface.surface}: ${surface.matched}`)
          .join(" · ")
      ),
      dataRow(
        "Missing required surfaces",
        health.missingRequired.length > 0 ? health.missingRequired.join(", ") : "None"
      )
    ];
    if (health.optionalMissing.length > 0) {
      rows.push(dataRow("Optional surfaces missing", health.optionalMissing.join(", ")));
    }
    if (health.fallbackMatches.length > 0) {
      rows.push(
        dataRow(
          "Fallback selectors in use",
          health.fallbackMatches.map((entry) => `${entry.surface}: ${entry.selector}`).join(" · ")
        )
      );
    }
    if (health.affectedFeatures.length > 0) {
      rows.push(dataRow("Affected features", health.affectedFeatures.join(", ")));
    }
    if (health.lastTransition) {
      rows.push(
        dataRow(
          "Last selector transition",
          `${health.lastTransition.to} · ${health.lastTransition.route} · ${health.lastTransition.at}`
        )
      );
    }
    const ads = health.adObservations;
    rows.push(
      dataRow(
        "Ad observations",
        ads.lastObservedAt && ads.lastRoute
          ? `${ads.lastRoute} · ${ads.lastObservedAt}`
          : "None"
      ),
      dataRow(
        "Ad marker counts",
        `${t("Native")} ${ads.counts.native} · ${t("Trend")} ${ads.counts.trend} · ${t("House promo")} ${ads.counts.housePromo} · ${t("Video")} ${ads.counts.video}`
      ),
      dataRow("Retained ad observations", String(ads.retained))
    );
    if (ads.missingContracts.length > 0) {
      const labels = {
        native: t("Native"),
        trend: t("Trend"),
        housePromo: t("House promo"),
        video: t("Video")
      };
      rows.push(
        dataRow(
          "Ad contract drift",
          localizedCopy("Formerly observed markers are no longer detected: {markers}.", {
            markers: ads.missingContracts.map((kind) => labels[kind]).join(", ")
          })
        )
      );
    }
    return rows;
  };

  launcher.addEventListener("click", () => setOpen(!open));
  navLauncher.addEventListener("click", () => setOpen(!open));
  close.addEventListener("click", () => setOpen(false));
  // `input` covers typing and the native clear affordance alike. The field is outside `body`,
  // so the re-render below cannot steal the caret back.
  search.addEventListener("input", () => {
    if (holdDirtyDraft()) {
      search.value = searchQuery;
      return;
    }
    searchQuery = search.value;
    render();
  });
  render();
  updateTransactionButtons();

  return {
    destroy() {
      if (open) setOpen(false);
      if (focusTrapAttached) {
        document.removeEventListener("focusin", handleModalFocusIn, true);
        focusTrapAttached = false;
      }
      destroyLauncherMount();
      host.remove();
    },
    refresh() {
      reconcileLauncherMount();
      if (!open || isBusy()) {
        dirtyWhileBusy = true;
        return;
      }
      render();
    }
  };
}

/**
 * Aviary themes own a dark canvas. With the theme turned off, the panel follows X's actual
 * reading surface so opening settings never drops a dark modal onto a light timeline.
 */
function controlCenterColorMode(settings: AviarySettings): "dark" | "light" {
  if (settings.appearance.theme !== "off") return "dark";

  for (const node of [
    document.querySelector<HTMLElement>('[data-testid="primaryColumn"]'),
    document.body,
    document.documentElement
  ]) {
    if (!node) continue;
    const match = getComputedStyle(node).backgroundColor.match(
      /rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)(?:\D+(\d*(?:\.\d+)?))?\s*\)/i
    );
    if (!match || (match[4] !== undefined && Number(match[4]) === 0)) continue;
    const perceived = Number(match[1]) * 0.299 + Number(match[2]) * 0.587 + Number(match[3]) * 0.114;
    return perceived >= 170 ? "light" : "dark";
  }

  return globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const FOCUSABLE_SELECTOR = "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])";
const COVERAGE_ROW_CLASS = "av-locale-coverage";

function replaceSettings(target: AviarySettings, source: AviarySettings): void {
  Object.assign(target, cloneSettings(source));
}

/**
 * Only one panel is mounted at a time, so the active locale can live at module scope. Every
 * row helper below runs its user-visible copy through `t()`, which means a new row is
 * localized the moment it is added — there is no second place to remember to update.
 */
let panelLocale = "en";

/**
 * Coverage is measured from the render that just happened, not from a hand-kept list — a row
 * added tomorrow is counted the moment it is drawn, so the Trust readout cannot drift into
 * claiming a locale is more complete than it is.
 */
const seenStrings = new Set<string>();
let renderedStrings = 0;
let translatedStrings = 0;

function resetCoverageTally(): void {
  seenStrings.clear();
  renderedStrings = 0;
  translatedStrings = 0;
}

/**
 * Every English string the last render passed through `t()`. This is the ground truth the
 * checked-in `PANEL_STRINGS` manifest is generated from, and what the drift check compares
 * against — a row added without a catalog entry shows up here immediately.
 */
export function renderedPanelStrings(): string[] {
  return [...seenStrings];
}

function t(text: string): string {
  if (text.length > 0 && !seenStrings.has(text)) {
    seenStrings.add(text);
    renderedStrings += 1;
    if (hasTranslation(panelLocale, text)) {
      translatedStrings += 1;
    }
  }
  return translateText(panelLocale, text);
}

function formatCopy(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function localizedCopy(source: string, values: Record<string, string | number>): string {
  return formatCopy(t(source), values);
}

interface CapturedSelection {
  start: number | null;
  end: number | null;
}

/** Text fields keep their caret across a rebuild; everything else only needs focus back. */
function captureSelection(node: Element | null): CapturedSelection | null {
  if (!isTextField(node)) {
    return null;
  }
  return { start: node.selectionStart, end: node.selectionEnd };
}

function restoreSelection(node: Element, selection: CapturedSelection | null): void {
  if (!selection || !isTextField(node) || selection.start === null || selection.end === null) {
    return;
  }
  try {
    node.setSelectionRange(selection.start, selection.end);
  } catch {
    // Input types such as email/number reject setSelectionRange; focus alone is enough.
  }
}

function isTextField(node: Element | null): node is HTMLInputElement | HTMLTextAreaElement {
  if (node instanceof HTMLTextAreaElement) {
    return true;
  }
  return node instanceof HTMLInputElement && node.type !== "checkbox" && node.type !== "radio";
}

/** Fallback identity for controls that sit outside a labelled row. */
function positionalPath(root: Element, node: Element): string {
  const steps: number[] = [];
  let current: Element | null = node;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    steps.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return steps.join(".");
}

function prefersReducedMotion(settings: AviarySettings): boolean {
  if (settings.accessibility.reduceMotion === "always") return true;
  if (settings.accessibility.reduceMotion === "never") return false;
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function section(entry: PanelSection, rows: HTMLElement[]): HTMLElement {
  const node = el("section", "av-section");
  node.dataset.avSection = entry.id;
  node.style.setProperty("--av-page-accent", entry.accent);

  const heading = el("div", "av-page-header");
  const headingCopy = el("div", "av-page-heading-copy");
  headingCopy.append(
    el("p", "av-page-kicker", t(entry.group)),
    el("h3", "av-section-title", t(entry.title)),
    el("p", "av-page-summary", t(entry.summary))
  );
  heading.append(sectionIcon(entry.icon), headingCopy);

  const grid = el("div", "av-page-grid");
  const breaks = new Map(
    (SECTION_GROUP_BREAKS[entry.id] ?? []).map((group) => [group.before, group.title])
  );
  for (const row of rows) {
    const groupTitle = row.dataset.avLabel ? breaks.get(row.dataset.avLabel) : undefined;
    if (groupTitle) {
      grid.append(el("h4", "av-group-title", t(groupTitle)));
    }
    grid.append(row);
  }
  node.append(heading, grid);
  return node;
}

function searchIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("av-search-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "11");
  circle.setAttribute("cy", "11");
  circle.setAttribute("r", "6");
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "path");
  handle.setAttribute("d", "m16 16 4 4");
  svg.append(circle, handle);
  return svg;
}

function navLauncherIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("av-nav-launcher-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M21 4h-7M10 4H3M14 2v4M21 12h-9M8 12H3M8 10v4M21 20h-5M12 20H3M16 18v4"
  );
  svg.append(path);
  return svg;
}

function sectionIcon(icon: SectionIcon): SVGSVGElement {
  const paths: Record<SectionIcon, string[]> = {
    presets: ["M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"],
    appearance: ["M12 3a9 9 0 1 0 0 18V3Z"],
    layout: ["M4 4h16v16H4zM4 9h16M9 9v11"],
    filtering: ["M4 5h16l-6 7v5l-4 2v-7L4 5Z"],
    catchup: ["M4 5h16v14H4z", "M8 9h8M8 13h5"],
    hidden: ["M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z", "M4 4l16 16"],
    performance: ["M4 17a8 8 0 0 1 16 0", "M12 17l4-6"],
    media: ["M4 5h16v14H4z", "M7 16l3-4 3 3 2-2 3 3", "M9 9h.01"],
    export: ["M12 3v12", "M7 10l5 5 5-5", "M5 21h14"],
    library: ["M5 4h14v16H5z", "M8 8h8M8 12h8M8 16h5"],
    snapshots: ["M12 7v5l3 2", "M4.9 4.9A10 10 0 1 1 2 12", "M2 5v7h7"],
    integrations: ["M8 3v4M16 3v4", "M6 7h12v5a6 6 0 0 1-12 0V7Z", "M12 18v3"],
    backup: ["M4 4v5h5", "M4.8 8.8A8 8 0 1 1 6.3 17.7", "M12 8v5l3 2"],
    trust: ["M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z", "M9 12l2 2 4-4"]
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("av-page-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const data of paths[icon]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}

function presetIcon(id: string): SVGSVGElement {
  const paths: Record<string, string[]> = {
    "quiet-reader": ["M4 5.5c2.8-.8 5.5-.3 8 1.5v13c-2.5-1.8-5.2-2.3-8-1.5v-13Z", "M20 5.5c-2.8-.8-5.5-.3-8 1.5v13c2.5-1.8 5.2-2.3 8-1.5v-13Z"],
    "media-archivist": ["M3 7h7l2 2h9l-2 10H5L3 7Z", "M5 7l1-3h5l2 3"],
    creator: ["M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z", "M13.5 7.5l3 3"],
    researcher: ["M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z", "M16 16l5 5"],
    classic: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"],
    minimal: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8 12h8"]
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("av-preset-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const data of paths[id] ?? paths["quiet-reader"]!) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}

function toggleRow(
  label: string,
  description: string,
  checked: boolean,
  onChange: (checked: boolean) => Promise<void>,
  drafts?: DraftHooks,
  mode: RowCommitMode = "page"
): HTMLElement {
  const row = el("label", "av-row");
  row.dataset.avLabel = label;
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => {
    if (mode === "page" && drafts) {
      drafts.update(input, label, input.checked !== checked);
      drafts.stage(() => onChange(input.checked));
    } else {
      if (drafts?.guard()) return;
      void onChange(input.checked);
    }
  });

  const toggleControl = el("span", "av-toggle-control");
  const toggle = el("span", "av-toggle");
  toggle.setAttribute("aria-hidden", "true");
  toggleControl.append(input, toggle);
  row.append(copy, toggleControl);
  return row;
}

function selectRow(
  label: string,
  value: string,
  options: Array<[string, string]>,
  onChange: (value: string) => Promise<void>,
  description?: string,
  /**
   * Set false when the option labels are already in their own language — the locale picker
   * lists endonyms (Español, 日本語), which must never be translated and must never count
   * against a locale's coverage.
   */
  translateOptions = true,
  drafts?: DraftHooks,
  mode: RowCommitMode = "page"
): HTMLElement {
  const row = el("label", "av-row");
  row.dataset.avLabel = label;
  if (description) {
    const copy = el("span", "av-row-copy");
    copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
    row.append(copy);
  } else {
    row.append(el("span", "av-row-label", t(label)));
  }

  const select = document.createElement("select");
  select.className = "av-select";
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = translateOptions ? t(optionLabel) : optionLabel;
    option.selected = optionValue === value;
    select.append(option);
  }
  select.addEventListener("change", () => {
    if (mode === "page" && drafts) {
      drafts.update(select, label, select.value !== value);
      drafts.stage(() => onChange(select.value));
    } else {
      if (drafts?.guard()) {
        select.value = value;
        return;
      }
      void onChange(select.value);
    }
  });

  row.append(select);
  return row;
}

function readonlyRow(label: string, value: string): HTMLElement {
  const row = el("div", "av-row av-row-readonly");
  row.dataset.avLabel = label;
  row.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(value)));
  return row;
}

/**
 * A readonly row whose value is runtime data — counts, timestamps, endpoint summaries — rather
 * than copy. The label is translated and the value is left alone. Sending data through `t()`
 * would put strings no catalog can ever contain into the coverage tally, which would then
 * under-report a fully translated locale forever.
 */
function dataRow(label: string, value: string): HTMLElement {
  const row = el("div", "av-row av-row-readonly");
  row.dataset.avLabel = label;
  row.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", value));
  return row;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function defaultAiEndpoint(provider: string): string {
  return provider === "anthropic"
    ? "https://api.anthropic.com/v1/messages"
    : "https://api.openai.com/v1/chat/completions";
}

function textInputRow(
  label: string,
  description: string,
  value: string,
  onChange: (value: string) => DraftCommit,
  drafts?: DraftHooks,
  mode: RowCommitMode = "page",
  actionLabel = "Apply"
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
  row.dataset.avLabel = label;
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "av-text-input";
  input.value = value;
  input.spellcheck = false;
  input.setAttribute("aria-label", t(label));
  if (mode === "page" && drafts) {
    drafts.register(input, label, () => onChange(input.value.trim()));
    input.addEventListener("input", () => drafts.update(input, label, input.value !== value));
    row.append(input);
  } else {
    const apply = el("button", "av-button av-button-secondary", t(actionLabel)) as HTMLButtonElement;
    apply.type = "button";
    apply.addEventListener("click", () => {
      if (drafts?.guard()) return;
      void onChange(input.value.trim());
    });
    row.append(input, apply);
  }
  return row;
}

/**
 * Credentials get a masked field: the panel opens over a page the user may well be
 * screen-sharing, and these values are API keys and app passwords. Reveal is explicit.
 */
function secretInputRow(
  label: string,
  description: string,
  value: string,
  onChange: (value: string) => DraftCommit,
  drafts?: DraftHooks,
  mode: RowCommitMode = "page"
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
  row.dataset.avLabel = label;
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const input = document.createElement("input");
  input.type = "password";
  input.className = "av-text-input";
  input.value = value;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", t(label));
  if (mode === "page" && drafts) {
    drafts.register(input, label, () => onChange(input.value.trim()));
    input.addEventListener("input", () => drafts.update(input, label, input.value !== value));
  }

  const controls = el("div", "av-inline-controls");

  const reveal = el("button", "av-button av-button-secondary", t("Show")) as HTMLButtonElement;
  reveal.type = "button";
  reveal.setAttribute("aria-label", `${t("Show")} ${t(label)}`);
  reveal.setAttribute("aria-pressed", "false");
  reveal.addEventListener("click", () => {
    const masked = input.type === "password";
    input.type = masked ? "text" : "password";
    reveal.textContent = masked ? t("Hide") : t("Show");
    reveal.setAttribute("aria-pressed", String(masked));
    reveal.setAttribute("aria-label", `${masked ? t("Hide") : t("Show")} ${t(label)}`);
  });

  controls.append(reveal);
  if (mode === "action") {
    const apply = el("button", "av-button av-button-secondary", t("Apply")) as HTMLButtonElement;
    apply.type = "button";
    apply.addEventListener("click", () => {
      if (drafts?.guard()) return;
      void onChange(input.value.trim());
    });
    controls.append(apply);
  }
  row.append(input, controls);
  return row;
}

function integerInputRow(
  label: string,
  description: string,
  value: number,
  onChange: (value: number) => DraftCommit,
  bounds: { min?: number; max?: number } = {},
  drafts?: DraftHooks,
  mode: RowCommitMode = "page",
  actionLabel = "Apply"
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
  row.dataset.avLabel = label;
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const input = document.createElement("input");
  input.type = "number";
  input.min = String(bounds.min ?? 0);
  if (bounds.max !== undefined) {
    input.max = String(bounds.max);
  }
  input.step = "1";
  input.className = "av-text-input";
  input.value = String(value);
  input.setAttribute("aria-label", t(label));
  const commit = (): DraftCommit => {
    const parsed = Number.parseInt(input.value, 10);
    return onChange(Number.isFinite(parsed) ? parsed : 0);
  };
  if (mode === "page" && drafts) {
    drafts.register(input, label, commit);
    input.addEventListener("input", () => drafts.update(input, label, input.value !== String(value)));
    row.append(input);
  } else {
    const apply = el("button", "av-button av-button-secondary", t(actionLabel)) as HTMLButtonElement;
    apply.type = "button";
    apply.addEventListener("click", () => {
      if (drafts?.guard()) return;
      void commit();
    });
    row.append(input, apply);
  }
  return row;
}

function buildActionRow(
  label: string,
  description: LocalizedCopy,
  onClick: () => Promise<void>,
  onReject?: (error: unknown) => void,
  onStart?: (button: HTMLButtonElement) => void,
  onFinish?: (button: HTMLButtonElement) => void
): HTMLElement {
  const row = el("div", "av-row");
  row.dataset.avLabel = label;
  const copy = el("span", "av-row-copy");
  copy.append(
    el("span", "av-row-label", t(label)),
    el(
      "span",
      "av-row-description",
      typeof description === "string" ? t(description) : localizedCopy(description.source, description.values)
    )
  );
  row.append(copy);

  const button = el("button", "av-button av-button-secondary", t(label)) as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => {
    onStart?.(button);
    button.disabled = true;
    void Promise.resolve()
      .then(onClick)
      .catch((error: unknown) => {
        try {
          onReject?.(error);
        } catch {
          // The rejection boundary must remain terminal even if diagnostic UI code fails.
        }
      })
      .finally(() => {
        button.disabled = false;
        onFinish?.(button);
      });
  });
  row.append(button);
  return row;
}

function textareaRow(
  label: string,
  description: string,
  lines: string[],
  onChange: (lines: string[]) => DraftCommit,
  actionLabel = "Save list",
  drafts?: DraftHooks,
  mode: RowCommitMode = "page"
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
  row.dataset.avLabel = label;
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const textarea = document.createElement("textarea");
  textarea.className = "av-textarea";
  textarea.value = lines.join("\n");
  textarea.spellcheck = false;
  textarea.rows = 4;
  textarea.setAttribute("aria-label", t(label));
  const initialValue = lines.join("\n");
  const commit = (): DraftCommit => {
    const next = textarea.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line, index, array) => line.length > 0 && array.indexOf(line) === index);
    return onChange(next);
  };
  if (mode === "page" && drafts) {
    drafts.register(textarea, label, commit);
    textarea.addEventListener("input", () => drafts.update(textarea, label, textarea.value !== initialValue));
    row.append(textarea);
  } else {
    const apply = el("button", "av-button av-button-secondary", t(actionLabel)) as HTMLButtonElement;
    apply.type = "button";
    apply.addEventListener("click", () => {
      if (drafts?.guard()) return;
      void commit();
    });
    row.append(textarea, apply);
  }
  return row;
}

function bookmarkField(label: string, value: string, placeholder: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "av-text-input av-bookmark-field";
  input.value = value;
  input.placeholder = t(placeholder);
  input.setAttribute("aria-label", t(label));
  input.spellcheck = false;
  return input;
}

function splitBookmarkTags(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function surfaceRow(
  label: string,
  description: string,
  selected: FilterSurface[],
  onChange: (next: FilterSurface[]) => Promise<void>,
  drafts?: DraftHooks
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
  row.dataset.avLabel = label;
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const group = el("div", "av-chip-group");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t(label));

  const state = new Set<FilterSurface>(selected);

  for (const surface of FILTER_SURFACES) {
    const chip = document.createElement("label");
    chip.className = "av-chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.has(surface);
    input.value = surface;
    input.addEventListener("change", () => {
      if (input.checked) {
        state.add(surface);
      } else {
        state.delete(surface);
      }
      drafts?.update(input, label, input.checked !== selected.includes(surface));
      if (drafts) {
        drafts.stage(() => onChange(FILTER_SURFACES.filter((value) => state.has(value))));
      } else {
        void onChange(FILTER_SURFACES.filter((value) => state.has(value)));
      }
    });
    const text = el("span", "av-chip-label", t(FILTER_SURFACE_LABELS[surface]));
    chip.append(input, text);
    group.append(chip);
  }

  row.append(group);
  return row;
}

function coerceReduceMotion(value: string): ReduceMotionMode {
  return value === "always" || value === "never" ? value : "system";
}

function coerceFilterAction(value: string): FilterAction {
  return value === "hide" || value === "dim" ? value : "off";
}

function coerceLayout(value: string): MediaLayout {
  return value === "stacked" || value === "grid" ? value : "default";
}

function button(label: string, className: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.className = className;
  node.textContent = t(label);
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

const NAV_LAUNCHER_CSS = `
:host {
  display: block;
  width: 100%;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  font-style: inherit;
  font-weight: inherit;
  line-height: inherit;
}

.av-nav-launcher {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 58px;
  margin: 0;
  padding: 4px 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  font-style: inherit;
  font-weight: inherit;
  line-height: inherit;
  text-align: start;
}

.av-nav-launcher-pill {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-width: 50px;
  min-height: 50px;
  padding: 12px;
  border-radius: 9px;
  transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
}

.av-nav-launcher-icon {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.av-nav-launcher-label {
  margin-inline: 20px 16px;
  overflow: hidden;
  font-size: 20px;
  font-weight: 400;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.av-nav-launcher:hover .av-nav-launcher-pill {
  background-color: color-mix(in srgb, currentColor 10%, transparent);
}

.av-nav-launcher[aria-expanded="true"] .av-nav-launcher-pill {
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 13%, transparent);
  color: var(--av-text, currentColor);
}

.av-nav-launcher:focus-visible {
  outline: none;
}

.av-nav-launcher:focus-visible .av-nav-launcher-pill {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 2px;
}

:host([data-av-compact="true"]) .av-nav-launcher {
  justify-content: center;
}

:host([data-av-compact="true"]) .av-nav-launcher-pill {
  width: 50px;
  justify-content: center;
}

:host([data-av-compact="true"]) .av-nav-launcher-label {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .av-nav-launcher-pill {
    transition: none;
  }
}

:host([data-av-motion="reduce"]) .av-nav-launcher-pill {
  transition: none;
}
`;

const CONTROL_CENTER_CSS = `
:host {
  direction: ltr;
  --av-bg: rgb(5, 9, 13);
  --av-surface: rgb(10, 16, 22);
  --av-surface-raised: rgb(17, 25, 33);
  --av-border: rgb(43, 56, 67);
  --av-text: rgb(243, 247, 249);
  --av-muted: rgb(163, 175, 185);
  --av-accent: rgb(77, 211, 208);
  --av-danger: rgb(255, 130, 140);
  --av-warn: rgb(248, 190, 100);
  --av-ok: rgb(92, 219, 168);
  color-scheme: dark;
  font-family: TwitterChirp, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

:host([data-av-color-mode="light"]) {
  --av-bg: rgb(237, 243, 246);
  --av-surface: rgb(250, 252, 253);
  --av-surface-raised: rgb(229, 237, 241);
  --av-border: rgb(194, 207, 214);
  --av-text: rgb(15, 24, 31);
  --av-muted: rgb(78, 94, 105);
  --av-accent: rgb(0, 126, 132);
  --av-danger: rgb(183, 36, 50);
  --av-warn: rgb(139, 91, 0);
  --av-ok: rgb(0, 115, 75);
  color-scheme: light;
}

:host([dir="rtl"]) {
  direction: rtl;
}

.av-shell {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.av-launcher {
  position: fixed;
  inset-inline-end: 18px;
  bottom: 18px;
  min-width: 78px;
  min-height: 42px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 70%, transparent);
  border-radius: 8px;
  /* Opaque, and deliberately so. This was a translucent accent wash over whatever the page had
     behind it, which worked only because Aviary used to force X dark. With the default now
     "leave X alone", the same wash sat on X's light mode at 1.12:1 against its own near-white
     label, invisible. The launcher is Aviary's own chrome and must not depend on the page.
     Measured in tests/injected-ui-contract.test.mjs by compositing on canvas. */
  background: rgb(20, 32, 42);
  color: var(--av-text, rgb(239, 243, 244));
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.42);
  cursor: pointer;
  font-weight: 700;
  font-size: 13px;
  line-height: 1.1;
  font-family: inherit;
  letter-spacing: 0;
  pointer-events: auto;
  transition: transform 140ms ease, border-color 140ms ease;
}

.av-launcher[hidden] {
  display: none !important;
}

.av-launcher:hover {
  transform: translateY(-1px);
  border-color: var(--av-accent, rgb(29, 155, 240));
  background: rgb(24, 42, 54);
}

/* The forced-colors block below already lists .av-nav-item and textarea; leaving them out here
   meant the panel's primary navigation fell back to the UA ring in ordinary rendering while every
   control beside it carried Aviary's. */
.av-launcher:focus-visible,
.av-button:focus-visible,
.av-select:focus-visible,
.av-nav-item:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 3px;
}

.av-overlay {
  display: contents;
}

.av-panel {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(1280px, calc(100vw - 32px));
  height: min(860px, calc(100vh - 32px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--av-border, rgb(43, 56, 67));
  border-radius: 10px;
  background: var(--av-surface, rgb(10, 16, 22));
  box-shadow: 0 28px 88px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
}

/* The UA hides a closed popover with [popover]:not(:popover-open) { display: none }, which is
   UA-origin and therefore loses to the author display: flex above. Without this rule the closed
   panel is laid out and painted full-screen on every page load while inert keeps it dead to
   input -- a settings window that covers X and cannot be dismissed. Authored here so the author
   sheet stops fighting the UA sheet. */
.av-panel:not(:popover-open) {
  display: none;
}

/* The escape hatch for a host with the selector above but no showPopover to satisfy it. The class
   is repeated to carry more weight than the rule it overrides rather than tying with it: this sheet
   lives in a shadow root, so there is no html element here to qualify with, and a tie would be
   settled by source order alone. */
.av-panel.av-popover-unavailable.av-popover-unavailable {
  display: flex;
}

.av-panel::backdrop {
  background: rgba(0, 0, 0, 0.5);
}

/* The panel takes focus when it opens; the UA default paints a hard white halo around the
   whole dialog. Keep the indicator, make it read as a highlighted edge instead. */
.av-panel:focus-visible {
  outline: 2px solid transparent;
  border-color: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 34%, var(--av-border));
}

.av-panel-header {
  display: grid;
  grid-template-columns: 220px minmax(320px, 520px) minmax(80px, 1fr);
  align-items: center;
  gap: 20px;
  height: 56px;
  min-height: 56px;
  padding: 8px 18px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--av-border, rgb(47, 51, 54));
  background: color-mix(in srgb, var(--av-surface, rgb(10, 16, 22)) 94%, var(--av-bg));
}

.av-panel-header > .av-button {
  justify-self: end;
}

.av-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

/* Quiet by default -- it is a build marker, not a heading. Carries the accent so a reload reads
   as a different build at a glance. */
.av-version {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--av-muted, rgb(132, 139, 145));
  font-weight: 600;
  font-size: 12px;
  line-height: 1.4;
  font-family: inherit;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.av-title {
  margin: 0;
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 16px;
  line-height: 1.25;
}

.av-subtitle {
  margin: 2px 0 0;
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 12px;
  line-height: 1.35;
}

.av-button,
.av-select {
  min-height: 34px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 8px;
  background: var(--av-surface-raised, rgb(17, 25, 33));
  color: var(--av-text, rgb(239, 243, 244));
  font-weight: 650;
  font-size: 13px;
  line-height: 1.2;
  font-family: inherit;
}

.av-button {
  padding: 0 12px;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
}

.av-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 54%, transparent);
  background: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 10%, var(--av-surface-raised, rgb(22, 24, 28)));
}

.av-button-primary {
  border-color: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 82%, white 18%);
  background: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 78%, white 8%);
  color: rgb(5, 10, 15);
  box-shadow: none;
}

.av-button-primary:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 68%, white 32%);
  background: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 84%, white 12%);
}

.av-button-primary:disabled {
  border-color: var(--av-border, rgb(47, 51, 54));
  background: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 24%, var(--av-surface-raised, rgb(22, 24, 28)));
  color: var(--av-muted, rgb(132, 139, 145));
  box-shadow: none;
}

.av-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.av-searchbar {
  position: relative;
  min-width: 0;
}

.av-search-icon {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 13px;
  width: 17px;
  height: 17px;
  transform: translateY(-50%);
  fill: none;
  stroke: var(--av-muted, rgb(132, 139, 145));
  stroke-width: 1.8;
  stroke-linecap: round;
  pointer-events: none;
}

.av-search-input {
  width: 100%;
  height: 36px;
  padding-block: 0;
  padding-inline: 40px 14px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--av-surface-raised, rgb(17, 25, 33));
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 13px;
  line-height: 1.4;
  font-family: inherit;
}

.av-search-input::placeholder {
  color: var(--av-muted, rgb(132, 139, 145));
}

.av-search-input:focus-visible {
  border-color: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 70%, transparent);
  outline-color: var(--av-page-accent, rgb(77, 199, 255));
}

/* Two panes: a fixed rail and a scrolling content column. Each scrolls independently, so
   moving through a long section never scrolls the section list out of reach. */
.av-panel-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.av-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 10px;
  overflow-y: auto;
  /* Reserved so the list does not reflow the moment it becomes scrollable. */
  scrollbar-gutter: stable;
  border-inline-end: 1px solid var(--av-border, rgb(47, 51, 54));
  background: color-mix(in srgb, var(--av-surface, rgb(10, 16, 22)) 94%, var(--av-bg));
  /* The rail scrolls at thirteen sections and a short viewport, and nothing said so -- the last
     item rendered cut through its own baseline, which reads as a rendering fault rather than a
     list with more below. The mask only bites where content actually reaches the bottom edge,
     so a rail that fits is untouched. */
  mask-image: none;
}

.av-nav,
.av-content {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--av-muted, rgb(132, 139, 145)) 58%, transparent) transparent;
}

.av-nav::-webkit-scrollbar,
.av-content::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.av-nav::-webkit-scrollbar-thumb,
.av-content::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: color-mix(in srgb, var(--av-muted, rgb(132, 139, 145)) 58%, transparent);
}

.av-nav-group {
  /* The rail is sized so all twelve sections fit without scrolling at the default panel
     height; a sliced-in-half last item reads as a rendering bug rather than as "more below". */
  margin: 11px 0 4px;
  padding: 0 10px;
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 11.5px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.av-nav-group:first-child {
  margin-top: 0;
}

.av-nav-item {
  position: relative;
  min-height: 33px;
  padding-block: 0;
  padding-inline: 18px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: color-mix(in srgb, var(--av-text, rgb(239, 243, 244)) 70%, var(--av-muted, rgb(132, 139, 145)));
  font-weight: 600;
  font-size: 14px;
  line-height: 1.2;
  font-family: inherit;
  text-align: start;
  cursor: pointer;
}

.av-nav-item::before {
  content: "";
  position: absolute;
  inset-block: 8px;
  inset-inline-start: 4px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
}

.av-nav-item:hover {
  background: var(--av-surface-raised, rgb(22, 24, 28));
  color: var(--av-text, rgb(239, 243, 244));
}

.av-nav-item.is-active {
  background: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 10%, var(--av-surface-raised, rgb(22, 24, 28)));
  color: var(--av-text, rgb(239, 243, 244));
}

.av-nav-item.is-active::before {
  background: var(--av-page-accent, rgb(77, 199, 255));
  box-shadow: none;
}

.av-content {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 16px 28px 22px;
  overflow-y: auto;
  min-height: 0;
  scrollbar-gutter: stable;
  background: var(--av-surface, rgb(10, 16, 22));
}

.av-empty {
  display: grid;
  gap: 6px;
  padding: 24px 4px;
}

.av-empty-title {
  margin: 0;
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 14px;
}

.av-empty-hint {
  margin: 0;
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 13px;
  line-height: 1.4;
}

.av-section {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.av-page-header {
  display: flex;
  align-items: center;
  gap: 0;
  min-height: 52px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--av-border, rgb(47, 51, 54));
}

.av-page-icon {
  display: none;
}

.av-page-heading-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.av-page-kicker {
  display: none;
}

.av-section-title {
  margin: 0;
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 24px;
  font-weight: 760;
  line-height: 1.12;
  letter-spacing: -0.025em;
}

.av-page-summary {
  margin: 0;
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 13.5px;
  line-height: 1.4;
  max-width: 760px;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  overflow-wrap: anywhere;
}

.av-page-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 0;
  min-width: 0;
}

.av-section[data-av-section="presets"] .av-page-grid {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.av-section[data-av-section="presets"] .av-page-grid > .av-row:not(.av-preset-card) {
  grid-column: 1 / -1;
  min-height: 52px;
  padding: 8px 12px;
}

.av-section[data-av-section="appearance"] .av-page-grid,
.av-section[data-av-section="hidden"] .av-page-grid,
.av-section[data-av-section="performance"] .av-page-grid {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}

.av-section[data-av-section="media"] .av-page-grid {
  grid-template-columns: minmax(0, 1fr);
}

.av-section[data-av-section="media"] .av-group-title,
.av-section[data-av-section="media"] .av-row[data-av-label="Show download buttons"],
.av-section[data-av-section="media"] .av-row[data-av-label="Prefer original quality"],
.av-section[data-av-section="media"] .av-row[data-av-label="Original quality status"],
.av-section[data-av-section="media"] .av-row[data-av-label="Show images at original quality"],
.av-section[data-av-section="media"] .av-row[data-av-label="Media layout"],
.av-section[data-av-section="media"] .av-row[data-av-label="Filename template"],
.av-section[data-av-section="media"] .av-row[data-av-label="Download all visible media"] {
  grid-column: 1 / -1;
}

.av-section[data-av-section="media"] .av-row[data-av-label="Download all visible media"] > .av-button {
  border-color: transparent;
  background: var(--av-page-accent, rgb(72, 211, 193));
  color: rgb(3, 20, 24);
  font-weight: 780;
}

.av-section[data-av-section="media"] .av-row[data-av-label="Download all visible media"] > .av-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--av-page-accent, rgb(72, 211, 193)) 86%, white);
}

.av-section[data-av-section="media"] .av-row[data-av-label="Concurrent downloads"] {
  display: flex;
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: center;
}

.av-section[data-av-section="media"] .av-row[data-av-label="Concurrent downloads"] > .av-text-input {
  flex: 0 0 64px;
  width: 64px;
}

.av-section[data-av-section="media"] .av-row[data-av-label="Download pacing"] .av-select {
  min-width: 118px;
}

.av-section[data-av-section="media"] .av-row[data-av-label="Duplicate history"] .av-row-description,
.av-section[data-av-section="media"] .av-row[data-av-label="Concurrent downloads"] .av-row-description,
.av-section[data-av-section="media"] .av-row[data-av-label="Download pacing"] .av-row-description {
  -webkit-line-clamp: 2;
}

.av-group-title {
  grid-column: 1 / -1;
  margin: 13px 0 3px;
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 11.5px;
  font-weight: 820;
  line-height: 1.2;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.av-group-title:first-child {
  margin-top: 0;
}

.av-section[data-av-section="presets"] .av-page-grid > .av-row:not(.av-preset-card) .av-row-description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.av-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  min-height: 50px;
  padding: 7px 0;
  box-sizing: border-box;
  /* Rows share one surface. A single divider keeps groups scannable without boxing each item. */
  border: 0;
  border-bottom: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 0;
  background: transparent;
  transition: background 140ms ease, color 140ms ease;
}

.av-row:hover {
  background: color-mix(in srgb, var(--av-surface-raised, rgb(22, 24, 28)) 46%, transparent);
}

.av-page-grid > .av-row + .av-row {
  margin-top: 0;
}

.av-group-title + .av-row,
.av-page-grid > .av-row:first-child {
  border-start-start-radius: 0;
  border-start-end-radius: 0;
}

.av-row:has(+ .av-group-title),
.av-page-grid > .av-row:last-child {
  border-end-start-radius: 0;
  border-end-end-radius: 0;
}

.av-section[data-av-section="appearance"] .av-row,
.av-section[data-av-section="hidden"] .av-row,
.av-section[data-av-section="performance"] .av-row {
  margin-top: 0;
  border-radius: 0;
}

.av-page-grid > .av-row-stack:not(.av-preset-card),
.av-page-grid > .av-row:has(.av-textarea),
.av-page-grid > .av-row:has(.av-text-input),
.av-page-grid > .av-row:has(.av-file-input),
.av-page-grid > .av-row:has(.av-search-results) {
  grid-column: 1 / -1;
}

.av-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
}

.av-row-stack:has(> .av-text-input),
.av-row-stack:has(> .av-textarea),
.av-row-stack:has(> .av-file-input) {
  display: grid;
  grid-template-columns: minmax(210px, 0.75fr) minmax(280px, 1.25fr) auto;
  align-items: center;
  gap: 12px;
}

.av-row-stack:has(> .av-textarea) {
  align-items: start;
}

.av-section[data-av-section="library"] .av-row-stack:has(> .av-library-media-actions) {
  grid-template-columns: minmax(320px, 1fr) auto;
}

.av-section[data-av-section="library"] .av-row-stack:has(> .av-library-media-actions) > .av-row-copy {
  grid-column: 1 / -1;
}

.av-row-stack:has(> .av-textarea) > .av-button {
  margin-top: 2px;
}

.av-rule-set-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.av-rule-set-actions .av-button {
  min-width: 0;
  min-height: 32px;
  padding-inline: 10px;
}

.av-rule-set-preview {
  grid-column: 2 / -1;
  min-height: 18px;
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 12px;
  line-height: 1.35;
}

.av-rule-set-preview[data-av-state="error"] {
  color: var(--av-danger, rgb(244, 33, 46));
}

.av-preservation-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(280px, 1fr) auto;
  align-items: center;
  min-height: 64px;
}

.av-preservation-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}

.av-preservation-actions .av-button {
  min-width: 0;
  min-height: 34px;
  padding-inline: 12px;
}

.av-replay-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  text-decoration: none;
}

.av-preset-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(260px, 1.15fr) minmax(300px, 1fr) auto;
  align-items: center;
  min-height: 68px;
  gap: 16px;
  padding: 10px 8px 10px 16px;
  overflow: hidden;
  border-radius: 0;
}

.av-preset-card::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 3px;
  background: var(--av-card-accent, var(--av-page-accent, rgb(77, 199, 255)));
}

.av-preset-card { --av-card-accent: var(--av-page-accent, rgb(72, 211, 193)); }

.av-preset-card .av-row-label {
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 14px;
}

.av-preset-header {
  display: flex;
  align-items: start;
  gap: 10px;
  min-width: 0;
}

.av-preset-icon {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 2px;
  box-sizing: border-box;
  fill: none;
  stroke: var(--av-card-accent, var(--av-page-accent, rgb(77, 199, 255)));
  stroke-width: 1.65;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.av-preset-card .av-row-description {
  display: block;
  overflow: visible;
}

.av-preset-highlights {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 10px;
  padding: 0;
  border: 0;
}

.av-preset-highlight {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
  line-height: 1.2;
}

.av-preset-highlight-label {
  color: var(--av-muted, rgb(132, 139, 145));
  white-space: normal;
}

.av-preset-highlight-value {
  flex: 0 0 auto;
  color: var(--av-card-accent, var(--av-page-accent, rgb(77, 199, 255)));
  font-weight: 700;
}

.av-row-stack.av-preset-card > .av-button {
  margin-top: 0;
  width: auto;
  min-width: 84px;
  min-height: 34px;
}

/* Text fields and textareas want the full row width; an action button does not. At the old
   386px panel a stretched button looked deliberate. At 780px it reads as a banner. */
.av-row-stack > .av-button {
  align-self: start;
  width: auto;
  min-width: 132px;
}

.av-textarea,
.av-text-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 8px;
  background: var(--av-surface, rgb(15, 20, 25));
  color: var(--av-text, rgb(239, 243, 244));
  font: 12px/1.4 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

.av-textarea {
  min-height: 76px;
  resize: vertical;
}

.av-text-input {
  height: 38px;
}

.av-file-input {
  width: 100%;
  color: var(--av-text, rgb(239, 243, 244));
  font: 12px/1.4 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

.av-search-results {
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}

.av-row-stack > .av-search-results {
  grid-column: 1 / -1;
}

.av-library-media-actions {
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
}

.av-library-media-actions > .av-inline-controls {
  align-items: center;
  white-space: nowrap;
}

.av-library-media-actions .av-library-media-download {
  flex: 0 0 auto;
  min-width: 132px;
}

.av-library-media-count {
  min-width: 54px;
  text-align: end;
  white-space: nowrap;
}

.av-search-hit {
  display: grid;
  gap: 2px;
  padding: 6px 8px;
  border: 0;
  border-inline-start: 2px solid color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 58%, transparent);
  border-radius: 0;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(17, 25, 33)) 66%, transparent);
}

.av-bookmark-editor {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 6px;
}

.av-bookmark-editor .av-bookmark-notes {
  grid-column: 1 / -1;
  min-height: 54px;
}

.av-bookmark-hit > .av-inline-controls {
  margin-top: 2px;
}

.av-textarea:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 2px;
}

.av-chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.av-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--av-surface-raised, rgb(17, 25, 33));
  color: var(--av-text, rgb(239, 243, 244));
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
}

.av-chip input[type="checkbox"] {
  width: 14px;
  height: 14px;
}

.av-chip-label {
  font-weight: 650;
}

.av-row-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.av-inline-controls {
  display: flex;
  gap: 8px;
}

.av-inline-controls .av-button {
  flex: 1 1 auto;
}

.av-row-label {
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 14.5px;
  font-weight: 720;
  line-height: 1.25;
}

.av-row-description {
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 13.5px;
  line-height: 1.4;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--av-page-accent, var(--av-accent, rgb(29, 155, 240)));
}

.av-toggle-control {
  position: relative;
  flex: 0 0 38px;
  width: 38px;
  height: 22px;
}

.av-toggle-control > input[type="checkbox"] {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  appearance: none;
  opacity: 0;
  cursor: pointer;
}

.av-toggle {
  position: absolute;
  inset: 0;
  border: 1px solid color-mix(in srgb, var(--av-border, rgb(47, 51, 54)) 70%, var(--av-text, rgb(239, 243, 244)) 30%);
  border-radius: 6px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 78%, black);
  transition: border-color 140ms ease, background 140ms ease;
}

.av-toggle::before {
  content: "";
  position: absolute;
  inset-block-start: 3px;
  inset-inline-start: 3px;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--av-muted, rgb(132, 139, 145));
  transition: transform 140ms ease, background 140ms ease;
}

.av-toggle-control > input[type="checkbox"]:checked + .av-toggle {
  border-color: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 72%, transparent);
  background: color-mix(in srgb, var(--av-page-accent, rgb(77, 199, 255)) 28%, var(--av-surface, rgb(15, 20, 25)));
}

.av-toggle-control > input[type="checkbox"]:checked + .av-toggle::before {
  background: var(--av-page-accent, rgb(77, 199, 255));
  transform: translateX(16px);
}

:host([dir="rtl"]) .av-toggle-control > input[type="checkbox"]:checked + .av-toggle::before {
  transform: translateX(-16px);
}

.av-toggle-control > input[type="checkbox"]:focus-visible + .av-toggle {
  outline: 2px solid var(--av-page-accent, rgb(77, 199, 255));
  outline-offset: 2px;
}

.av-select {
  max-width: 178px;
  padding: 0 10px;
}

.av-transaction-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 54px;
  padding: 8px 18px;
  border-top: 1px solid var(--av-border, rgb(47, 51, 54));
  background: color-mix(in srgb, var(--av-surface, rgb(10, 16, 22)) 94%, var(--av-bg));
  box-shadow: none;
}

.av-status {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  gap: 8px;
  min-width: 0;
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 13px;
  line-height: 1.3;
}

.av-transaction-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.av-transaction-actions .av-button {
  min-width: 82px;
}

.av-status::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--av-ok, rgb(72, 211, 147));
  box-shadow: none;
}

.av-status[data-state="dirty"] {
  color: var(--av-warn, rgb(247, 183, 73));
}

.av-status[data-state="dirty"]::before {
  background: var(--av-warn, rgb(247, 183, 73));
  box-shadow: none;
}

.av-status[data-state="saving"]::before {
  background: var(--av-page-accent, rgb(77, 199, 255));
  box-shadow: none;
}

.av-status[data-state="error"] {
  color: var(--av-danger, rgb(255, 120, 128));
}

.av-status[data-state="error"]::before {
  background: var(--av-danger, rgb(255, 120, 128));
  box-shadow: none;
}

/* Touch and viewport rules must live in this stylesheet: a sheet in document.head cannot
   reach into the shadow root, so the page-level av-touch / av-mobile classes never styled
   these controls. Media queries evaluate against the viewport and do work here. */
@media (pointer: coarse) {
  .av-row {
    min-height: 56px;
  }

  .av-button,
  .av-select {
    min-height: 44px;
  }

  .av-chip {
    min-height: 44px;
  }

  .av-text-input {
    height: 44px;
  }

  input[type="checkbox"] {
    width: 24px;
    height: 24px;
  }

  .av-chip input[type="checkbox"] {
    width: 18px;
    height: 18px;
  }
}

/*
 * Windows High Contrast and any other forced-colors mode.
 *
 * The UA overrides author colours, drops non-url() background-image to none, and drops box-shadow
 * to none. This panel signalled a great deal through exactly those three, so before this block a
 * forced-colors user got a settings cockpit whose controls were largely indistinguishable from each
 * other -- worst of all the toggle, which carried its entire on/off state in a background colour
 * and a background-coloured ::before knob.
 *
 * The toggle is the important case and the fix is to stop competing with the UA: the real checkbox
 * is normally opacity:0 with appearance:none, so here it is handed back its native rendering and
 * the painted track is hidden. The UA draws a checked box in system colours that are guaranteed to
 * contrast, which no author styling can promise. System colours also follow *native* element
 * semantics rather than ARIA roles, so a styled span could never have earned ButtonText here.
 *
 * Everywhere else, borders replace the shadows and tints that carried structure.
 */
@media (forced-colors: active) {
  .av-toggle-control > input[type="checkbox"] {
    opacity: 1;
    appearance: auto;
    inset: auto;
    width: auto;
    height: auto;
    position: static;
  }

  .av-toggle {
    display: none;
  }

  .av-toggle-control {
    flex-basis: auto;
    width: auto;
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }

  /* Structure that was carried by elevation or tint needs an explicit edge. */
  .av-panel,
  .av-row,
  .av-button,
  .av-select,
  .av-preset-card,
  .av-transaction-bar,
  .av-nav-launcher-pill,
  input,
  textarea {
    border: 1px solid ButtonBorder;
  }

  .av-panel,
  .av-row,
  .av-preset-card {
    background: Canvas;
    color: CanvasText;
  }

  .av-button {
    background: ButtonFace;
    color: ButtonText;
  }

  /* A selected destination was distinguished only by its background tint. */
  .av-nav-item[aria-current="page"],
  .av-nav-item.is-active {
    background: Highlight;
    color: HighlightText;
    forced-color-adjust: none;
  }

  /* The focus ring must not be the same colour as an ordinary border. */
  .av-launcher:focus-visible,
  .av-button:focus-visible,
  .av-select:focus-visible,
  .av-nav-item:focus-visible,
  input:focus-visible,
  textarea:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }

  /* Status tone was colour-only; keep the text and let the UA colour it. */
  .av-status {
    border: 1px solid ButtonBorder;
  }

  /*
   * Keep the commit bar edge explicit when the UA replaces the authored surface colours.
   */
  .av-transaction-bar {
    background: Canvas;
    color: CanvasText;
  }
}

@media (max-width: 1100px) {
  .av-panel {
    width: min(960px, calc(100vw - 32px));
  }

  .av-panel-body {
    grid-template-columns: 190px minmax(0, 1fr);
  }

  .av-content {
    padding-inline: 20px;
  }

  .av-preset-card {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .av-preset-highlights {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .av-section[data-av-section="media"] .av-page-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .av-launcher {
    inset-inline-end: 12px;
    bottom: 12px;
    min-width: 92px;
    min-height: 48px;
  }

  .av-panel {
    width: min(420px, calc(100vw - 16px));
    height: min(86vh, calc(100vh - 60px));
  }

  .av-panel-header {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px 12px;
    height: auto;
    min-height: 0;
    padding: 12px;
  }

  .av-searchbar {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .av-subtitle {
    display: none;
  }

  /* No room for a side rail. It becomes a horizontal strip of chips above the content, which
     keeps every section one tap away instead of hiding them behind a menu. */
  .av-panel-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .av-nav {
    flex-direction: row;
    gap: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    overflow-y: hidden;
    border-inline-end: 0;
    border-bottom: 1px solid var(--av-border, rgb(47, 51, 54));
    mask-image: none;
    scrollbar-width: none;
  }

  .av-nav::-webkit-scrollbar {
    display: none;
  }

  .av-nav-item {
    flex: 0 0 auto;
    min-height: 44px;
  }

  /* The group headings only make sense stacked; the chip order still follows them. */
  .av-nav-group {
    display: none;
  }

  .av-content {
    padding: 18px 14px 22px;
  }

  .av-transaction-bar {
    gap: 10px;
    padding: 9px 12px;
  }

  .av-transaction-actions .av-button {
    min-width: 72px;
    padding-inline: 10px;
  }

  .av-page-header {
    gap: 12px;
    padding-bottom: 14px;
  }

  .av-page-icon {
    width: 42px;
    height: 42px;
    padding: 9px;
  }

  .av-section-title {
    font-size: 21px;
  }

  .av-page-grid,
  .av-section[data-av-section="presets"] .av-page-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .av-rule-set-preview {
    grid-column: auto;
  }

  .av-preservation-row {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }

  .av-preservation-actions {
    justify-content: flex-start;
  }

  .av-section[data-av-section="library"] .av-row-stack:has(> .av-library-media-actions) {
    grid-template-columns: minmax(0, 1fr);
  }

  .av-section[data-av-section="appearance"] .av-page-grid,
  .av-section[data-av-section="hidden"] .av-page-grid,
  .av-section[data-av-section="performance"] .av-page-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .av-preset-card,
  .av-row-stack:has(> .av-text-input),
  .av-row-stack:has(> .av-textarea),
  .av-row-stack:has(> .av-file-input) {
    grid-template-columns: minmax(0, 1fr);
  }

  .av-preset-highlights {
    grid-column: auto;
  }

  .av-library-media-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .av-library-media-count {
    text-align: start;
  }

  .av-row,
  .av-preset-card {
    min-height: 76px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .av-launcher,
  .av-panel {
    transition: none;
  }
}

/* The reduceMotion setting can force reduction with no OS preference set, and a page-level
   class cannot cross into this shadow tree, the host carries the state instead. */
:host([data-av-motion="reduce"]) .av-launcher,
:host([data-av-motion="reduce"]) .av-launcher:hover,
:host([data-av-motion="reduce"]) .av-panel {
  transition: none;
  transform: none;
}
`;
