import { supportedLocales } from "../../platform/i18n";
import { normalizeSettings, SETTINGS_KEY, type AviarySettings } from "../../platform/settings";
import type {
  ControlCenterHandle,
  ExportStatus,
  HiddenPostsStatus,
  MediaStatus
} from "../../ui/control-center";
import { mountControlCenter } from "../../ui/control-center";
import { applyPreset, describePresetDelta, getPreset, listPresets } from "./presets";
import {
  getCheckpointStore,
  getDiscoveredQueries,
  runExportOfVisibleTweets
} from "../export/export-feature";
import {
  DEFAULT_RETENTION_POLICY,
  loadRetentionPolicy,
  normalizeRetentionPolicy,
  saveRetentionPolicy,
  type RetentionPolicy
} from "../export/jobs";
import { renderForExternalTarget } from "../export/external-targets";
import {
  clearHiddenPosts,
  getHiddenPostStore,
  undoLastHide
} from "../filtering/hidden-posts-feature";
import { buildWarcArchive } from "../export/warc";
import { pingAria2Version, removeAria2Download, tellActiveAria2 } from "../integrations/aria2";
import { crosspost, readComposerText, type CrosspostRequest } from "../integrations/crosspost";
import { SemanticIndex } from "../integrations/semantic-search";
import { recentIntegrationErrors } from "./integration-errors";
import { importOfficialArchive } from "../library/archive-import";
import { previewCleanup } from "../library/cleanup-preview";
import { CleanupQueue } from "../library/cleanup-queue";
import { runMediaBatch } from "../media/batch-downloader";
import { LocalSearchIndex } from "../library/local-search";
import { buildMarkdownReport } from "../library/reports";
import { captureSnapshotFromDom, getSnapshotStore } from "../library/snapshots-feature";
import { clearUserNotes, getUserNotes, setUserNote } from "../library/user-notes";
import { getMediaHistory, getMediaQueue } from "../media/media-buttons";
import { getLastDownload } from "../media/last-download";
import type { FeatureModule } from "../registry";
import {
  buildSettingsExport,
  parseSettingsImport,
  type SettingsImportReport
} from "./settings-migration";

let controlCenter: ControlCenterHandle | undefined;
const searchIndex = new LocalSearchIndex();
let cleanupQueue: CleanupQueue | undefined;
let semanticIndex: SemanticIndex | undefined;
let retentionPolicy: RetentionPolicy | undefined;

