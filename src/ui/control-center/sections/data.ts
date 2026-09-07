import {
  DEFAULT_SETTINGS,
  isCopyLinkHost,
  type AviarySettings,
  type MediaSidecarFormat,
  type RateLimitMode
} from "../../../platform/settings.ts";
import type { PanelContext } from "../panel-context.ts";
import { MEDIA_LAYOUT_OPTIONS } from "../constants.ts";
/**
 * What each archive layout is called in the import report.
 *
 * X's export changed by accretion rather than by version, so the reader needs the name of the
 * shape that was read before any count means anything. These are deliberately not translated:
 * two are literal filenames from inside the archive and the third is the format's own name, so
 * they are the strings a reader would search for, in every locale. The extractor only harvests
 * literals it can see at a call site, and a translated name reached through a lookup would have
 * shipped English everywhere while looking translated -- which is the defect that had 28 panel
 * strings untranslated until this release.
 */
const ARCHIVE_LAYOUT_LABELS: Record<string, string> = {
  current: "tweets.js",
  "tweet-js": "tweet.js",
  grailbird: "Grailbird",
  unknown: "unrecognised"
};

export function buildSnapshotRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];

  if (ctx.options.getSnapshotStatus) {
    const status = ctx.options.getSnapshotStatus();
    rows.push(
      ctx.dataRow(
        "Snapshots stored",
        status.latestAt
          ? ctx.localizedCopy("{count} entries · latest {kind} of {latestCount} @ {at}", {
              count: status.total,
              kind: status.latestKind ?? "snapshot",
              latestCount: status.latestCount,
              at: status.latestAt
            })
          : ctx.localizedCopy("{count} entries", { count: status.total })
      )
    );
    if (status.total === 0) {
      rows.push(
        ctx.readonlyRow(
          "No snapshots yet",
          ctx.t("Open a profile's followers or following list, then use Capture snapshot to record it.")
        )
      );
    }
  }

  if (ctx.options.captureSnapshot) {
    rows.push(
      ctx.actionRow(
        "Capture followers from this view",
        "Walks UserCell rows on the current page. Open a /handle/followers view first.",
        async () => {
          try {
            const result = await ctx.options.captureSnapshot!("followers");
            ctx.render();
            if (result) {
              // Say which of the two this was. A capture that stopped at the fold is a slice of the
              // list, and a reader who is not told that will later read a comparison against it as
              // a list of people who unfollowed them.
              ctx.setStatusCopy(
                result.reachedEnd
                  ? "Captured {count} followers for @{handle}. The list had finished loading, so this is all of them."
                  : "Captured {count} followers for @{handle}. The list was still loading, so this is only what was on screen. Scroll to the end and capture again for the whole list.",
                {
                  count: result.count,
                  handle: result.handle
                }
              );
            } else {
              ctx.setStatus("No UserCell rows found.");
            }
          } catch (error) {
            ctx.options.onError("Snapshot failed", error);
            ctx.setStatus("Snapshot failed.");
          }
        }
      )
    );
    rows.push(
      ctx.actionRow(
        "Capture following from this view",
        "Walks UserCell rows on the current page. Open a /handle/following view first.",
        async () => {
          try {
            const result = await ctx.options.captureSnapshot!("following");
            ctx.render();
            if (result) {
              // Say which of the two this was. A capture that stopped at the fold is a slice of the
              // list, and a reader who is not told that will later read a comparison against it as
              // a list of people who unfollowed them.
              ctx.setStatusCopy(
                result.reachedEnd
                  ? "Captured {count} following for @{handle}. The list had finished loading, so this is all of them."
                  : "Captured {count} following for @{handle}. The list was still loading, so this is only what was on screen. Scroll to the end and capture again for the whole list.",
                {
                  count: result.count,
                  handle: result.handle
                }
              );
            } else {
              ctx.setStatus("No UserCell rows found.");
            }
          } catch (error) {
            ctx.options.onError("Snapshot failed", error);
            ctx.setStatus("Snapshot failed.");
          }
        }
      )
    );
  }

  if (ctx.options.clearSnapshots) {
    rows.push(
      ctx.actionRow("Clear all snapshots", "Drop every stored follower/following snapshot.", async () => {
        try {
          await ctx.options.clearSnapshots!();
          await ctx.save("Snapshots cleared.");
        } catch (error) {
          ctx.options.onError("Could not clear snapshots", error);
          ctx.setStatus("Could not clear snapshots.");
        }
      })
    );
  }

  const archiveStatus = ctx.options.getArchiveImportStatus?.();
  const archiveLibraryStatus = ctx.options.getArchiveLibraryStatus?.();
  if (archiveLibraryStatus) {
    rows.push(
      ctx.dataRow(
        "Imported collections",
        ctx.localizedCopy(
          "{posts} posts · {likes} likes · {messages} direct messages (kept out of public search) · {media} media refs · {followers} followers · {following} following · {lists} lists",
          {
            posts: archiveLibraryStatus.authoredPosts,
            likes: archiveLibraryStatus.likes,
            messages: archiveLibraryStatus.directMessages,
            media: archiveLibraryStatus.media,
            followers: archiveLibraryStatus.followers,
            following: archiveLibraryStatus.following,
            lists: archiveLibraryStatus.lists
          }
        )
      )
    );
    if (archiveLibraryStatus.hasImport) {
      rows.push(
        ctx.dataRow(
          "Offline archive repairs",
          ctx.localizedCopy(
            "{archiveLinks} archive links + {corpusLinks} captured links expanded · {participants} participant IDs resolved · {unresolved} kept as unresolved IDs · no requests made",
            {
              archiveLinks: archiveLibraryStatus.repairs.archiveLinksExpanded,
              corpusLinks: archiveLibraryStatus.repairs.corpusLinksExpanded,
              participants: archiveLibraryStatus.repairs.participantIdsResolved,
              unresolved: archiveLibraryStatus.repairs.participantIdsUnresolved
            }
          )
        )
      );
    }
  }
  if (archiveStatus) {
    for (const job of archiveStatus.jobs) {
      rows.push(
        ctx.dataRow(
          "Archive import",
          `${ctx.localizedCopy("{status} · {filename} · {records} records · {files} files · {warnings} warnings", {
            status: job.status,
            filename: job.filename,
            records: job.recordCount,
            files: job.filesParsed,
            warnings: job.warningCount
          })}${job.error ? ` · ${job.error}` : ""}`
        )
      );
      if (job.status === "running" && ctx.options.pauseArchiveImport) {
        rows.push(
          ctx.actionRow("Pause archive import", { source: "Pause {filename}.", values: { filename: job.filename } }, async () => {
            const result = await ctx.options.pauseArchiveImport!(job.jobId);
            if (!result.ok) throw new Error(result.error ?? "Archive import could not be paused");
            ctx.render();
            ctx.setStatus("Archive import paused.");
          },
          "The import could not be paused. It may have already finished. Reopen this section to see where it got to.")
        );
      }
      if ((job.status === "paused" || job.status === "queued") && ctx.options.resumeArchiveImport) {
        rows.push(
          ctx.actionRow("Resume archive import", { source: "Resume {filename}.", values: { filename: job.filename } }, async () => {
            const result = await ctx.options.resumeArchiveImport!(job.jobId);
            if (!result.ok) throw new Error(result.error ?? "Archive import could not be resumed");
            ctx.render();
            ctx.setStatus("Archive import resumed.");
          },
          "The import could not be resumed. Its saved source may have been cleared. Retry it to start again from the file.")
        );
      }
      if (
        (job.status === "running" || job.status === "paused" || job.status === "queued") &&
        ctx.options.cancelArchiveImport
      ) {
        rows.push(
          ctx.actionRow("Cancel archive import", { source: "Cancel {filename}.", values: { filename: job.filename } }, async () => {
            const result = await ctx.options.cancelArchiveImport!(job.jobId);
            if (!result.ok) throw new Error(result.error ?? "Archive import could not be cancelled");
            ctx.render();
            ctx.setStatus("Archive import cancelled.");
          },
          "The import could not be cancelled. It may have already finished. Reopen this section to see where it got to.")
        );
      }
      if ((job.status === "failed" || job.status === "cancelled") && ctx.options.retryArchiveImport) {
        rows.push(
          ctx.actionRow("Retry archive import", { source: "Retry {filename}.", values: { filename: job.filename } }, async () => {
            const result = await ctx.options.retryArchiveImport!(job.jobId);
            if (!result.ok) throw new Error(result.error ?? "Archive import could not be retried");
            ctx.render();
            ctx.setStatus("Archive import retry started.");
          },
          "The import could not be retried. Pick the archive file again to start a fresh import.")
        );
      }
    }
  }

  if (ctx.options.importArchive) {
    const row = ctx.el("div", "av-row av-row-stack");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t("Import official X archive")),
      ctx.el("span", "av-row-description", ctx.t("Pick a ZIP exported from x.com. STORE and DEFLATE entries are supported; the source stays local while it is resumable."))
    );
    const archiveLabel = copy.querySelector<HTMLElement>(".av-row-label")!;
    archiveLabel.id = "av-import-archive-label";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.className = "av-file-input";
    input.id = "av-import-archive";
    input.setAttribute("aria-labelledby", archiveLabel.id);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        ctx.setStatus("Reading archive, large files take a moment…");
        try {
          const result = await ctx.options.importArchive!(file);
          ctx.render();
          // Name the layout, and name what that layout has no place for. Reporting "0 direct
          // messages" for an archive that never had a file for them is how three other importers
          // told people their history was empty when it was only absent from that export.
          const layout = ARCHIVE_LAYOUT_LABELS[result.vintage ?? "unknown"] ?? "unrecognised";
          const absent = (result.collectionsAbsent ?? []).length > 0
            ? ` ${ctx.t("Not in this layout:")} ${(result.collectionsAbsent ?? []).join(", ")}.`
            : "";
          ctx.setStatusCopy(
            "Read a {layout} archive. Imported {records} records. Repairs: {archiveLinks} archive links, {corpusLinks} captured links, {participants} participant IDs resolved, {unresolved} kept unresolved. Warnings: {warnings}; errors: {errors}. Files: {recognized} recognized, {skipped} skipped, {malformed} malformed.{absent}",
            {
              records: result.records,
              archiveLinks: result.archiveLinksExpanded ?? 0,
              corpusLinks: result.corpusLinksExpanded ?? 0,
              participants: result.participantIdsResolved ?? 0,
              unresolved: result.participantIdsUnresolved ?? 0,
              warnings: result.warnings,
              errors: result.errors,
              recognized: result.recognizedFiles ?? 0,
              skipped: result.skippedFiles ?? 0,
              malformed: result.malformedFiles ?? 0,
              layout,
              absent
            }
          );
        } catch (error) {
          ctx.options.onError("Archive import failed", error);
          ctx.setStatus("Archive import failed.");
        } finally {
          input.value = "";
        }
      })();
    });
    row.append(copy, input);
    rows.push(row);
  }

  if (ctx.options.searchArchive) {
    const row = ctx.el("div", "av-row av-row-stack");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t("Search captured records")),
      ctx.el("span", "av-row-description", ctx.t("Full-text search across the latest export collector run."))
    );
    const archiveSearchLabel = copy.querySelector<HTMLElement>(".av-row-label")!;
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = ctx.t("@handle, keyword, phrase…");
    archiveSearchLabel.id = "av-search-archive-label";
    input.id = "av-search-archive";
    input.setAttribute("aria-labelledby", archiveSearchLabel.id);
    input.className = "av-text-input";
    const results = ctx.el("div", "av-search-results");
    results.setAttribute("role", "list");
    results.setAttribute("aria-live", "polite");
    const runSearch = (): void => {
      const query = input.value.trim();
      results.replaceChildren();
      if (query.length === 0) {
        results.append(
          ctx.el("div", "av-row-description", ctx.t("Type to search the records captured by export runs."))
        );
        return;
      }
      const hits = ctx.options.searchArchive!(query);
      if (hits.length === 0) {
        results.append(
          ctx.el(
            "div",
            "av-row-description",
            ctx.formatCopy(ctx.t("No captured records match “{query}”."), { query })
          )
        );
        return;
      }
      for (const hit of hits.slice(0, 10)) {
        const item = ctx.el("div", "av-search-hit");
        item.setAttribute("role", "listitem");
        const head = ctx.el("span", "av-row-label", `@${hit.handle ?? "anon"} · ${hit.tweetId ?? "unknown"}`);
        const body = ctx.el("span", "av-row-description", hit.text.slice(0, 140));
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

  if (ctx.options.downloadReport) {
    rows.push(
      ctx.actionRow("Download Markdown report", "Audit log + snapshot diff + cleanup preview.", async () => {
        ctx.setStatus("Building report…");
        try {
          await ctx.options.downloadReport!();
          ctx.setStatus("Report downloaded.");
        } catch (error) {
          ctx.options.onError("Could not build report", error);
          ctx.setStatus("Could not build report.");
        }
      })
    );
  }

  if (ctx.options.getCleanupQueueSize) {
    const queueStatus = ctx.options.getCleanupQueueSize();
    rows.push(
      ctx.dataRow(
        "Cleanup review queue",
        ctx.localizedCopy("{total} items · queued {queued} · approved {approved} · skipped {skipped}", {
          total: queueStatus.total,
          queued: queueStatus.queued,
          approved: queueStatus.approved,
          skipped: queueStatus.skipped
        })
      )
    );
    rows.push(
      ctx.readonlyRow(
        "Destructive actions",
        "Aviary never deletes posts, likes, or follows. The queue is a review list; approving or skipping only writes to the audit log."
      )
    );
  }

  if (ctx.options.enqueueCleanupReview) {
    rows.push(
      ctx.actionRow(
        "Enqueue cleanup preview for review",
        "Append every non-protected candidate from the latest cleanup preview to the queue (no destructive action).",
        async () => {
          ctx.setStatus("Building cleanup preview…");
        try {
            const result = await ctx.options.enqueueCleanupReview!();
            ctx.render();
            ctx.setStatusCopy("Enqueued {added} items ({protected} protected skipped).", {
              added: result.added,
              protected: result.protected
            });
          } catch (error) {
            ctx.options.onError("Could not enqueue cleanup", error);
            ctx.setStatus("Could not enqueue cleanup.");
          }
        }
      )
    );
  }

  if (ctx.options.clearCleanupQueue) {
    rows.push(
      ctx.actionRow("Clear cleanup queue", "Drop every queued item without touching account data.", async () => {
        try {
          await ctx.options.clearCleanupQueue!();
          await ctx.save("Cleanup queue cleared.");
        } catch (error) {
          ctx.options.onError("Could not clear cleanup queue", error);
          ctx.setStatus("Could not clear queue.");
        }
      })
    );
  }

  return rows;
}

/**
 * What the local library occupies, measured rather than estimated.
 *
 * Two numbers that are not the same number. The measured total is the sum of Aviary's own stored
 * collections; the browser's usage figure counts index overhead, uncompacted tombstones and every
 * other store on this origin, and the Storage Standard calls it approximate. Printing one as the
 * other would be a filesystem claim this cannot make.
 */
function libraryStorageRows(ctx: PanelContext): HTMLElement[] {
  const breakdown = ctx.libraryStorage();
  if (breakdown === undefined) {
    return [ctx.readonlyRow("Library storage", "Measuring…")];
  }
  if (breakdown === null) {
    return [
      ctx.readonlyRow(
        "Library storage",
        "This browser store cannot be weighed from here, so Aviary does not report a size for it."
      )
    ];
  }

  // One template per sentence, interpolated. Concatenating translated fragments in English word
  // order produced something ungrammatical in every locale that does not share it, and the
  // singular/plural pick was an English two-form rule applied to eight languages.
  const rows: HTMLElement[] = [
    ctx.dataRow(
      "Library storage",
      ctx.formatCopy(ctx.t("{bytes} across {count} collections"), {
        bytes: ctx.formatBytes(breakdown.totalBytes),
        count: breakdown.collections.length
      })
    )
  ];

  // One row, with the store names as data in its value. A store key is an identifier, not copy,
  // and passing one as a row label puts it in the translation manifest and then demands eight
  // translations of `aviary.library.bookmarks.v1`.
  if (breakdown.collections.length > 0) {
    rows.push(
      ctx.dataRow(
        "Largest collections",
        breakdown.collections
          .slice(0, 8)
          .map((entry) => `${entry.key} ${ctx.formatBytes(entry.bytes)}`)
          .join(" · ")
      )
    );
  }

  rows.push(
    breakdown.usageDetails
      ? ctx.dataRow(
          "Browser storage report",
          Object.entries(breakdown.usageDetails)
            .map(([name, bytes]) => `${name}: ${ctx.formatBytes(bytes)}`)
            .join(" · ")
        )
      : ctx.readonlyRow(
          "Browser storage report",
          "This browser does not break its storage report down by type, so only Aviary's own measurement is shown."
        )
  );
  return rows;
}

/** The soft cap and the two capture-size controls, which change the next capture and nothing else. */
function libraryCaptureSizeRows(ctx: PanelContext): HTMLElement[] {
  const settings = ctx.options.settings.export;
  const megabytes = Math.round(settings.storageCapBytes / 1_000_000);
  return [
    ctx.integerInputRow(
      "Storage cap warning",
      "Warn before a capture takes the local library past this many megabytes. 0 turns the warning off. Aviary never deletes anything to stay under it; removal is chosen in the cleanup preview.",
      megabytes,
      async (value) => {
        settings.storageCapBytes = value <= 0 ? 0 : value * 1_000_000;
        await ctx.save(value <= 0 ? "Storage cap warning off." : "Storage cap warning saved.");
      },
      { min: 0, max: 1_000_000 }
    ),
    ctx.selectRow(
      "Downscale captured images",
      String(settings.captureImageScale),
      [
        ["1", "Keep the original"],
        ["0.75", "Three quarters"],
        ["0.5", "Half"],
        ["0.25", "Quarter"]
      ],
      async (value) => {
        settings.captureImageScale = Number(value);
        await ctx.save(
          settings.captureImageScale === 1
            ? "Captured images keep their original size."
            : "Captured images will be downscaled."
        );
      },
      "Applies to captures from here on. Nothing already stored changes, and each reduced record says it was reduced."
    ),
    ctx.toggleRow(
      "Video poster frames only",
      "Store the still X serves for a video instead of the video itself. The record says the video was left out, so a later export cannot present the still as the whole post.",
      settings.capturePosterFramesOnly,
      async (checked) => {
        settings.capturePosterFramesOnly = checked;
        await ctx.save(checked ? "Videos will be captured as poster frames." : "Videos will be captured in full.");
      }
    )
  ];
}

export function buildLibraryRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [...libraryStorageRows(ctx), ...libraryCaptureSizeRows(ctx)];

  if (ctx.options.getUnderTheHoodStatus && ctx.options.importUnderTheHood) {
    const status = ctx.options.getUnderTheHoodStatus();
    const intro = ctx.el("div", "av-row av-row-stack av-under-the-hood");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t("X Under the Hood")),
      ctx.el(
        "span",
        "av-row-description",
        ctx.t("Read X's own monthly visibility summary locally. It reports aggregate labels, not production ranking weights or a complete post audit.")
      )
    );
    const file = document.createElement("input");
    file.type = "file";
    file.className = "av-text-input";
    file.accept = ".json,application/json";
    file.setAttribute("aria-label", ctx.t("Import X Under the Hood JSON"));
    file.addEventListener("change", () => {
      const selected = file.files?.[0];
      if (!selected) return;
      ctx.setStatus("Reading Under the Hood report…");
      void selected
        .text()
        .then(async (payload) => {
          const result = await ctx.options.importUnderTheHood!(payload);
          if (!result.report) {
            ctx.setStatus(result.errors[0] ?? ctx.t("Under the Hood report could not be read."));
            return;
          }
          ctx.render();
          const warning = result.warnings.length > 0 ? ` ${result.warnings[0]}` : "";
          ctx.setStatus(`${ctx.t("Under the Hood report saved locally.")} ${result.report.period.startDate.slice(0, 7)}.${warning}`);
        })
        .catch((error: unknown) => {
          ctx.options.onError("Under the Hood import failed", error);
          ctx.setStatus("Under the Hood report could not be read.");
        });
    });
    intro.append(copy, file);
    rows.push(intro);

    if (status.latest) {
      rows.push(
        ctx.dataRow(
          "Latest Under the Hood report",
          `${status.latest.period} · ${status.latest.postCount} eligible posts · ${status.latest.postLabelCount} labeled posts · ${status.latest.accountLabelDayCount} account label-days`
        )
      );
      const labels = [
        ...status.latest.postLabels.map((label) => `post: ${label}`),
        ...status.latest.accountLabels.map((label) => `account: ${label}`)
      ];
      rows.push(
        ctx.readonlyRow(
          "Labels in latest report",
          labels.length > 0 ? labels.join(" · ") : ctx.t("No visibility labels were reported for this month.")
        )
      );
    } else {
      rows.push(ctx.readonlyRow("Under the Hood reports", ctx.t("No X report imported yet.")));
    }

    if (status.comparison && status.previous && status.latest) {
      const comparison = status.comparison;
      const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));
      const labelChanges = [
        ...comparison.addedPostLabels.map((label) => `new post: ${label}`),
        ...comparison.removedPostLabels.map((label) => `removed post: ${label}`),
        ...comparison.addedAccountLabels.map((label) => `new account: ${label}`),
        ...comparison.removedAccountLabels.map((label) => `removed account: ${label}`)
      ];
      rows.push(
        ctx.dataRow(
          "Month-over-month",
          `${comparison.earlier} → ${comparison.later} · posts ${signed(comparison.postCountDelta)} · labeled posts ${signed(comparison.postLabelCountDelta)} · account label-days ${signed(comparison.accountLabelDayCountDelta)}${labelChanges.length > 0 ? ` · ${labelChanges.join(" · ")}` : ""}`
        )
      );
    } else if (status.reportCount > 0) {
      rows.push(ctx.readonlyRow("Month-over-month", ctx.t("Import another month to compare reports.")));
    }

    if (ctx.options.exportUnderTheHood) {
      rows.push(
        ctx.actionRow(
          "Export saved Under the Hood reports",
          "Downloads the normalized reports as local JSON. This is user data from X; Aviary does not add ranking weights or infer a score.",
          async () => {
            try {
              const result = await ctx.options.exportUnderTheHood!();
              ctx.setStatus(`Under the Hood reports exported: ${result.filename} (${result.reports} reports, ${ctx.formatBytes(result.bytes)}).`);
            } catch (error) {
              ctx.options.onError("Under the Hood export failed", error);
              ctx.setStatus("Could not export Under the Hood reports.");
            }
          }
        )
      );
    }
  }

  if (ctx.options.offlineSearch) {
    const row = ctx.el("div", "av-row av-row-stack");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t("Search all local collections")),
      ctx.el(
        "span",
        "av-row-description",
        ctx.t("Search posts, likes, bookmarks, notes, and captures.")
      )
    );
    const input = document.createElement("input");
    input.type = "search";
    input.className = "av-text-input";
    input.value = ctx.state.libraryQuery;
    input.placeholder = ctx.t("Search local library");
    input.setAttribute("aria-label", ctx.t("Search all local collections"));
    input.spellcheck = false;
    const semanticToggle = document.createElement("input");
    semanticToggle.type = "checkbox";
    semanticToggle.checked = ctx.state.unifiedSemantic;
    semanticToggle.setAttribute("aria-label", ctx.t("Semantic ranking"));
    const semanticCopy = ctx.el("span", "av-row-description", ctx.t("Semantic ranking"));
    const semanticRow = ctx.el("label", "av-inline-controls");
    semanticRow.append(semanticToggle, semanticCopy);
    const results = ctx.el("div", "av-search-results");
    results.setAttribute("role", "list");
    results.setAttribute("aria-live", "polite");
    let searchSequence = 0;
    const libraryTools = ctx.el("div", "av-inline-controls av-library-media-actions");
    libraryTools.append(semanticRow);

    const mediaCount = ctx.el("span", "av-row-description av-library-media-count");
    const updateMediaCount = (): void => {
      const count = ctx.options.getCapturedMediaCount?.(ctx.state.libraryQuery.trim()) ?? 0;
      mediaCount.textContent = ctx.formatCopy(ctx.t("{count} media"), { count });
    };
    if (ctx.options.runCapturedMediaBatch) {
      const download = ctx.el(
        "button",
        "av-button av-button-secondary av-library-media-download",
        ctx.t("Download media")
      ) as HTMLButtonElement;
      download.type = "button";
      download.addEventListener("click", () => {
        download.disabled = true;
        const query = ctx.state.libraryQuery.trim();
        ctx.setStatus(query ? "Downloading media from matching captures..." : "Downloading all captured media...");
        void ctx.options
          .runCapturedMediaBatch!(query)
          .then((result) => {
            updateMediaCount();
            ctx.setStatus(
              result.cancelled
                ? `Batch cancelled: ${result.downloaded} saved / ${result.started} running / ${result.opened} opened / ${result.duplicate} dup / ${result.failed} failed (of ${result.total}).`
                : `Batch finished: ${result.downloaded} saved / ${result.started} running / ${result.opened} opened / ${result.duplicate} dup / ${result.failed} failed (of ${result.total}).`
            );
          })
          .catch((error: unknown) => {
            ctx.options.onError("Captured media download failed", error);
            ctx.setStatus("Captured media download failed.");
          })
          .finally(() => {
            download.disabled = false;
          });
      });
      libraryTools.append(download, mediaCount);
    }

    const renderUnified = async (): Promise<void> => {
      const sequence = ++searchSequence;
      const query = input.value.trim();
      ctx.state.libraryQuery = input.value;
      updateMediaCount();
      results.replaceChildren();
      if (query.length === 0) {
        results.append(ctx.el("div", "av-row-description", ctx.t("Try source:bookmarks, tag:reading, or has:media.")));
        return;
      }
      let matches: ReturnType<NonNullable<typeof ctx.options.offlineSearch>>;
      try {
        matches = ctx.state.unifiedSemantic && ctx.options.offlineSemanticSearch
          ? await ctx.options.offlineSemanticSearch(query)
          : ctx.options.offlineSearch!(query);
      } catch (error) {
        // The semantic path reaches a provider, so this rejects in the ordinary course of things.
        // The results area has already been cleared, so without this the reader was left looking
        // at an empty pane with no message anywhere.
        ctx.options.onError("Library search failed", error);
        ctx.setStatus("Library search failed. Check the embedding endpoint and key in Integrations.");
        return;
      }
      if (sequence !== searchSequence) return;
      if (matches.length === 0) {
        results.append(ctx.el("div", "av-row-description", ctx.t("No local collections match this search.")));
        return;
      }
      for (const hit of matches.slice(0, 30)) {
        const item = ctx.el("div", "av-search-hit");
        item.setAttribute("role", "listitem");
        const account = hit.document.account ? `@${hit.document.account}` : "local";
        const signal = hit.mode === "hybrid"
          ? ctx.t("Text + semantic match")
          : hit.mode === "semantic"
            ? ctx.t("Semantic match")
            : ctx.t("Text match");
        item.append(
          ctx.el("span", "av-row-label", `${hit.document.collection} · ${account} · ${signal}`),
          ctx.el("span", "av-row-description", hit.snippet || ctx.t("(no text)"))
        );
        results.append(item);
      }
    };

    input.addEventListener("input", () => void renderUnified());
    semanticToggle.addEventListener("change", () => {
      ctx.state.unifiedSemantic = semanticToggle.checked;
      void renderUnified();
    });
    updateMediaCount();
    results.append(ctx.el("div", "av-row-description", ctx.t("Try source:bookmarks, tag:reading, or has:media.")));
    row.append(copy, input, libraryTools, results);
    rows.push(row);
  }

  if (ctx.options.getBookmarkStatus && ctx.options.searchBookmarks && ctx.options.updateBookmark && ctx.options.removeBookmark) {
    const status = ctx.options.getBookmarkStatus();
    rows.push(
      ctx.dataRow(
        "Local bookmarks",
        ctx.localizedCopy("{saved} saved · {mirrored} mirrored · {due} due · {tags} tags · {folders} folders", {
          saved: status.total,
          mirrored: status.mirrored ?? 0,
          due: status.due,
          tags: status.tags.length,
          folders: status.folders.length
        })
      )
    );

    const bookmarkRow = ctx.el("div", "av-row av-row-stack");
    const bookmarkCopy = ctx.el("span", "av-row-copy");
    bookmarkCopy.append(
      ctx.el("span", "av-row-label", ctx.t("Find local bookmarks")),
      ctx.el(
        "span",
        "av-row-description",
        ctx.t("Search saved posts by text, handle, tags, folder, or ID. Captured bookmarks only include posts X sent while you scrolled past them.")
      )
    );
    const bookmarkInput = document.createElement("input");
    bookmarkInput.type = "search";
    bookmarkInput.className = "av-text-input";
    bookmarkInput.value = ctx.state.bookmarkQuery;
    bookmarkInput.placeholder = ctx.t("Search local bookmarks");
    bookmarkInput.setAttribute("aria-label", ctx.t("Find local bookmarks"));
    bookmarkInput.spellcheck = false;
    const bookmarkResults = ctx.el("div", "av-search-results");
    bookmarkResults.setAttribute("role", "list");
    bookmarkResults.setAttribute("aria-live", "polite");

    const renderBookmarks = (): void => {
      bookmarkResults.replaceChildren();
      const matches = ctx.options.searchBookmarks!(ctx.state.bookmarkQuery).slice(0, 30);
      if (matches.length === 0) {
        // An empty library and an unmatched search are different problems and need different
        // guidance: one tells you how to start, the other only that this query found nothing.
        const copy =
          status.total === 0
            ? ctx.t("Nothing saved yet. Use Save locally on any post to keep a copy here.")
            : ctx.t("No local bookmarks match this search.");
        bookmarkResults.append(ctx.el("div", "av-row-description", copy));
        return;
      }
      for (const entry of matches) {
        const item = ctx.el("div", "av-search-hit av-bookmark-hit");
        item.setAttribute("role", "listitem");
        const head = ctx.el("span", "av-row-label", `@${entry.handle ?? "anon"} · ${entry.tweetId ?? entry.id}`);
        const body = ctx.el(
          "span",
          "av-row-description",
          entry.text.slice(0, 180) || entry.url || ctx.t("(no text)")
        );
        item.append(head, body);

        const editor = ctx.el("div", "av-bookmark-editor");
        const tags = ctx.bookmarkField("Bookmark tags", entry.tags.join(", "), "Tags, comma-separated");
        const folder = ctx.bookmarkField("Bookmark folder", entry.folder ?? "", "Folder");
        const reminder = ctx.bookmarkField(
          "Bookmark reminder",
          ctx.toDatetimeLocal(entry.remindAt),
          "Reminder"
        );
        reminder.type = "datetime-local";
        const notes = document.createElement("textarea");
        notes.className = "av-textarea av-bookmark-notes";
        notes.rows = 2;
        notes.value = entry.notes;
        notes.placeholder = ctx.t("Notes");
        notes.setAttribute("aria-label", ctx.t("Bookmark notes"));
        editor.append(tags, folder, reminder, notes);

        const controls = ctx.el("div", "av-inline-controls");
        const saveButton = ctx.el("button", "av-button av-button-secondary", ctx.t("Save")) as HTMLButtonElement;
        saveButton.type = "button";
        saveButton.addEventListener("click", () => {
          saveButton.disabled = true;
          void ctx.options
            .updateBookmark!(entry.id, {
              tags: ctx.splitBookmarkTags(tags.value),
              folder: folder.value.trim() || null,
              remindAt: ctx.fromDatetimeLocal(reminder.value),
              notes: notes.value
            })
            .then(() => {
              ctx.setStatus("Bookmark updated.");
              ctx.render();
            })
            .catch((error: unknown) => {
              ctx.options.onError("Bookmark update failed", error);
              ctx.setStatus("Could not update bookmark.");
              saveButton.disabled = false;
            });
        });
        const remove = ctx.el("button", "av-button av-button-secondary", ctx.t("Remove")) as HTMLButtonElement;
        remove.type = "button";
        remove.addEventListener("click", () => {
          remove.disabled = true;
          void ctx.options
            .removeBookmark!(entry.id)
            .then((removed) => {
              ctx.setStatus(removed ? "Bookmark removed." : "Bookmark was already removed.");
              ctx.render();
            })
            .catch((error: unknown) => {
              ctx.options.onError("Bookmark removal failed", error);
              ctx.setStatus("Could not remove bookmark.");
              remove.disabled = false;
            });
        });
        controls.append(saveButton, remove);
        item.append(editor, controls);
        bookmarkResults.append(item);
      }
    };

    bookmarkInput.addEventListener("input", () => {
      ctx.state.bookmarkQuery = bookmarkInput.value;
      renderBookmarks();
    });
    renderBookmarks();
    bookmarkRow.append(bookmarkCopy, bookmarkInput, bookmarkResults);
    rows.push(bookmarkRow);

    if (ctx.options.exportBookmarks) {
      rows.push(
        ctx.actionRow(
          "Export local bookmarks",
          "Download JSON and CSV for every bookmark in this profile. The mirror only holds what X has sent to the page while you scrolled past it.",
          async () => {
            try {
              const result = await ctx.options.exportBookmarks!();
              ctx.setStatusCopy("Bookmarks exported: {records} records in {files} files.", {
                records: result.records,
                files: result.files
              });
            } catch (error) {
              ctx.options.onError("Bookmark export failed", error);
              ctx.setStatus("Could not export bookmarks.");
            }
          }
        )
      );
    }

    if (ctx.options.clearBookmarks) {
      rows.push(
        ctx.actionRow("Clear local bookmarks", "Remove every saved local bookmark.", async () => {
          try {
            await ctx.options.clearBookmarks!();
            ctx.setStatus("Bookmarks cleared.");
            ctx.render();
          } catch (error) {
            ctx.options.onError("Could not clear bookmarks", error);
            ctx.setStatus("Could not clear bookmarks.");
          }
        })
      );
    }
  }

  rows.push(
    ctx.toggleRow(
      "Show the AI button on posts",
      "Adds a button to every post that builds a Translate, Summarize, Explain or Fact-check prompt. Without an AI provider configured it copies the prompt to your clipboard; nothing is sent anywhere.",
      ctx.options.settings.ai.commandMenu,
      async (checked) => {
        ctx.options.settings.ai.commandMenu = checked;
        await ctx.save(checked ? "AI button on." : "AI button off.");
      }
    )
  );

  rows.push(
    ctx.toggleRow(
      "Unshorten t.co links",
      "Replace short `t.co` redirects with the destination from aria-labels and titles.",
      ctx.options.settings.links.expandTco,
      async (checked) => {
        ctx.options.settings.links.expandTco = checked;
        await ctx.save(checked ? "Unshorten on." : "Unshorten off.");
      }
    )
  );

  rows.push(
    ctx.toggleRow(
      "Clean tracking from links",
      "Strips share tokens and campaign parameters (utm_*, fbclid, and X's own t/s) from links in the timeline, so what you copy is the plain address.",
      ctx.options.settings.links.cleanShareButtons,
      async (checked) => {
        ctx.options.settings.links.cleanShareButtons = checked;
        await ctx.save(checked ? "Link cleaning on." : "Link cleaning off.");
      }
    )
  );

  rows.push(
    ctx.selectRow(
      "Copy post links as",
      ctx.options.settings.links.copyLinkHost,
      [
        ["", "X (x.com)"],
        ["fxtwitter.com", "fxtwitter.com"],
        ["vxtwitter.com", "vxtwitter.com"],
        ["fixupx.com", "fixupx.com"],
        ["xcancel.com", "xcancel.com"]
      ],
      async (value) => {
        ctx.options.settings.links.copyLinkHost = isCopyLinkHost(value)
          ? value
          : DEFAULT_SETTINGS.links.copyLinkHost;
        await ctx.save(
          ctx.options.settings.links.copyLinkHost === ""
            ? "Copy link control off."
            : "Copy link control on."
        );
      },
      "Adds a Copy link control to each post that writes that post's address on the chosen host. Nothing X rendered is rewritten and no navigation is redirected. Only what you copy changes. Leave it on X to remove the control.",
      false
    )
  );

  if (ctx.options.getUserColors && ctx.options.setUserColor) {
    const colors = ctx.options.getUserColors();
    const serializedColors = Object.entries(colors)
      .map(([handle, color]) => `${handle}: ${color}`)
      .sort();
    rows.push(
      ctx.textareaRow(
        "Account colours",
        "Format: handle: colour. One per line. Colours are amber, rose, violet, sky, green, or slate. An empty line removes the tag.",
        serializedColors,
        async (lines) => {
          const seen = new Set<string>();
          for (const line of lines) {
            const match = /^@?([A-Za-z0-9_]{1,15})\s*[:\-]\s*(\w*)$/.exec(line.trim());
            if (!match) continue;
            const [, handle, color] = match;
            if (!handle) continue;
            seen.add(handle.toLowerCase());
            await ctx.options.setUserColor!(handle, (color ?? "").toLowerCase());
          }
          // A handle dropped from the textarea loses its tag.
          for (const handle of Object.keys(colors)) {
            if (!seen.has(handle)) {
              await ctx.options.setUserColor!(handle, "");
            }
          }
          ctx.render();
          await ctx.save("Account colours saved.");
        }
      )
    );
  }

  if (ctx.options.getUserNotes && ctx.options.setUserNote) {
    const notes = ctx.options.getUserNotes();
    if (Object.keys(notes).length === 0) {
      rows.push(
        ctx.readonlyRow(
          "No account notes yet",
          ctx.t("Add one below as handle: note. Notes appear beside that account's posts.")
        )
      );
    }
    const serialized = Object.entries(notes)
      .map(([handle, note]) => `${handle}: ${note}`)
      .sort();
    rows.push(
      ctx.textareaRow(
        "Account notes",
        "Format: handle: note. One per line. Empty notes remove the entry.",
        serialized,
        async (lines) => {
          const before = { ...notes };
          const restore = async (): Promise<void> => {
            const current = ctx.options.getUserNotes?.() ?? {};
            for (const handle of Object.keys(current)) {
              if (!(handle in before)) await ctx.options.setUserNote!(handle, "");
            }
            for (const [handle, note] of Object.entries(before)) {
              await ctx.options.setUserNote!(handle, note);
            }
          };
          const seen = new Set<string>();
          try {
            for (const line of lines) {
              const match = /^@?([A-Za-z0-9_]{1,15})\s*[:\-]\s*(.*)$/.exec(line);
              if (!match) continue;
              const [, handle, note] = match;
              if (handle) {
                seen.add(handle.toLowerCase());
                await ctx.options.setUserNote!(handle, note ?? "");
              }
            }
            // Remove notes the user wiped from the textarea.
            for (const handle of Object.keys(notes)) {
              if (!seen.has(handle)) {
                await ctx.options.setUserNote!(handle, "");
              }
            }
          } catch (error) {
            await restore();
            throw error;
          }
          await ctx.save(`${seen.size} account note${seen.size === 1 ? "" : "s"} saved.`);
          return restore;
        }
      )
    );
  }

  if (ctx.options.clearUserNotes) {
    rows.push(
      ctx.actionRow("Clear all account notes", "Drop every persisted note.", async () => {
        try {
          await ctx.options.clearUserNotes!();
          await ctx.save("Account notes cleared.");
        } catch (error) {
          ctx.options.onError("Could not clear account notes", error);
          ctx.setStatus("Could not clear notes.");
        }
      })
    );
  }

  rows.push(
    ctx.textareaRow(
      "Composer snippets",
      "One snippet per line. Reusable replies / templates insert from the composer toolbar.",
      ctx.options.settings.composer.snippets,
      async (lines) => {
        ctx.options.settings.composer.snippets = lines
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, 100);
        await ctx.save(`${ctx.options.settings.composer.snippets.length} snippet${ctx.options.settings.composer.snippets.length === 1 ? "" : "s"} saved.`);
      }
    )
  );

  return rows;
}

