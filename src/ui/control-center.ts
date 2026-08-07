import type {
  AviarySettings,
  FilterAction,
  FilterMediaKey,
  FilterSurface,
  MediaLayout,
  ReduceMotionMode,
  SensitiveMode
} from "../platform/settings";
import { FILTER_MEDIA_KEYS, FILTER_SURFACES, isThemeId } from "../platform/settings";
import { hasTranslation, translateText } from "../platform/i18n";
import type { RetentionPolicy } from "../features/export/jobs";

const SENSITIVE_OPTIONS: Array<[SensitiveMode, string]> = [
  ["default", "Default (X choice)"],
  ["reveal", "Always reveal"],
  ["blur", "Blur until hovered"],
  ["hide", "Always hide"]
];

const MEDIA_LAYOUT_OPTIONS: Array<[MediaLayout, string]> = [
  ["default", "Default grid"],
  ["stacked", "Stacked"],
  ["grid", "Strict grid"]
];
import type { DiagnosticEvent } from "../platform/diagnostics";

const FILTER_ACTION_OPTIONS: Array<[FilterAction, string]> = [
  ["off", "Off"],
  ["hide", "Hide"],
  ["dim", "Dim"]
];

const FILTER_SURFACE_LABELS: Record<FilterSurface, string> = {
  home: "Home",
  status: "Status",
  profile: "Profile",
  search: "Search",
  notifications: "Notifications",
  messages: "Messages"
};

const FILTER_MEDIA_LABELS: Record<FilterMediaKey, string> = {
  photo: "Photos",
  video: "Videos",
  gif: "GIFs"
};

export interface MediaStatus {
  historySize: number;
  completed: number;
  failed: number;
  duplicate: number;
  running: number;
}

export interface ExportStatus {
  jobCount: number;
  knownQueries: number;
}

export interface ExportResultSummary {
  records: number;
  filename: string;
  /** How many ZIPs the run produced; more than one when media.zipChunkSize split it. */
  files?: number;
}

