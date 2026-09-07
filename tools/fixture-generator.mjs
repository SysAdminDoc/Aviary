import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Deterministic synthetic X documents, built from `_decoded/dom-schema.json`.
 *
 * Selector work still ships only when an observation proves it -- the observation now lives in the
 * schema instead of in a saved page. That separation is the point: a saved authenticated page
 * carries a real account's handle, display name, post bodies and media ids, so it can neither be
 * published nor kept, while the facts Aviary's selectors actually depend on are a short list of
 * test ids, roles, aria attributes, nesting depths and repetition counts.
 *
 * Nothing here invents a surface. Every id, role and attribute comes from the schema, so renaming
 * one there changes what the generated documents contain and the owning surface reports missing.
 * Every string of content is synthetic and obviously so.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SCHEMA_PATH = path.join(root, "_decoded", "dom-schema.json");

const ACCOUNTS = [
  ["fixture_alpha", "Fixture Alpha"],
  ["fixture_bravo", "Fixture Bravo"],
  ["fixture_charlie", "Fixture Charlie"],
  ["fixture_delta", "Fixture Delta"],
  ["fixture_echo", "Fixture Echo"],
  ["fixture_foxtrot", "Fixture Foxtrot"],
  ["fixture_golf", "Fixture Golf"],
  ["fixture_hotel", "Fixture Hotel"],
  ["fixture_india", "Fixture India"],
  ["fixture_juliett", "Fixture Juliett"],
  ["fixture_kilo", "Fixture Kilo"],
  ["fixture_lima", "Fixture Lima"]
];

const BODIES = [
  "Synthetic fixture post about a local timeline surface.",
  "Second synthetic body, long enough to wrap onto another rendered line in a narrow column.",
  "Third synthetic body with a trailing link https://example.invalid/fixture that goes nowhere.",
  "Fourth synthetic body for a post that carries a photo.",
  "Fifth synthetic body for a post that carries a video player.",
  "Sixth synthetic body for a promoted placement.",
  "Seventh synthetic body for a quoted post boundary.",
  "Eighth synthetic body kept deliberately short.",
  "Ninth synthetic body for a conversation reply.",
  "Tenth synthetic body for a discovery suggestion."
];

const TRENDS = ["#FixtureOne", "#FixtureTwo", "#FixtureThree", "#FixtureFour", "#FixtureFive"];

/** Post ids are obviously synthetic: a fixed prefix plus the post's index. */
const POST_ID_BASE = 1900000000000000000n;
const BASE_TIME = Date.UTC(2026, 4, 19, 12, 0, 0);

export async function readDomSchema(file = SCHEMA_PATH) {
  return JSON.parse(await readFile(file, "utf8"));
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

/** `<tag a="b">children</tag>`, with every attribute escaped and `null` attributes dropped. */
function el(tag, attributes = {}, children = "") {
  const rendered = Object.entries(attributes)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  return `<${tag}${rendered}>${children}</${tag}>`;
}

/** `depth` nested plain divs around `inner`, which is how X's renderer stacks its layout boxes. */
function wrap(depth, inner, attributes = {}) {
  let html = inner;
  for (let index = 0; index < depth; index += 1) {
    html = el("div", index === depth - 1 ? attributes : {}, html);
  }
  return html;
}

/**
 * X abbreviates the visible count and keeps the exact one on the button's `aria-label`. A zero
 * renders no text at all, which is the case that separates "no replies" from "unreadable".
 */
function abbreviate(value) {
  if (value === 0) return "";
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1000;
    return thousands >= 100 ? `${Math.floor(thousands)}K` : `${(Math.floor(thousands * 10) / 10).toString()}K`;
  }
  return `${(Math.floor((value / 1_000_000) * 10) / 10).toString()}M`;
}

function metric(schema, value) {
  return el(
    "span",
    { "data-testid": schema.testIds.metricContainer },
    el("span", {}, el("span", {}, escapeText(abbreviate(value))))
  );
}

function actionButton(schema, testId, label, count) {
  return el(
    "div",
    {},
    el(
      "button",
      { "data-testid": testId, role: schema.roles.button, "aria-label": label, type: "button" },
      el("div", { dir: "ltr" }, el("div", {}, metric(schema, count)))
    )
  );
}

