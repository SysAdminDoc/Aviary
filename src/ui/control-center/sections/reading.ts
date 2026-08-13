import type { PanelContext } from "../panel-context";
import { FILTER_ACTION_OPTIONS, FILTER_MEDIA_LABELS, HIDE_NAV_ITEM_IDS } from "../constants";
import { FILTER_MEDIA_KEYS } from "../../../platform/settings";
export function buildAppearanceRows(ctx: PanelContext): HTMLElement[] {
  return [
      ctx.selectRow("Theme", ctx.options.settings.appearance.theme, [
        ["off", "Off (X's own theme)"],
        ["dim", "Dim"],
        ["lightsOut", "Lights out"],
        ["graphite", "Graphite"],
        ["plum", "Plum"],
        ["midnight", "Midnight"]
      ], async (value) => {
        if (!ctx.isThemeId(value)) {
          ctx.setStatus("Theme value is not supported.");
          return;
        }
        ctx.options.settings.appearance.theme = value;
        await ctx.save("Theme updated");
      }),
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
        "Widen the main column past the width X fixes it at. Capped to the space available, so a narrow window is unaffected."
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
        "Hide reply, repost, and like numbers. The buttons still work and screen readers still announce the totals.",
        ctx.options.settings.appearance.hideCounts,
        async (checked) => {
          ctx.options.settings.appearance.hideCounts = checked;
          await ctx.save(checked ? "Engagement counts hidden" : "Engagement counts shown");
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
}

export function buildLayoutRows(ctx: PanelContext): HTMLElement[] {
  const hooks = ctx.options.getPageHooks?.();
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
      ctx.readonlyRow(
        "Ad protection status",
        hooks
          ? `${hooks.hiddenPlacements} placements removed · ${hooks.blockedAdRequests} logging calls refused${hooks.suppressedVideoAds > 0 ? ` · ${hooks.suppressedVideoAds} pre-rolls suppressed` : ""}`
          : "Protection starts at document load."
      ),
      ctx.toggleRow("Hide right sidebar", "Reduce trends, recommendations, and footer noise.", ctx.options.settings.layout.hideRightSidebar, async (checked) => {
        ctx.options.settings.layout.hideRightSidebar = checked;
        await ctx.save("Sidebar preference saved");
      }),
      ctx.toggleRow("Hide trends", "Remove trending topics and news modules.", ctx.options.settings.layout.hideTrends, async (checked) => {
        ctx.options.settings.layout.hideTrends = checked;
        await ctx.save("Trend preference saved");
      }),
      ctx.toggleRow("Hide Grok surfaces", "Remove the Grok drawer, navigation link, image-generation entries, and per-post actions where detected.", ctx.options.settings.layout.hideGrok, async (checked) => {
        ctx.options.settings.layout.hideGrok = checked;
        await ctx.save("Grok preference saved");
      }),
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
      "One stable X navigation id per line: home, explore, notifications, messages, profile, more, or premium.",
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
      "Always play video at the highest quality",
      "X picks a video quality to suit your connection, and on a fast connection it often settles below the best one available. This pins every video to its highest rendition. It uses more data.",
      ctx.options.settings.performance.forceVideoQuality,
      async (checked) => {
        ctx.options.settings.performance.forceVideoQuality = checked;
        await ctx.save(checked ? "Best video quality on" : "Video quality left to X");
      }
    )
  );

  return rows;
}

export function buildFilterRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
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

export function buildHiddenPostRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];

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
      }
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