export function buildExportRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
  rows.push(
    ctx.toggleRow(
      "Capture visible posts",
      "Accumulate posts visible on the active page for the next export run.",
      ctx.options.settings.export.enabled,
      async (checked) => {
        ctx.options.settings.export.enabled = checked;
        await ctx.save(checked ? "Export capture on." : "Export capture off.");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Export formats",
      "Comma-separated list. Supported: json, csv, html, markdown, xlsx.",
      ctx.options.settings.export.formats.join(","),
      async (value) => {
        const parsed = value
          .split(/[\s,]+/)
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry.length > 0);
        const supported = new Set(["json", "csv", "html", "markdown", "xlsx"]);
        ctx.options.settings.export.formats = (parsed.filter((entry) => supported.has(entry)) as AviarySettings["export"]["formats"]);
        if (ctx.options.settings.export.formats.length === 0) {
          ctx.options.settings.export.formats = ["json"];
        }
        await ctx.save(`Export formats: ${ctx.options.settings.export.formats.join(", ")}`);
      }
    )
  );
  rows.push(
    ctx.toggleRow(
      "Preserve raw payloads",
      "Also store the raw GraphQL responses X sends this tab, so records can be re-parsed later. Session tokens are stripped before anything is written.",
      ctx.options.settings.export.preserveRawPayloads,
      async (checked) => {
        ctx.options.settings.export.preserveRawPayloads = checked;
        await ctx.save("Raw payload preference saved.");
      }
    )
  );
  rows.push(
    ctx.toggleRow(
      "Capture media bytes in export",
      "Fetch media during the export action and include successful bytes with length and checksum; failed items remain retryable references.",
      ctx.options.settings.export.captureMediaBytes,
      async (checked) => {
        ctx.options.settings.export.captureMediaBytes = checked;
        await ctx.save(checked ? "Media byte capture on." : "Media byte capture off.");
      }
    )
  );
  rows.push(
    ctx.toggleRow(
      "Auto-discover query IDs",
      "Scan loaded scripts for X GraphQL operation IDs and cache them locally.",
      ctx.options.settings.export.autoDiscoverQueryIds,
      async (checked) => {
        ctx.options.settings.export.autoDiscoverQueryIds = checked;
        await ctx.save("Query discovery preference saved.");
      }
    )
  );
  rows.push(
    ctx.toggleRow(
      "Include protected posts in share exports",
      "Protected posts stay out of HTML, Markdown, WARC, WACZ, and static viewer output until you enable this explicitly. JSON and CSV remain archival and keep the audience field.",
      ctx.options.settings.export.includeProtected,
      async (checked) => {
        ctx.options.settings.export.includeProtected = checked;
        await ctx.save(checked ? "Protected post sharing enabled." : "Protected posts excluded from share exports.");
      }
    )
  );
  rows.push(
    ctx.toggleRow(
      "Include unknown-audience posts in share exports",
      "DOM-only, imported, and older records stay out of share-oriented exports until you enable this explicitly. JSON and CSV remain archival.",
      ctx.options.settings.export.includeUnknown,
      async (checked) => {
        ctx.options.settings.export.includeUnknown = checked;
        await ctx.save(checked ? "Unknown-audience sharing enabled." : "Unknown-audience posts excluded from share exports.");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Save folder hint",
      "Folder name (or path) used as the export ZIP root and download prefix.",
      ctx.options.settings.media.lastSaveFolder,
      async (value) => {
        ctx.options.settings.media.lastSaveFolder = value;
        await ctx.save("Save folder hint saved.");
      }
    )
  );

  const status = ctx.options.getExportStatus?.();
  if (status) {
    rows.push(
      ctx.dataRow(
        "Export status",
        ctx.localizedCopy("{jobs} jobs tracked · {queries} GraphQL IDs cached", {
          jobs: status.jobCount,
          queries: status.knownQueries
        })
      )
    );
    if (status.audience) {
      rows.push(
        ctx.dataRow(
          "Audience coverage",
          ctx.localizedCopy("{public} public · {protected} protected · {unknown} unknown · {excluded} excluded from share exports", {
            public: status.audience.public,
            protected: status.audience.protected,
            unknown: status.audience.unknown,
            excluded: status.audience.excludedProtected + status.audience.excludedUnknown
          })
        )
      );
    }
    if (status.jobCount === 0) {
      rows.push(
        ctx.readonlyRow(
          "No export jobs yet",
          ctx.t("Turn Capture on, scroll a timeline, then export. Jobs and their records appear here.")
        )
      );
    }
    for (const job of (status.jobs ?? []).slice(-3)) {
      rows.push(
        ctx.dataRow(
          "Export job",
          `${ctx.localizedCopy("{status} · {records} records · {surface}", {
            status: job.status,
            records: job.recordCount,
            surface: job.surface
          })}${job.error ? ` · ${job.error}` : ""}`
        )
      );
      if (job.status === "running" && ctx.options.pauseExportJob) {
        rows.push(
          ctx.actionRow("Pause export job", { source: "Pause {jobId}.", values: { jobId: job.jobId } }, async () => {
            const result = await ctx.options.pauseExportJob!(job.jobId);
            if (!result.ok) throw new Error(result.error ?? "Export job could not be paused");
            ctx.render();
            ctx.setStatus("Export job paused.");
          },
          "The export job could not be paused. It may have already finished. Reopen this section to see its current state.")
        );
      }
      if (job.status === "paused" && ctx.options.resumeExportJob) {
        rows.push(
          ctx.actionRow("Resume export job", { source: "Resume {jobId}.", values: { jobId: job.jobId } }, async () => {
            const result = await ctx.options.resumeExportJob!(job.jobId);
            if (!result.ok) throw new Error(result.error ?? "Export job could not be resumed");
            ctx.render();
            ctx.setStatus("Export job resumed.");
          },
          "The export job could not be resumed. Its checkpoint may have been cleared. Start a new export instead.")
        );
      }
      if ((job.status === "running" || job.status === "paused" || job.status === "queued") && ctx.options.cancelExportJob) {
        rows.push(
          ctx.actionRow("Cancel export job", { source: "Cancel {jobId}.", values: { jobId: job.jobId } }, async () => {
            const result = await ctx.options.cancelExportJob!(job.jobId);
            if (!result.ok) throw new Error(result.error ?? "Export job could not be cancelled");
            ctx.render();
            ctx.setStatus("Export job cancelled.");
          },
          "The export job could not be cancelled. It may have already finished. Reopen this section to see its current state.")
        );
      }
    }
  }

  if (ctx.options.runExport) {
    rows.push(
      ctx.actionRow("Export visible posts", "Collect the currently rendered posts and download a ZIP.", async () => {
        ctx.setStatus("Collecting visible posts…");
        try {
          const result = await ctx.options.runExport!();
          ctx.render();
          const files = result.files ?? 1;
          if (result.records === 0) {
            ctx.setStatus("No posts found on this view. Scroll the timeline to load some, then export again.");
          } else if (files > 1) {
            ctx.setStatusCopy("Exported {records} records across {files} ZIPs → {filename}", {
              records: result.records,
              files,
              filename: result.filename
            });
          } else if (result.records === 1) {
            ctx.setStatusCopy("Exported {records} record → {filename}", {
              records: result.records,
              filename: result.filename
            });
          } else {
            ctx.setStatusCopy("Exported {records} records → {filename}", {
              records: result.records,
              filename: result.filename
            });
          }
        } catch (error) {
          ctx.options.onError("Export failed", error);
          ctx.setStatus("Export failed. See diagnostics.");
        }
      })
    );
  }

  if (ctx.options.rebuildThreads) {
    rows.push(
      ctx.actionRow(
        "Rebuild captured threads",
        "Read captured replies in parent-first order. Missing parents stay visible as local gaps.",
        async () => {
          try {
            const result = await ctx.options.rebuildThreads!();
            ctx.render();
            if (result.records === 0) {
              ctx.setStatus("No captured posts have thread metadata yet.");
            } else {
              ctx.setStatus("Captured thread reader exported.");
            }
          } catch (error) {
            ctx.options.onError("Thread rebuild failed", error);
            ctx.setStatus("Thread rebuild failed. See diagnostics.");
          }
        }
      )
    );
  }

  if (ctx.options.copyDiagnostics) {
    rows.push(
      ctx.actionRow("Copy diagnostics", "Copy support diagnostics (version, route, recent log).", async () => {
        try {
          await ctx.options.copyDiagnostics!();
          ctx.setStatus("Diagnostics copied to clipboard.");
        } catch (error) {
          ctx.options.onError("Could not copy diagnostics", error);
          ctx.setStatus("Could not copy diagnostics.");
        }
      })
    );
  }

  if (ctx.options.downloadWarc || ctx.options.downloadWacz) {
    rows.push(preservationArchiveRow(ctx));
  }
  if (ctx.options.downloadSignedWacz || ctx.options.exportWaczSigningKey) {
    rows.push(waczSigningRow(ctx));
  }

  if (ctx.options.exportToTarget) {
    const targets: Array<{ id: "clipboard-markdown" | "obsidian" | "notion" | "raw-json"; label: string; description: string }> = [
      { id: "clipboard-markdown", label: "Copy as Markdown", description: "Push a plain Markdown export onto the clipboard." },
      { id: "obsidian", label: "Save Obsidian Markdown", description: "Markdown with YAML frontmatter and Aviary tags." },
      { id: "notion", label: "Save Notion Markdown", description: "Heading-first Markdown that Notion imports cleanly." },
      { id: "raw-json", label: "Save records JSON", description: "Raw ExportRecord[] JSON without ZIP wrapping." }
    ];
    for (const target of targets) {
      rows.push(
        ctx.actionRow(target.label, target.description, async () => {
          try {
            const result = await ctx.options.exportToTarget!(target.id);
            if (result.copied) {
              ctx.setStatusCopy("Copied {records} records to clipboard.", { records: result.records });
            } else {
              ctx.setStatusCopy("Exported {records} records to {target}.", {
                records: result.records,
                target: ctx.t(target.label)
              });
            }
          } catch (error) {
            ctx.options.onError("External export failed", error);
            ctx.setStatus("External export failed.");
          }
        })
      );
    }
  }

  if (ctx.options.getRetentionPolicy && ctx.options.saveRetentionPolicy) {
    rows.push(
      ctx.integerInputRow(
        "Records per ZIP",
        "Split a long export across several archives instead of one huge file (25-1000).",
        ctx.options.settings.media.zipChunkSize,
        async (value) => {
          ctx.options.settings.media.zipChunkSize = value;
          await ctx.save("Records per ZIP saved.");
        },
        { min: 25, max: 1000 }
      )
    );
    const policy = ctx.options.getRetentionPolicy();
    rows.push(
      ctx.integerInputRow(
        "Maximum export jobs",
        "Keep the newest jobs. Use 0 for unlimited.",
        policy.maxJobs,
        async (value) => {
          const before = ctx.options.getRetentionPolicy!();
          await ctx.options.saveRetentionPolicy!({ ...before, maxJobs: value });
          await ctx.save("Export job retention saved.");
          return async () => ctx.options.saveRetentionPolicy!(before);
        }
      )
    );
    rows.push(
      ctx.integerInputRow(
        "Maximum records per job",
        "Keep the newest records in each job. Use 0 for unlimited.",
        policy.maxRecordsPerJob,
        async (value) => {
          const before = ctx.options.getRetentionPolicy!();
          await ctx.options.saveRetentionPolicy!({ ...before, maxRecordsPerJob: value });
          await ctx.save("Record retention saved.");
          return async () => ctx.options.saveRetentionPolicy!(before);
        }
      )
    );
    rows.push(
      ctx.integerInputRow(
        "Maximum export age (days)",
        "Remove older jobs at boot. Use 0 to disable age-based cleanup.",
        policy.maxAgeDays,
        async (value) => {
          const before = ctx.options.getRetentionPolicy!();
          await ctx.options.saveRetentionPolicy!({ ...before, maxAgeDays: value });
          await ctx.save("Age-based retention saved.");
          return async () => ctx.options.saveRetentionPolicy!(before);
        }
      )
    );
  }

  return rows;
}