export interface ControlCenterOptions {
  settings: AviarySettings;
  diagnostics: () => DiagnosticEvent[];
  onChange: () => Promise<void>;
  onError: (message: string, error: unknown) => void;
  getMediaStatus?: () => MediaStatus;
  clearMediaHistory?: () => Promise<void>;
  getExportStatus?: () => ExportStatus;
  runExport?: () => Promise<ExportResultSummary>;
  copyDiagnostics?: () => Promise<void>;
  exportSettings?: () => Promise<void>;
  importSettings?: (payload: string) => Promise<{ applied: boolean; warnings: string[]; errors: string[] }>;
  getAuditSize?: () => number;
  clearAuditLog?: () => Promise<void>;
  getRetentionPolicy?: () => RetentionPolicy;
  saveRetentionPolicy?: (policy: RetentionPolicy) => Promise<void>;
  getUserNotes?: () => Record<string, string>;
  setUserNote?: (handle: string, note: string) => Promise<void>;
  clearUserNotes?: () => Promise<void>;
  listPresets?: () => Array<{ id: string; label: string; description: string }>;
  applyPreset?: (id: string) => Promise<{ applied: boolean; changes: string[] }>;
  listLocales?: () => Array<{ code: string; label: string; direction: "ltr" | "rtl" }>;
  setLocale?: (code: string) => Promise<void>;
  getCleanupQueueSize?: () => { total: number; queued: number; approved: number; skipped: number };
  enqueueCleanupReview?: () => Promise<{ added: number; protected: number }>;
  clearCleanupQueue?: () => Promise<void>;
  runMediaBatch?: () => Promise<{ total: number; downloaded: number; duplicate: number; failed: number }>;
  downloadWarc?: () => Promise<{ records: number }>;
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
  captureSnapshot?: (kind: "followers" | "following") => Promise<{ count: number; handle: string } | null>;
  getSnapshotStatus?: () => { total: number; latestAt: string | null; latestKind: string | null; latestCount: number };
  diffLatestSnapshot?: (
    kind: "followers" | "following",
    handle: string
  ) => { added: number; removed: number; unchanged: number } | null;
  clearSnapshots?: () => Promise<void>;
  importArchive?: (file: File) => Promise<{ records: number; warnings: number; errors: number }>;
  searchArchive?: (query: string) => Array<{ handle: string | null; tweetId: string | null; text: string; score: number }>;
  downloadReport?: () => Promise<void>;
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

/** One entry in the settings rail: a heading group, a title, and the rows it owns. */
interface PanelSection {
  id: string;
  title: string;
  group: string;
  build: () => HTMLElement[];
}

export interface ControlCenterHandle {
  destroy(): void;
  refresh(): void;
}

export function mountControlCenter(options: ControlCenterOptions): ControlCenterHandle {
  const existing = document.getElementById("av-control-center");
  existing?.remove();

  // Set before any chrome is built, so the header is localized on the very first paint.
  panelLocale = options.settings.i18n.locale;
  resetCoverageTally();

  const host = document.createElement("div");
  host.id = "av-control-center";
  host.dataset.avOwned = "true";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CONTROL_CENTER_CSS;

  const shell = el("div", "av-shell");
  const launcher = button("Aviary", "av-launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "av-control-panel");

  const overlay = el("div", "av-overlay");
  overlay.setAttribute("aria-hidden", "true");
  // Closed at mount: keep it out of the tab order before the first toggle too.
  overlay.toggleAttribute("inert", true);

  const panel = el("section", "av-panel");
  panel.id = "av-control-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Aviary settings");
  panel.tabIndex = -1;

  const header = el("header", "av-panel-header");
  const titleWrap = el("div", "av-title-wrap");
  const title = el("h2", "av-title", t("Aviary"));
  const subtitle = el("p", "av-subtitle", t("Local controls for a quieter X."));
  titleWrap.append(title, subtitle);

  const close = button("Close", "av-button av-button-secondary");
  close.type = "button";
  header.append(titleWrap, close);

  const status = el("div", "av-status", t("Saved locally"));
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

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
  searchBar.append(search);

  const body = el("div", "av-panel-body");
  panel.append(header, searchBar, body, status);
  overlay.append(panel);
  shell.append(launcher, overlay);
  shadow.append(style, shell);

  let open = false;
  let dirtyWhileBusy = false;
  /** Which section the content pane is showing. Survives a re-render via the closure. */
  let activeSectionId = "presets";
  /** Non-empty means the content pane shows matches from every section instead of one. */
  let searchQuery = "";
  /** English source of whatever the status line shows, so a locale change can re-translate it. */
  let lastStatusEnglish = "Saved locally";

  const setOpen = (value: boolean): void => {
    open = value;
    launcher.setAttribute("aria-expanded", String(open));
    overlay.classList.toggle("is-open", open);
    overlay.setAttribute("aria-hidden", String(!open));
    // opacity:0 hides the panel visually but leaves every control in the tab order, so a
    // keyboard user would tab through ~137 invisible fields inside an aria-hidden container.
    overlay.toggleAttribute("inert", !open);
    if (open) {
      // Repaint anything that went stale while the panel was closed.
      if (dirtyWhileBusy) {
        dirtyWhileBusy = false;
        render();
      }
      panel.focus({ preventScroll: true });
    } else {
      launcher.focus({ preventScroll: true });
    }
  };

  /**
   * A rebuild replaces every row, which destroys half-typed input and moves focus. Page
   * mutations must never do that to someone mid-edit, so a refresh requested while the
   * panel is closed or focused is deferred until it is safe.
   */
  const isBusy = (): boolean => {
    const active = shadow.activeElement;
    if (!active) {
      return false;
    }
    return active !== panel;
  };

  const setStatus = (message: string): void => {
    lastStatusEnglish = message;
    status.textContent = t(message);
  };

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

  const render = (): void => {
    // Every render replaces every row, so the caret has to be put back deliberately —
    // otherwise saving a setting drops focus to the document.
    const active = shadow.activeElement as HTMLElement | null;
    const identity = focusIdentity(active);
    const selection = captureSelection(active);
    const scrollTop = body.scrollTop;

    panelLocale = options.settings.i18n.locale;
    resetCoverageTally();
    // Chrome is built once at mount, so a locale change has to repaint it explicitly.
    title.textContent = t("Aviary");
    subtitle.textContent = t("Local controls for a quieter X.");
    close.textContent = t("Close");
    launcher.textContent = t("Aviary");
    // Chrome outside `body` survives the re-render, which is the point — but that also means
    // nothing repaints it on a locale change unless it is done here.
    search.placeholder = t("Search settings");
    search.setAttribute("aria-label", t("Search settings"));
    // The status line keeps its English source so a locale change can re-translate whatever it
    // is currently showing, rather than stranding the last toast in the previous language.
    status.textContent = t(lastStatusEnglish);

    // Mirrored onto the host because shadow content cannot see the page-level motion class.
    host.dataset.avMotion = prefersReducedMotion(options.settings) ? "reduce" : "full";
    const registry = sectionRegistry();
    if (!registry.some((entry) => entry.id === activeSectionId)) {
      activeSectionId = registry[0]?.id ?? "presets";
    }
    body.replaceChildren(buildNav(registry), buildContent(registry));

    // Filled after the body exists so the number counts the render that just happened,
    // including the rows drawn after this one.
    const coverage = body.querySelector(`.${COVERAGE_ROW_CLASS} .av-row-description`);
    if (coverage) {
      coverage.textContent = coverageSummary();
    }

    body.scrollTop = scrollTop;
    if (identity) {
      const target = findByIdentity(identity);
      if (target) {
        target.focus({ preventScroll: true });
        restoreSelection(target, selection);
      }
    }
  };

  const appearanceRows = (): HTMLElement[] => {
    return [
        selectRow("Theme", options.settings.appearance.theme, [
          ["dim", "Dim"],
          ["lightsOut", "Lights out"],
          ["graphite", "Graphite"],
          ["plum", "Plum"],
          ["midnight", "Midnight"]
        ], async (value) => {
          if (!isThemeId(value)) {
            setStatus("Theme value is not supported.");
            return;
          }
          options.settings.appearance.theme = value;
          await save("Theme updated");
        }),
        toggleRow("Dense mode", "Tighten timeline spacing for scanning.", options.settings.appearance.denseMode, async (checked) => {
          options.settings.appearance.denseMode = checked;
          await save("Density updated");
        }),
        selectRow(
          "Timeline width",
          options.settings.appearance.timelineWidth,
          [
            ["default", "Default"],
            ["comfortable", "Comfortable"],
            ["wide", "Wide"]
          ],
          async (value) => {
            options.settings.appearance.timelineWidth = value as "default" | "comfortable" | "wide";
            await save("Timeline width updated");
          },
          "Widen the main column past the width X fixes it at. Capped to the space available, so a narrow window is unaffected."
        ),
        toggleRow(
          "Restore the Chirp font",
          "Force X's own Chirp typeface where the site has fallen back to a system font.",
          options.settings.appearance.restoreChirp,
          async (checked) => {
            options.settings.appearance.restoreChirp = checked;
            await save(checked ? "Chirp font on" : "Chirp font off");
          }
        ),
        toggleRow(
          "Hide engagement counts",
          "Hide reply, repost, and like numbers. The buttons still work and screen readers still announce the totals.",
          options.settings.appearance.hideCounts,
          async (checked) => {
            options.settings.appearance.hideCounts = checked;
            await save(checked ? "Engagement counts hidden" : "Engagement counts shown");
          }
        ),
        toggleRow(
          "Hide row borders",
          "Remove the 1px divider under each timeline post and the primary column's side rules.",
          options.settings.appearance.hideBorders,
          async (checked) => {
            options.settings.appearance.hideBorders = checked;
            await save(checked ? "Row borders hidden" : "Row borders restored");
          }
        ),
        toggleRow("High contrast", "Use stronger borders and text contrast.", options.settings.accessibility.highContrast, async (checked) => {
          options.settings.accessibility.highContrast = checked;
          await save("Contrast preference saved");
        }),
        selectRow(
          "Reduced motion",
          options.settings.accessibility.reduceMotion,
          [
            ["system", "Follow system setting"],
            ["always", "Always reduce"],
            ["never", "Never reduce"]
          ],
          async (value) => {
            options.settings.accessibility.reduceMotion = coerceReduceMotion(value);
            await save("Motion preference saved");
          }
        )
    ];
  };

  const layoutRows = (): HTMLElement[] => {
    return [
        toggleRow("Hide right sidebar", "Reduce trends, recommendations, and footer noise.", options.settings.layout.hideRightSidebar, async (checked) => {
          options.settings.layout.hideRightSidebar = checked;
          await save("Sidebar preference saved");
        }),
        toggleRow("Hide trends", "Remove trending topics and news modules.", options.settings.layout.hideTrends, async (checked) => {
          options.settings.layout.hideTrends = checked;
          await save("Trend preference saved");
        }),
        toggleRow("Hide Grok surfaces", "Remove Grok drawer and composer buttons where detected.", options.settings.layout.hideGrok, async (checked) => {
          options.settings.layout.hideGrok = checked;
          await save("Grok preference saved");
        }),
        toggleRow(
          "Writer mode",
          "While focus is in the composer, fade the sidebar and the timeline behind it. Everything returns the moment you click away.",
          options.settings.layout.writerMode,
          async (checked) => {
            options.settings.layout.writerMode = checked;
            await save(checked ? "Writer mode on" : "Writer mode off");
          }
        ),
        toggleRow(
          "Open Following instead of For you",
          "Selects the second home tab each time you arrive at the timeline. Switch back to For you and it stays there until you navigate away.",
          options.settings.layout.forceFollowing,
          async (checked) => {
            options.settings.layout.forceFollowing = checked;
            await save(checked ? "Following timeline on" : "Following timeline off");
          }
        )
    ];
  };

  const trustRows = (): HTMLElement[] => {
    return [
        readonlyRow("Storage", "Settings stay in this browser."),
        toggleRow(
          "Local-only mode",
          "Blocks every outbound request, including the integrations you configured. On by default; turning an integration on is what turns this off.",
          options.settings.privacy.localOnly,
          async (checked) => {
            options.settings.privacy.localOnly = checked;
            await save(checked ? "Local-only mode on" : "Local-only mode off");
          }
        ),
        storageHealthRow(),
        readonlyRow("Telemetry", options.settings.privacy.telemetry ? "Enabled" : "Disabled"),
        coverageRow(),
        dataRow("Selector health", selectorSummary())
    ];
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
    { id: "presets", title: "Presets", group: "Start", build: presetRows },
    { id: "appearance", title: "Appearance", group: "Reading", build: appearanceRows },
    { id: "layout", title: "Layout", group: "Reading", build: layoutRows },
    { id: "filtering", title: "Filtering", group: "Reading", build: filterRows },
    { id: "hidden", title: "Hidden posts", group: "Reading", build: hiddenPostRows },
    { id: "performance", title: "Performance", group: "Reading", build: performanceRows },
    { id: "media", title: "Media", group: "Data", build: mediaRows },
    { id: "export", title: "Export", group: "Data", build: exportRows },
    { id: "library", title: "Library", group: "Data", build: libraryRows },
    { id: "snapshots", title: "Snapshots & Archive", group: "Data", build: snapshotRows },
    { id: "integrations", title: "Integrations", group: "Advanced", build: integrationRows },
    { id: "backup", title: "Backup & Audit", group: "Advanced", build: backupRows },
    { id: "trust", title: "Trust", group: "Advanced", build: trustRows }
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
      const selected = searchQuery.length === 0 && entry.id === activeSectionId;
      item.classList.toggle("is-active", selected);
      // A rail of buttons is a tablist in behaviour; say so rather than leaving it to guesswork.
      item.setAttribute("aria-current", selected ? "true" : "false");
      item.addEventListener("click", () => {
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

  const buildContent = (registry: PanelSection[]): HTMLElement => {
    const content = el("div", "av-content");
    if (searchQuery.length > 0) {
      content.append(...searchResults(registry));
      return content;
    }
    const entry = registry.find((candidate) => candidate.id === activeSectionId) ?? registry[0]!;
    content.append(section(entry.title, entry.build()));
    return content;
  };

  /**
   * Matching happens on the rendered row text rather than a separate keyword table, so a row
   * added later is searchable the moment it exists and a label edit cannot desynchronise from
   * its search terms. Sections are built once each here, which is the one render where paying
   * for the whole panel is the point.
   */
  const searchResults = (registry: PanelSection[]): HTMLElement[] => {
    const needle = searchQuery.trim().toLowerCase();
    const out: HTMLElement[] = [];
    let matches = 0;

    for (const entry of registry) {
      const hits = entry.build().filter((row) => (row.textContent ?? "").toLowerCase().includes(needle));
      if (hits.length === 0) {
        continue;
      }
      matches += hits.length;
      out.push(section(entry.title, hits));
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

  const presetRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    if (!options.listPresets || !options.applyPreset) {
      rows.push(readonlyRow("Presets", "Preset packs unavailable in this build."));
      return rows;
    }
    for (const preset of options.listPresets()) {
      const row = el("div", "av-row av-row-stack");
      const copy = el("span", "av-row-copy");
      copy.append(
        el("span", "av-row-label", preset.label),
        el("span", "av-row-description", preset.description)
      );
      const apply = el("button", "av-button av-button-secondary", t("Apply")) as HTMLButtonElement;
      apply.type = "button";
      apply.addEventListener("click", () => {
        apply.disabled = true;
        void options
          .applyPreset!(preset.id)
          .then((result) => {
            if (result.applied) {
              setStatus(`Applied "${preset.label}" — ${result.changes.length} changes`);
            } else {
              setStatus(`Preset "${preset.label}" unchanged.`);
            }
          })
          .catch((error: unknown) => {
            options.onError("Could not apply preset", error);
            setStatus("Could not apply preset.");
          })
          .finally(() => {
            apply.disabled = false;
          });
      });
      row.append(copy, apply);
      rows.push(row);
    }
    if (options.listLocales && options.setLocale) {
      rows.push(
        selectRow(
          "Locale",
          options.settings.i18n.locale,
          options.listLocales().map((entry) => [entry.code, entry.label] as [string, string]),
          async (value) => {
            await options.setLocale!(value);
            const entry = options.listLocales?.().find((locale) => locale.code === value);
            await save(`Locale set to ${entry?.label ?? value}`);
          },
          "Translates the panel and sets reading direction — right-to-left for Arabic and Hebrew. Trust shows how much of the chosen locale is filled in; anything missing stays English.",
          false
        )
      );
    }
    return rows;
  };

  const snapshotRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];

    if (options.getSnapshotStatus) {
      const status = options.getSnapshotStatus();
      rows.push(
        dataRow(
          "Snapshots stored",
          `${status.total} entries${
            status.latestAt
              ? ` · latest ${status.latestKind} of ${status.latestCount} @ ${status.latestAt}`
              : ""
          }`
        )
      );
    }

    if (options.captureSnapshot) {
      rows.push(
        actionRow(
          "Capture followers from this view",
          "Walks UserCell rows on the current page. Open a /handle/followers view first.",
          async () => {
            try {
              const result = await options.captureSnapshot!("followers");
              setStatus(result ? `Captured ${result.count} followers for @${result.handle}.` : "No UserCell rows found.");
            } catch (error) {
              options.onError("Snapshot failed", error);
              setStatus("Snapshot failed.");
            }
          }
        )
      );
      rows.push(
        actionRow(
          "Capture following from this view",
          "Walks UserCell rows on the current page. Open a /handle/following view first.",
          async () => {
            try {
              const result = await options.captureSnapshot!("following");
              setStatus(result ? `Captured ${result.count} following for @${result.handle}.` : "No UserCell rows found.");
            } catch (error) {
              options.onError("Snapshot failed", error);
              setStatus("Snapshot failed.");
            }
          }
        )
      );
    }

    if (options.clearSnapshots) {
      rows.push(
        actionRow("Clear all snapshots", "Drop every stored follower/following snapshot.", async () => {
          try {
            await options.clearSnapshots!();
            await save("Snapshots cleared");
          } catch (error) {
            options.onError("Could not clear snapshots", error);
            setStatus("Could not clear snapshots.");
          }
        })
      );
    }

    if (options.importArchive) {
      const row = el("div", "av-row av-row-stack");
      const copy = el("span", "av-row-copy");
      copy.append(
        el("span", "av-row-label", "Import official X archive"),
        el("span", "av-row-description", "Pick a ZIP exported from x.com. STORE-only entries only; compressed archives are rejected.")
      );
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zip,application/zip";
      input.className = "av-file-input";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        void (async () => {
          setStatus("Reading archive — large files take a moment…");
          try {
            const result = await options.importArchive!(file);
            const warningsLabel =
              result.warnings > 0 || result.errors > 0
                ? ` (${result.warnings} warning${result.warnings === 1 ? "" : "s"}, ${result.errors} error${
                    result.errors === 1 ? "" : "s"
                  })`
                : "";
            setStatus(`Imported ${result.records} records${warningsLabel}.`);
          } catch (error) {
            options.onError("Archive import failed", error);
            setStatus("Archive import failed.");
          } finally {
            input.value = "";
          }
        })();
      });
      row.append(copy, input);
      rows.push(row);
    }

    if (options.searchArchive) {
      const row = el("div", "av-row av-row-stack");
      const copy = el("span", "av-row-copy");
      copy.append(
        el("span", "av-row-label", "Search captured records"),
        el("span", "av-row-description", "Full-text search across the latest export collector run.")
      );
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = "@handle, keyword, phrase…";
      input.className = "av-text-input";
      const results = el("div", "av-search-results");
      results.setAttribute("role", "list");
      results.setAttribute("aria-live", "polite");
      const runSearch = (): void => {
        const query = input.value.trim();
        results.replaceChildren();
        if (query.length === 0) {
          results.append(
            el("div", "av-row-description", "Type to search the records captured by export runs.")
          );
          return;
        }
        const hits = options.searchArchive!(query);
        if (hits.length === 0) {
          results.append(el("div", "av-row-description", `No captured records match “${query}”.`));
          return;
        }
        for (const hit of hits.slice(0, 10)) {
          const item = el("div", "av-search-hit");
          item.setAttribute("role", "listitem");
          const head = el("span", "av-row-label", `@${hit.handle ?? "anon"} · ${hit.tweetId ?? "—"}`);
          const body = el("span", "av-row-description", hit.text.slice(0, 140));
          item.append(head, body);
          results.append(item);
        }
      };
      // Searching a large imported archive walks every record; running that per keystroke
      // froze the panel while typing.
      let searchTimer: ReturnType<typeof setTimeout> | undefined;
      input.addEventListener("input", () => {
        if (searchTimer !== undefined) {
          clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(runSearch, 180);
      });
      runSearch();
      row.append(copy, input, results);
      rows.push(row);
    }

    if (options.downloadReport) {
      rows.push(
        actionRow("Download Markdown report", "Audit log + snapshot diff + cleanup preview.", async () => {
          setStatus("Building report…");
          try {
            await options.downloadReport!();
            setStatus("Report downloaded.");
          } catch (error) {
            options.onError("Could not build report", error);
            setStatus("Could not build report.");
          }
        })
      );
    }

    if (options.getCleanupQueueSize) {
      const queueStatus = options.getCleanupQueueSize();
      rows.push(
        dataRow(
          "Cleanup review queue",
          `${queueStatus.total} items · queued ${queueStatus.queued} · approved ${queueStatus.approved} · skipped ${queueStatus.skipped}`
        )
      );
      rows.push(
        readonlyRow(
          "Destructive actions",
          "Aviary never deletes posts, likes, or follows. The queue is a review list; approving or skipping only writes to the audit log."
        )
      );
    }

    if (options.enqueueCleanupReview) {
      rows.push(
        actionRow(
          "Enqueue cleanup preview for review",
          "Append every non-protected candidate from the latest cleanup preview to the queue (no destructive action).",
          async () => {
            setStatus("Building cleanup preview…");
          try {
              const result = await options.enqueueCleanupReview!();
              setStatus(`Enqueued ${result.added} items (${result.protected} protected skipped).`);
            } catch (error) {
              options.onError("Could not enqueue cleanup", error);
              setStatus("Could not enqueue cleanup.");
            }
          }
        )
      );
    }

    if (options.clearCleanupQueue) {
      rows.push(
        actionRow("Clear cleanup queue", "Drop every queued item without touching account data.", async () => {
          try {
            await options.clearCleanupQueue!();
            await save("Cleanup queue cleared");
          } catch (error) {
            options.onError("Could not clear cleanup queue", error);
            setStatus("Could not clear queue.");
          }
        })
      );
    }

    return rows;
  };

  const integrationRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    const status = options.getIntegrationStatus?.();
    const integrations = options.settings.integrations;

    // Aria2
    rows.push(
      toggleRow(
        "Aria2 handoff",
        "Send large media downloads to a self-hosted Aria2 JSON-RPC endpoint.",
        integrations.aria2.enabled,
        async (checked) => {
          integrations.aria2.enabled = checked;
          await save(checked ? "Aria2 handoff on" : "Aria2 handoff off");
        }
      )
    );
    rows.push(
      textInputRow(
        "Aria2 endpoint",
        "http://localhost:6800 (no trailing slash needed)",
        integrations.aria2.endpoint,
        async (value) => {
          integrations.aria2.endpoint = value;
          await save("Aria2 endpoint saved");
        }
      )
    );
    rows.push(
      secretInputRow(
        "Aria2 RPC secret",
        "Optional shared secret for token: auth.",
        integrations.aria2.secret,
        async (value) => {
          integrations.aria2.secret = value;
          await save("Aria2 secret saved");
        }
      )
    );
    rows.push(
      integerInputRow(
        "Hand off files larger than (MB)",
        "Smaller files save through the browser. Aviary checks the size first; when the server will not report one, the file is handed off anyway.",
        Math.round(integrations.aria2.minBytes / 1_000_000),
        async (value) => {
          integrations.aria2.minBytes = Math.max(0, value) * 1_000_000;
          await save("Aria2 threshold saved");
        }
      )
    );
    if (options.pingAria2) {
      rows.push(
        actionRow("Test Aria2 connection", "Sends a trivial JSON-RPC call.", async () => {
          const result = await options.pingAria2!();
          setStatus(result.ok ? "Aria2 reachable." : `Aria2 unreachable: ${result.error}`);
        })
      );
    }

    if (options.listAria2Active && options.cancelAria2) {
      const row = el("div", "av-row av-row-stack");
      const copy = el("span", "av-row-copy");
      copy.append(
        el("span", "av-row-label", "Aria2 active downloads"),
        el("span", "av-row-description", "Refresh to list in-flight transfers; tap Cancel to abort one.")
      );
      const list = el("div", "av-search-results");
      const refresh = async (): Promise<void> => {
        try {
          const active = await options.listAria2Active!();
          list.replaceChildren();
          if (active.length === 0) {
            list.append(el("div", "av-row-description", "No active downloads."));
            return;
          }
          for (const job of active) {
            const item = el("div", "av-search-hit");
            const total = job.totalLength > 0 ? `${Math.round((job.completedLength / job.totalLength) * 100)}%` : "?";
            item.append(
              el("span", "av-row-label", `${job.path || job.gid} · ${total}`),
              el("span", "av-row-description", `gid ${job.gid} · ${job.status}`)
            );
            const cancel = el("button", "av-button av-button-secondary", t("Cancel")) as HTMLButtonElement;
            cancel.type = "button";
            cancel.addEventListener("click", async () => {
              cancel.disabled = true;
              const result = await options.cancelAria2!(job.gid);
              cancel.disabled = false;
              if (result.ok) {
                setStatus(`Cancelled ${job.gid}.`);
                await refresh();
              } else {
                setStatus(`Aria2 cancel failed: ${result.error}`);
              }
            });
            item.append(cancel);
            list.append(item);
          }
        } catch (error) {
          options.onError("Aria2 sweep failed", error);
          setStatus("Aria2 sweep failed.");
        }
      };
      const refreshBtn = el("button", "av-button av-button-secondary", t("Refresh")) as HTMLButtonElement;
      refreshBtn.type = "button";
      refreshBtn.addEventListener("click", () => void refresh());
      row.append(copy, refreshBtn, list);
      rows.push(row);
    }

    // Bluesky
    rows.push(
      toggleRow(
        "Bluesky crosspost",
        "Post composer text to your Bluesky account on demand.",
        integrations.bluesky.enabled,
        async (checked) => {
          integrations.bluesky.enabled = checked;
          await save(checked ? "Bluesky on" : "Bluesky off");
        }
      )
    );
    rows.push(
      textInputRow(
        "Bluesky service URL",
        "Default: https://bsky.social",
        integrations.bluesky.service,
        async (value) => {
          integrations.bluesky.service = value;
          await save("Bluesky service saved");
        }
      )
    );
    rows.push(
      textInputRow(
        "Bluesky handle",
        "Your handle (no @, e.g. you.bsky.social)",
        integrations.bluesky.handle,
        async (value) => {
          integrations.bluesky.handle = value;
          await save("Bluesky handle saved");
        }
      )
    );
    rows.push(
      secretInputRow(
        "Bluesky app password",
        "App password from your account settings — never your main password.",
        integrations.bluesky.appPassword,
        async (value) => {
          integrations.bluesky.appPassword = value;
          await save("Bluesky app password saved");
        }
      )
    );

    // Mastodon
    rows.push(
      toggleRow(
        "Mastodon crosspost",
        "Post composer text to your Mastodon account on demand.",
        integrations.mastodon.enabled,
        async (checked) => {
          integrations.mastodon.enabled = checked;
          await save(checked ? "Mastodon on" : "Mastodon off");
        }
      )
    );
    rows.push(
      textInputRow(
        "Mastodon instance",
        "https://mastodon.social",
        integrations.mastodon.instance,
        async (value) => {
          integrations.mastodon.instance = value;
          await save("Mastodon instance saved");
        }
      )
    );
    rows.push(
      secretInputRow(
        "Mastodon access token",
        "Bearer token with write:statuses scope.",
        integrations.mastodon.token,
        async (value) => {
          integrations.mastodon.token = value;
          await save("Mastodon token saved");
        }
      )
    );

    rows.push(
      toggleRow(
        "Attach last download",
        "Upload the last successful Aviary media download with the first post in an explicit crosspost.",
        integrations.crosspost.attachLastDownload,
        async (checked) => {
          integrations.crosspost.attachLastDownload = checked;
          await save(checked ? "Crosspost attachment on" : "Crosspost attachment off");
        }
      )
    );

    if (options.crosspost) {
      const threadRow = el("div", "av-row");
      const copy = el("span", "av-row-copy");
      copy.append(
        el("span", "av-row-label", "Crosspost as thread"),
        el("span", "av-row-description", "Split on blank lines and reply each segment to the previous one.")
      );
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      threadRow.append(copy, checkbox);
      rows.push(threadRow);

      rows.push(
        actionRow("Crosspost composer → Bluesky", "Uses the current composer text.", async () => {
          const result = await options.crosspost!("bluesky", { asThread: checkbox.checked });
          setStatus(
            result.ok
              ? `Posted ${result.posts ?? 1} to Bluesky.${result.url ? ` ${result.url}` : ""}`
              : `Bluesky failed: ${result.error}`
          );
        })
      );
      rows.push(
        actionRow("Crosspost composer → Mastodon", "Uses the current composer text.", async () => {
          const result = await options.crosspost!("mastodon", { asThread: checkbox.checked });
          setStatus(
            result.ok
              ? `Posted ${result.posts ?? 1} to Mastodon.${result.url ? ` ${result.url}` : ""}`
              : `Mastodon failed: ${result.error}`
          );
        })
      );
    }

    // AI provider
    rows.push(
      toggleRow(
        "AI provider runs",
        "Let the AI command menu POST prompts to your configured provider.",
        integrations.ai.enabled,
        async (checked) => {
          integrations.ai.enabled = checked;
          await save(checked ? "AI runs on" : "AI runs off");
        }
      )
    );
    rows.push(
      selectRow(
        "AI provider",
        integrations.ai.provider,
        [
          ["anthropic", "Anthropic Messages API"],
          ["openai", "OpenAI Chat Completions"],
          ["openai-compatible", "OpenAI-compatible (LocalAI, Ollama proxy, …)"]
        ],
        async (value) => {
          if (value === "anthropic" || value === "openai" || value === "openai-compatible") {
            integrations.ai.provider = value;
            await save(`AI provider set to ${value}`);
          }
        }
      )
    );
    rows.push(
      textInputRow(
        "AI endpoint (optional)",
        "Override the default endpoint for the chosen provider.",
        integrations.ai.endpoint,
        async (value) => {
          integrations.ai.endpoint = value;
          await save("AI endpoint saved");
        }
      )
    );
    rows.push(
      textInputRow(
        "AI model",
        "e.g. claude-sonnet-4-6, gpt-4o, llama3.1:8b",
        integrations.ai.model,
        async (value) => {
          integrations.ai.model = value;
          await save("AI model saved");
        }
      )
    );
    rows.push(
      secretInputRow(
        "AI API key",
        "Stored locally only. Aviary never sends this except as the auth header to your provider.",
        integrations.ai.apiKey,
        async (value) => {
          integrations.ai.apiKey = value;
          await save("AI API key saved");
        }
      )
    );

    // Semantic search
    rows.push(
      toggleRow(
        "Semantic search",
        "Embed CheckpointStore records via your provider for similarity search.",
        integrations.semanticSearch.enabled,
        async (checked) => {
          integrations.semanticSearch.enabled = checked;
          await save(checked ? "Semantic search on" : "Semantic search off");
        }
      )
    );
    rows.push(
      textInputRow(
        "Embedding endpoint",
        "POST endpoint that returns {data: [{embedding: number[]}]}",
        integrations.semanticSearch.endpoint,
        async (value) => {
          integrations.semanticSearch.endpoint = value;
          await save("Embedding endpoint saved");
        }
      )
    );
    rows.push(
      textInputRow(
        "Embedding model",
        "e.g. text-embedding-3-small",
        integrations.semanticSearch.model,
        async (value) => {
          integrations.semanticSearch.model = value;
          await save("Embedding model saved");
        }
      )
    );
    rows.push(
      secretInputRow(
        "Embedding API key",
        "Stored locally; used only as the Authorization header.",
        integrations.semanticSearch.apiKey,
        async (value) => {
          integrations.semanticSearch.apiKey = value;
          await save("Embedding API key saved");
        }
      )
    );

    rows.push(
      toggleRow(
        "Auto-embed every export",
        "After each export run, kick the embedding job in the background. Off by default.",
        integrations.semanticSearch.autoIndex,
        async (checked) => {
          integrations.semanticSearch.autoIndex = checked;
          await save(checked ? "Auto-embed on" : "Auto-embed off");
        }
      )
    );

    if (options.rebuildSemanticIndex) {
      rows.push(
        actionRow(
          "Rebuild semantic index",
          "Embed every captured record. Re-running is cheap because cached entries are skipped.",
          async () => {
            setStatus("Rebuilding semantic index…");
          try {
              const result = await options.rebuildSemanticIndex!();
              // The index is capped, so say when the cap actually bit rather than letting the
              // total quietly stop growing.
              const trimmed = result.dropped > 0 ? ` · oldest ${result.dropped} dropped` : "";
              setStatus(
                `Indexed: +${result.added} new · skipped ${result.skipped} · errors ${result.errors} · total ${result.total}${trimmed}.`
              );
            } catch (error) {
              options.onError("Embedding failed", error);
              setStatus("Embedding failed.");
            }
          }
        )
      );
    }

    if (options.semanticSearchQuery) {
      const row = el("div", "av-row av-row-stack");
      const copy = el("span", "av-row-copy");
      copy.append(
        el("span", "av-row-label", "Semantic search"),
        el("span", "av-row-description", "Vector similarity over captured records. Embeddings run on demand.")
      );
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = "Describe what you're looking for…";
      input.className = "av-text-input";
      const results = el("div", "av-search-results");
      let pending: number | undefined;
      input.addEventListener("input", () => {
        if (pending !== undefined) clearTimeout(pending);
        pending = setTimeout(() => {
          void options
            .semanticSearchQuery!(input.value.trim())
            .then((hits) => {
              results.replaceChildren();
              if (hits.length === 0) {
                results.append(el("div", "av-row-description", "No matches (or integration disabled)."));
                return;
              }
              for (const hit of hits) {
                const item = el("div", "av-search-hit");
                item.append(
                  el("span", "av-row-label", `@${hit.handle ?? "anon"} · ${hit.tweetId ?? "—"} · score ${hit.score.toFixed(3)}`),
                  el("span", "av-row-description", hit.text.slice(0, 200))
                );
                results.append(item);
              }
            })
            .catch((error: unknown) => {
              options.onError("Semantic search failed", error);
            });
        }, 220) as unknown as number;
      });
      row.append(copy, input, results);
      rows.push(row);
    }

    if (options.clearSemanticIndex) {
      rows.push(
        actionRow("Clear semantic index", "Forget every embedded record.", async () => {
          await options.clearSemanticIndex!();
          await save("Semantic index cleared");
        })
      );
    }

    if (status) {
      const lines = [
        `Aria2: ${status.aria2.enabled ? "on" : "off"} · ${status.aria2.configured ? "configured" : "missing endpoint"}`,
        `Bluesky: ${status.bluesky.enabled ? "on" : "off"} · ${status.bluesky.configured ? "configured" : "missing credentials"}`,
        `Mastodon: ${status.mastodon.enabled ? "on" : "off"} · ${status.mastodon.configured ? "configured" : "missing credentials"}`,
        `AI: ${status.ai.enabled ? "on" : "off"} · ${status.ai.configured ? "configured" : "missing key/model"}`,
        `Semantic: ${status.semanticSearch.enabled ? "on" : "off"} · ${status.semanticSearch.indexed} indexed`
      ];
      rows.push(dataRow("Integration status", lines.join(" · ")));
    }

    if (options.recentIntegrationErrors) {
      const errors = options.recentIntegrationErrors();
      if (errors.length === 0) {
        rows.push(readonlyRow("Recent integration errors", "None recorded."));
      } else {
        const row = el("div", "av-row av-row-stack");
        const copy = el("span", "av-row-copy");
        copy.append(
          el("span", "av-row-label", "Recent integration errors"),
          el("span", "av-row-description", "Drawn from the audit log; only failed integration calls show up.")
        );
        const list = el("div", "av-search-results");
        for (const error of errors.slice(0, 8)) {
          const item = el("div", "av-search-hit");
          item.append(
            el("span", "av-row-label", `${error.kind} · ${error.at}`),
            el("span", "av-row-description", error.message.slice(0, 200))
          );
          list.append(item);
        }
        row.append(copy, list);
        rows.push(row);
      }
    }

    return rows;
  };

  const performanceRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];

