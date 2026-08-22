import type { PanelContext } from "../panel-context.ts";
import {
  ENGAGEMENT_METRIC_OPTIONS,
  FILTER_ACTION_OPTIONS,
  FILTER_REASON_OPTIONS,
  FILTER_MEDIA_LABELS,
  HIDE_NAV_ITEM_IDS
} from "../constants.ts";
import {
  CUSTOM_CSS_SCOPE_IDS,
  sanitizeCustomCss,
  FILTER_MEDIA_KEYS,
  isEngagementMetric,
  isFilterReasonMode
} from "../../../platform/settings.ts";
export function buildAppearanceRows(ctx: PanelContext): HTMLElement[] {
  const rows = [
      ctx.selectRow("Theme", ctx.options.settings.appearance.theme, [
        ["off", "Off (X's own theme)"],
        ["dim", "Dim"],
        ["lightsOut", "Lights out"],
        ["graphite", "Graphite"],
        ["plum", "Plum"],
        ["midnight", "Midnight"],
        ["noir", "Noir"]
      ], async (value) => {
        if (!ctx.isThemeId(value)) {
          ctx.setStatus("Theme value is not supported.");
          return;
        }
        ctx.options.settings.appearance.theme = value;
        await ctx.save("Theme updated");
      }, "Noir adds Aviary's premium cyan-violet skin; Off leaves X's own styling untouched."),
      ctx.toggleRow("Dense mode", "Tighten timeline spacing for scanning.", ctx.options.settings.appearance.denseMode, async (checked) => {
        ctx.options.settings.appearance.denseMode = checked;
        await ctx.save("Density updated");
      }),
      ctx.selectRow(
        "Timeline width",
        ctx.options.settings.appearance.timelineWidth,
        [
          ["default", "Default"],
          ["comfortable", "Comfortable"],
          ["wide", "Wide"]
        ],
        async (value) => {
          ctx.options.settings.appearance.timelineWidth = value as "default" | "comfortable" | "wide";
          await ctx.save("Timeline width updated");
        },
        "Comfortable keeps the discovery rail. Wide uses a centered 1120px media canvas and hides the rail."
      ),
      ctx.readonlyRow(
        "Custom CSS",
        "Optional local overrides for the scoped surfaces below. CSS never leaves this profile and is not covered by bug-report expectations."
      ),
      ctx.toggleRow(
        "Restore the Chirp font",
        "Force X's own Chirp typeface where the site has fallen back to a system font.",
        ctx.options.settings.appearance.restoreChirp,
        async (checked) => {
          ctx.options.settings.appearance.restoreChirp = checked;
          await ctx.save(checked ? "Chirp font on" : "Chirp font off");
        }
      ),
      ctx.toggleRow(
        "Hide engagement counts",
        "Master switch for the four numbers below. The controls still work and screen readers still announce the totals.",
        ctx.options.settings.appearance.hideCounts,
        async (checked) => {
          ctx.options.settings.appearance.hideCounts = checked;
          await ctx.save(checked ? "Engagement counts hidden" : "Engagement counts shown");
        }
      ),
      ctx.toggleRow(
        "Hide reply counts",
        "Applies while Hide engagement counts is on.",
        ctx.options.settings.appearance.countMetrics.replies,
        async (checked) => {
          ctx.options.settings.appearance.countMetrics = {
            ...ctx.options.settings.appearance.countMetrics,
            replies: checked
          };
          await ctx.save("Count preference saved");
        }
      ),
      ctx.toggleRow(
        "Hide repost counts",
        "Applies while Hide engagement counts is on.",
        ctx.options.settings.appearance.countMetrics.reposts,
        async (checked) => {
          ctx.options.settings.appearance.countMetrics = {
            ...ctx.options.settings.appearance.countMetrics,
            reposts: checked
          };
          await ctx.save("Count preference saved");
        }
      ),
      ctx.toggleRow(
        "Hide like counts",
        "Applies while Hide engagement counts is on.",
        ctx.options.settings.appearance.countMetrics.likes,
        async (checked) => {
          ctx.options.settings.appearance.countMetrics = {
            ...ctx.options.settings.appearance.countMetrics,
            likes: checked
          };
          await ctx.save("Count preference saved");
        }
      ),
      ctx.toggleRow(
        "Hide view counts",
        "Applies while Hide engagement counts is on. The view total lives in an analytics link, not an action button.",
        ctx.options.settings.appearance.countMetrics.views,
        async (checked) => {
          ctx.options.settings.appearance.countMetrics = {
            ...ctx.options.settings.appearance.countMetrics,
            views: checked
          };
          await ctx.save("Count preference saved");
        }
      ),
      ctx.toggleRow(
        "Hide the tab title badge",
        "Remove X's unread count from the browser tab title, so a hidden notification badge is not restored by the tab.",
        ctx.options.settings.appearance.hideTitleBadge,
        async (checked) => {
          ctx.options.settings.appearance.hideTitleBadge = checked;
          await ctx.save(checked ? "Tab title badge hidden" : "Tab title badge shown");
        }
      ),
      ctx.toggleRow(
        "Absolute timestamps",
        "Show the exact date and time on every post instead of X's relative text.",
        ctx.options.settings.appearance.absoluteTimestamps,
        async (checked) => {
          ctx.options.settings.appearance.absoluteTimestamps = checked;
          await ctx.save(checked ? "Absolute timestamps on" : "Absolute timestamps off");
        }
      ),
      ctx.toggleRow(
        "Use Aviary's tab icon",
        "Replace X's favicon with Aviary's mark so its tabs are easy to pick out. Restores X's own icon when off.",
        ctx.options.settings.appearance.replaceFavicon,
        async (checked) => {
          ctx.options.settings.appearance.replaceFavicon = checked;
          await ctx.save(checked ? "Aviary tab icon on" : "X tab icon restored");
        }
      ),
      ctx.toggleRow(
        "Hide row borders",
        "Remove the 1px divider under each timeline post and the primary column's side rules.",
        ctx.options.settings.appearance.hideBorders,
        async (checked) => {
          ctx.options.settings.appearance.hideBorders = checked;
          await ctx.save(checked ? "Row borders hidden" : "Row borders restored");
        }
      ),
      ctx.toggleRow("High contrast", "Use stronger borders and text contrast.", ctx.options.settings.accessibility.highContrast, async (checked) => {
        ctx.options.settings.accessibility.highContrast = checked;
        await ctx.save("Contrast preference saved");
      }),
      ctx.selectRow(
        "Reduced motion",
        ctx.options.settings.accessibility.reduceMotion,
        [
          ["system", "Follow system setting"],
          ["always", "Always reduce"],
          ["never", "Never reduce"]
        ],
        async (value) => {
          ctx.options.settings.accessibility.reduceMotion = ctx.coerceReduceMotion(value);
          await ctx.save("Motion preference saved");
        }
      )
  ];
  const cssRows: Array<[typeof CUSTOM_CSS_SCOPE_IDS[number], string, string]> = [
    ["posts", "Posts CSS", "Scoped to rendered posts. Example: article { border-radius: 18px; }"],
    ["media", "Media actions CSS", "Scoped to Aviary media buttons and their contents."],
    ["navigation", "Navigation CSS", "Scoped to X's navigation rail."],
    ["sidebar", "Sidebar CSS", "Scoped to X's discovery sidebar."],
    ["composer", "Composer CSS", "Scoped to the composer toolbar and text area."]
  ];
  for (const [scope, label, description] of cssRows) {
    rows.push(
      ctx.textareaRow(
        label,
        description,
        ctx.options.settings.appearance.customCss[scope].split(/\r?\n/),
        async (lines) => {
          const candidate = lines.join("\n");
          const sanitized = sanitizeCustomCss(candidate);
          ctx.options.settings.appearance.customCss[scope] = sanitized.value;
          await ctx.save(
            sanitized.changed && sanitized.value.length === 0
              ? `${label} rejected unsafe or malformed CSS`
              : `${label} saved`
          );
        },
        "Apply"
      )
    );
  }
  return rows;
}