function authorBlock(schema, account, postId, verified, timestamp, relative) {
  const [handle, displayName] = account;
  const verifiedMark = verified
    ? el(
        "div",
        { dir: "ltr" },
        el(
          "span",
          {},
          el(
            "svg",
            {
              "aria-label": schema.aria.verifiedLabel,
              role: "img",
              "data-testid": schema.testIds.verifiedIcon
            },
            el("g", {}, "<path></path>")
          )
        )
      )
    : "";

  const nameRow = el(
    "div",
    {},
    el(
      "div",
      {},
      el(
        "a",
        { href: `https://x.com/${handle}`, role: schema.roles.link },
        el("div", {}, el("div", { dir: "ltr" }, el("span", {}, el("span", {}, escapeText(displayName)))) + verifiedMark)
      )
    )
  );

  const handleRow = el(
    "div",
    {},
    el(
      "div",
      {},
      el(
        "div",
        {},
        el(
          "a",
          { href: `https://x.com/${handle}`, role: schema.roles.link, tabindex: "-1" },
          el("div", { dir: "ltr" }, el("span", {}, escapeText(`@${handle}`)))
        )
      ) +
        el("div", { dir: "ltr", [schema.aria.hiddenSeparator]: "true" }, el("span", {}, "·")) +
        el(
          "div",
          {},
          el(
            "a",
            {
              href: `https://x.com/${handle}/status/${postId}`,
              dir: "ltr",
              "aria-label": `${relative} ago`,
              role: schema.roles.link
            },
            el("time", { [schema.observedHead.timeAttribute]: timestamp }, escapeText(relative))
          )
        )
    )
  );

  return el("div", { "data-testid": schema.testIds.authorName }, nameRow + handleRow);
}

function photoBlock(schema, index) {
  const image = el("img", {
    alt: schema.aria.photoLabel,
    src: `https://pbs.twimg.com/media/AviaryFixtureMedia${String(index).padStart(2, "0")}?format=jpg&name=900x900`
  }).replace("></img>", ">");
  const photo = el(
    "div",
    { "data-testid": schema.testIds.photo, "aria-label": schema.aria.photoLabel },
    el("div", {}, "") + image
  );
  return el("div", { "aria-labelledby": `id_media_${index}` }, wrap(schema.nesting.mediaToPhoto, photo));
}

function videoBlock(schema, index) {
  const stem = `AviaryFixtureVideo${String(index).padStart(2, "0")}`;
  const poster = `https://pbs.twimg.com/amplify_video_thumb/${POST_ID_BASE + BigInt(900 + index)}/img/${stem}.jpg`;
  const source = `<source type="video/mp4" src="https://video.twimg.com/amplify_video/${
    POST_ID_BASE + BigInt(900 + index)
  }/vid/avc1/1280x720/${stem}.mp4?tag=fixture">`;
  const video = el(
    "video",
    { tabindex: "-1", "aria-label": schema.aria.videoLabel, poster },
    source
  );
  const component = el("div", { "data-testid": schema.testIds.videoComponent }, el("div", {}, video));
  const player = el("div", { "data-testid": schema.testIds.videoPlayer }, el("div", {}, component));
  return el("div", { "aria-labelledby": `id_media_${index}` }, player);
}

/**
 * The quoted-post boundary: a `role=link` box with `tabindex=0` whose author name is what tells it
 * apart from a link-preview card wearing the same role.
 */
function quoteBlock(schema, account, quotedVerified, index) {
  const quotedId = POST_ID_BASE + BigInt(500 + index);
  const inner =
    authorBlock(
      schema,
      account,
      quotedId,
      quotedVerified,
      new Date(BASE_TIME - (index + 40) * 3_600_000).toISOString(),
      `${index + 40}h`
    ) +
    el(
      "div",
      { "data-testid": schema.testIds.postText, lang: "en", dir: "auto" },
      el("span", {}, escapeText(`Quoted synthetic body ${index + 1}.`))
    );
  return el(
    "div",
    {},
    el("div", { dir: "ltr" }, el("span", {}, "Quote")) +
      el(
        "div",
        { role: schema.roles.link, tabindex: schema.aria.quoteBoundaryTabIndex },
        el("div", {}, el("div", {}, inner))
      )
  );
}