    rows.push(
      toggleRow(
        "Pause video that scrolls out of view",
        "Stops decoding timeline video once it leaves the screen, and resumes it when it comes back. A video you paused yourself stays paused.",
        options.settings.performance.pauseOffscreenVideo,
        async (checked) => {
          options.settings.performance.pauseOffscreenVideo = checked;
          await save(checked ? "Offscreen video paused" : "Offscreen video left playing");
        }
      )
    );

    return rows;
  };

  const libraryRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];

    rows.push(
      toggleRow(
        "Unshorten t.co links",
        "Replace short `t.co` redirects with the destination from aria-labels and titles.",
        options.settings.links.expandTco,
        async (checked) => {
          options.settings.links.expandTco = checked;
          await save(checked ? "Unshorten on" : "Unshorten off");
        }
      )
    );

    rows.push(
      toggleRow(
        "Clean tracking from links",
        "Strips share tokens and campaign parameters (utm_*, fbclid, and X's own t/s) from links in the timeline, so what you copy is the plain address.",
        options.settings.links.cleanShareButtons,
        async (checked) => {
          options.settings.links.cleanShareButtons = checked;
          await save(checked ? "Link cleaning on" : "Link cleaning off");
        }
      )
    );

    if (options.getUserNotes && options.setUserNote) {
      const notes = options.getUserNotes();
      const serialized = Object.entries(notes)
        .map(([handle, note]) => `${handle}: ${note}`)
        .sort();
      rows.push(
        textareaRow(
          "Account notes",
          "Format: handle: note. One per line. Empty notes remove the entry.",
          serialized,
          async (lines) => {
            const seen = new Set<string>();
            for (const line of lines) {
              const match = /^@?([A-Za-z0-9_]{1,15})\s*[:\-]\s*(.*)$/.exec(line);
              if (!match) continue;
              const [, handle, note] = match;
              if (handle) {
                seen.add(handle.toLowerCase());
                await options.setUserNote!(handle, note ?? "");
              }
            }
            // Remove notes the user wiped from the textarea.
            for (const handle of Object.keys(notes)) {
              if (!seen.has(handle)) {
                await options.setUserNote!(handle, "");
              }
            }
            await save(`${seen.size} account note${seen.size === 1 ? "" : "s"} saved`);
          }
        )
      );
    }

    if (options.clearUserNotes) {
      rows.push(
        actionRow("Clear all account notes", "Drop every persisted note.", async () => {
          try {
            await options.clearUserNotes!();
            await save("Account notes cleared");
          } catch (error) {
            options.onError("Could not clear account notes", error);
            setStatus("Could not clear notes.");
          }
        })
      );
    }

    rows.push(
      textareaRow(
        "Composer snippets",
        "One snippet per line. Reusable replies / templates (insertion landing in a later release).",
        options.settings.composer.snippets,
        async (lines) => {
          options.settings.composer.snippets = lines
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, 100);
          await save(`${options.settings.composer.snippets.length} snippet${options.settings.composer.snippets.length === 1 ? "" : "s"} saved`);
        }
      )
    );

    return rows;
  };

  const backupRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];

    if (options.exportSettings) {
      rows.push(
        actionRow("Export settings", "Downloads your preferences as JSON. API keys and passwords are replaced with a placeholder, so the file is safe to share; importing it here keeps the credentials already saved on this machine.", async () => {
          try {
            await options.exportSettings!();
            setStatus("Settings exported.");
          } catch (error) {
            options.onError("Could not export settings", error);
            setStatus("Could not export settings.");
          }
        })
      );
    }

    if (options.importSettings) {
      rows.push(
        textareaRow(
          "Import settings (JSON)",
          "Paste a settings file exported from Aviary, then choose Import. Redacted credentials keep the values already saved here.",
          [],
          async (lines) => {
            const payload = lines.join("\n");
            try {
              const report = await options.importSettings!(payload);
              if (report.applied) {
                // Show what the warning actually said — a bare count tells the user nothing.
                const [first, ...rest] = report.warnings;
                const extra = rest.length > 0 ? ` (+${rest.length} more)` : "";
                setStatus(first ? `Settings imported. ${first}${extra}` : "Settings imported.");
              } else {
                setStatus(`Import failed: ${report.errors.join("; ")}`);
              }
            } catch (error) {
              options.onError("Could not import settings", error);
              setStatus("Could not import settings.");
            }
          },
          "Import"
        )
      );
    }

    if (options.getAuditSize) {
      rows.push(
        toggleRow(
          "Keep a local action log",
          "Records downloads, exports and settings changes on this device so you can review what Aviary did. Nothing is sent anywhere. Turning this off stops new entries immediately; existing ones stay until you clear them.",
          options.settings.privacy.auditLog,
          async (value) => {
            options.settings.privacy.auditLog = value;
            await save(value ? "Action log on" : "Action log off");
          }
        )
      );
      rows.push(dataRow("Audit entries", String(options.getAuditSize())));
    }

    if (options.clearAuditLog) {
      rows.push(
        actionRow("Clear audit log", "Drop the local action log.", async () => {
          try {
            await options.clearAuditLog!();
            await save("Audit log cleared");
          } catch (error) {
            options.onError("Could not clear audit log", error);
            setStatus("Could not clear audit log.");
          }
        })
      );
    }

    return rows;
  };

  const exportRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    rows.push(
      toggleRow(
        "Capture visible tweets",
        "Accumulate tweets visible on the active page for the next export run.",
        options.settings.export.enabled,
        async (checked) => {
          options.settings.export.enabled = checked;
          await save(checked ? "Export capture on" : "Export capture off");
        }
      )
    );
    rows.push(
      textInputRow(
        "Export formats",
        "Comma-separated list. Supported: json, csv, html, markdown, xlsx.",
        options.settings.export.formats.join(","),
        async (value) => {
          const parsed = value
            .split(/[\s,]+/)
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => entry.length > 0);
          const supported = new Set(["json", "csv", "html", "markdown", "xlsx"]);
          options.settings.export.formats = (parsed.filter((entry) => supported.has(entry)) as AviarySettings["export"]["formats"]);
          if (options.settings.export.formats.length === 0) {
            options.settings.export.formats = ["json"];
          }
          await save(`Export formats: ${options.settings.export.formats.join(", ")}`);
        }
      )
    );
    rows.push(
      toggleRow(
        "Preserve raw payloads",
        "Also store the raw GraphQL responses X sends this tab, so records can be re-parsed later. Session tokens are stripped before anything is written.",
        options.settings.export.preserveRawPayloads,
        async (checked) => {
          options.settings.export.preserveRawPayloads = checked;
          await save("Raw payload preference saved");
        }
      )
    );
    rows.push(
      toggleRow(
        "Auto-discover query IDs",
        "Scan loaded scripts for X GraphQL operation IDs and cache them locally.",
        options.settings.export.autoDiscoverQueryIds,
        async (checked) => {
          options.settings.export.autoDiscoverQueryIds = checked;
          await save("Query discovery preference saved");
        }
      )
    );
    rows.push(
      textInputRow(
        "Save folder hint",
        "Folder name (or path) used as the export ZIP root and download prefix.",
        options.settings.media.lastSaveFolder,
        async (value) => {
          options.settings.media.lastSaveFolder = value;
          await save("Save folder hint saved");
        }
      )
    );

    const status = options.getExportStatus?.();
    if (status) {
      rows.push(
        dataRow(
          "Export status",
          `${status.jobCount} jobs tracked · ${status.knownQueries} GraphQL IDs cached`
        )
      );
    }

    if (options.runExport) {
      rows.push(
        actionRow("Export visible tweets", "Collect the currently rendered tweets and download a ZIP.", async () => {
          setStatus("Collecting visible posts…");
          try {
            const result = await options.runExport!();
            const files = result.files ?? 1;
            setStatus(
              result.records === 0
                ? "No posts found on this view. Scroll the timeline to load some, then export again."
                : files > 1
                  ? `Exported ${result.records} records across ${files} ZIPs → ${result.filename}`
                  : `Exported ${result.records} record${result.records === 1 ? "" : "s"} → ${result.filename}`
            );
          } catch (error) {
            options.onError("Export failed", error);
            setStatus("Export failed. See diagnostics.");
          }
        })
      );
    }

    if (options.copyDiagnostics) {
      rows.push(
        actionRow("Copy diagnostics", "Copy support diagnostics (version, route, recent log).", async () => {
          try {
            await options.copyDiagnostics!();
            setStatus("Diagnostics copied to clipboard.");
          } catch (error) {
            options.onError("Could not copy diagnostics", error);
            setStatus("Could not copy diagnostics.");
          }
        })
      );
    }

    if (options.downloadWarc) {
      rows.push(
        actionRow(
          "Download as WARC",
          "Wrap captured records into an ISO-28500 WARC file for research / preservation tooling.",
          async () => {
            setStatus("Building WARC archive…");
          try {
              const result = await options.downloadWarc!();
              setStatus(`WARC downloaded (${result.records} records).`);
            } catch (error) {
              options.onError("WARC export failed", error);
              setStatus("WARC export failed.");
            }
          }
        )
      );
    }

    if (options.exportToTarget) {
      const targets: Array<{ id: "clipboard-markdown" | "obsidian" | "notion" | "raw-json"; label: string; description: string }> = [
        { id: "clipboard-markdown", label: "Copy as Markdown", description: "Push a plain Markdown export onto the clipboard." },
        { id: "obsidian", label: "Save Obsidian Markdown", description: "Markdown with YAML frontmatter and Aviary tags." },
        { id: "notion", label: "Save Notion Markdown", description: "Heading-first Markdown that Notion imports cleanly." },
        { id: "raw-json", label: "Save records JSON", description: "Raw ExportRecord[] JSON without ZIP wrapping." }
      ];
      for (const target of targets) {
        rows.push(
          actionRow(target.label, target.description, async () => {
            try {
              const result = await options.exportToTarget!(target.id);
              setStatus(
                result.copied
                  ? `Copied ${result.records} records to clipboard.`
                  : `Exported ${result.records} records → ${target.label.toLowerCase()}.`
              );
            } catch (error) {
              options.onError("External export failed", error);
              setStatus("External export failed.");
            }
          })
        );
      }
    }

    if (options.getRetentionPolicy && options.saveRetentionPolicy) {
      rows.push(
        integerInputRow(
          "Records per ZIP",
          "Split a long export across several archives instead of one huge file (25-1000).",
          options.settings.media.zipChunkSize,
          async (value) => {
            options.settings.media.zipChunkSize = value;
            await save("Records per ZIP saved");
          }
        )
      );
      const policy = options.getRetentionPolicy();
      rows.push(
        integerInputRow(
          "Maximum export jobs",
          "Keep the newest jobs. Use 0 for unlimited.",
          policy.maxJobs,
          async (value) => {
            await options.saveRetentionPolicy!({ ...options.getRetentionPolicy!(), maxJobs: value });
            render();
            setStatus("Export job retention saved");
          }
        )
      );
      rows.push(
        integerInputRow(
          "Maximum records per job",
          "Keep the newest records in each job. Use 0 for unlimited.",
          policy.maxRecordsPerJob,
          async (value) => {
            await options.saveRetentionPolicy!({ ...options.getRetentionPolicy!(), maxRecordsPerJob: value });
            render();
            setStatus("Record retention saved");
          }
        )
      );
      rows.push(
        integerInputRow(
          "Maximum export age (days)",
          "Remove older jobs at boot. Use 0 to disable age-based cleanup.",
          policy.maxAgeDays,
          async (value) => {
            await options.saveRetentionPolicy!({ ...options.getRetentionPolicy!(), maxAgeDays: value });
            render();
            setStatus("Age-based retention saved");
          }
        )
      );
    }

    return rows;
  };

  const mediaRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    rows.push(
      toggleRow(
        "Show download buttons",
        "Inject Save and Thumb buttons over tweet photos and video thumbnails.",
        options.settings.media.buttons,
        async (checked) => {
          options.settings.media.buttons = checked;
          await save(checked ? "Media buttons on" : "Media buttons off");
        }
      )
    );
    rows.push(
      toggleRow(
        "Prefer original quality",
        "Rewrite image URLs to name=orig before downloading.",
        options.settings.media.preferOriginalImages,
        async (checked) => {
          options.settings.media.preferOriginalImages = checked;
          await save("Original quality preference saved");
        }
      )
    );
    rows.push(
      toggleRow(
        "Show images at original quality",
        "Loads timeline photos at full size instead of the version X picks for the slot. Sharper, and several times the bytes.",
        options.settings.media.inlineOriginalImages,
        async (checked) => {
          options.settings.media.inlineOriginalImages = checked;
          await save(checked ? "Full-size images on" : "Full-size images off");
        }
      )
    );
    rows.push(
      textInputRow(
        "Filename template",
        "Fields: {handle}, {tweetId}, {mediaId}, {index}, {total}, {date}, {text}, {ext}.",
        options.settings.media.filenameTemplate,
        async (value) => {
          options.settings.media.filenameTemplate = value.length > 0 ? value : "{handle}_{tweetId}_{index}";
          await save("Filename template saved");
        }
      )
    );
    rows.push(
      toggleRow(
        "Duplicate history",
        "Skip downloads of media you have already saved from this browser.",
        options.settings.media.downloadHistory,
        async (checked) => {
          options.settings.media.downloadHistory = checked;
          await save(checked ? "Duplicate history on" : "Duplicate history off");
        }
      )
    );
    rows.push(
      selectRow(
        "Sensitive content",
        options.settings.media.sensitive,
        SENSITIVE_OPTIONS,
        async (value) => {
          options.settings.media.sensitive = coerceSensitive(value);
          await save("Sensitive content preference saved");
        }
      )
    );
    rows.push(
      selectRow(
        "Media layout",
        options.settings.media.layout,
        MEDIA_LAYOUT_OPTIONS,
        async (value) => {
          options.settings.media.layout = coerceLayout(value);
          await save("Media layout saved");
        }
      )
    );

    const status = options.getMediaStatus?.();
    if (status) {
      rows.push(
        dataRow(
          "Download status",
          `${status.running} running / ${status.completed} done / ${status.duplicate} dup / ${status.failed} failed`
        )
      );
      rows.push(dataRow("History entries", String(status.historySize)));
    }

    if (options.clearMediaHistory) {
      rows.push(
        actionRow("Clear download history", "Reset the local dedup index.", async () => {
          try {
            await options.clearMediaHistory?.();
            await save("History cleared");
          } catch (error) {
            options.onError("Could not clear download history", error);
            setStatus("Could not clear history.");
          }
        })
      );
    }

    if (options.runMediaBatch) {
      rows.push(
        actionRow(
          "Download all visible media",
          "Walks every tweet rendered on the current page and queues every photo/video/GIF/thumbnail through the existing download pipeline.",
          async () => {
            setStatus("Downloading media from this view…");
          try {
              const result = await options.runMediaBatch!();
              setStatus(
                `Batch finished: ${result.downloaded} saved / ${result.duplicate} dup / ${result.failed} failed (of ${result.total}).`
              );
            } catch (error) {
              options.onError("Batch download failed", error);
              setStatus("Batch download failed.");
            }
          }
        )
      );
    }

    return rows;
  };

  const filterRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    rows.push(
      toggleRow(
        "Enable filters",
        "Master switch for keyword, regex, premium, and media filters.",
        options.settings.filter.enabled,
        async (checked) => {
          options.settings.filter.enabled = checked;
          await save(checked ? "Filters enabled" : "Filters disabled");
        }
      )
    );

    rows.push(
      textareaRow(
        "Keyword rules",
        "One keyword or phrase per line. Case-insensitive substring match.",
        options.settings.filter.keywordRules,
        async (lines) => {
          options.settings.filter.keywordRules = lines.slice(0, 200);
          await save(`Saved ${options.settings.filter.keywordRules.length} keyword rules`);
        }
      )
    );

    rows.push(
      textareaRow(
        "Regex rules",
        "One pattern per line. Use /pattern/flags or a bare pattern (case-insensitive).",
        options.settings.filter.regexRules,
        async (lines) => {
          options.settings.filter.regexRules = lines.slice(0, 100);
          await save(`Saved ${options.settings.filter.regexRules.length} regex rules`);
        }
      )
    );

    rows.push(
      textareaRow(
        "Whitelist handles",
        "Handles (one per line, no @) that are never filtered.",
        options.settings.filter.whitelist,
        async (lines) => {
          options.settings.filter.whitelist = lines
            .map((line) => line.replace(/^@/, "").trim())
            .filter((line) => /^[A-Za-z0-9_]{1,15}$/.test(line))
            .slice(0, 200);
          await save(`Saved ${options.settings.filter.whitelist.length} whitelist handles`);
        }
      )
    );

    rows.push(
      selectRow(
        "Premium / verified posts",
        options.settings.filter.premiumRule,
        FILTER_ACTION_OPTIONS,
        async (value) => {
          options.settings.filter.premiumRule = coerceFilterAction(value);
          await save("Premium filter saved");
        }
      )
    );

    for (const key of FILTER_MEDIA_KEYS) {
      const label = FILTER_MEDIA_LABELS[key];
      const current = options.settings.filter.mediaTypes[key] === true;
      rows.push(
        toggleRow(
          `Hide posts with ${label.toLowerCase()}`,
          `Filter posts containing ${label.toLowerCase()}.`,
          current,
          async (checked) => {
            options.settings.filter.mediaTypes = {
              ...options.settings.filter.mediaTypes,
              [key]: checked
            };
            await save(`${label} filter ${checked ? "on" : "off"}`);
          }
        )
      );
    }

    rows.push(
      surfaceRow(
        "Active on",
        "Routes where filters run.",
        options.settings.filter.surfaces,
        async (next) => {
          options.settings.filter.surfaces = next;
          await save(
            next.length > 0
              ? `Filters active on ${next.length} route${next.length === 1 ? "" : "s"}`
              : "Filters off on every route"
          );
        }
      )
    );

    rows.push(
      readonlyRow(
        "Blocked accounts / self-reposts",
        "Pending an authenticated fixture; controls stay disabled."
      )
    );

    return rows;
  };

  const hiddenPostRows = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];

    rows.push(
      toggleRow(
        "Hide dismissed posts",
        "Keep posts you hid collapsed so the next post rises to the top.",
        options.settings.hidden.enabled,
        async (checked) => {
          options.settings.hidden.enabled = checked;
          await save(checked ? "Hidden posts applied" : "Hidden posts revealed");
        }
      )
    );

    rows.push(
      toggleRow(
        "Show hide buttons",
        "Adds a Hide control to every post next to the More menu.",
        options.settings.hidden.buttons,
        async (checked) => {
          options.settings.hidden.buttons = checked;
          await save(checked ? "Hide buttons on" : "Hide buttons off");
        }
      )
    );

    rows.push(
      surfaceRow(
        "Active on",
        "Routes where hiding and the Hide button apply.",
        options.settings.hidden.surfaces,
        async (next) => {
          options.settings.hidden.surfaces = next;
          await save(
            next.length > 0
              ? `Hiding active on ${next.length} route${next.length === 1 ? "" : "s"}`
              : "Hiding off on every route"
          );
        }
      )
    );

    rows.push(
      integerInputRow(
        "Maximum remembered posts",
        "Oldest entries are dropped once the store passes this size (100-50000).",
        options.settings.hidden.maxEntries,
        async (value) => {
          options.settings.hidden.maxEntries = value;
          await save(`Hidden post limit set to ${options.settings.hidden.maxEntries}`);
        }
      )
    );

    const status = options.getHiddenPostsStatus?.();
    if (!status) {
      rows.push(readonlyRow("Hidden posts", "Hidden post store unavailable in this build."));
      return rows;
    }

    rows.push(
      dataRow(
        "Hidden posts stored",
        `${status.total}${status.updatedAt ? ` · updated ${status.updatedAt}` : ""}`
      )
    );

    if (options.undoLastHide) {
      rows.push(
        actionRow("Undo last hide", "Restores the most recently hidden post.", async () => {
          try {
            const result = await options.undoLastHide!();
            setStatus(
              result.restored
                ? `Restored ${result.handle ? `@${result.handle}` : "the last hidden post"}.`
                : "Nothing left to restore."
            );
            render();
          } catch (error) {
            options.onError("Could not undo the last hide", error);
            setStatus("Could not undo the last hide.");
          }
        })
      );
    }

    for (const entry of status.recent) {
      const row = el("div", "av-row av-row-stack");
      const copy = el("span", "av-row-copy");
      copy.append(
        el("span", "av-row-label", entry.handle ? `@${entry.handle}` : "Unknown account"),
        el(
          "span",
          "av-row-description",
          `${entry.hiddenAt} — ${entry.text.length > 0 ? entry.text : "(no text)"}`
        )
      );
      const restore = el("button", "av-button av-button-secondary", t("Restore")) as HTMLButtonElement;
      restore.type = "button";
      restore.addEventListener("click", () => {
        restore.disabled = true;
        void options
          .unhidePost?.(entry.key)
          .then((restored) => {
            setStatus(restored ? "Post restored." : "That post was already restored.");
            render();
          })
          .catch((error: unknown) => {
            options.onError("Could not restore the post", error);
            setStatus("Could not restore the post.");
            restore.disabled = false;
          });
      });
      row.append(copy, restore);
      rows.push(row);
    }

    if (options.clearHiddenPosts && status.total > 0) {
      rows.push(
        actionRow(
          "Clear hidden posts",
          "Forgets every hidden post and brings them all back.",
          async () => {
            try {
              const removed = await options.clearHiddenPosts!();
              setStatus(`Cleared ${removed} hidden post${removed === 1 ? "" : "s"}.`);
              render();
            } catch (error) {
              options.onError("Could not clear hidden posts", error);
              setStatus("Could not clear hidden posts.");
            }
          }
        )
      );
    }

    return rows;
  };

  const save = async (message: string): Promise<void> => {
    setStatus("Saving...");
    try {
      await options.onChange();
      render();
      setStatus(message);
    } catch (error) {
      options.onError("Control Center could not save settings", error);
      setStatus("Could not save settings. Try again.");
    }
  };

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
      return `${label} — every panel string translated (${renderedStrings}).`;
    }
    return `${label} — ${translatedStrings} of ${renderedStrings} panel strings translated (${percent}%). The rest fall back to English.`;
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
      return readonlyRow("Saving", "Working — every change has been written.");
    }
    const last = failures[failures.length - 1]?.message ?? "";
    return dataRow(
      "Saving",
      `${t("Some changes could not be saved — the browser store may be full.")} ${last} (${failures.length})`
    );
  };

  const selectorSummary = (): string => {
    const last = [...options.diagnostics()].reverse().find((event) => event.message.includes("Selector"));
    return last?.message ?? "Monitoring active";
  };

  launcher.addEventListener("click", () => setOpen(!open));
  close.addEventListener("click", () => setOpen(false));
  // `input` covers typing and the native clear affordance alike. The field is outside `body`,
  // so the re-render below cannot steal the caret back.
  search.addEventListener("input", () => {
    searchQuery = search.value;
    render();
  });
  render();

  return {
    destroy() {
      host.remove();
    },
    refresh() {
      if (!open || isBusy()) {
        dirtyWhileBusy = true;
        return;
      }
      render();
    }
  };
}