export function buildLayoutRows(ctx: PanelContext): HTMLElement[] {
  const hooks = ctx.options.getPageHooks?.();
  ctx.t("Protection starts at document load.");
  const rows = [
      ctx.toggleRow(
        "Ad-free mode",
        "Collapse sponsored posts, paid partnerships, promoted trends, house promos, and visible pre-rolls. Aviary also refuses X's separate promoted-content logging call without blocking timeline delivery.",
        ctx.options.settings.privacy.blockAds,
        async (checked) => {
          ctx.options.settings.privacy.blockAds = checked;
          await ctx.save(checked ? "Ad-free mode on" : "Ad-free mode off");
        }
      ),
      ctx.toggleRow(
        "Refuse X's ad logging call",
        "Only applies while Ad-free mode is on. Aviary refuses exactly one request — X's separate promoted-content logging call — and nothing else, including the checks X uses to notice an ad blocker. Turn this off if X complains anyway: sponsored posts stay hidden and Aviary stops refusing any request at all.",
        ctx.options.settings.privacy.networkShield,
        async (checked) => {
          ctx.options.settings.privacy.networkShield = checked;
          await ctx.save(checked ? "Ad logging refused" : "Ad logging allowed");
        }
      ),
      hooks
        ? ctx.dataRow(
            "Ad protection status",
            `${hooks.hiddenPlacements} placements removed · ${hooks.blockedAdRequests} logging calls refused${hooks.suppressedVideoAds > 0 ? ` · ${hooks.suppressedVideoAds} pre-rolls suppressed` : ""}`
          )
        : ctx.readonlyRow("Ad protection status", "Protection starts at document load."),
      ctx.toggleRow("Hide right sidebar", "Reduce trends, recommendations, and footer noise.", ctx.options.settings.layout.hideRightSidebar, async (checked) => {
        ctx.options.settings.layout.hideRightSidebar = checked;
        await ctx.save("Sidebar preference saved");
      }),
      ctx.toggleRow("Hide trends", "Remove trending topics and news modules.", ctx.options.settings.layout.hideTrends, async (checked) => {
        ctx.options.settings.layout.hideTrends = checked;
        await ctx.save("Trend preference saved");
      }),
      ctx.toggleRow(
        "Hide follow suggestions",
        "Remove Who to follow cards without hiding the rest of the sidebar.",
        ctx.options.settings.layout.hideFollowSuggestions,
        async (checked) => {
          ctx.options.settings.layout.hideFollowSuggestions = checked;
          await ctx.save("Layout preference saved");
        }
      ),
      ctx.toggleRow(
        "Hide home composer",
        "Remove the quick-post composer from Home. The Post button still opens it when needed.",
        ctx.options.settings.layout.hideHomeComposer,
        async (checked) => {
          ctx.options.settings.layout.hideHomeComposer = checked;
          await ctx.save("Layout preference saved");
        }
      ),
      ctx.toggleRow(
        "Hide thread recommendations",
        "Stop a conversation at its last real reply by collapsing the Discover more block and the suggested posts below it.",
        ctx.options.settings.layout.hideThreadRecommendations,
        async (checked) => {
          ctx.options.settings.layout.hideThreadRecommendations = checked;
          await ctx.save("Layout preference saved");
        }
      ),
      ctx.toggleRow("Hide Grok surfaces", "Remove the Grok drawer, navigation link, image-generation entries, and per-post actions where detected.", ctx.options.settings.layout.hideGrok, async (checked) => {
        ctx.options.settings.layout.hideGrok = checked;
        await ctx.save("Grok preference saved");
      }),
      ctx.toggleRow(
        "Focus mode",
        "Outside the hours below, cover the reading column with a calm local panel. Navigation stays usable and a five-minute override is one click away. Nothing is blocked and nothing leaves this device.",
        ctx.options.settings.layout.focusMode,
        async (checked) => {
          ctx.options.settings.layout.focusMode = checked;
          await ctx.save(checked ? "Focus mode on" : "Focus mode off");
        }
      ),
      ctx.textInputRow(
        "Reading hours start",
        "24-hour time, for example 09:00.",
        ctx.options.settings.layout.focusStart,
        async (value) => {
          ctx.options.settings.layout.focusStart = value;
          await ctx.save("Reading hours saved");
        }
      ),
      ctx.textInputRow(
        "Reading hours end",
        "24-hour time. An end before the start wraps past midnight.",
        ctx.options.settings.layout.focusEnd,
        async (value) => {
          ctx.options.settings.layout.focusEnd = value;
          await ctx.save("Reading hours saved");
        }
      ),
      ctx.integerInputRow(
        "Stop the timeline after",
        "Posts to show before the feed stops extending, with a control to continue. Zero leaves X's endless scroll alone. Nothing already on screen moves, and the control appears below the last post rather than above it.",
        ctx.options.settings.layout.timelineStopAfter,
        async (value) => {
          ctx.options.settings.layout.timelineStopAfter = value;
          await ctx.save(
            value > 0 ? `Timeline stops after ${value} posts` : "Timeline scrolls without stopping"
          );
        },
        { min: 0, max: 1000 }
      ),
      ctx.toggleRow(
        "Show read marker",
        "Keep a local position for each feed and show a new since you last looked line. It never adds an unread badge.",
        ctx.options.settings.layout.readMarker,
        async (checked) => {
          ctx.options.settings.layout.readMarker = checked;
          await ctx.save(checked ? "Read marker on" : "Read marker off");
        }
      ),
      ctx.surfaceRow(
        "Read marker surfaces",
        "Choose where the local position marker and new-post separator appear.",
        ctx.options.settings.layout.readMarkerSurfaces,
        async (surfaces) => {
          ctx.options.settings.layout.readMarkerSurfaces = surfaces;
          await ctx.save("Read marker surfaces saved");
        }
      ),
      ctx.toggleRow(
        "Writer mode",
        "While focus is in the composer, fade the sidebar and the timeline behind it. Everything returns the moment you click away.",
        ctx.options.settings.layout.writerMode,
        async (checked) => {
          ctx.options.settings.layout.writerMode = checked;
          await ctx.save(checked ? "Writer mode on" : "Writer mode off");
        }
      ),
      ctx.toggleRow(
        "Open Following instead of For you",
        "Selects the second home tab each time you arrive at the timeline. Switch back to For you and it stays there until you navigate away.",
        ctx.options.settings.layout.forceFollowing,
        async (checked) => {
          ctx.options.settings.layout.forceFollowing = checked;
          await ctx.save(checked ? "Following timeline on" : "Following timeline off");
        }
      )
  ];
  rows.push(
    ctx.textareaRow(
      "Hide navigation items",
      "One stable X navigation id per line: home, explore, notifications, follow, chat, messages, grok, history, studio, premium, profile, or more.",
      ctx.options.settings.layout.hideNavItems,
      async (lines) => {
        ctx.options.settings.layout.hideNavItems = [...new Set(
          lines
            .map((line) => line.trim().toLowerCase())
            .filter((line) => HIDE_NAV_ITEM_IDS.has(line))
        )].slice(0, 24);
        await ctx.save("Navigation visibility saved");
      }
    )
  );
  return rows;
}