function postCell(schema, cell, index) {
  const account = ACCOUNTS[index % ACCOUNTS.length];
  const [handle] = account;
  const postId = POST_ID_BASE + BigInt(index + 1);
  const timestamp = new Date(BASE_TIME - (index + 1) * 3_600_000).toISOString();
  const relative = `${index + 1}h`;
  const counts = cell.counts;

  const controls =
    el(
      "div",
      {},
      el(
        "div",
        {},
        el(
          "button",
          { role: schema.roles.button, "aria-label": schema.aria.grokActionsLabel, type: "button" },
          el("div", { dir: "ltr" }, "")
        )
      ) +
        el(
          "div",
          {},
          el(
            "button",
            {
              "aria-expanded": "false",
              "aria-haspopup": "menu",
              "aria-label": schema.aria.caretLabel,
              role: schema.roles.button,
              "data-testid": schema.testIds.caret,
              type: "button"
            },
            el("div", { dir: "ltr" }, "")
          )
        )
    );

  const header = el(
    "div",
    {},
    el(
      "div",
      {},
      el(
        "div",
        {},
        wrap(
          3,
          el("div", { "data-testid": `UserAvatar-Container-${handle}` }, ""),
          { "data-testid": schema.testIds.avatar }
        )
      ) +
        el(
          "div",
          {},
          el("div", {}, authorBlock(schema, account, postId, cell.verified, timestamp, relative) + controls)
        )
    )
  );

  const body = el(
    "div",
    {},
    el(
      "div",
      { "data-testid": schema.testIds.postText, lang: "en", dir: "auto" },
      el("span", {}, escapeText(BODIES[index % BODIES.length]))
    )
  );

  let media = "";
  if (cell.media === "photo") media = photoBlock(schema, index);
  if (cell.media === "video") media = videoBlock(schema, index);
  if (cell.promoted) {
    media = el("div", { "data-testid": schema.testIds.placement }, media + el("span", {}, "Ad"));
  }

  const quote = cell.quote
    ? quoteBlock(schema, ACCOUNTS[(index + 5) % ACCOUNTS.length], cell.quotedVerified === true, index)
    : "";

  const actions = el(
    "div",
    {},
    el(
      "div",
      {},
      el(
        "div",
        {
          role: schema.roles.actionGroup,
          "aria-label": `${counts.replies} replies, ${counts.reposts} reposts, ${counts.likes} likes, ${counts.views} views`
        },
        actionButton(schema, schema.testIds.reply, `${counts.replies} ${schema.aria.replyLabelSuffix}`, counts.replies) +
          actionButton(
            schema,
            schema.testIds.repost,
            `${counts.reposts} ${schema.aria.repostLabelSuffix}`,
            counts.reposts
          ) +
          actionButton(schema, schema.testIds.like, `${counts.likes} ${schema.aria.likeLabelSuffix}`, counts.likes) +
          el(
            "div",
            {},
            el(
              "a",
              {
                role: schema.roles.link,
                "aria-label": `${counts.views} ${schema.aria.analyticsLabelSuffix}`,
                href: `https://x.com/${handle}/status/${postId}/analytics`
              },
              el("div", { dir: "ltr" }, el("div", {}, metric(schema, counts.views)))
            )
          ) +
          el(
            "div",
            {},
            el(
              "button",
              {
                "data-testid": schema.testIds.bookmark,
                role: schema.roles.button,
                "aria-label": schema.aria.bookmarkLabel,
                type: "button"
              },
              el("div", { dir: "ltr" }, "")
            )
          )
      )
    )
  );

  const article = el(
    "article",
    {
      "data-testid": schema.testIds.post,
      role: schema.roles.post,
      "aria-labelledby": `id_post_${index} id_body_${index}`,
      tabindex: "0"
    },
    el("div", {}, header + body + media + quote + actions)
  );

  return el(
    "div",
    { "data-testid": schema.testIds.cell },
    wrap(schema.nesting.cellToArticle, article)
  );
}

function userCell(schema, index) {
  const [handle, displayName] = ACCOUNTS[(index + 3) % ACCOUNTS.length];
  return el(
    "div",
    { "data-testid": schema.testIds.userCell },
    el("div", {}, el("span", {}, escapeText(displayName)) + el("span", {}, escapeText(`@${handle}`)))
  );
}

function whoToFollowCell(schema, cell) {
  const rows = Array.from({ length: cell.userCells }, (_, index) => userCell(schema, index)).join("");
  return el("div", { "data-testid": schema.testIds.cell }, el("div", {}, rows));
}

function headingCell(schema, cell) {
  return el(
    "div",
    { "data-testid": schema.testIds.cell },
    el(
      "h2",
      { role: schema.roles.heading, "aria-level": "2" },
      el("div", { dir: "ltr" }, el("span", {}, escapeText(cell.text)))
    )
  );
}