function preservationArchiveRow(ctx: PanelContext): HTMLElement {
  const row = ctx.el("div", "av-row av-preservation-row");
  row.dataset.avLabel = "Preservation archive";
  const copy = ctx.el("span", "av-row-copy");
  const description = ctx.el(
    "span",
    "av-row-description",
    ctx.t("Download a raw WARC or a replay-ready WACZ. WACZ keeps archive and index members uncompressed.")
  );
  const estimate = ctx.options.getWaczEstimate?.();
  if (estimate) {
    description.append(document.createTextNode(` ${ctx.localizedCopy(
      "Estimated WACZ: {size} for {records} records.",
      { size: ctx.formatBytes(estimate.estimatedBytes), records: estimate.records }
    )}`));
  }
  copy.append(ctx.el("span", "av-row-label", ctx.t("Preservation archive")), description);

  const actions = ctx.el("div", "av-preservation-actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", ctx.t("Preservation archive actions"));
  const archiveButtons: HTMLButtonElement[] = [];
  const run = async (
    button: HTMLButtonElement,
    status: string,
    operation: () => Promise<void>
  ): Promise<void> => {
    archiveButtons.forEach((candidate) => { candidate.disabled = true; });
    button.setAttribute("aria-busy", "true");
    ctx.setStatus(status);
    try {
      await operation();
    } finally {
      button.removeAttribute("aria-busy");
      archiveButtons.forEach((candidate) => { candidate.disabled = false; });
    }
  };

  if (ctx.options.downloadWarc) {
    const warc = ctx.button("WARC", "av-button av-button-secondary");
    archiveButtons.push(warc);
    warc.addEventListener("click", () => {
      void run(warc, ctx.t("Building WARC archive…"), async () => {
        try {
          const result = await ctx.options.downloadWarc!();
          ctx.setStatusCopy("WARC downloaded ({records} records).", { records: result.records });
        } catch (error) {
          ctx.options.onError("WARC export failed", error);
          ctx.setStatus("WARC export failed.");
        }
      });
    });
    actions.append(warc);
  }

  if (ctx.options.downloadWacz) {
    const wacz = ctx.button("WACZ", "av-button av-button-primary");
    archiveButtons.push(wacz);
    let waczController: AbortController | undefined;
    const cancelWacz = ctx.button("Cancel", "av-button av-button-secondary");
    cancelWacz.type = "button";
    cancelWacz.hidden = true;
    cancelWacz.setAttribute("aria-hidden", "true");
    cancelWacz.addEventListener("click", () => {
      waczController?.abort();
      cancelWacz.disabled = true;
    });
    wacz.addEventListener("click", () => {
      void run(wacz, ctx.t("Building WACZ archive…"), async () => {
        waczController = new AbortController();
        cancelWacz.hidden = false;
        cancelWacz.removeAttribute("aria-hidden");
        try {
          const result = await ctx.options.downloadWacz!({
            signal: waczController.signal,
            onProgress: (progress) => {
              ctx.setStatus(`${ctx.t("Building WACZ archive…")} ${Math.round(progress * 100)}%`);
            }
          });
          ctx.setStatusCopy("WACZ downloaded ({records} records, {size}).", {
            records: result.records,
            size: ctx.formatBytes(result.bytes)
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            ctx.setStatus("Export job cancelled.");
          } else {
            ctx.options.onError("WACZ export failed", error);
            // An authored sentence, not the exception. statusState reads the English source to
            // choose the tone, so a raw message like "Quota exceeded" matched none of its words
            // and rendered beside the success dot; the real reason is in diagnostics.
            ctx.setStatus("WACZ export failed. Free some disk space or export fewer records, then try again.");
          }
        } finally {
          waczController = undefined;
          cancelWacz.hidden = true;
          cancelWacz.setAttribute("aria-hidden", "true");
          cancelWacz.disabled = false;
        }
      });
    });
    actions.append(wacz);
    actions.append(cancelWacz);
  }

  const replay = ctx.el("a", "av-button av-button-secondary av-replay-link", ctx.t("Open replayweb.page"));
  replay.href = "https://replayweb.page/";
  replay.target = "_blank";
  replay.rel = "noopener noreferrer";
  actions.append(replay);
  row.append(copy, actions);
  return row;
}

function waczSigningRow(ctx: PanelContext): HTMLElement {
  const row = ctx.el("div", "av-row av-preservation-row");
  row.dataset.avLabel = "Aviary-only WACZ proof";
  const copy = ctx.el("span", "av-row-copy");
  const description = ctx.el("span", "av-row-description");
  copy.append(ctx.el("span", "av-row-label", ctx.t("Aviary-only WACZ proof")), description);

  const actions = ctx.el("div", "av-preservation-actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", ctx.t("Aviary-only WACZ proof actions"));
  let actionButtons: HTMLButtonElement[] = [];
  let signingController: AbortController | undefined;
  const cancelSigning = ctx.button("Cancel", "av-button av-button-secondary");
  cancelSigning.type = "button";
  cancelSigning.hidden = true;
  cancelSigning.setAttribute("aria-hidden", "true");
  cancelSigning.addEventListener("click", () => {
    signingController?.abort();
    cancelSigning.disabled = true;
  });

  const run = async (
    button: HTMLButtonElement,
    status: string,
    operation: () => Promise<void>
  ): Promise<void> => {
    if (ctx.guardDraft()) return;
    actionButtons.forEach((candidate) => { candidate.disabled = true; });
    button.setAttribute("aria-busy", "true");
    ctx.setStatus(status);
    try {
      await operation();
    } finally {
      button.removeAttribute("aria-busy");
      actionButtons.forEach((candidate) => { candidate.disabled = false; });
    }
  };

  const refresh = (): void => {
    const signing = ctx.options.getWaczSigningStatus?.() ?? {
      state: "missing" as const,
      fingerprint: null,
      createdAt: null
    };
    if (signing.state === "ready" && signing.fingerprint) {
      description.textContent = ctx.localizedCopy(
        "Local identity {fingerprint}. It proves continuity of this key, not what X served.",
        { fingerprint: shortFingerprint(signing.fingerprint) }
      );
    } else if (signing.state === "invalid") {
      description.textContent = ctx.t("The stored keypair is invalid. Replace it before signing another archive.");
    } else {
      description.textContent = ctx.t("First use creates a local P-384 identity. Signing stays off for ordinary WACZ downloads.");
    }

    actionButtons = [];
    actions.replaceChildren();
    if (signing.state === "invalid" && ctx.options.replaceWaczSigningKey) {
      const replace = ctx.button("Replace keypair", "av-button av-button-secondary");
      actionButtons.push(replace);
      replace.addEventListener("click", () => {
        void run(replace, ctx.t("Creating a new signing identity…"), async () => {
          try {
            await ctx.options.replaceWaczSigningKey!();
            refresh();
            actionButtons[0]?.focus({ preventScroll: true });
            ctx.setStatus("Signing identity replaced.");
          } catch (error) {
            ctx.options.onError("Signing identity replacement failed", error);
            ctx.setStatus("Could not replace the signing identity.");
          }
        });
      });
      actions.append(replace);
      return;
    }

    if (ctx.options.downloadSignedWacz) {
      const signed = ctx.button("Aviary-only WACZ proof", "av-button av-button-primary");
      actionButtons.push(signed);
      signed.addEventListener("click", () => {
        void run(signed, ctx.t("Creating Aviary-only WACZ proof…"), async () => {
          signingController = new AbortController();
          cancelSigning.hidden = false;
          cancelSigning.removeAttribute("aria-hidden");
          try {
            const result = await ctx.options.downloadSignedWacz!({
              signal: signingController.signal,
              onProgress: (progress) => {
                ctx.setStatus(`${ctx.t("Creating Aviary-only WACZ proof…")} ${Math.round(progress * 100)}%`);
              }
            });
            refresh();
            ctx.setStatusCopy("Aviary-only WACZ proof downloaded ({records} records, {size}).", {
              records: result.records,
              size: ctx.formatBytes(result.bytes)
            });
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              ctx.setStatus("Export job cancelled.");
            } else {
              ctx.options.onError("Aviary-only WACZ proof export failed", error);
              ctx.setStatus("Aviary-only WACZ proof export failed.");
            }
          } finally {
            signingController = undefined;
            cancelSigning.hidden = true;
            cancelSigning.setAttribute("aria-hidden", "true");
            cancelSigning.disabled = false;
          }
        });
      });
      actions.append(signed);
      actions.append(cancelSigning);
    }

    if (ctx.options.exportWaczSigningKey) {
      const exportKey = ctx.button("Export keypair", "av-button av-button-secondary");
      actionButtons.push(exportKey);
      exportKey.addEventListener("click", () => {
        void run(exportKey, ctx.t("Preparing signing keypair…"), async () => {
          try {
            const result = await ctx.options.exportWaczSigningKey!();
            refresh();
            ctx.setStatusCopy("Signing keypair downloaded: {filename}.", { filename: result.filename });
          } catch (error) {
            ctx.options.onError("Signing keypair export failed", error);
            ctx.setStatus("Signing keypair export failed.");
          }
        });
      });
      actions.append(exportKey);
    }
  };

  refresh();
  row.append(copy, actions);
  return row;
}