export function buildPerformanceRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];

  rows.push(
    ctx.toggleRow(
      "Pause video that scrolls out of view",
      "Stops decoding timeline video once it leaves the screen, and resumes it when it comes back. A video you paused yourself stays paused.",
      ctx.options.settings.performance.pauseOffscreenVideo,
      async (checked) => {
        ctx.options.settings.performance.pauseOffscreenVideo = checked;
        await ctx.save(checked ? "Offscreen video paused" : "Offscreen video left playing");
      }
    )
  );

  rows.push(
    ctx.toggleRow(
      "Keep video playing when the tab loses focus",
      "X stops a playing video when you switch tabs. This resumes it when you come back. A video you paused yourself stays paused.",
      ctx.options.settings.performance.keepVideoPlaying,
      async (checked) => {
        ctx.options.settings.performance.keepVideoPlaying = checked;
        await ctx.save(checked ? "Video keeps playing" : "Video pauses with the tab");
      }
    )
  );

  rows.push(
    ctx.toggleRow(
      "Loop videos",
      "Restart a video when it reaches the end instead of stopping.",
      ctx.options.settings.performance.loopVideos,
      async (checked) => {
        ctx.options.settings.performance.loopVideos = checked;
        await ctx.save(checked ? "Video looping on" : "Video looping off");
      }
    )
  );

  // This row used to promise that every video played at the highest quality. Aviary can only
  // rewrite an HLS master playlist it actually sees, and a player that fetches one inside a worker
  // never passes through the page agent, so the outcome was never guaranteed. The readout below
  // reports how many playlists were rewritten this session: it states rather than promises.
  rows.push(
    ctx.toggleRow(
      "Pin video playlists to their best rendition",
      "When X hands Aviary a playlist listing several qualities, keep only the highest. X often settles below the best available on a fast connection. This uses more data, and it can only act on playlists Aviary sees.",
      ctx.options.settings.performance.forceVideoQuality,
      async (checked) => {
        ctx.options.settings.performance.forceVideoQuality = checked;
        await ctx.save(checked ? "Playlist pinning on" : "Playlist pinning off");
      }
    )
  );

  const hooks = ctx.options.getPageHooks?.();
  if (hooks && ctx.options.settings.performance.forceVideoQuality) {
    rows.push(
      ctx.dataRow(
        "Playlists rewritten",
        ctx.localizedCopy("{count} this session", { count: hooks.rewrittenPlaylists })
      )
    );
  }

  return rows;
}

