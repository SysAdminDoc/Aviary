/**
 * A text-free measurement of X's page structure, in the shape `_decoded/dom-schema.json` records.
 *
 * Refreshing that schema used to need a signed-in MHTML save, a decode, measurement and deletion
 * of a page that carried a real account's posts. This measures the same facts from the live page
 * and returns only counts, nesting depths, computed layout keywords and the keys the schema already
 * names. It never reads text content, attribute values it did not ask about, URLs, handles or ids.
 *
 * The plan below mirrors the schema's `testIds`, `roles` and `aria` maps; a test fails the moment
 * the two disagree, so the schema stays the only authority.
 */

export const STRUCTURAL_OBSERVATION_PLAN = {
  testIds: {
    appRoot: "react-root",
    primaryColumn: "primaryColumn",
    sidebarColumn: "sidebarColumn",
    post: "tweet",
    postText: "tweetText",
    composer: "tweetTextarea_0",
    photo: "tweetPhoto",
    videoPlayer: "videoPlayer",
    videoComponent: "videoComponent",
    cell: "cellInnerDiv",
    toolBar: "toolBar",
    metricContainer: "app-text-transition-container",
    authorName: "User-Name",
    avatar: "Tweet-User-Avatar",
    verifiedIcon: "icon-verified",
    caret: "caret",
    reply: "reply",
    repost: "retweet",
    like: "like",
    bookmark: "bookmark",
    trend: "trend",
    newsSidebar: "news_sidebar",
    userCell: "UserCell",
    homeTabLink: "AppTabBar_Home_Link",
    exploreTabLink: "AppTabBar_Explore_Link",
    composeButton: "SideNav_NewTweet_Button",
    searchInput: "SearchBox_Search_Input",
    placement: "placementTracking",
    grokDrawer: "GrokDrawer",
    grokImageGen: "grokImgGen",
    tabStrip: "ScrollSnap-List"
  },
  roles: {
    post: "article",
    banner: "banner",
    navigation: "navigation",
    main: "main",
    timeline: "region",
    actionGroup: "group",
    tabStrip: "tablist",
    tab: "tab",
    link: "link",
    button: "button",
    heading: "heading",
    searchBox: "combobox"
  },
  aria: {
    postLabelledBy: "aria-labelledby",
    quoteBoundaryTabIndex: "0",
    verifiedLabel: "Verified account",
    photoLabel: "Image",
    videoLabel: "Embedded video",
    caretLabel: "More",
    grokActionsLabel: "Grok actions",
    shareLabel: "Share post",
    bookmarkLabel: "Bookmark",
    analyticsLabelSuffix: "views. View post analytics",
    replyLabelSuffix: "Replies. Reply",
    repostLabelSuffix: "reposts. Repost",
    likeLabelSuffix: "Likes. Like",
    hiddenSeparator: "aria-hidden"
  }
} as const;

type PlanKey<K extends keyof typeof STRUCTURAL_OBSERVATION_PLAN> = keyof (typeof STRUCTURAL_OBSERVATION_PLAN)[K];

/** The schema's per-route counts, each named for the test id it counts. */
const COUNTED: Record<string, PlanKey<"testIds">> = {
  cells: "cell",
  posts: "post",
  postTexts: "postText",
  photos: "photo",
  videoPlayers: "videoPlayer",
  videoComponents: "videoComponent",
  verifiedIcons: "verifiedIcon",
  authorNames: "authorName",
  placements: "placement",
  userCells: "userCell",
  trends: "trend",
  carets: "caret",
  metricContainers: "metricContainer"
};

export interface StructuralObservation {
  $comment: string;
  ceilingDays: number;
  warnDays: number;
  derivedFrom: { capturedOn: string; sources: string[]; notes: string };
  testIds: Record<string, number>;
  roles: Record<string, number>;
  aria: Record<string, number>;
  nesting: Record<string, number | null>;
  layout: Record<string, number | string | null>;
  /** Keyed like the schema's own routes, so the counts drop into place when merged. */
  routes: Record<string, { route: string; lang: string | null; observedCounts: Record<string, number> }>;
}

/** The schema's route templates; a real path never leaves the page. */
const ROUTE_TEMPLATES = {
  home: "https://x.com/home",
  status: "https://x.com/<handle>/status/<id>",
  other: "other"
} as const;

