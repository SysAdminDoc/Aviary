import type { PanelContext } from "../panel-context";
export function buildTrustRows(ctx: PanelContext): HTMLElement[] {
  const rows = [
      ctx.storageStatusRow(),
      ctx.toggleRow(
        "Local-only mode",
        "Blocks every outbound request, including the integrations you configured. On by default; turning an integration on is what turns this off.",
        ctx.options.settings.privacy.localOnly,
        async (checked) => {
          ctx.options.settings.privacy.localOnly = checked;
          await ctx.save(checked ? "Local-only mode on" : "Local-only mode off");
        }
      ),
      ctx.toggleRow(
        "Refuse X's analytics beacons",
        "Stops the tracking pings X sends as you scroll, click and pause. Only the analytics endpoints are refused — timeline, media and login traffic is untouched.",
        ctx.options.settings.privacy.blockAnalyticsBeacons,
        async (checked) => {
          ctx.options.settings.privacy.blockAnalyticsBeacons = checked;
          await ctx.save(checked ? "Analytics beacons refused" : "Analytics beacons allowed");
        }
      ),
      ctx.toggleRow(
        "Monitor selector health",
        "Check the current X surface for required and fallback anchors. Turn this off when you do not want selector diagnostics.",
        ctx.options.settings.diagnostics.selectorHealth,
        async (checked) => {
          ctx.options.settings.diagnostics.selectorHealth = checked;
          await ctx.save(checked ? "Selector health monitoring on" : "Selector health monitoring off");
        }
      ),
        ...ctx.beaconRows(),
      ctx.storageHealthRow(),
      ctx.readonlyRow("Telemetry", ctx.options.settings.privacy.telemetry ? "Enabled" : "Disabled"),
      ctx.coverageRow(),
        ...ctx.selectorHealthRows()
  ];
  const profile = ctx.options.getProfileStatus?.();
  if (profile) {
    rows.splice(
      1,
      0,
      ctx.dataRow("Active profile", `${profile.activeLabel} · ${profile.activeId}`),
      ctx.selectRow(
        "Switch profile",
        profile.activeId,
        profile.profiles.map((entry) => [entry.id, `${entry.label} (${entry.kind})`] as [string, string]),
        async (profileId) => {
          if (!ctx.options.switchProfile) return;
          try {
            const result = await ctx.options.switchProfile(profileId);
            if (!result.ok) throw new Error(result.error ?? "Profile could not be switched");
            ctx.setStatus("Profile switched. Reloading…");
          } catch (error) {
            ctx.options.onError("Profile switch failed", error);
            ctx.setStatus("Profile switch failed.");
          }
        },
        "A profile is an explicit local boundary for settings, credentials, library data, jobs, and search.",
        false
      )
    );
    if (profile.legacyDataAvailable && ctx.options.adoptLegacyProfileData) {
      rows.push(
        ctx.actionRow(
          "Assign legacy data here",
          "Move unassigned pre-profile settings and library stores into the active profile. Nothing is guessed from the current X route.",
          async () => {
            const result = await ctx.options.adoptLegacyProfileData!();
            ctx.render();
            ctx.setStatusCopy("Assigned {moved} stores; {skipped} already existed.", {
              moved: result.moved,
              skipped: result.skipped
            });
          }
        )
      );
    }
    if (ctx.options.createProfile) {
      rows.push(
        ctx.textInputRow("New profile", "Create an empty offline profile before switching accounts or importing another archive.", "", async (label) => {
          try {
            const result = await ctx.options.createProfile!(label);
            if (!result.ok) throw new Error(result.error ?? "Profile could not be created");
            ctx.setStatus("Profile created. Reloading…");
          } catch (error) {
            ctx.options.onError("Profile creation failed", error);
            ctx.setStatus("Profile creation failed.");
          }
        })
      );
    }
  }
  return rows;
}