export function buildFilterRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
  ctx.t("Rules are active on the selected routes.");
  rows.push(
    ctx.toggleRow(
      "Enable filters",
      "Master switch for keyword, regex, premium, and media filters.",
      ctx.options.settings.filter.enabled,
      async (checked) => {
        ctx.options.settings.filter.enabled = checked;
        await ctx.save(checked ? "Filters enabled" : "Filters disabled");
      }
    )
  );

  rows.push(
    ctx.readonlyRow(
      "Rule status",
      ctx.options.settings.filter.enabled
        ? "Rules are active on the selected routes."
        : "Inactive until filters are enabled. You can edit rules before turning them on."
    )
  );

  rows.push(
    ctx.toggleRow(
      "Dim posts you have already seen",
      "Fade a post the second time it scrolls past, and keep a local catch-up copy of posts Aviary has rendered. Hovering a faded post brings it back.",
      ctx.options.settings.filter.dimSeenPosts,
      async (checked) => {
        ctx.options.settings.filter.dimSeenPosts = checked;
        await ctx.save(checked ? "Seen-post dimming on" : "Seen-post dimming off");
      }
    )
  );

  rows.push(
    ctx.surfaceRow(
      "Hide seen posts on",
      "Choose the feed surfaces where posts you have already seen are dimmed.",
      ctx.options.settings.filter.dimSeenSurfaces,
      async (surfaces) => {
        ctx.options.settings.filter.dimSeenSurfaces = surfaces;
        await ctx.save("Seen-post surfaces saved");
      }
    )
  );

  if (ctx.options.clearSeenPosts) {
    rows.push(
      ctx.actionRow(
        "Forget seen posts",
        "Clear the stored post IDs so everything reads as unseen again.",
        async () => {
          try {
            await ctx.options.clearSeenPosts!();
            ctx.setStatus("Seen posts forgotten.");
          } catch (error) {
            ctx.options.onError("Could not clear seen posts", error);
            ctx.setStatus("Could not clear seen posts.");
          }
        }
      )
    );
  }

  rows.push(
    ctx.textareaRow(
      "Filter rules",
      "One rule per line: field, optional not, operator, value. Fields are text, handle, media, verified, link; operators are contains, is, starts, ends, matches. Join with and / or, and prefix dim: to fade instead of hide. Name a rule by starting the line with [a title], and give it a limited life with for 7d from <date>. Example: [Weekend sales] dim for 7d from 2026-08-19T10:00:00.000Z: text contains sale and media is photo",
      ctx.options.settings.filter.rules,
      async (lines) => {
        ctx.options.settings.filter.rules = lines.slice(0, 100);
        await ctx.save("Filter rules saved");
      }
    )
  );

  const ruleProblems = ctx.options.getFilterRuleErrors?.() ?? [];
  if (ruleProblems.length > 0) {
    rows.push(
      ctx.dataRow(
        "Rules that could not be read",
        // Both editors number from their own line 1, so the box has to be named or the reader is
        // sent to an innocent line in the wrong one.
        ruleProblems
          .map((problem) => {
            const box = problem.origin === "regex" ? ctx.t("Regex rules") : ctx.t("Filter rules");
            return `${box} ${ctx.t("line")} ${problem.line}: ${problem.message}`;
          })
          .join(" · ")
      )
    );
  }

  if (
    ctx.options.exportFilterRules &&
    ctx.options.previewFilterRuleImport &&
    ctx.options.applyFilterRuleImport
  ) {
    rows.push(portableRuleSetRow(ctx));
  }

  const expiredRules = ctx.options.getExpiredFilterRules?.() ?? [];
  if (expiredRules.length > 0) {
    rows.push(
      ctx.dataRow(
        "Expired rules",
        expiredRules
          .map((rule) => rule.title ?? rule.source)
          .join(" · ")
      )
    );
    if (ctx.options.renewFilterRules) {
      rows.push(
        ctx.actionRow(
          "Renew expired rules",
          "Restart each expired rule's own window from now. Nothing is deleted when a rule expires, so a rule can always be brought back.",
          async () => {
            try {
              const renewed = await ctx.options.renewFilterRules!();
              ctx.setStatusCopy("Renewed {count} rules.", { count: String(renewed) });
              ctx.render();
            } catch (error) {
              ctx.options.onError("Could not renew filter rules", error);
              ctx.setStatus("Could not renew the expired rules.");
            }
          }
        )
      );
    }
  }

  rows.push(
    ctx.textareaRow(
      "Keyword rules",
      "One keyword or phrase per line. Case-insensitive substring match.",
      ctx.options.settings.filter.keywordRules,
      async (lines) => {
        ctx.options.settings.filter.keywordRules = lines.slice(0, 200);
        await ctx.save(`Saved ${ctx.options.settings.filter.keywordRules.length} keyword rules`);
      }
    )
  );

  rows.push(
    ctx.textareaRow(
      "Regex rules",
      "One pattern per line. Use /pattern/flags or a bare pattern (case-insensitive).",
      ctx.options.settings.filter.regexRules,
      async (lines) => {
        ctx.options.settings.filter.regexRules = lines.slice(0, 100);
        await ctx.save(`Saved ${ctx.options.settings.filter.regexRules.length} regex rules`);
      }
    )
  );

  rows.push(
    ctx.textareaRow(
      "Whitelist handles",
      "Handles (one per line, no @) that are never filtered.",
      ctx.options.settings.filter.whitelist,
      async (lines) => {
        ctx.options.settings.filter.whitelist = lines
          .map((line) => line.replace(/^@/, "").trim())
          .filter((line) => /^[A-Za-z0-9_]{1,15}$/.test(line))
          .slice(0, 200);
        await ctx.save(`Saved ${ctx.options.settings.filter.whitelist.length} whitelist handles`);
      }
    )
  );

  rows.push(
    ctx.selectRow(
      "Premium / verified posts",
      ctx.options.settings.filter.premiumRule,
      FILTER_ACTION_OPTIONS,
      async (value) => {
        ctx.options.settings.filter.premiumRule = ctx.coerceFilterAction(value);
        await ctx.save("Premium filter saved");
      }
    )
  );

  rows.push(
    ctx.selectRow(
      "Quote posts",
      ctx.options.settings.filter.quotePosts,
      FILTER_ACTION_OPTIONS,
      async (value) => {
        ctx.options.settings.filter.quotePosts = ctx.coerceFilterAction(value);
        await ctx.save("Quote post filter saved");
      },
      "Posts that quote another post."
    )
  );

  rows.push(
    ctx.selectRow(
      "Say why a post was filtered",
      ctx.options.settings.filter.showReason,
      FILTER_REASON_OPTIONS,
      async (value) => {
        ctx.options.settings.filter.showReason = isFilterReasonMode(value)
          ? value
          : ctx.options.settings.filter.showReason;
        await ctx.save("Filter reason setting saved");
      },
      "A filter that hides silently is hard to tell from a bug. Dimmed posts can name what caught them at no cost to the layout; the third setting also turns a hidden post into a one-line strip that says why and opens when you hover or tab into it."
    )
  );

  rows.push(
    ctx.selectRow(
      "Low-engagement posts",
      ctx.options.settings.filter.engagementRule,
      FILTER_ACTION_OPTIONS,
      async (value) => {
        ctx.options.settings.filter.engagementRule = ctx.coerceFilterAction(value);
        await ctx.save("Engagement filter saved");
      },
      "Posts under the minimum below. A post whose count Aviary cannot read is never filtered on it."
    )
  );

  rows.push(
    ctx.selectRow(
      "Engagement measured in",
      ctx.options.settings.filter.engagementMetric,
      ENGAGEMENT_METRIC_OPTIONS,
      async (value) => {
        ctx.options.settings.filter.engagementMetric = isEngagementMetric(value)
          ? value
          : ctx.options.settings.filter.engagementMetric;
        await ctx.save("Engagement metric saved");
      },
      "Which of the counts under a post the minimum applies to."
    )
  );

  rows.push(
    ctx.integerInputRow(
      "Minimum engagement",
      "Posts below this count are filtered. Zero leaves every post alone.",
      ctx.options.settings.filter.engagementMin,
      async (value) => {
        ctx.options.settings.filter.engagementMin = value;
        await ctx.save(`Engagement floor set to ${value}`);
      },
      { min: 0, max: 1_000_000 }
    )
  );

  for (const key of FILTER_MEDIA_KEYS) {
    const label = FILTER_MEDIA_LABELS[key];
    const current = ctx.options.settings.filter.mediaTypes[key] === true;
    rows.push(
      ctx.toggleRow(
        `Hide posts with ${label.toLowerCase()}`,
        `Filter posts containing ${label.toLowerCase()}.`,
        current,
        async (checked) => {
          ctx.options.settings.filter.mediaTypes = {
            ...ctx.options.settings.filter.mediaTypes,
            [key]: checked
          };
          await ctx.save(`${label} filter ${checked ? "on" : "off"}`);
        }
      )
    );
  }

  rows.push(
    ctx.surfaceRow(
      "Active on",
      "Routes where filters run.",
      ctx.options.settings.filter.surfaces,
      async (next) => {
        ctx.options.settings.filter.surfaces = next;
        await ctx.save(
          next.length > 0
            ? `Filters active on ${next.length} route${next.length === 1 ? "" : "s"}`
            : "Filters off on every route"
        );
      }
    )
  );

  rows.push(
    ctx.readonlyRow(
      "Blocked accounts / self-reposts",
      "Pending an authenticated fixture; controls stay disabled."
    )
  );

  return rows;
}