export const controlCenterFeature: FeatureModule = {
  id: "core.controlCenter",
  title: "Control Center",
  category: "core",
  defaultEnabled: true,

  async init(ctx) {
    if (!cleanupQueue) {
      cleanupQueue = new CleanupQueue(ctx.storage);
      await cleanupQueue.load();
    }
    if (!semanticIndex) {
      semanticIndex = new SemanticIndex(ctx.storage);
      await semanticIndex.load();
    }
    retentionPolicy = await loadRetentionPolicy(ctx.storage);
    controlCenter = mountControlCenter({
      settings: ctx.settings,
      diagnostics: () => ctx.diagnostics.snapshot(),
      async onChange() {
        await ctx.saveSettings();
        ctx.requestApply();
      },
      onError(message, error) {
        ctx.diagnostics.error(message, errorDetails(error));
      },
      getMediaStatus(): MediaStatus {
        const queue = getMediaQueue();
        const history = getMediaHistory();
        const snapshot = queue?.snapshot();
        return {
          historySize: history?.size() ?? 0,
          completed: snapshot?.completed ?? 0,
          failed: snapshot?.failed ?? 0,
          duplicate: snapshot?.duplicate ?? 0,
          running: snapshot?.running ?? 0
        };
      },
      async clearMediaHistory() {
        await getMediaHistory()?.clear();
      },
      getExportStatus(): ExportStatus {
        const store = getCheckpointStore();
        const queries = getDiscoveredQueries();
        return {
          jobCount: store?.list().length ?? 0,
          knownQueries: queries ? Object.keys(queries.queries).length : 0
        };
      },
      async runExport() {
        const result = await runExportOfVisibleTweets(ctx);
        for (const artifact of result.artifacts) {
          downloadBlob(artifact.data, artifact.filename);
        }
        return {
          records: result.records,
          filename: result.filename,
          files: result.artifacts.length
        };
      },
      async copyDiagnostics() {
        const payload = buildDiagnosticsPayload(ctx);
        await writeClipboard(payload);
        void ctx.auditLog.record("diagnostics.copy");
      },
      async exportSettings() {
        const envelope = buildSettingsExport(ctx.settings);
        const text = JSON.stringify(envelope, null, 2);
        const bytes = new TextEncoder().encode(text);
        downloadBlob(bytes, settingsFilename(), "application/json");
        void ctx.auditLog.record("settings.export");
      },
      async importSettings(payload: string): Promise<SettingsImportReport> {
        const report = parseSettingsImport(payload, ctx.settings);
        if (report.applied) {
          Object.assign(ctx.settings, report.settings);
          await ctx.storage.set(SETTINGS_KEY, normalizeSettings(ctx.settings));
          ctx.requestApply();
          void ctx.auditLog.record("settings.import", {
            warnings: report.warnings.length,
            errors: report.errors.length
          });
        }
        return report;
      },
      getAuditSize() {
        return ctx.auditLog.size();
      },
      async clearAuditLog() {
        await ctx.auditLog.clear();
      },
      getRetentionPolicy() {
        return retentionPolicy ?? DEFAULT_RETENTION_POLICY;
      },
      async saveRetentionPolicy(next) {
        const normalized = await saveRetentionPolicy(ctx.storage, normalizeRetentionPolicy(next));
        retentionPolicy = normalized;
        const sweep = await getCheckpointStore()?.sweep(normalized);
        if (sweep && (sweep.removedJobs > 0 || sweep.removedRecords > 0)) {
          void ctx.auditLog.record("export.complete", {
            kind: "checkpoint-retention",
            removedJobs: sweep.removedJobs,
            removedRecords: sweep.removedRecords
          });
        }
        ctx.requestApply();
      },
      getHiddenPostsStatus(): HiddenPostsStatus {
        const hiddenStore = getHiddenPostStore();
        const entries = hiddenStore?.list() ?? [];
        return {
          total: entries.length,
          updatedAt: hiddenStore?.updatedAt() ?? null,
          recent: entries.slice(0, 8).map((entry) => ({
            key: entry.key,
            handle: entry.handle,
            text: entry.text,
            hiddenAt: entry.hiddenAt
          }))
        };
      },
      async undoLastHide() {
        const entry = await undoLastHide(ctx);
        return { restored: entry !== null, handle: entry?.handle ?? null };
      },
      async unhidePost(key: string) {
        const entry = await getHiddenPostStore()?.unhide(key);
        if (entry) {
          ctx.requestApply();
          void ctx.auditLog.record("post.unhide", { key });
        }
        return entry !== null && entry !== undefined;
      },
      async clearHiddenPosts() {
        return await clearHiddenPosts(ctx);
      },
      getUserNotes() {
        return getUserNotes();
      },
      async setUserNote(handle, note) {
        await setUserNote(handle, note);
        ctx.requestApply();
      },
      async clearUserNotes() {
        await clearUserNotes();
        ctx.requestApply();
      },
      async captureSnapshot(kind) {
        const handle = inferProfileHandle(ctx.route.path) ?? "self";
        const result = await captureSnapshotFromDom(ctx, kind, handle);
        if (!result) return null;
        return { count: result.totalAccounts, handle: result.entry.handle };
      },
      getSnapshotStatus() {
        const store = getSnapshotStore();
        const entries = store?.list() ?? [];
        const latest = entries[entries.length - 1];
        return {
          total: entries.length,
          latestAt: latest?.capturedAt ?? null,
          latestKind: latest?.kind ?? null,
          latestCount: latest?.accounts.length ?? 0
        };
      },
      diffLatestSnapshot(kind, handle) {
        const diff = getSnapshotStore()?.diffLatest(kind, handle);
        if (!diff) return null;
        return {
          added: diff.added.length,
          removed: diff.removed.length,
          unchanged: diff.unchanged
        };
      },
      async clearSnapshots() {
        await getSnapshotStore()?.clear();
      },
      async importArchive(file) {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const result = await importOfficialArchive(buffer, "archive");
        if (result.records.length > 0) {
          const store = getCheckpointStore();
          if (store) {
            const jobId = `archive-${Date.now()}`;
            await store.start(jobId, "archive", ["json"], false);
            await store.append(jobId, result.records);
            await store.finish(jobId);
          }
          rebuildSearchIndex();
          void ctx.auditLog.record("settings.import", {
            archive: file.name,
            records: result.records.length,
            warnings: result.warnings.length
          });
        }
        return {
          records: result.records.length,
          warnings: result.warnings.length,
          errors: result.errors.length
        };
      },
      searchArchive(query) {
        if (query.length === 0) return [];
        // A miss used to rebuild the whole index, so every keystroke that matched nothing
        // re-tokenized every captured record. Rebuild only when the index is actually stale.
        const storedRecordCount = countStoredRecords(getCheckpointStore());
        if (searchIndex.size() !== storedRecordCount) {
          rebuildSearchIndex();
        }
        return searchIndex.search(query, { limit: 20 }).map(formatHit);
      },
      listPresets() {
        return listPresets().map((preset) => ({
          id: preset.id,
          label: preset.label,
          description: preset.description
        }));
      },
      async applyPreset(id) {
        const preset = getPreset(id as Parameters<typeof getPreset>[0]);
        if (!preset) return { applied: false, changes: [] };
        const changes = describePresetDelta(ctx.settings, preset);
        const next = applyPreset(ctx.settings, preset);
        replaceSettings(ctx.settings, next);
        await ctx.storage.set(SETTINGS_KEY, normalizeSettings(ctx.settings));
        ctx.requestApply();
        void ctx.auditLog.record("settings.import", { preset: preset.id, changes: changes.length });
        return { applied: changes.length > 0, changes };
      },
      listLocales() {
        return supportedLocales().map((entry) => ({
          code: entry.code,
          label: entry.label,
          direction: entry.direction
        }));
      },
      async setLocale(code) {
        ctx.settings.i18n.locale = code;
        await ctx.storage.set(SETTINGS_KEY, normalizeSettings(ctx.settings));
        ctx.requestApply();
      },
      getCleanupQueueSize() {
        const items = cleanupQueue?.list() ?? [];
        return {
          total: items.length,
          queued: items.filter((item) => item.status === "queued").length,
          approved: items.filter((item) => item.status === "approved").length,
          skipped: items.filter((item) => item.status === "skipped").length
        };
      },
      async enqueueCleanupReview() {
        rebuildSearchIndex();
        const store = getCheckpointStore();
        const records = collectAllRecords(store);
        const preview = previewCleanup(records, {
          whitelistHandles: ctx.settings.filter.whitelist
        });
        const candidates = preview.candidates;
        const protectedCount = candidates.filter((candidate) => candidate.protected).length;
        const added = (await cleanupQueue?.enqueue(candidates)) ?? 0;
        void ctx.auditLog.record("settings.export", {
          cleanupEnqueued: added,
          protected: protectedCount
        });
        return { added, protected: protectedCount };
      },
      async clearCleanupQueue() {
        await cleanupQueue?.clear();
      },
      async crosspost(target, options) {
        const text = readComposerText();
        if (!text) {
          return { ok: false, error: "Composer is empty" };
        }
        const request: CrosspostRequest = {
          text,
          target,
          asThread: options.asThread
        };
        if (ctx.settings.integrations.crosspost.attachLastDownload) {
          const lastDownload = await getLastDownload(ctx.storage);
          if (lastDownload) {
            request.attachment = {
              url: lastDownload.url,
              filename: lastDownload.filename,
              kind: lastDownload.kind
            };
          }
        }
        const result = await crosspost(ctx.settings.integrations, request);
        void ctx.auditLog.record(result.ok ? "export.complete" : "export.start", {
          kind: "crosspost",
          target,
          ok: result.ok,
          asThread: options.asThread,
          posts: result.posts ?? 0,
          error: result.error ?? null
        });
        return {
          ok: result.ok,
          ...(result.url ? { url: result.url } : {}),
          ...(result.error ? { error: result.error } : {}),
          ...(result.posts !== undefined ? { posts: result.posts } : {})
        };
      },
      async listAria2Active() {
        const active = await tellActiveAria2({
          endpoint: ctx.settings.integrations.aria2.endpoint,
          secret: ctx.settings.integrations.aria2.secret
        });
        return active.map((job) => ({
          gid: job.gid,
          status: job.status,
          totalLength: job.totalLength,
          completedLength: job.completedLength,
          path: job.files[0]?.path ?? ""
        }));
      },
      async cancelAria2(gid) {
        const result = await removeAria2Download(
          {
            endpoint: ctx.settings.integrations.aria2.endpoint,
            secret: ctx.settings.integrations.aria2.secret
          },
          gid
        );
        if (result.ok) {
          void ctx.auditLog.record("export.complete", { kind: "aria2-cancel", gid });
          return { ok: true };
        }
        return { ok: false, ...(result.error ? { error: result.error } : {}) };
      },
      recentIntegrationErrors() {
        return recentIntegrationErrors(ctx.auditLog.snapshot().entries);
      },
      async rebuildSemanticIndex() {
        if (!semanticIndex) {
          semanticIndex = new SemanticIndex(ctx.storage);
          await semanticIndex.load();
        }
        rebuildSearchIndex();
        const store = getCheckpointStore();
        const records = collectAllRecords(store);
        const result = await semanticIndex.embedAndIndex(
          ctx.settings.integrations.semanticSearch,
          records
        );
        void ctx.auditLog.record("export.complete", {
          kind: "semantic-index",
          added: result.added,
          skipped: result.skipped,
          errors: result.errors
        });
        return { ...result, total: semanticIndex.size() };
      },
      async semanticSearchQuery(query) {
        if (!semanticIndex) return [];
        const hits = await semanticIndex.search(
          ctx.settings.integrations.semanticSearch,
          query,
          12
        );
        return hits.map((hit) => ({
          tweetId: hit.entry.tweetId,
          handle: hit.entry.handle,
          text: hit.entry.text,
          score: hit.score
        }));
      },
      async clearSemanticIndex() {
        await semanticIndex?.clear();
      },
      async pingAria2() {
        const result = await pingAria2Version({
          endpoint: ctx.settings.integrations.aria2.endpoint,
          secret: ctx.settings.integrations.aria2.secret
        });
        if (result.ok) return { ok: true };
        return { ok: false, ...(result.error ? { error: result.error } : {}) };
      },
      getIntegrationStatus() {
        const integrations = ctx.settings.integrations;
        return {
          aria2: { enabled: integrations.aria2.enabled, configured: integrations.aria2.endpoint.length > 0 },
          bluesky: {
            enabled: integrations.bluesky.enabled,
            configured:
              integrations.bluesky.handle.length > 0 && integrations.bluesky.appPassword.length > 0
          },
          mastodon: {
            enabled: integrations.mastodon.enabled,
            configured:
              integrations.mastodon.instance.length > 0 && integrations.mastodon.token.length > 0
          },
          ai: {
            enabled: integrations.ai.enabled,
            configured: integrations.ai.apiKey.length > 0 && integrations.ai.model.length > 0
          },
          semanticSearch: {
            enabled: integrations.semanticSearch.enabled,
            configured:
              integrations.semanticSearch.endpoint.length > 0 &&
              integrations.semanticSearch.apiKey.length > 0 &&
              integrations.semanticSearch.model.length > 0,
            indexed: semanticIndex?.size() ?? 0
          }
        };
      },
      async runMediaBatch() {
        const result = await runMediaBatch(ctx, { maxItems: 100, surface: ctx.route.surface });
        void ctx.auditLog.record("media.download", {
          batch: true,
          total: result.total,
          downloaded: result.downloaded,
          duplicate: result.duplicate,
          failed: result.failed
        });
        return {
          total: result.total,
          downloaded: result.downloaded,
          duplicate: result.duplicate,
          failed: result.failed
        };
      },
      async downloadWarc() {
        rebuildSearchIndex();
        const store = getCheckpointStore();
        const records = collectAllRecords(store);
        const artifact = buildWarcArchive(records);
        downloadBlob(artifact.data, artifact.filename, artifact.contentType);
        void ctx.auditLog.record("export.complete", { format: "warc", records: records.length });
        return { records: records.length };
      },
      async exportToTarget(target) {
        rebuildSearchIndex();
        const store = getCheckpointStore();
        const records = collectAllRecords(store);
        const rendered = renderForExternalTarget(target, records);
        if (rendered.payload !== undefined) {
          await writeClipboard(rendered.payload);
          void ctx.auditLog.record("diagnostics.copy", { kind: "external", target });
          return { target, records: records.length, copied: true };
        }
        if (rendered.artifact) {
          downloadBlob(rendered.artifact.data, rendered.artifact.filename, rendered.artifact.contentType);
          void ctx.auditLog.record("export.complete", { format: target, records: records.length });
          return { target, records: records.length };
        }
        return { target, records: records.length };
      },
      async downloadReport() {
        rebuildSearchIndex();
        const store = getCheckpointStore();
        const records = collectAllRecords(store);
        const cleanup = previewCleanup(records, {
          whitelistHandles: ctx.settings.filter.whitelist
        });
        const snapshotStore = getSnapshotStore();
        const latest = snapshotStore?.list().at(-1);
        const diff = latest ? snapshotStore?.diffLatest(latest.kind, latest.handle) ?? undefined : undefined;
        const reportInput: import("../library/reports").ReportInputs = {
          audit: ctx.auditLog.snapshot().entries,
          cleanup
        };
        if (latest) {
          reportInput.snapshots = diff ? { latest, diff } : { latest };
        }
        if (ctx.settings.i18n.locale !== "en") {
          reportInput.version = ctx.settings.i18n.locale;
        }
        const markdown = buildMarkdownReport(reportInput);
        const bytes = new TextEncoder().encode(markdown);
        downloadBlob(bytes, reportFilename(), "text/markdown");
      }
    });
    ctx.diagnostics.info("Control Center mounted");
  },

  apply() {
    controlCenter?.refresh();
  },

  destroy(ctx) {
    controlCenter?.destroy();
    controlCenter = undefined;
    cleanupQueue = undefined;
    semanticIndex = undefined;
    retentionPolicy = undefined;
    ctx.diagnostics.info("Control Center destroyed");
  }
};

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return {
    message: String(error)
  };
}