const FOCUSABLE_SELECTOR = "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])";
const COVERAGE_ROW_CLASS = "av-locale-coverage";

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

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const node = el("section", "av-section");
  node.append(el("h3", "av-section-title", t(title)), ...rows);
  return node;
}

function toggleRow(
  label: string,
  description: string,
  checked: boolean,
  onChange: (checked: boolean) => Promise<void>
): HTMLElement {
  const row = el("label", "av-row");
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => {
    void onChange(input.checked);
  });

  row.append(copy, input);
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
  translateOptions = true
): HTMLElement {
  const row = el("label", "av-row");
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
    void onChange(select.value);
  });

  row.append(select);
  return row;
}

function readonlyRow(label: string, value: string): HTMLElement {
  const row = el("div", "av-row av-row-readonly");
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
  row.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", value));
  return row;
}

function textInputRow(
  label: string,
  description: string,
  value: string,
  onChange: (value: string) => Promise<void>
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "av-text-input";
  input.value = value;
  input.spellcheck = false;
  input.setAttribute("aria-label", t(label));

  const apply = el("button", "av-button av-button-secondary", t("Save")) as HTMLButtonElement;
  apply.type = "button";
  apply.addEventListener("click", () => {
    void onChange(input.value.trim());
  });

  row.append(input, apply);
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
  onChange: (value: string) => Promise<void>
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
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

  const apply = el("button", "av-button av-button-secondary", t("Save")) as HTMLButtonElement;
  apply.type = "button";
  apply.addEventListener("click", () => {
    void onChange(input.value.trim());
  });

  controls.append(reveal, apply);
  row.append(input, controls);
  return row;
}