function portableRuleSetRow(ctx: PanelContext): HTMLElement {
  const row = ctx.el("div", "av-row av-row-stack av-rule-set-row");
  row.dataset.avLabel = "Portable rule set";
  const copy = ctx.el("span", "av-row-copy");
  copy.append(
    ctx.el("span", "av-row-label", ctx.t("Portable rule set")),
    ctx.el(
      "span",
      "av-row-description",
      ctx.t("Export plain text, or paste a set to preview before adding or replacing rules.")
    )
  );

  const textarea = document.createElement("textarea");
  textarea.className = "av-textarea av-rule-set-input";
  textarea.value = ctx.state.pendingFilterRuleImport;
  textarea.placeholder = ctx.t("Paste rules here");
  textarea.rows = 4;
  textarea.spellcheck = false;
  textarea.setAttribute("aria-label", ctx.t("Portable rule set"));

  const actions = ctx.el("div", "av-rule-set-actions");
  const exportButton = ctx.button("Export .txt", "av-button av-button-secondary");
  const previewButton = ctx.button("Preview", "av-button av-button-secondary");
  const addButton = ctx.button("Add rules", "av-button av-button-primary");
  const replaceButton = ctx.button("Replace rules", "av-button av-button-secondary");
  const previewCopy = ctx.el("div", "av-rule-set-preview", ctx.t("Paste rules to see both import choices."));
  previewCopy.setAttribute("role", "status");
  previewCopy.setAttribute("aria-live", "polite");

  const showPreview = (): void => {
    const preview = ctx.state.pendingFilterRulePreview;
    addButton.disabled = !preview || preview.add.errors.length > 0;
    replaceButton.disabled = !preview || preview.replace.errors.length > 0;
    previewCopy.dataset.avState = "ready";
    if (!preview) {
      previewCopy.textContent = ctx.t("Paste rules to see both import choices.");
      return;
    }
    const parseErrors = preview.replace.errors;
    if (parseErrors.length > 0) {
      previewCopy.dataset.avState = "error";
      previewCopy.textContent = parseErrors
        .map((problem) => `line ${problem.line}: ${problem.message}`)
        .join(" · ");
      return;
    }
    if (preview.add.errors.length > 0) {
      previewCopy.dataset.avState = "error";
      const problem = preview.add.errors[0]!;
      previewCopy.textContent = ctx.localizedCopy(
        "{imported} rules found. Replace is ready. Add is blocked at line {line}: {error}",
        {
          imported: preview.imported,
          line: problem.line,
          error: problem.message
        }
      );
      return;
    }
    previewCopy.textContent = ctx.localizedCopy(
      "{imported} rules found. Add {added}; {duplicates} already present. Replace {replaced} with {total}.",
      {
        imported: preview.imported,
        added: preview.add.added,
        duplicates: preview.add.duplicates,
        replaced: preview.replace.replaced,
        total: preview.replace.total
      }
    );
  };

  textarea.addEventListener("input", () => {
    ctx.state.pendingFilterRuleImport = textarea.value;
    ctx.state.pendingFilterRulePreview = null;
    showPreview();
  });

  exportButton.addEventListener("click", () => {
    if (ctx.guardDraft()) return;
    exportButton.disabled = true;
    void ctx.options
      .exportFilterRules!()
      .then((result) => {
        ctx.setStatusCopy("Rule set exported: {filename} ({count} lines).", {
          filename: result.filename,
          count: result.rules
        });
      })
      .catch((error: unknown) => {
        ctx.options.onError("Could not export filter rules", error);
        ctx.setStatus("Could not export the rule set.");
      })
      .finally(() => {
        exportButton.disabled = false;
      });
  });

  previewButton.addEventListener("click", () => {
    try {
      ctx.state.pendingFilterRuleImport = textarea.value;
      ctx.state.pendingFilterRulePreview = ctx.options.previewFilterRuleImport!(
        textarea.value,
        ctx.options.settings.filter.rules
      );
      showPreview();
      const errors = ctx.state.pendingFilterRulePreview.replace.errors.length;
      ctx.setStatus(errors > 0 ? "Rule set needs attention." : "Rule-set preview ready.");
    } catch (error) {
      ctx.options.onError("Could not preview filter rules", error);
      ctx.setStatus("Could not preview the rule set.");
    }
  });

  const apply = (mode: "add" | "replace", button: HTMLButtonElement): void => {
    if (ctx.guardDraft()) return;
    button.disabled = true;
    void ctx.options
      .applyFilterRuleImport!(textarea.value, mode)
      .then((plan) => {
        if (plan.errors.length > 0) {
          ctx.state.pendingFilterRulePreview = ctx.options.previewFilterRuleImport!(
            textarea.value,
            ctx.options.settings.filter.rules
          );
          showPreview();
          ctx.setStatus("Rule set needs attention.");
          return;
        }
        ctx.options.settings.filter.rules = [...plan.lines];
        ctx.state.pendingFilterRuleImport = "";
        ctx.state.pendingFilterRulePreview = null;
        ctx.render();
        if (mode === "add") {
          ctx.setStatusCopy("Added {count} rules.", { count: plan.added });
        } else {
          ctx.setStatusCopy("Replaced the rule set with {count} rules.", { count: plan.total });
        }
      })
      .catch((error: unknown) => {
        ctx.options.onError("Could not import filter rules", error);
        ctx.setStatus("Could not import the rule set.");
      })
      .finally(() => {
        button.disabled = false;
      });
  };

  addButton.addEventListener("click", () => apply("add", addButton));
  replaceButton.addEventListener("click", () => apply("replace", replaceButton));
  actions.append(exportButton, previewButton, addButton, replaceButton);
  row.append(copy, textarea, actions, previewCopy);
  showPreview();
  return row;
}