function navigation(schema, route) {
  const links = [
    el(
      "a",
      { "data-testid": schema.testIds.homeTabLink, href: "/home", role: schema.roles.link },
      el("span", {}, "Home")
    ),
    el(
      "a",
      { "data-testid": schema.testIds.exploreTabLink, href: "/explore", role: schema.roles.link },
      el("span", {}, "Explore")
    ),
    el("a", { href: "/i/grok", role: schema.roles.link }, el("span", {}, "Grok")),
    el(
      "a",
      { "data-testid": schema.testIds.composeButton, href: "/compose/post", role: schema.roles.link },
      el("span", {}, "Post")
    )
  ].join("");
  const drawer = el("div", { "data-testid": schema.testIds.grokDrawer }, el("div", {}, ""));
  const imageGen = route.hasGrokImageGen
    ? el("div", { "data-testid": schema.testIds.grokImageGen }, el("div", {}, ""))
    : "";
  return el(
    "header",
    { role: schema.roles.banner },
    el("nav", { role: schema.roles.navigation, "aria-label": "Primary" }, links) + drawer + imageGen
  );
}

function sidebar(schema, route) {
  const search = el(
    "div",
    {},
    el("input", {
      "data-testid": schema.testIds.searchInput,
      role: schema.roles.searchBox,
      type: "text",
      "aria-label": "Search query"
    }).replace("></input>", ">")
  );

  const news = route.hasNewsSidebar
    ? el(
        "section",
        { "data-testid": schema.testIds.newsSidebar, role: schema.roles.timeline, "aria-label": "Today's News" },
        el("h2", { role: schema.roles.heading, "aria-level": "2" }, el("span", {}, "Today's News"))
      )
    : "";

  const trends = el(
    "section",
    { role: schema.roles.timeline, "aria-label": "Trending now" },
    el("h1", { role: schema.roles.heading, "aria-level": "1" }, el("span", {}, "Trending now")) +
      TRENDS.slice(0, 4)
        .map((label) => el("div", { "data-testid": schema.testIds.trend }, el("span", {}, escapeText(label))))
        .join("")
  );

  const headings = route.sidebarHeadings
    .map((text) => el("h2", { role: schema.roles.heading, "aria-level": "2" }, el("span", {}, escapeText(text))))
    .join("");

  return el(
    "div",
    { "data-testid": schema.testIds.sidebarColumn },
    search + news + trends + headings
  );
}

function tabStrip(schema, route) {
  if (route.tabs.length === 0) return "";
  const tabs = route.tabs
    .map((tab) =>
      el(
        "div",
        { role: schema.roles.tab, "aria-selected": tab.selected ? "true" : "false", tabindex: "0" },
        el("div", {}, el("span", {}, escapeText(tab.label)))
      )
    )
    .join("");
  return el(
    "div",
    { role: schema.roles.tabStrip, "data-testid": schema.testIds.tabStrip },
    tabs
  );
}

function composer(schema, route) {
  if (!route.hasComposer) return "";
  return el(
    "div",
    { "data-testid": schema.testIds.toolBar },
    el("div", {
      "data-testid": schema.testIds.composer,
      role: "textbox",
      "aria-label": "Post text",
      contenteditable: "true"
    })
  );
}

/** The minimal stylesheet that reproduces the column geometry recorded in `layout`. */
export function generateLayoutStylesheet(schema) {
  const layout = schema.layout;
  return [
    "*, *::before, *::after { box-sizing: border-box; }",
    "body { margin: 0; }",
    `#${schema.testIds.appRoot} { display: flex; flex-direction: column; min-height: 100vh; }`,
    `#${schema.testIds.appRoot} > div { display: flex; flex-direction: row; flex: 0 0 auto; }`,
    `header[role="${schema.roles.banner}"] { flex: 0 0 ${layout.navColumnWidth}px; width: ${layout.navColumnWidth}px; }`,
    `main[role="${schema.roles.main}"] { display: flex; flex-direction: column; flex: ${layout.mainFlex}; align-items: ${layout.mainAlignItems}; min-width: 0; }`,
    `main[role="${schema.roles.main}"] > div { display: flex; flex-direction: column; flex: 1 0 auto; width: 100%; min-width: 0; }`,
    `main[role="${schema.roles.main}"] > div > div { display: flex; flex-direction: column; flex: 1 0 auto; width: 100%; min-width: 0; }`,
    `main[role="${schema.roles.main}"] > div > div > div { display: flex; flex-direction: row; flex: 1 0 auto; justify-content: ${layout.columnRowJustify}; width: 100%; min-width: 0; }`,
    `[data-testid="${schema.testIds.primaryColumn}"] { display: ${layout.primaryColumnDisplay}; flex-direction: ${layout.primaryColumnDirection}; flex: ${layout.primaryColumnFlex}; max-width: ${layout.primaryColumnMaxWidth}px; min-width: 0; }`,
    `[data-testid="${schema.testIds.sidebarColumn}"] { display: flex; flex-direction: column; flex: ${layout.sidebarFlex}; width: ${layout.sidebarColumnWidth}px; }`
  ].join("\n");
}