export function buildIntegrationRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const status = ctx.options.getIntegrationStatus?.();
  const usage = ctx.options.getIntegrationUsage?.();
  const integrations = ctx.options.settings.integrations;

  // Aria2
  rows.push(
    ctx.toggleRow(
      "Aria2 handoff",
      "Send large media downloads to a self-hosted Aria2 JSON-RPC endpoint.",
      integrations.aria2.enabled,
      async (checked) => {
        integrations.aria2.enabled = checked;
        await ctx.save(checked ? "Aria2 handoff on" : "Aria2 handoff off");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Aria2 endpoint",
      "http://localhost:6800 (no trailing slash needed)",
      integrations.aria2.endpoint,
      async (value) => {
        integrations.aria2.endpoint = value;
        await ctx.save("Aria2 endpoint saved");
      }
    )
  );
  rows.push(
    ctx.secretInputRow(
      "Aria2 RPC secret",
      "Optional shared secret for token: auth.",
      integrations.aria2.secret,
      async (value) => {
        integrations.aria2.secret = value;
        await ctx.save("Aria2 secret saved");
      }
    )
  );
  rows.push(
    ctx.integerInputRow(
      "Hand off files larger than (MB)",
      "Smaller files save through the browser. Aviary checks the size first; when the server will not report one, the file is handed off anyway.",
      Math.round(integrations.aria2.minBytes / 1_000_000),
      async (value) => {
        integrations.aria2.minBytes = Math.max(0, value) * 1_000_000;
        await ctx.save("Aria2 threshold saved");
      }
    )
  );
  if (ctx.options.pingAria2) {
    rows.push(
      ctx.actionRow("Test Aria2 connection", "Sends a trivial JSON-RPC call.", async () => {
        try {
          const result = await ctx.options.pingAria2!();
          if (result.ok) {
            ctx.setStatus("Aria2 reachable.");
          } else {
            ctx.setStatusCopy("Aria2 unreachable: {error}", { error: result.error ?? "unknown error" });
          }
        } catch (error) {
          ctx.options.onError("Aria2 connection test failed", error);
          ctx.setStatus("Aria2 connection test failed.");
        }
      })
    );
  }

  if (ctx.options.listAria2Active && ctx.options.cancelAria2) {
    const row = ctx.el("div", "av-row av-row-stack");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t("Aria2 active downloads")),
      ctx.el("span", "av-row-description", ctx.t("Refresh to list in-flight transfers; tap Cancel to abort one."))
    );
    const list = ctx.el("div", "av-search-results");
    const refresh = async (): Promise<void> => {
      try {
        const active = await ctx.options.listAria2Active!();
        list.replaceChildren();
        if (active.length === 0) {
          list.append(ctx.el("div", "av-row-description", ctx.t("No active downloads.")));
          return;
        }
        for (const job of active) {
          const item = ctx.el("div", "av-search-hit");
          const total = job.totalLength > 0 ? `${Math.round((job.completedLength / job.totalLength) * 100)}%` : "?";
          item.append(
            ctx.el("span", "av-row-label", `${job.path || job.gid} · ${total}`),
            ctx.el("span", "av-row-description", ctx.localizedCopy("gid {gid} · {status}", { gid: job.gid, status: job.status }))
          );
          const cancel = ctx.el("button", "av-button av-button-secondary", ctx.t("Cancel")) as HTMLButtonElement;
          cancel.type = "button";
          cancel.addEventListener("click", () => {
            void (async () => {
              cancel.disabled = true;
              try {
                const result = await ctx.options.cancelAria2!(job.gid);
                if (result.ok) {
                  ctx.setStatusCopy("Cancelled {gid}.", { gid: job.gid });
                  await refresh();
                } else {
                  ctx.setStatusCopy("Aria2 cancel failed: {error}", {
                    error: result.error ?? "unknown error"
                  });
                }
              } catch (error) {
                try {
                  ctx.options.onError("Aria2 cancel failed", error);
                } catch {
                  // Diagnostic reporting must not create a second rejected action.
                }
                ctx.setStatus("Aria2 cancel failed.");
              } finally {
                cancel.disabled = false;
              }
            })();
          });
          item.append(cancel);
          list.append(item);
        }
      } catch (error) {
        ctx.options.onError("Aria2 sweep failed", error);
        ctx.setStatus("Aria2 sweep failed.");
      }
    };
    const refreshBtn = ctx.el("button", "av-button av-button-secondary", ctx.t("Refresh")) as HTMLButtonElement;
    refreshBtn.type = "button";
    refreshBtn.addEventListener("click", () => void refresh());
    row.append(copy, refreshBtn, list);
    rows.push(row);
  }

  // Bluesky
  rows.push(
    ctx.toggleRow(
      "Bluesky crosspost",
      "Post composer text to your Bluesky account on demand.",
      integrations.bluesky.enabled,
      async (checked) => {
        integrations.bluesky.enabled = checked;
        await ctx.save(checked ? "Bluesky on" : "Bluesky off");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Bluesky service URL",
      "Default: https://bsky.social",
      integrations.bluesky.service,
      async (value) => {
        integrations.bluesky.service = value;
        await ctx.save("Bluesky service saved");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Bluesky handle",
      "Your handle (no @, e.g. you.bsky.social)",
      integrations.bluesky.handle,
      async (value) => {
        integrations.bluesky.handle = value;
        await ctx.save("Bluesky handle saved");
      }
    )
  );
  rows.push(
    ctx.secretInputRow(
      "Bluesky app password",
      "App password from your account settings — never your main password.",
      integrations.bluesky.appPassword,
      async (value) => {
        integrations.bluesky.appPassword = value;
        await ctx.save("Bluesky app password saved");
      }
    )
  );

  // Mastodon
  rows.push(
    ctx.toggleRow(
      "Mastodon crosspost",
      "Post composer text to your Mastodon account on demand.",
      integrations.mastodon.enabled,
      async (checked) => {
        integrations.mastodon.enabled = checked;
        await ctx.save(checked ? "Mastodon on" : "Mastodon off");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Mastodon instance",
      "https://mastodon.social",
      integrations.mastodon.instance,
      async (value) => {
        integrations.mastodon.instance = value;
        await ctx.save("Mastodon instance saved");
      }
    )
  );
  rows.push(
    ctx.secretInputRow(
      "Mastodon access token",
      "Bearer token with write:statuses scope.",
      integrations.mastodon.token,
      async (value) => {
        integrations.mastodon.token = value;
        await ctx.save("Mastodon token saved");
      }
    )
  );

  rows.push(
    ctx.toggleRow(
      "Attach last download",
      "Upload the last successful Aviary media download with the first post in an explicit crosspost.",
      integrations.crosspost.attachLastDownload,
      async (checked) => {
        integrations.crosspost.attachLastDownload = checked;
        await ctx.save(checked ? "Crosspost attachment on" : "Crosspost attachment off");
      }
    )
  );

  if (ctx.options.crosspost) {
    const threadRow = ctx.el("div", "av-row");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t("Crosspost as thread")),
      ctx.el("span", "av-row-description", ctx.t("Split on blank lines and reply each segment to the previous one."))
    );
    const threadLabel = copy.querySelector<HTMLElement>(".av-row-label")!;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    threadLabel.id = "av-crosspost-thread-label";
    checkbox.id = "av-crosspost-thread";
    checkbox.setAttribute("aria-labelledby", threadLabel.id);
    threadRow.append(copy, checkbox);
    rows.push(threadRow);

    rows.push(
      ctx.actionRow("Crosspost composer → Bluesky", "Uses the current composer text.", async () => {
        try {
          const result = await ctx.options.crosspost!("bluesky", { asThread: checkbox.checked });
          if (result.ok) {
            ctx.setStatusCopy("Posted {posts} to Bluesky.{url}", {
              posts: result.posts ?? 1,
              url: result.url ? ` ${result.url}` : ""
            });
          } else {
            ctx.setStatusCopy("Bluesky failed: {error}", { error: result.error ?? "unknown error" });
          }
        } catch (error) {
          ctx.options.onError("Bluesky crosspost failed", error);
          ctx.setStatus("Bluesky crosspost failed.");
        }
      })
    );
    rows.push(
      ctx.actionRow("Crosspost composer → Mastodon", "Uses the current composer text.", async () => {
        try {
          const result = await ctx.options.crosspost!("mastodon", { asThread: checkbox.checked });
          if (result.ok) {
            ctx.setStatusCopy("Posted {posts} to Mastodon.{url}", {
              posts: result.posts ?? 1,
              url: result.url ? ` ${result.url}` : ""
            });
          } else {
            ctx.setStatusCopy("Mastodon failed: {error}", { error: result.error ?? "unknown error" });
          }
        } catch (error) {
          ctx.options.onError("Mastodon crosspost failed", error);
          ctx.setStatus("Mastodon crosspost failed.");
        }
      })
    );
  }

  // AI provider
  rows.push(
    ctx.toggleRow(
      "AI provider runs",
      "Let the AI command menu POST prompts to your configured provider.",
      integrations.ai.enabled,
      async (checked) => {
        integrations.ai.enabled = checked;
        await ctx.save(checked ? "AI runs on" : "AI runs off");
      }
    )
  );
  rows.push(
    ctx.selectRow(
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
          await ctx.save(`AI provider set to ${value}`);
        }
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "AI endpoint (optional)",
      "Override the default endpoint for the chosen provider.",
      integrations.ai.endpoint,
      async (value) => {
        integrations.ai.endpoint = value;
        await ctx.save("AI endpoint saved");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "AI model",
      "e.g. claude-sonnet-4-6, gpt-4o, llama3.1:8b",
      integrations.ai.model,
      async (value) => {
        integrations.ai.model = value;
        await ctx.save("AI model saved");
      }
    )
  );
  rows.push(
    ctx.secretInputRow(
      "AI API key",
      "Stored locally only. Aviary never sends this except as the auth header to your provider.",
      integrations.ai.apiKey,
      async (value) => {
        integrations.ai.apiKey = value;
        await ctx.save("AI API key saved");
      }
    )
  );

  if (usage) {
    rows.push(
      ctx.dataRow(
        "Network status",
        usage.networkAllowed ? ctx.t("Allowed") : ctx.t("Blocked by local-only mode")
      ),
      ctx.dataRow(
        "AI destination",
        `${integrations.ai.provider} · ${integrations.ai.endpoint || ctx.defaultAiEndpoint(integrations.ai.provider)}`
      ),
      ctx.readonlyRow(
        "AI data disclosure",
        "Before sending, Aviary shows the provider, endpoint, fields, character/token estimate, retention, and budget status."
      ),
      ctx.dataRow(
        "AI usage today",
        `${usage.ai.requests} requests · ${ctx.formatBytes(usage.ai.bytes)} / ${usage.ai.dailyLimitBytes > 0 ? ctx.formatBytes(usage.ai.dailyLimitBytes) : ctx.t("unlimited")}`
      ),
      ctx.integerInputRow(
        "AI max request bytes",
        "Stop before sending one AI request larger than this UTF-8 body. Use 0 for no per-request bound.",
        integrations.ai.maxRequestBytes,
        async (value) => {
          integrations.ai.maxRequestBytes = value;
          await ctx.save("AI request budget saved");
        },
        { max: 5_000_000 }
      ),
      ctx.integerInputRow(
        "AI daily request bytes",
        "Stop AI provider calls after this many UTF-8 request bytes in the local day. Use 0 for unlimited.",
        integrations.ai.dailyRequestBytes,
        async (value) => {
          integrations.ai.dailyRequestBytes = value;
          await ctx.save("AI daily budget saved");
        },
        { max: 100_000_000 }
      )
    );
  }

  // Semantic search
  rows.push(
    ctx.toggleRow(
      "Semantic search",
      "Send captured record text to the configured embedding endpoint for similarity search. The destination, fields, retention, and byte budget are shown here.",
      integrations.semanticSearch.enabled,
      async (checked) => {
        integrations.semanticSearch.enabled = checked;
        await ctx.save(checked ? "Semantic search on" : "Semantic search off");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Embedding endpoint",
      "POST endpoint that returns {data: [{embedding: number[]}]}",
      integrations.semanticSearch.endpoint,
      async (value) => {
        integrations.semanticSearch.endpoint = value;
        await ctx.save("Embedding endpoint saved");
      }
    )
  );
  rows.push(
    ctx.textInputRow(
      "Embedding model",
      "e.g. text-embedding-3-small",
      integrations.semanticSearch.model,
      async (value) => {
        integrations.semanticSearch.model = value;
        await ctx.save("Embedding model saved");
      }
    )
  );
  rows.push(
    ctx.secretInputRow(
      "Embedding API key",
      "Stored locally; used only as the Authorization header.",
      integrations.semanticSearch.apiKey,
      async (value) => {
        integrations.semanticSearch.apiKey = value;
        await ctx.save("Embedding API key saved");
      }
    )
  );

  if (usage) {
    rows.push(
      ctx.dataRow(
        "Embedding destination",
        `${integrations.semanticSearch.endpoint || ctx.t("Not configured")}`
      ),
      ctx.readonlyRow(
        "Embedding data disclosure",
        "A request contains the model and captured record text. Vectors and bounded text stay in Aviary's local index; provider retention follows its policy."
      ),
      ctx.dataRow(
        "Embedding usage today",
        `${usage.embedding.requests} requests · ${usage.embedding.records} records · ${ctx.formatBytes(usage.embedding.bytes)} / ${usage.embedding.dailyLimitBytes > 0 ? ctx.formatBytes(usage.embedding.dailyLimitBytes) : ctx.t("unlimited")}`
      ),
      ctx.integerInputRow(
        "Embedding max record bytes",
        "Stop before sending one record larger than this UTF-8 body. Use 0 for no per-record bound.",
        integrations.semanticSearch.maxRecordBytes,
        async (value) => {
          integrations.semanticSearch.maxRecordBytes = value;
          await ctx.save("Embedding request budget saved");
        },
        { max: 5_000_000 }
      ),
      ctx.integerInputRow(
        "Embedding daily record bytes",
        "Stop embedding calls after this many UTF-8 record bytes in the local day. Use 0 for unlimited.",
        integrations.semanticSearch.dailyRecordBytes,
        async (value) => {
          integrations.semanticSearch.dailyRecordBytes = value;
          await ctx.save("Embedding daily budget saved");
        },
        { max: 100_000_000 }
      )
    );
  }

  rows.push(
    ctx.toggleRow(
      "Auto-embed every export",
      "Before enabling, review the endpoint, captured-record fields, local retention, and daily byte budget above. After each export, embed in the background. Off by default.",
      integrations.semanticSearch.autoIndex,
      async (checked) => {
        integrations.semanticSearch.autoIndex = checked;
        await ctx.save(checked ? "Auto-embed on" : "Auto-embed off");
      }
    )
  );

  if (ctx.options.rebuildSemanticIndex) {
    rows.push(
      ctx.actionRow(
        "Rebuild semantic index",
        "Embed every captured record. Re-running is cheap because cached entries are skipped.",
        async () => {
          ctx.setStatus("Rebuilding semantic index…");
          try {
            const result = await ctx.options.rebuildSemanticIndex!();
            ctx.render();
            if ((result.blocked ?? 0) > 0) {
              ctx.setStatusCopy(
                "Embedding stopped at the budget ({blocked} records were not sent).",
                { blocked: result.blocked ?? 0 }
              );
              return;
            }
            // The index is capped, so say when the cap actually bit rather than letting the
            // total quietly stop growing.
            const trimmed = result.dropped > 0 ? ` · oldest ${result.dropped} dropped` : "";
            ctx.setStatusCopy(
              "Indexed: +{added} new · skipped {skipped} · errors {errors} · total {total}{trimmed}.",
              {
                added: result.added,
                skipped: result.skipped,
                errors: result.errors,
                total: result.total,
                trimmed
              }
            );
          } catch (error) {
            ctx.options.onError("Embedding failed", error);
            ctx.setStatus("Embedding failed.");
          }
        }
      )
    );
  }

  if (ctx.options.semanticSearchQuery) {
    const row = ctx.el("div", "av-row av-row-stack");
    const copy = ctx.el("span", "av-row-copy");
    copy.append(
      ctx.el("span", "av-row-label", ctx.t("Semantic search")),
      ctx.el("span", "av-row-description", ctx.t("Vector similarity over captured records. Embeddings run on demand."))
    );
    const semanticSearchLabel = copy.querySelector<HTMLElement>(".av-row-label")!;
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = ctx.t("Describe what you're looking for…");
    semanticSearchLabel.id = "av-semantic-search-label";
    input.id = "av-semantic-search";
    input.setAttribute("aria-labelledby", semanticSearchLabel.id);
    input.className = "av-text-input";
    const results = ctx.el("div", "av-search-results");
    let pending: number | undefined;
    let searchSequence = 0;
    input.addEventListener("input", () => {
      if (pending !== undefined) clearTimeout(pending);
      const sequence = ++searchSequence;
      const query = input.value.trim();
      if (query.length === 0) {
        results.replaceChildren();
        pending = undefined;
        return;
      }
      pending = setTimeout(() => {
        pending = undefined;
        void ctx.options
          .semanticSearchQuery!(query)
          .then((hits) => {
            if (sequence !== searchSequence || input.value.trim() !== query) return;
            results.replaceChildren();
            if (hits.length === 0) {
              results.append(ctx.el("div", "av-row-description", ctx.t("No matches (or integration disabled).")));
              return;
            }
            for (const hit of hits) {
              const item = ctx.el("div", "av-search-hit");
              item.append(
                ctx.el("span", "av-row-label", `@${hit.handle ?? "anon"} · ${hit.tweetId ?? "—"} · score ${hit.score.toFixed(3)}`),
                ctx.el("span", "av-row-description", hit.text.slice(0, 200))
              );
              results.append(item);
            }
          })
          .catch((error: unknown) => {
            if (sequence === searchSequence && input.value.trim() === query) {
              ctx.options.onError("Semantic search failed", error);
            }
          });
      }, 220) as unknown as number;
    });
    row.append(copy, input, results);
    rows.push(row);
  }

  if (ctx.options.clearSemanticIndex) {
    rows.push(
      ctx.actionRow("Clear semantic index", "Forget every embedded record.", async () => {
        try {
          await ctx.options.clearSemanticIndex!();
          await ctx.save("Semantic index cleared");
        } catch (error) {
          ctx.options.onError("Could not clear semantic index", error);
          ctx.setStatus("Could not clear semantic index.");
        }
      })
    );
  }

  if (ctx.options.clearIntegrationUsage) {
    rows.push(
      ctx.actionRow(
        "Clear AI and embedding usage",
        "Forget local request counters only. This does not remove the semantic index or provider credentials.",
        async () => {
          try {
            await ctx.options.clearIntegrationUsage!();
            await ctx.save("AI and embedding usage cleared");
          } catch (error) {
            ctx.options.onError("Could not clear AI and embedding usage", error);
            ctx.setStatus("Could not clear AI and embedding usage.");
          }
        }
      )
    );
  }

  if (status) {
    const on = ctx.t("on");
    const off = ctx.t("off");
    const configured = ctx.t("configured");
    const missingEndpoint = ctx.t("missing endpoint");
    const missingCredentials = ctx.t("missing credentials");
    const missingKeyModel = ctx.t("missing key/model");
    const indexed = ctx.t("indexed");
    const integrationLine = (name: string, enabled: boolean, ready: boolean, missing: string): string =>
      ctx.formatCopy(ctx.t("{name}: {state} · {config}"), {
        name,
        state: enabled ? on : off,
        config: ready ? configured : missing
      });
    const lines = [
      integrationLine("Aria2", status.aria2.enabled, status.aria2.configured, missingEndpoint),
      integrationLine("Bluesky", status.bluesky.enabled, status.bluesky.configured, missingCredentials),
      integrationLine("Mastodon", status.mastodon.enabled, status.mastodon.configured, missingCredentials),
      integrationLine("AI", status.ai.enabled, status.ai.configured, missingKeyModel),
      ctx.formatCopy(ctx.t("{name}: {state} · {count} {indexed}"), {
        name: "Semantic",
        state: status.semanticSearch.enabled ? on : off,
        count: status.semanticSearch.indexed,
        indexed
      })
    ];
    rows.push(ctx.dataRow("Integration status", lines.join(" · ")));
  }

  if (ctx.options.recentIntegrationErrors) {
    const errors = ctx.options.recentIntegrationErrors();
    if (errors.length === 0) {
      rows.push(ctx.readonlyRow("Recent integration errors", "None recorded."));
    } else {
      const row = ctx.el("div", "av-row av-row-stack");
      const copy = ctx.el("span", "av-row-copy");
      copy.append(
        ctx.el("span", "av-row-label", ctx.t("Recent integration errors")),
        ctx.el("span", "av-row-description", ctx.t("Drawn from the audit log; only failed integration calls show up."))
      );
      const list = ctx.el("div", "av-search-results");
      for (const error of errors.slice(0, 8)) {
        const item = ctx.el("div", "av-search-hit");
        item.append(
          ctx.el("span", "av-row-label", `${error.kind} · ${error.at}`),
          ctx.el("span", "av-row-description", error.message.slice(0, 200))
        );
        list.append(item);
      }
      row.append(copy, list);
      rows.push(row);
    }
  }

  return rows;
}

export function buildBackupRows(ctx: PanelContext): HTMLElement[] {
  const rows: HTMLElement[] = [];

  // These branches appear only after a file has been selected, so keep their stable copy in
  // the panel manifest even though the extractor cannot click a native file picker.
  ctx.t("Redacted — saved credentials will be kept.");
  ctx.t("Stop after the current collection and roll back anything already written.");
  ctx.t("Validate the backup and show the same conflicts without writing or removing any local data.");
  ctx.t("Apply the selected profile collections. A failed write rolls back the collections already changed.");
  ctx.t("Credentials are redacted; the values already saved in this profile will be kept.");

  if (ctx.options.resetSettings) {
    rows.push(
      ctx.actionRow(
        "Reset everything to plain X",
        "Puts every setting back to its default, which is to change nothing about X at all. Your saved posts, notes, bookmarks and download history are kept — this only resets preferences.",
        async () => {
          try {
            await ctx.options.resetSettings!();
            ctx.setStatus("Everything reset. X is untouched again.");
          } catch (error) {
            ctx.options.onError("Could not reset settings", error);
            ctx.setStatus("Could not reset settings.");
          }
        }
      )
    );
  }

  if (ctx.options.exportSettings) {
    rows.push(
      ctx.actionRow("Export settings", "Downloads your preferences as JSON. API keys and passwords are replaced with a placeholder, so the file is safe to share; importing it here keeps the credentials already saved on this machine.", async () => {
        try {
          await ctx.options.exportSettings!();
          ctx.setStatus("Settings exported.");
        } catch (error) {
          ctx.options.onError("Could not export settings", error);
          ctx.setStatus("Could not export settings.");
        }
      })
    );
  }

  if (ctx.options.importSettings) {
    rows.push(
      ctx.textareaRow(
        "Import settings (JSON)",
        "Paste a settings file exported from Aviary, then choose Import. Redacted credentials keep the values already saved here.",
        [],
        async (lines) => {
          const payload = lines.join("\n");
          try {
            const report = await ctx.options.importSettings!(payload);
            if (report.applied) {
              // Show what the warning actually said — a bare count tells the user nothing.
              const [first, ...rest] = report.warnings;
              const extra = rest.length > 0 ? ` (+${rest.length} more)` : "";
              ctx.setStatusCopy("Settings imported. {warning}", {
                warning: first ? `${first}${extra}` : ""
              });
            } else {
              ctx.setStatusCopy("Import failed: {errors}", { errors: report.errors.join("; ") });
            }
          } catch (error) {
            ctx.options.onError("Could not import settings", error);
            ctx.setStatus("Could not import settings.");
          }
        },
        "Import"
      )
    );
  }

  if (ctx.options.exportLibraryBackup) {
    rows.push(
      ctx.actionRow(
        "Export full library backup",
        "Downloads one versioned JSON backup of this profile's local collections. Credentials are excluded by default; restoring keeps the credentials already saved here.",
        async () => {
          try {
            const result = await ctx.options.exportLibraryBackup!();
            ctx.setStatusCopy("Library backup downloaded: {filename} ({collections} collections, {bytes}).", {
              filename: result.filename,
              collections: result.collections,
              bytes: ctx.formatBytes(result.bytes)
            });
          } catch (error) {
            ctx.options.onError("Could not export full library backup", error);
            ctx.setStatus("Could not export full library backup.");
          }
        }
      )
    );
  }

  if (ctx.options.previewLibraryRestore && ctx.options.restoreLibraryBackup) {
    const fileRow = ctx.el("div", "av-row av-row-stack");
    const fileCopy = ctx.el("span", "av-row-copy");
    fileCopy.append(
      ctx.el("span", "av-row-label", ctx.t("Choose a library backup")),
      ctx.el(
        "span",
        "av-row-description",
        ctx.t("Select a JSON backup to inspect its versions, counts, conflicts, and checksum before changing local data.")
      )
    );
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.className = "av-text-input";
    fileInput.accept = ".json,application/json";
    fileInput.setAttribute("aria-label", ctx.t("Choose a library backup"));
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      ctx.state.pendingLibraryBackupPayload = null;
      ctx.state.pendingLibraryBackupPreview = null;
      ctx.setStatus("Reading library backup…");
      void file
        .text()
        .then(async (payload) => {
          const preview = await ctx.options.previewLibraryRestore!(payload);
          ctx.state.pendingLibraryBackupPayload = payload;
          ctx.state.pendingLibraryBackupPreview = preview;
          ctx.render();
          ctx.setStatusCopy("Backup loaded: {collections} collections, {conflicts} changes.", {
            collections: preview.collections.length,
            conflicts: preview.conflictCount
          });
        })
        .catch((error: unknown) => {
          ctx.state.pendingLibraryBackupPayload = null;
          ctx.state.pendingLibraryBackupPreview = null;
          ctx.options.onError("Could not read library backup", error);
          ctx.setStatus("Could not read library backup.");
        });
    });
    fileRow.append(fileCopy, fileInput);
    rows.push(fileRow);
  }

  const backupPreview = ctx.state.pendingLibraryBackupPreview;
  const backupPayload = ctx.state.pendingLibraryBackupPayload;
  if (backupPreview && backupPayload && ctx.options.restoreLibraryBackup) {
    rows.push(ctx.dataRow("Backup version", `v${backupPreview.schemaVersion} · ${backupPreview.createdAt}`));
    rows.push(
      ctx.dataRow(
        "Backup collections",
        `${backupPreview.collections.length} · ${ctx.formatBytes(backupPreview.totalBytes)}`
      )
    );
    rows.push(
      ctx.dataRow(
        "Collection changes",
        backupPreview.collections
          .map((collection) => `${collection.label} v${collection.version}: ${collection.conflict}`)
          .join(" · ")
      )
    );
    if (backupPreview.credentialsRedacted) {
      rows.push(ctx.readonlyRow("Credentials", "Redacted — saved credentials will be kept."));
    }
    if (backupPreview.warnings.length > 0) {
      rows.push(
        ctx.dataRow(
          "Backup warnings",
          backupPreview.warnings
            .map((warning) =>
              warning === "Credentials are redacted; the values already saved in this profile will be kept."
                ? ctx.t(warning)
                : warning
            )
            .join(" · ")
        )
      );
    }

    if (ctx.state.libraryRestoreRunning) {
      rows.push(
        ctx.actionRow(
          "Cancel restore",
          "Stop after the current collection and roll back anything already written.",
          async () => {
            ctx.state.libraryRestoreAbort?.abort();
            ctx.setStatus("Cancelling restore…");
          }
        )
      );
    } else {
      rows.push(
        ctx.actionRow(
          "Dry-run restore",
          "Validate the backup and show the same conflicts without writing or removing any local data.",
          async () => {
            try {
              const result = await ctx.options.restoreLibraryBackup!(backupPayload, {
                dryRun: true,
                signal: new AbortController().signal
              });
              if (result.errors.length === 0) {
                ctx.setStatus("Dry-run complete. No local data changed.");
              } else {
                ctx.setStatusCopy("Dry-run failed: {errors}", { errors: result.errors.join("; ") });
              }
            } catch (error) {
              ctx.options.onError("Could not dry-run library restore", error);
              ctx.setStatus("Could not dry-run library restore.");
            }
          }
        )
      );
      rows.push(
        ctx.actionRow(
          "Restore this library backup",
          "Apply the selected profile collections. A failed write rolls back the collections already changed.",
          async () => {
            ctx.state.libraryRestoreRunning = true;
            ctx.state.libraryRestoreAbort = new AbortController();
            ctx.render();
            try {
              const result = await ctx.options.restoreLibraryBackup!(backupPayload, {
                dryRun: false,
                signal: ctx.state.libraryRestoreAbort.signal
              });
              if (result.applied) {
                ctx.state.pendingLibraryBackupPayload = null;
                ctx.state.pendingLibraryBackupPreview = null;
                ctx.setStatusCopy("Library backup restored ({collections} collections). Reloading…", {
                  collections: result.restoredKeys.length
                });
              } else if (result.cancelled) {
                ctx.setStatus(
                  result.rolledBack ? "Restore cancelled; local data was rolled back." : "Restore cancelled."
                );
              } else {
                ctx.setStatusCopy("Restore failed: {errors}", { errors: result.errors.join("; ") });
              }
            } catch (error) {
              ctx.options.onError("Could not restore library backup", error);
              ctx.setStatus("Could not restore library backup.");
            } finally {
              ctx.state.libraryRestoreRunning = false;
              ctx.state.libraryRestoreAbort = null;
              ctx.render();
            }
          }
        )
      );
    }
  }

  if (ctx.options.getAuditSize) {
    rows.push(
      ctx.toggleRow(
        "Keep a local action log",
        "Records downloads, exports and settings changes on this device so you can review what Aviary did. Nothing is sent anywhere. Turning this off stops new entries immediately; existing ones stay until you clear them.",
        ctx.options.settings.privacy.auditLog,
        async (value) => {
          ctx.options.settings.privacy.auditLog = value;
          await ctx.save(value ? "Action log on" : "Action log off");
        }
      )
    );
    rows.push(ctx.dataRow("Audit entries", String(ctx.options.getAuditSize())));
  }

  if (ctx.options.clearAuditLog) {
    rows.push(
      ctx.actionRow("Clear audit log", "Drop the local action log.", async () => {
        try {
          await ctx.options.clearAuditLog!();
          await ctx.save("Audit log cleared");
        } catch (error) {
          ctx.options.onError("Could not clear audit log", error);
          ctx.setStatus("Could not clear audit log.");
        }
      })
    );
  }

  return rows;
}