export function buildCatchUpRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const status = ctx.options.getCatchUpStatus?.();
  if (!status?.tracking) {
    rows.push(
      ctx.readonlyRow(
        "Catch-up is waiting",
        "Turn on Dim posts you have already seen in Filtering. Catch-up uses only rows Aviary has already rendered."
      )
    );
  } else {
    rows.push(
      ctx.dataRow(
        "Posts available",
        `${status.records} rendered post${status.records === 1 ? "" : "s"} kept locally for 30 days.`
      )
    );
  }
  if (ctx.options.openCatchUp) {
    rows.push(
      ctx.actionRow(
        "Open catch-up digest",
        "Review a time window, filter by post type, group by author, and open the original post. No requests are made.",
        async () => {
          const result = ctx.options.openCatchUp!();
          ctx.setStatus(`Catch-up opened with ${result.count} post${result.count === 1 ? "" : "s"}.`);
        }
      )
    );
  }
  rows.push(
    ctx.readonlyRow(
      "What it includes",
      "Everything Aviary saw in the active browser profile. Filtered posts keep the reason written by the active filter rule."
    )
  );
  return rows;
}

export function buildHiddenPostRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
  ctx.t("Hide buttons follow the setting above.");

  rows.push(
    ctx.toggleRow(
      "Hide dismissed posts",
      "Keep posts you hid collapsed so the next post rises to the top.",
      ctx.options.settings.hidden.enabled,
      async (checked) => {
        ctx.options.settings.hidden.enabled = checked;
        await ctx.save(checked ? "Hidden posts applied" : "Hidden posts revealed");
      }
    )
  );

  rows.push(
    ctx.toggleRow(
      "Show hide buttons",
      "Adds a Hide control to every post next to the More menu.",
      ctx.options.settings.hidden.buttons,
      async (checked) => {
        ctx.options.settings.hidden.buttons = checked;
        await ctx.save(checked ? "Hide buttons on" : "Hide buttons off");
      }
    )
  );

  rows.push(
    ctx.readonlyRow(
      "Hide button status",
      ctx.options.settings.hidden.enabled
        ? "Hide buttons follow the setting above."
        : "Activates when Hide dismissed posts is on."
    )
  );

  rows.push(
    ctx.surfaceRow(
      "Active on",
      "Routes where hiding and the Hide button apply.",
      ctx.options.settings.hidden.surfaces,
      async (next) => {
        ctx.options.settings.hidden.surfaces = next;
        await ctx.save(
          next.length > 0
            ? `Hiding active on ${next.length} route${next.length === 1 ? "" : "s"}`
            : "Hiding off on every route"
        );
      }
    )
  );

  rows.push(
    ctx.integerInputRow(
      "Maximum remembered posts",
      "Oldest entries are dropped once the store passes this size (100-50000).",
      ctx.options.settings.hidden.maxEntries,
      async (value) => {
        ctx.options.settings.hidden.maxEntries = value;
        await ctx.save(`Hidden post limit set to ${ctx.options.settings.hidden.maxEntries}`);
      },
      // The same range the description states and the normalizer clamps to. Without it the panel
      // accepted anything, confirmed it, and let the next reload substitute a different number.
      { min: 100, max: 50_000 }
    )
  );

  const status = ctx.options.getHiddenPostsStatus?.();
  if (!status) {
    rows.push(ctx.readonlyRow("Hidden posts", "Hidden post store unavailable in this build."));
    return rows;
  }

  rows.push(
    ctx.dataRow(
      "Hidden posts stored",
      `${status.total}${status.updatedAt ? ` · updated ${status.updatedAt}` : ""}`
    )
  );

  if (ctx.options.undoLastHide) {
    rows.push(
      ctx.actionRow("Undo last hide", "Restores the most recently hidden post.", async () => {
        try {
          const result = await ctx.options.undoLastHide!();
          ctx.setStatus(
            result.restored
              ? `Restored ${result.handle ? `@${result.handle}` : "the last hidden post"}.`
              : "Nothing left to restore."
          );
          ctx.render();
        } catch (error) {
          ctx.options.onError("Could not undo the last hide", error);
          ctx.setStatus("Could not undo the last hide.");
        }
      })
    );
  }

  for (const entry of status.recent) {
    const row = ctx.el("div", "av-row av-row-stack");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", entry.handle ? `@${entry.handle}` : "Unknown account"),
      ctx.el(
        "span",
        "av-row-description",
        `${entry.hiddenAt} — ${entry.text.length > 0 ? entry.text : "(no text)"}`
      )
    );
    const restore = ctx.el("button", "av-button av-button-secondary", ctx.t("Restore")) as HTMLButtonElement;
    restore.type = "button";
    restore.addEventListener("click", () => {
      restore.disabled = true;
      void ctx.options
        .unhidePost?.(entry.key)
        .then((restored) => {
          ctx.setStatus(restored ? "Post restored." : "That post was already restored.");
          ctx.render();
        })
        .catch((error: unknown) => {
          ctx.options.onError("Could not restore the post", error);
          ctx.setStatus("Could not restore the post.");
          restore.disabled = false;
        });
    });
    row.append(copy, restore);
    rows.push(row);
  }

  if (ctx.options.clearHiddenPosts && status.total > 0) {
    rows.push(
      ctx.actionRow(
        "Clear hidden posts",
        "Forgets every hidden post and brings them all back.",
        async () => {
          try {
            const removed = await ctx.options.clearHiddenPosts!();
            ctx.setStatusCopy(
              removed === 1 ? "Cleared {removed} hidden post." : "Cleared {removed} hidden posts.",
              { removed }
            );
            ctx.render();
          } catch (error) {
            ctx.options.onError("Could not clear hidden posts", error);
            ctx.setStatus("Could not clear hidden posts.");
          }
        }
      )
    );
  }

  return rows;
}