/**
 * One synthetic document for a route in the schema.
 *
 * `layout: true` attaches the recorded geometry as a stylesheet, which is what the timeline-width
 * measurements need. Without it the document renders unstyled, which is how the decoded captures
 * behaved and what every selector test was written against.
 */
export function generateCaptureDocument(schema, routeName, options = {}) {
  const route = schema.routes[routeName];
  if (!route) {
    throw new Error(`dom-schema.json has no route named ${JSON.stringify(routeName)}`);
  }
  // A missing observation must stop the generator, not render as the string "undefined" in an
  // attribute a test then happily matches.
  for (const field of ["lang", "route", "title"]) {
    if (typeof route[field] !== "string" || route[field].length === 0) {
      throw new Error(`dom-schema.json route ${routeName} is missing ${field}`);
    }
  }
  for (const field of ["iconRel", "iconHref", "timeAttribute"]) {
    if (typeof schema.observedHead?.[field] !== "string" || schema.observedHead[field].length === 0) {
      throw new Error(`dom-schema.json is missing observedHead.${field}`);
    }
  }

  let postIndex = 0;
  const cells = route.cells
    .map((cell) => {
      if (cell.kind === "post") {
        const html = postCell(schema, cell, postIndex);
        postIndex += 1;
        return html;
      }
      if (cell.kind === "whoToFollow") return whoToFollowCell(schema, cell);
      if (cell.kind === "heading") return headingCell(schema, cell);
      throw new Error(`dom-schema.json has no generator for cell kind ${JSON.stringify(cell.kind)}`);
    })
    .join("");

  // Each cell is its own `section > div > *` child, which is the shape the timeline-cell fallback
  // selector is written against.
  const timeline = el(
    "section",
    { role: schema.roles.timeline, "aria-label": route.timelineLabel },
    wrap(schema.nesting.timelineToCell - 1, cells)
  );

  const primary = el(
    "div",
    { "data-testid": schema.testIds.primaryColumn },
    el("h1", { role: schema.roles.heading, "aria-level": "1" }, el("span", {}, escapeText(route.primaryHeading))) +
      tabStrip(schema, route) +
      composer(schema, route) +
      timeline
  );

  const columns = el("div", {}, primary + sidebar(schema, route));
  const main = el("main", { role: schema.roles.main }, wrap(schema.nesting.mainToPrimaryColumn - 1, columns));
  const shell = el("div", {}, navigation(schema, route) + main);
  // X ships this inline on the app root itself, so it survives with or without its stylesheets
  // and it is what makes the unstyled document lay out as flex items rather than blocks.
  const appRoot = el("div", { id: schema.testIds.appRoot, style: schema.layout.appRootInlineStyle }, shell);

  const stylesheet = options.layout ? `<style>${generateLayoutStylesheet(schema)}</style>` : "";

  return [
    "<!doctype html>",
    `<html lang="${escapeAttribute(route.lang)}" dir="ltr">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeText(route.title)}</title>`,
    // Both facts are recorded observations, not generator decoration: a feature reads each one,
    // and if X stops shipping it the schema is what changes.
    `<link rel="${escapeAttribute(schema.observedHead.iconRel)}" href="${escapeAttribute(schema.observedHead.iconHref)}">`,
    `<link rel="canonical" href="${escapeAttribute(route.route)}">`,
    stylesheet,
    "</head>",
    `<body style="${escapeAttribute(schema.layout.bodyInlineStyle)}">`,
    appRoot,
    "</body>",
    "</html>"
  ].join("\n");
}

/** Both routes at once, keyed by route name. */
export async function generateAllCaptureDocuments(options = {}) {
  const schema = options.schema ?? (await readDomSchema());
  const documents = {};
  for (const routeName of Object.keys(schema.routes)) {
    documents[routeName] = generateCaptureDocument(schema, routeName, options);
  }
  return documents;
}