function integerInputRow(
  label: string,
  description: string,
  value: number,
  onChange: (value: number) => Promise<void>
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "1";
  input.className = "av-text-input";
  input.value = String(value);
  input.setAttribute("aria-label", t(label));

  const apply = el("button", "av-button av-button-secondary", t("Save")) as HTMLButtonElement;
  apply.type = "button";
  apply.addEventListener("click", () => {
    const parsed = Number.parseInt(input.value, 10);
    void onChange(Number.isFinite(parsed) ? parsed : 0);
  });

  row.append(input, apply);
  return row;
}

function actionRow(
  label: string,
  description: string,
  onClick: () => Promise<void>
): HTMLElement {
  const row = el("div", "av-row");
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const button = el("button", "av-button av-button-secondary", t(label)) as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => {
    button.disabled = true;
    void onClick().finally(() => {
      button.disabled = false;
    });
  });
  row.append(button);
  return row;
}

function textareaRow(
  label: string,
  description: string,
  lines: string[],
  onChange: (lines: string[]) => Promise<void>,
  actionLabel = "Save list"
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
  const copy = el("span", "av-row-copy");
  copy.append(el("span", "av-row-label", t(label)), el("span", "av-row-description", t(description)));
  row.append(copy);

  const textarea = document.createElement("textarea");
  textarea.className = "av-textarea";
  textarea.value = lines.join("\n");
  textarea.spellcheck = false;
  textarea.rows = 4;
  textarea.setAttribute("aria-label", t(label));

  const apply = el("button", "av-button av-button-secondary", t(actionLabel)) as HTMLButtonElement;
  apply.type = "button";
  apply.addEventListener("click", () => {
    const next = textarea.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line, index, array) => line.length > 0 && array.indexOf(line) === index);
    void onChange(next);
  });

  row.append(textarea, apply);
  return row;
}