function shortFingerprint(value: string): string {
  return value.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
}

export function buildMediaRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
  ctx.t("The download preference applies to every media control.");
  rows.push(
    ctx.toggleRow(
      "Show download buttons",
      "Add one Download action to each media post, plus per-asset controls.",
      ctx.options.settings.media.buttons,
      async (checked) => {
        ctx.options.settings.media.buttons = checked;
        await ctx.save(checked ? "Media buttons on." : "Media buttons off.");
      }
    )
  );
  rows.push(
    ctx.toggleRow(
      "Prefer original quality",
      "Try source-format name=orig first, then 4096x4096 if it fails.",
      ctx.options.settings.media.preferOriginalImages,
      async (checked) => {
        ctx.options.settings.media.preferOriginalImages = checked;
        await ctx.save("Original quality preference saved.");
      }
    )
  );
  rows.push(
    ctx.readonlyRow(
      "Original quality status",
      ctx.options.settings.media.buttons
        ? "The download preference applies to every media control."
        : "Original quality is applied when download controls are enabled."
    )
  );
  rows.push(
    ctx.toggleRow(
      "Show images at original quality",
      "Loads timeline photos at full size instead of the version X picks for the slot. Sharper, and several times the bytes.",
      ctx.options.settings.media.inlineOriginalImages,
      async (checked) => {
        ctx.options.settings.media.inlineOriginalImages = checked;
        await ctx.save(checked ? "Full-size images on." : "Full-size images off.");
      }
    )
  );
  rows.push(
    ctx.selectRow(
      "Media layout",
      ctx.options.settings.media.layout,
      MEDIA_LAYOUT_OPTIONS,
      async (value) => {
        ctx.options.settings.media.layout = ctx.coerceLayout(value);
        await ctx.save("Media layout saved.");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Filename template",
      "Fields: {handle}, {account}, {tweetId}, {mediaId}, {index}, {total}, {date}, {text}, {ext}. {account} is an alias for the publishing handle and can create per-account folders.",
      ctx.options.settings.media.filenameTemplate,
      async (value) => {
        ctx.options.settings.media.filenameTemplate = value.length > 0 ? value : "{handle}_{tweetId}_{index}";
        await ctx.save("Filename template saved.");
      }
    )
  );
  rows.push(
    ctx.selectRow(
      "Metadata sidecar",
      ctx.options.settings.media.sidecarFormat,
      [
        ["off", "Off"],
        ["text", "Text"],
        ["json", "JSON"]
      ],
      async (value) => {
        if (value === "off" || value === "text" || value === "json") {
          ctx.options.settings.media.sidecarFormat = value as MediaSidecarFormat;
          await ctx.save("Media sidecar preference saved.");
        }
      },
      "Save a local text or JSON companion after each completed media download."
    )
  );
  rows.push(
    ctx.toggleRow(
      "Match visually similar images",
      "Compare a 256-bit visual signature too. Similar flat compositions can be mistaken for a match, so this stays off by default.",
      ctx.options.settings.media.perceptualDedup,
      async (checked) => {
        ctx.options.settings.media.perceptualDedup = checked;
        await ctx.save(checked ? "Visual duplicate matching on." : "Visual duplicate matching off.");
      }
    )
  );
  rows.push(
    ctx.toggleRow(
      "Duplicate history",
      "Skip the same X asset or exact image bytes without storing its source URL.",
      ctx.options.settings.media.downloadHistory,
      async (checked) => {
        ctx.options.settings.media.downloadHistory = checked;
        await ctx.save(checked ? "Duplicate history on." : "Duplicate history off.");
      }
    )
  );
  rows.push(
    ctx.integerInputRow(
      "Concurrent downloads",
      "Maximum media downloads in flight during a batch (1-6).",
      ctx.options.settings.jobs.concurrentDownloads,
      async (value) => {
        ctx.options.settings.jobs.concurrentDownloads = Math.max(1, Math.min(6, Math.trunc(value)));
        await ctx.save("Concurrent download limit saved.");
      },
      { min: 1, max: 6 }
    )
  );
  rows.push(
    ctx.selectRow(
      "Download pacing",
      ctx.options.settings.jobs.rateLimitMode,
      [
        ["conservative", "Conservative"],
        ["balanced", "Balanced"]
      ],
      async (value) => {
        if (value === "conservative" || value === "balanced") {
          ctx.options.settings.jobs.rateLimitMode = value as RateLimitMode;
          await ctx.save("Download pacing saved.");
        }
      },
      "Controls the opening burst and sustained pace of batch media requests."
    )
  );

  if (ctx.options.runMediaBatch) {
    rows.push(
      ctx.actionRow(
        "Download all visible media",
        "Queue every photo, video, GIF, thumbnail, audio track, and caption track currently visible on this page.",
        async () => {
          ctx.setStatus("Downloading media from this view…");
          try {
            const result = await ctx.options.runMediaBatch!();
            ctx.render();
            ctx.setStatus(
              result.cancelled
                ? `Batch cancelled: ${result.downloaded} saved / ${result.started} running / ${result.opened} opened / ${result.duplicate} dup / ${result.failed} failed (of ${result.total}).`
                : `Batch finished: ${result.downloaded} saved / ${result.started} running / ${result.opened} opened / ${result.duplicate} dup / ${result.failed} failed (of ${result.total}).`
            );
          } catch (error) {
            ctx.options.onError("Batch download failed", error);
            ctx.setStatus("Batch download failed.");
          }
        }
      )
    );
  }

  const status = ctx.options.getMediaStatus?.();
  if (status) {
    rows.push(
      ctx.dataRow(
        "Download status",
        `${status.running} running / ${status.queued ?? 0} queued / ${status.paused ?? 0} paused / ${status.completed} done / ${status.opened ?? 0} opened / ${status.duplicate} dup / ${status.failed} failed`
      )
    );
    if (status.batch) {
      rows.push(
        ctx.dataRow(
          "Active media batch",
          `${status.batch.status} · ${status.batch.downloaded} saved / ${status.batch.started} running / ${status.batch.opened} opened / ${status.batch.duplicate} dup / ${status.batch.failed} failed of ${status.batch.total}`
        )
      );
    }
    rows.push(ctx.dataRow("History entries", String(status.historySize)));
    rows.push(
      ctx.dataRow(
        "Duplicate matches",
        `${status.historyMatches.exact} exact / ${status.historyMatches.identity} same X asset / ${status.historyMatches.perceptual} visual`
      )
    );
    if (status.qualityReceipts) {
      rows.push(
        ctx.dataRow(
          "Quality receipts",
          `${status.qualityReceipts.original} original / ${status.qualityReceipts.bestDirect} best direct / ${status.qualityReceipts.fallback} fallback / ${status.qualityReceipts.unknown} unknown`
        )
      );
    }
    rows.push(
      ctx.dataRow(
        "Last duplicate match",
        status.lastHistoryMatch === "exact"
          ? "Exact downloaded bytes"
          : status.lastHistoryMatch === "identity"
            ? "Same X media asset"
            : status.lastHistoryMatch === "perceptual"
              ? "Visually similar image"
              : "No duplicate match recorded"
      )
    );
  }

  if (ctx.options.clearMediaHistory) {
    rows.push(
      ctx.actionRow("Clear download history", "Reset the local dedup index.", async () => {
        try {
          await ctx.options.clearMediaHistory?.();
          await ctx.save("History cleared.");
        } catch (error) {
          ctx.options.onError("Could not clear download history", error);
          ctx.setStatus("Could not clear history.");
        }
      })
    );
  }

  if (ctx.options.exportMediaHistory) {
    const row = ctx.el("div", "av-row av-row-stack av-media-history-export");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t("Export download history")),
      ctx.el("span", "av-row-description", ctx.t("Export the local dedup records as JSON and CSV for a chosen date range. Source media URLs are never included."))
    );
    const controls = ctx.el("div", "av-inline-controls");
    const from = document.createElement("input");
    from.type = "date";
    from.className = "av-text-input";
    from.setAttribute("aria-label", ctx.t("History start date"));
    const to = document.createElement("input");
    to.type = "date";
    to.className = "av-text-input";
    to.setAttribute("aria-label", ctx.t("History end date"));
    const exportButton = ctx.button(ctx.t("Export range"), "av-button av-button-secondary");
    exportButton.addEventListener("click", () => {
      exportButton.disabled = true;
      void ctx.options.exportMediaHistory!({ from: from.value || null, to: to.value || null })
        .then((result) => {
          ctx.setStatusCopy("History exported: {records} records in {files} files.", {
            records: result.records,
            files: result.files
          });
        })
        .catch((error: unknown) => {
          ctx.options.onError("Download history export failed", error);
          ctx.setStatus("Could not export download history.");
        })
        .finally(() => {
          exportButton.disabled = false;
        });
    });
    controls.append(from, to, exportButton);
    row.append(copy, controls);
    rows.push(row);
  }

  if (ctx.options.getCapturedMediaCount && ctx.options.runCapturedMediaBatch) {
    const followOns: Array<["audio" | "subtitle", string, string]> = [
      [
        "audio",
        ctx.t("Download captured audio"),
        ctx.t("Download audio tracks already present in local captures. No metadata discovery request is made.")
      ],
      [
        "subtitle",
        ctx.t("Download captured captions"),
        ctx.t("Download caption tracks already present in local captures. No metadata discovery request is made.")
      ]
    ];
    for (const [kind, label, description] of followOns) {
      const count = ctx.options.getCapturedMediaCount("", kind);
      if (count === 0) continue;
      rows.push(
        ctx.actionRow(
          label,
          { source: `${description} {count} available.`, values: { count } },
          async () => {
            const result = await ctx.options.runCapturedMediaBatch!("", kind);
            ctx.render();
            ctx.setStatusCopy("Captured media finished: {downloaded} saved / {duplicate} dup / {failed} failed.", {
              downloaded: result.downloaded,
              duplicate: result.duplicate,
              failed: result.failed
            });
          },
          "That batch could not run. Grant download access on the Aviary permissions page, then try again."
        )
      );
    }
  }

  const mediaControlAction = (
    label: string,
    description: string,
    action: () => { ok: boolean; error?: string },
    success: string
  ): void => {
    rows.push(
      ctx.actionRow(
        label,
        description,
        async () => {
          const result = action();
          if (!result.ok) {
            throw new Error(result.error ?? `${label} failed`);
          }
          ctx.render();
          ctx.setStatus(success);
        },
        "The batch did not take that instruction. It may have already finished. Reopen this section to see its current state."
      )
    );
  };

  if (ctx.options.pauseMediaBatch) {
    mediaControlAction(
      "Pause media batch",
      "Stop starting new downloads; the current downloads finish and the queue remains resumable.",
      ctx.options.pauseMediaBatch,
      "Media batch paused."
    );
  }
  if (ctx.options.resumeMediaBatch) {
    mediaControlAction(
      "Resume media batch",
      "Continue the active batch from its durable queue.",
      ctx.options.resumeMediaBatch,
      "Media batch resumed."
    );
  }
  if (ctx.options.cancelMediaBatch) {
    mediaControlAction(
      "Cancel media batch",
      "Stop scheduling new downloads and leave unfinished queue entries available for recovery.",
      ctx.options.cancelMediaBatch,
      "Media batch cancelling."
    );
  }
  if (ctx.options.resumePendingMediaJobs) {
    rows.push(
      ctx.actionRow("Resume queued media", "Recover paused or queued downloads from an earlier session.", async () => {
        const result = await ctx.options.resumePendingMediaJobs!();
        ctx.render();
        ctx.setStatus(
          result.cancelled
            ? `Queued media recovery cancelled after ${result.downloaded} saved, ${result.started} still running, and ${result.opened} opened.`
            : `Queued media recovery finished: ${result.downloaded} saved / ${result.started} running / ${result.opened} opened / ${result.failed} failed.`
        );
      },
      "The queued downloads could not be resumed. Grant download access on the Aviary permissions page, then try again.")
    );
  }
  if (ctx.options.retryFailedMediaJobs) {
    rows.push(
      ctx.actionRow("Retry failed media", "Retry every failed or cancelled media job in the durable queue.", async () => {
        const result = await ctx.options.retryFailedMediaJobs!();
        ctx.render();
        ctx.setStatus(
          result.total === 0
            ? "No failed media jobs to retry."
            : `Media retry finished: ${result.downloaded} saved / ${result.started} running / ${result.opened} opened / ${result.failed} failed.`
        );
      },
      "The failed downloads could not be retried. Grant download access on the Aviary permissions page, then try again.")
    );
  }

  return rows;
}