export function observeStructure(
  documentObject: Document,
  windowObject: Window,
  options: { now: Date; build: string; pathname: string }
): StructuralObservation {
  const plan = STRUCTURAL_OBSERVATION_PLAN;
  const byTestId = (key: PlanKey<"testIds">): Element[] =>
    [...documentObject.querySelectorAll(`[data-testid="${plan.testIds[key]}"]`)];
  const route = routeKind(options.pathname);

  const testIds: Record<string, number> = {};
  for (const key of Object.keys(plan.testIds) as PlanKey<"testIds">[]) {
    // appRoot is X's element id rather than a test id.
    testIds[key] = key === "appRoot"
      ? documentObject.querySelectorAll(`#${plan.testIds.appRoot}`).length
      : byTestId(key).length;
  }

  const roles: Record<string, number> = {};
  for (const [key, role] of Object.entries(plan.roles)) {
    roles[key] = key === "post"
      ? documentObject.querySelectorAll(`article[data-testid="${plan.testIds.post}"]`).length
      : documentObject.querySelectorAll(`[role="${role}"]`).length;
  }

  // Only how many elements carry each expected label is reported, never a label itself: an action
  // label on X embeds live counts, and some carry names.
  const labels = [...documentObject.querySelectorAll("[aria-label]")].map(
    (node) => node.getAttribute("aria-label") ?? ""
  );
  const aria: Record<string, number> = {};
  for (const [key, value] of Object.entries(plan.aria)) {
    if (key.endsWith("LabelSuffix")) aria[key] = labels.filter((label) => label.endsWith(value)).length;
    else if (key.endsWith("Label")) aria[key] = labels.filter((label) => label === value).length;
    else if (key === "quoteBoundaryTabIndex") {
      aria[key] = documentObject.querySelectorAll(`article div[role="link"][tabindex="${value}"]`).length;
    } else aria[key] = documentObject.querySelectorAll(`[${value}]`).length;
  }

  const firstIn = (key: PlanKey<"testIds">): Element | null => byTestId(key)[0] ?? null;
  const post = documentObject.querySelector(`article[data-testid="${plan.testIds.post}"]`);
  const primary = firstIn("primaryColumn");
  // Each depth inverts the generator in tools/fixture-generator.mjs, which is the schema's own
  // statement of what the number means.
  const nesting = {
    cellToArticle: wrappersBetween(post, `[data-testid="${plan.testIds.cell}"]`),
    timelineToCell: hopsTo(firstIn("cell"), `[role="${plan.roles.timeline}"]`),
    mainToPrimaryColumn: wrappersBetween(primary, `[role="${plan.roles.main}"]`),
    mediaToPhoto: wrappersBetween(firstIn("photo"), "[aria-labelledby]")
  };

  const observedCounts: Record<string, number> = {};
  for (const [name, key] of Object.entries(COUNTED)) observedCounts[name] = byTestId(key).length;

  const width = (node: Element | null): number | null =>
    node ? Math.round(node.getBoundingClientRect().width) : null;
  const primaryStyle = primary ? windowObject.getComputedStyle(primary) : null;
  const main = documentObject.querySelector(`[role="${plan.roles.main}"]`);
  const mainStyle = main ? windowObject.getComputedStyle(main) : null;
  const sidebar = firstIn("sidebarColumn");
  const layout = {
    viewportWidth: windowObject.innerWidth,
    navColumnWidth: width(documentObject.querySelector(`header[role="${plan.roles.banner}"]`)),
    sidebarColumnWidth: width(sidebar),
    primaryColumnWidth: width(primary),
    primaryColumnMaxWidth: pixels(primaryStyle?.maxWidth),
    primaryColumnFlex: primaryStyle?.flex ?? null,
    primaryColumnDisplay: primaryStyle?.display ?? null,
    primaryColumnDirection: primaryStyle?.flexDirection ?? null,
    firstPostWidth: width(post),
    mainFlex: mainStyle?.flex ?? null,
    mainAlignItems: mainStyle?.alignItems ?? null,
    sidebarFlex: sidebar ? windowObject.getComputedStyle(sidebar).flex : null
  };

  return {
    $comment:
      "Structural observation copied from Aviary. Counts, nesting depths and computed layout only: " +
      "no text, names, handles, links or ids. testIds, roles and aria here are COUNTS keyed by the " +
      "schema's names; keep the schema's own maps and use these only to confirm each is present. " +
      "Copy routes.<route>.observedCounts, nesting and the layout widths into _decoded/dom-schema.json, " +
      "keep its titles, labels and cells, and set derivedFrom.capturedOn to this date.",
    ceilingDays: 90,
    warnDays: 30,
    derivedFrom: {
      capturedOn: options.now.toISOString().slice(0, 10),
      sources: [`Aviary ${options.build} structural observation of the ${route} route`],
      notes: "Measured in the signed-in page by Privacy & diagnostics > Copy structural observation."
    },
    testIds,
    roles,
    aria,
    nesting,
    layout,
    routes: {
      [route]: {
        route: ROUTE_TEMPLATES[route],
        lang: normalizeLang(documentObject.documentElement.getAttribute("lang")),
        observedCounts
      }
    }
  };
}

function routeKind(pathname: string): "home" | "status" | "other" {
  if (/^\/home\/?$/.test(pathname)) return "home";
  if (/^\/[A-Za-z0-9_]{1,30}\/status\/\d+\/?$/.test(pathname)) return "status";
  return "other";
}

/** Parent steps from `node` up to the nearest ancestor matching `selector`, or null. */
function hopsTo(node: Element | null, selector: string): number | null {
  let hops = 0;
  for (let current = node?.parentElement ?? null; current; current = current.parentElement) {
    hops += 1;
    if (current.matches(selector)) return hops;
  }
  return null;
}

/** Elements strictly between `node` and the nearest ancestor matching `selector`. */
function wrappersBetween(node: Element | null, selector: string): number | null {
  const hops = hopsTo(node, selector);
  return hops === null ? null : hops - 1;
}

function pixels(value: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value ?? "");
  return match ? Math.round(Number(match[1])) : null;
}

/**
 * A language, optional script and optional region, or nothing. Free-form private-use subtags are
 * refused: the attribute is X's today, but nothing guarantees it can never carry anything else.
 */
function normalizeLang(value: string | null): string | null {
  return value && /^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?$/i.test(value) ? value : null;
}