function surfaceRow(
  label: string,
  description: string,
  selected: FilterSurface[],
  onChange: (next: FilterSurface[]) => Promise<void>
): HTMLElement {
  const row = el("div", "av-row av-row-stack");
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
      void onChange(FILTER_SURFACES.filter((value) => state.has(value)));
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

function coerceSensitive(value: string): SensitiveMode {
  return value === "reveal" || value === "blur" || value === "hide" ? value : "default";
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

const CONTROL_CENTER_CSS = `
:host {
  color-scheme: dark;
  font-family: TwitterChirp, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.av-shell {
  position: fixed;
  inset: 0;
  z-index: 2147482600;
  pointer-events: none;
}

.av-launcher {
  position: fixed;
  right: 18px;
  bottom: 18px;
  min-width: 78px;
  min-height: 42px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 70%, transparent);
  border-radius: 8px;
  /* Follows the active theme's accent — this was pinned to X blue in every theme. */
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 22%, transparent),
    color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 12%, transparent)
  );
  color: var(--av-text, rgb(239, 243, 244));
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.42);
  cursor: pointer;
  font-weight: 700;
  font-size: 13px;
  line-height: 1.1;
  font-family: inherit;
  letter-spacing: 0;
  pointer-events: auto;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
}

.av-launcher:hover {
  transform: translateY(-1px);
  border-color: var(--av-accent, rgb(29, 155, 240));
}

.av-launcher:focus-visible,
.av-button:focus-visible,
.av-select:focus-visible,
input:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 3px;
}

.av-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  justify-content: end;
  align-items: end;
  padding: 72px 18px 72px;
  opacity: 0;
  pointer-events: none;
  /* Belt and braces with [inert]: keeps the closed panel out of the tab order even where
     inert is unsupported. Delayed so the fade-out still runs. */
  visibility: hidden;
  transform: translateY(8px);
  transition: opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms;
}

.av-overlay.is-open {
  opacity: 1;
  pointer-events: none;
  visibility: visible;
  transform: translateY(0);
  transition: opacity 160ms ease, transform 160ms ease, visibility 0s;
}

.av-panel {
  /* Was 386px for all twelve sections stacked in one column. The rail needs room beside the
     content, and the content itself reads badly at ~350px once descriptions wrap to four
     lines. */
  width: min(780px, calc(100vw - 36px));
  max-height: min(720px, calc(100vh - 96px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 12px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 96%, black);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.58);
  pointer-events: auto;
}

/* The panel takes focus when it opens; the UA default paints a hard white halo around the
   whole dialog. Keep the indicator, make it read as a highlighted edge instead. */
.av-panel:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 70%, transparent);
  outline-offset: -2px;
}

.av-panel-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--av-border, rgb(47, 51, 54));
}

.av-title {
  margin: 0;
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 18px;
  line-height: 1.25;
}

.av-subtitle {
  margin: 4px 0 0;
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 13px;
  line-height: 1.35;
}

.av-button,
.av-select {
  min-height: 34px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 8px;
  background: var(--av-surface-raised, rgb(22, 24, 28));
  color: var(--av-text, rgb(239, 243, 244));
  font-weight: 650;
  font-size: 13px;
  line-height: 1.2;
  font-family: inherit;
}

.av-button {
  padding: 0 12px;
  cursor: pointer;
}

.av-searchbar {
  padding: 12px 18px;
  border-bottom: 1px solid var(--av-border, rgb(47, 51, 54));
}

.av-search-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 8px;
  background: var(--av-surface, rgb(15, 20, 25));
  color: var(--av-text, rgb(239, 243, 244));
  font-size: 13px;
  line-height: 1.4;
  font-family: inherit;
}

.av-search-input::placeholder {
  color: var(--av-muted, rgb(113, 118, 123));
}

/* Two panes: a fixed rail and a scrolling content column. Each scrolls independently, so
   moving through a long section never scrolls the section list out of reach. */
.av-panel-body {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.av-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  overflow-y: auto;
  border-right: 1px solid var(--av-border, rgb(47, 51, 54));
}

.av-nav-group {
  /* The rail is sized so all twelve sections fit without scrolling at the default panel
     height; a sliced-in-half last item reads as a rendering bug rather than as "more below". */
  margin: 6px 0 2px;
  padding: 0 8px;
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 10px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.av-nav-group:first-child {
  margin-top: 0;
}

.av-nav-item {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--av-muted, rgb(113, 118, 123));
  font-weight: 600;
  font-size: 13px;
  line-height: 1.2;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.av-nav-item:hover {
  background: var(--av-surface-raised, rgb(22, 24, 28));
  color: var(--av-text, rgb(239, 243, 244));
}

.av-nav-item.is-active {
  border-color: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 45%, transparent);
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 16%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
}

.av-content {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 16px;
  overflow-y: auto;
  min-height: 0;
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
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 13px;
  line-height: 1.4;
}

.av-section {
  display: grid;
  gap: 8px;
}

.av-section-title {
  margin: 0;
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  text-transform: uppercase;
}

.av-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 48px;
  padding: 10px 12px;
  /* The border token alone sits near 1.4:1 against the row fill, which reads as no border at
     all across ~100 rows. Lifted toward the text token so grouping is actually visible. */
  border: 1px solid color-mix(in srgb, var(--av-border, rgb(47, 51, 54)), var(--av-text, rgb(239, 243, 244)) 18%);
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(22, 24, 28)) 62%, transparent);
}

.av-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

/* Text fields and textareas want the full row width; an action button does not. At the old
   386px panel a stretched button looked deliberate — at 780px it reads as a banner. */
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
  min-height: 96px;
  resize: vertical;
}

.av-text-input {
  height: 34px;
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

.av-search-hit {
  display: grid;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--av-border, rgb(47, 51, 54)) 70%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 70%, transparent);
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
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 6px;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(22, 24, 28)) 70%, transparent);
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
  font-size: 13px;
  font-weight: 720;
  line-height: 1.25;
}

.av-row-description {
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 12px;
  line-height: 1.35;
}

input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--av-accent, rgb(29, 155, 240));
}

.av-select {
  max-width: 150px;
  padding: 0 10px;
}

.av-status {
  min-height: 35px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--av-border, rgb(47, 51, 54));
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 12px;
  line-height: 1.3;
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

@media (max-width: 760px) {
  .av-launcher {
    right: 12px;
    bottom: 12px;
    min-width: 92px;
    min-height: 48px;
  }

  .av-overlay {
    padding: 16px 8px 84px;
  }

  .av-panel {
    width: min(420px, calc(100vw - 16px));
    max-height: min(85vh, calc(100vh - 64px));
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
    border-right: 0;
    border-bottom: 1px solid var(--av-border, rgb(47, 51, 54));
  }

  .av-nav-item {
    flex: 0 0 auto;
    min-height: 44px;
  }

  /* The group headings only make sense stacked; the chip order still follows them. */
  .av-nav-group {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .av-launcher,
  .av-overlay {
    transition: none;
  }
}

/* The reduceMotion setting can force reduction with no OS preference set, and a page-level
   class cannot cross into this shadow tree — the host carries the state instead. */
:host([data-av-motion="reduce"]) .av-launcher,
:host([data-av-motion="reduce"]) .av-launcher:hover,
:host([data-av-motion="reduce"]) .av-overlay {
  transition: none;
  transform: none;
}
`;