function replaceSettings(target: AviarySettings, next: AviarySettings): void {
  for (const key of Object.keys(next) as Array<keyof AviarySettings>) {
    (target as unknown as Record<string, unknown>)[key as string] = (next as unknown as Record<string, unknown>)[key as string];
  }
}

function settingsFilename(): string {
  return `aviary-settings-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

function reportFilename(): string {
  return `aviary-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
}

function inferProfileHandle(path: string): string | null {
  const match = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:followers|following|verified_followers))?/.exec(path);
  return match?.[1]?.toLowerCase() ?? null;
}

function countStoredRecords(store: ReturnType<typeof getCheckpointStore>): number {
  if (!store) return 0;
  let total = 0;
  for (const job of store.list()) {
    total += store.records(job.jobId).length;
  }
  return total;
}

function rebuildSearchIndex(): void {
  const store = getCheckpointStore();
  searchIndex.rebuild(collectAllRecords(store));
}

function collectAllRecords(
  store: ReturnType<typeof getCheckpointStore>
): Array<import("../export/types").ExportRecord> {
  if (!store) return [];
  const all: Array<import("../export/types").ExportRecord> = [];
  for (const job of store.list()) {
    all.push(...store.records(job.jobId));
  }
  return all;
}

function formatHit(hit: import("../library/local-search").SearchHit): {
  handle: string | null;
  tweetId: string | null;
  text: string;
  score: number;
} {
  return {
    handle: hit.record.handle,
    tweetId: hit.record.tweetId,
    text: hit.record.text,
    score: hit.score
  };
}

function downloadBlob(data: Uint8Array, filename: string, contentType = "application/zip"): void {
  if (typeof document === "undefined") {
    return;
  }
  const blob = new Blob([new Uint8Array(data)], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

interface DiagnosticsContext {
  diagnostics: { snapshot(): unknown };
  route: { surface: string; href: string };
  settings: { i18n: { locale: string } };
}

function buildDiagnosticsPayload(ctx: DiagnosticsContext): string {
  const events = ctx.diagnostics.snapshot();
  const payload = {
    generator: "Aviary",
    generatedAt: new Date().toISOString(),
    surface: ctx.route.surface,
    href: ctx.route.href,
    locale: ctx.settings.i18n.locale,
    userAgent: globalThis.navigator?.userAgent ?? "unknown",
    events
  };
  return JSON.stringify(payload, null, 2);
}

async function writeClipboard(payload: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(payload);
    return;
  }
  throw new Error("Clipboard API unavailable in this context");
}
