import { supportedLocales } from "../../platform/i18n";
import { AVIARY_VERSION } from "../../platform/build-version";
import type { ProfileStatus } from "../../platform/profile";
import {
  DEFAULT_SETTINGS,
  cloneSettings,
  normalizeSettings,
  SETTINGS_KEY,
  type AviarySettings
} from "../../platform/settings";
import {
  type ControlCenterHandle,
  type ExportStatus,
  type HiddenPostsStatus,
  type MediaStatus,
  type IntegrationUsageStatus as ControlCenterUsageStatus,
  mountControlCenter
} from "../../ui/control-center";
import { pageHookCounters } from "../privacy/page-hooks";
import { adProtectionCounters } from "../privacy/ad-protection";
import {
  clearAdObservations as clearSelectorAdObservations,
  getSelectorHealthSnapshot
} from "./selector-health";
import { applyPreset, describePresetDelta, getPreset, listPresets } from "./presets";
import {
  getCheckpointStore,
  getDiscoveredQueries,
  cancelExportJob,
  pauseExportJob,
  resumeExportJob,
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
import { filterRuleErrors } from "../filtering/filter-engine";
import {
  clearHiddenPosts,
  getHiddenPostStore,
  undoLastHide
} from "../filtering/hidden-posts-feature";
import { buildWarcArchive } from "../export/warc";
import { pingAria2Version, removeAria2Download, tellActiveAria2 } from "../integrations/aria2";
import { crosspost, readComposerText, type CrosspostRequest } from "../integrations/crosspost";
import { SemanticIndex } from "../integrations/semantic-search";
import { isLocalOnly } from "../integrations/network-policy";
import { defaultAiBudget, defaultEmbeddingBudget } from "../integrations/usage";
import { recentIntegrationErrors } from "./integration-errors";
import { importOfficialArchive, MAX_ARCHIVE_BYTES } from "../library/archive-import";
import {
  ArchiveImportJobStore,
  type ArchiveImportJobActionResult
} from "../library/archive-import-jobs";
import { ArchiveLibraryStore } from "../library/archive-library";
import { previewCleanup } from "../library/cleanup-preview";
import { CleanupQueue } from "../library/cleanup-queue";
import {
  cancelMediaBatch,
  getMediaBatchStatus,
  pauseMediaBatch,
  resumeMediaBatch,
  resumePendingMediaJobs,
  retryFailedMediaJobs,
  runMediaBatch
} from "../media/batch-downloader";
import { LocalSearchIndex } from "../library/local-search";
import { buildMarkdownReport } from "../library/reports";
import { captureSnapshotFromDom, getSnapshotStore } from "../library/snapshots-feature";
import { clearUserNotes, getUserNotes, setUserNote } from "../library/user-notes";
import {
  bookmarkStatus,
  clearBookmarks,
  getBookmarks,
  removeBookmark,
  searchBookmarks,
  updateBookmark
} from "../library/bookmarks-feature";
import {
  documentFromBookmark,
  documentFromExportRecord,
  documentFromNote,
  documentFromSemanticEntry,
  documentFromSnapshot,
  documentsFromArchiveLibrary,
  OfflineQueryIndex,
  type OfflineQueryHit
} from "../library/query-model";
import { getMediaHistory, getMediaQueue } from "../media/media-buttons";
import { getLastDownload } from "../media/last-download";
import type { FeatureContext, FeatureModule } from "../registry";
import {
  buildSettingsExport,
  parseSettingsImport,
  type SettingsImportReport
} from "./settings-migration";
import {
  createLibraryBackup,
  previewLibraryRestore,
  restoreLibraryBackup,
  type LibraryBackupPreview,
  type LibraryBackupRestoreResult
} from "./library-backup";

let controlCenter: ControlCenterHandle | undefined;
const searchIndex = new LocalSearchIndex();
let cleanupQueue: CleanupQueue | undefined;
let semanticIndex: SemanticIndex | undefined;
let retentionPolicy: RetentionPolicy | undefined;
let archiveImportJobs: ArchiveImportJobStore | undefined;
let archiveLibrary: ArchiveLibraryStore | undefined;

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
      semanticIndex = new SemanticIndex(ctx.storage, ctx.integrationUsage);
      await semanticIndex.load();
    }
    retentionPolicy = await loadRetentionPolicy(ctx.storage);
    if (!archiveImportJobs) {
      archiveImportJobs = new ArchiveImportJobStore(ctx.storage);
      await archiveImportJobs.load();
    }
    if (!archiveLibrary) {
      archiveLibrary = new ArchiveLibraryStore(ctx.storage);
      await archiveLibrary.load();
    }
    controlCenter = mountControlCenter({
      settings: ctx.settings,
      diagnostics: () => ctx.diagnostics.snapshot(),
      getStorageStatus: () => ctx.storage.getStatus?.() ?? {
        backend: "legacy",
        schemaVersion: 0,
        migratedKeys: 0,
        usageBytes: null,
        quotaBytes: null,
        lastError: null
      },
      async onChange() {
        await ctx.saveSettings();
        ctx.requestApply();
      },
      onError(message, error) {
        ctx.diagnostics.error(message, errorDetails(error));
      },
      getProfileStatus(): ProfileStatus {
        return ctx.profile?.status() ?? {
          activeId: "offline-default",
          activeLabel: "Offline library",
          profiles: [],
          legacyDataAvailable: false
        };
      },
      async createProfile(label) {
        const profile = await ctx.profile?.create(label);
        if (!profile) return { ok: false, error: "Profile manager is not loaded" };
        await ctx.profile?.switchTo(profile.id);
        reloadPage();
        return { ok: true };
      },
      async switchProfile(profileId) {
        const switched = await ctx.profile?.switchTo(profileId);
        if (!switched) return { ok: false, error: "Profile was not found" };
        reloadPage();
        return { ok: true };
      },
      async adoptLegacyProfileData() {
        if (!ctx.profile) return { moved: 0, skipped: 0 };
        const result = await ctx.profile.adoptLegacyIntoActive();
        if (result.moved > 0) {
          ctx.diagnostics.info("Legacy data assigned to profile", result);
          reloadPage();
        }
        return result;
      },
      getMediaStatus(): MediaStatus {
        const queue = getMediaQueue();
        const history = getMediaHistory();
        const snapshot = queue?.snapshot();
        const batch = getMediaBatchStatus();
        return {
          historySize: history?.size() ?? 0,
          completed: snapshot?.completed ?? 0,
          failed: snapshot?.failed ?? 0,
          duplicate: snapshot?.duplicate ?? 0,
          running: snapshot?.running ?? 0,
          queued: snapshot?.queued ?? 0,
          paused: snapshot?.paused ?? 0,
          cancelled: snapshot?.cancelled ?? 0,
          ...(batch ? { batch } : {})
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
          knownQueries: queries ? Object.keys(queries.queries).length : 0,
          jobs: (store?.list() ?? []).map((job) => ({
            jobId: job.jobId,
            status: job.status,
            recordCount: job.recordCount,
            surface: job.surface,
            startedAt: job.startedAt,
            ...(job.error ? { error: job.error } : {})
          }))
        };
      },
      pauseExportJob,
      resumeExportJob,
      cancelExportJob,
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
      async resetSettings() {
        // Replace in place: every feature holds a reference to this same object, and swapping it
        // out would leave them reading the old one. Data stores are untouched -- resetting a
        // preference must never be a way to lose saved posts or notes.
        const live = ctx.settings as unknown as Record<string, unknown>;
        for (const key of Object.keys(live)) {
          delete live[key];
        }
        Object.assign(ctx.settings, cloneSettings(DEFAULT_SETTINGS));
        await ctx.saveSettings();
        ctx.requestApply();
        void ctx.auditLog.record("settings.reset");
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
          await ctx.saveSettings();
          ctx.requestApply();
          void ctx.auditLog.record("settings.import", {
            warnings: report.warnings.length,
            errors: report.errors.length
          });
        }
        return report;
      },
      async exportLibraryBackup() {
        const profile = ctx.profile?.status();
        const result = await createLibraryBackup(ctx.storage, {
          profile: profile
            ? { id: profile.activeId, label: profile.activeLabel }
            : null
        });
        downloadBlob(result.artifact.data, result.artifact.filename, result.artifact.contentType);
        void ctx.auditLog.record("library.backup.export", {
          collections: result.artifact.collections,
          bytes: result.artifact.bytes,
          credentialsRedacted: true
        });
        return {
          filename: result.artifact.filename,
          collections: result.artifact.collections,
          bytes: result.artifact.bytes
        };
      },
      async previewLibraryRestore(payload: string): Promise<LibraryBackupPreview> {
        return previewLibraryRestore(
          ctx.storage,
          payload,
          ctx.profile ? { profileId: ctx.profile.activeId } : {}
        );
      },
      async restoreLibraryBackup(
        payload: string,
        restoreOptions: { dryRun: boolean; signal: AbortSignal }
      ): Promise<LibraryBackupRestoreResult> {
        const result = await restoreLibraryBackup(ctx.storage, payload, {
          dryRun: restoreOptions.dryRun,
          signal: restoreOptions.signal,
          ...(ctx.profile ? { profileId: ctx.profile.activeId } : {})
        });
        if (result.applied) {
          if (result.restoredKeys.includes(SETTINGS_KEY)) {
            const restoredSettings = await ctx.storage.get(SETTINGS_KEY, ctx.settings);
            replaceSettings(ctx.settings, normalizeSettings(restoredSettings));
            await ctx.saveSettings();
            ctx.requestApply();
          }
          void ctx.auditLog.record("library.backup.restore", {
            collections: result.restoredKeys.length,
            dryRun: false,
            rolledBack: result.rolledBack
          });
          // Stores hold in-memory snapshots, so a reload is the only way to make every feature
          // observe the restored transaction rather than a mixture of old and new state.
          reloadPage();
        }
        return result;
      },
      getAuditSize() {
        return ctx.auditLog.size();
      },
      getPageHooks() {
        const bridge = ctx.pageBridge;
        const hooks = pageHookCounters();
        const ads = adProtectionCounters();
        return {
          reachable: bridge ? bridge.status() !== "unavailable" : false,
          reason: bridge?.reason() ?? "",
          blockedBeacons: hooks.blockedBeacons,
          blockedAdRequests: hooks.blockedAdRequests,
          hiddenPlacements: ads.hiddenPlacements,
          suppressedVideoAds: ads.suppressedVideoAds
        };
      },
      getSelectorHealth() {
        return getSelectorHealthSnapshot();
      },
      async clearAdObservations() {
        await clearSelectorAdObservations(ctx.storage);
      },
      getFilterRuleErrors() {
        return filterRuleErrors().map((problem) => ({
          line: problem.line,
          message: problem.message
        }));
      },
      getSavedDiagnostics() {
        const saved = ctx.diagnosticsStore?.snapshot() ?? [];
        return {
          total: saved.length,
          errors: saved.filter((entry) => entry.level === "error").length,
          newestAt: saved.length > 0 ? (saved[saved.length - 1]?.at ?? null) : null
        };
      },
      async clearSavedDiagnostics() {
        await ctx.diagnosticsStore?.clear();
        void ctx.auditLog.record("diagnostics.clear");
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
      getBookmarkStatus() {
        return bookmarkStatus();
      },
      searchBookmarks(query) {
        return searchBookmarks(query);
      },
      offlineSearch(query) {
        return searchOfflineLibrary(query);
      },
      async offlineSemanticSearch(query) {
        if (!semanticIndex) return [];
        const hits = await semanticIndex.search(
          ctx.settings.integrations.semanticSearch,
          query,
          30
        );
        return hits.map((hit) => ({
          document: documentFromSemanticEntry(hit.entry),
          score: hit.score,
          matchedTerms: [],
          snippet: hit.entry.text.slice(0, 220),
          mode: "semantic" as const
        }));
      },
      async updateBookmark(id, input) {
        const entry = await updateBookmark(id, input);
        if (entry) {
          void ctx.auditLog.record("bookmark.update", { id: entry.id, tweetId: entry.tweetId });
          ctx.requestApply();
        }
        return entry;
      },
      async removeBookmark(id) {
        const removed = await removeBookmark(id);
        if (removed) {
          void ctx.auditLog.record("bookmark.remove", { id });
          ctx.requestApply();
        }
        return removed;
      },
      async clearBookmarks() {
        await clearBookmarks();
        void ctx.auditLog.record("bookmark.clear");
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
        if (typeof file.size === "number" && file.size > MAX_ARCHIVE_BYTES) {
          throw new Error("Archive exceeds the 256 MiB input limit.");
        }
        const buffer = new Uint8Array(await file.arrayBuffer());
        const jobs = archiveImportJobs ?? new ArchiveImportJobStore(ctx.storage);
        archiveImportJobs = jobs;
        const job = await jobs.start(file.name, buffer);
        return processArchiveImport(ctx, jobs, job.jobId);
      },
      getArchiveImportStatus() {
        const jobs = archiveImportJobs?.list() ?? [];
        return {
          jobs: jobs.slice(-3).map((job) => ({
            jobId: job.jobId,
            filename: job.filename,
            status: job.status,
            filesParsed: job.filesParsed,
            recordCount: job.recordCount,
            warningCount: job.warningCount,
            errorCount: job.errorCount,
            ...(job.error ? { error: job.error } : {})
          }))
        };
      },
      getArchiveLibraryStatus() {
        const snapshot = archiveLibrary?.snapshot();
        return {
          authoredPosts: countRecordsForSurface(getCheckpointStore(), "archive"),
          likes: countRecordsForSurface(getCheckpointStore(), "archive.likes"),
          directMessages: snapshot?.directMessages.length ?? 0,
          media: snapshot?.media.length ?? 0,
          followers: snapshot?.followers.length ?? 0,
          following: snapshot?.following.length ?? 0,
          lists: snapshot?.lists.length ?? 0,
          profile: snapshot?.profile ? 1 : 0,
          account: snapshot?.account ? 1 : 0
        };
      },
      async resumeArchiveImport(jobId) {
        const jobs = archiveImportJobs;
        if (!jobs) return { ok: false, error: "Archive import store is not loaded" };
        const resumed = await jobs.resume(jobId);
        if (!resumed.ok) return resumed;
        return processArchiveImportAction(ctx, jobs, jobId);
      },
      async pauseArchiveImport(jobId): Promise<ArchiveImportJobActionResult> {
        return (await archiveImportJobs?.pause(jobId)) ?? {
          ok: false,
          error: "Archive import store is not loaded"
        };
      },
      async cancelArchiveImport(jobId): Promise<ArchiveImportJobActionResult> {
        return (await archiveImportJobs?.cancel(jobId)) ?? {
          ok: false,
          error: "Archive import store is not loaded"
        };
      },
      async retryArchiveImport(jobId): Promise<ArchiveImportJobActionResult> {
        const jobs = archiveImportJobs;
        if (!jobs) return { ok: false, error: "Archive import store is not loaded" };
        const retried = await jobs.retry(jobId);
        if (!retried.ok) return retried;
        return processArchiveImportAction(ctx, jobs, jobId);
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
          description: preset.description,
          highlights: preset.highlights.map((highlight) => ({ ...highlight }))
        }));
      },
      async applyPreset(id) {
        const preset = getPreset(id as Parameters<typeof getPreset>[0]);
        if (!preset) return { applied: false, changes: [] };
        const changes = describePresetDelta(ctx.settings, preset);
        const next = applyPreset(ctx.settings, preset);
        replaceSettings(ctx.settings, next);
        await ctx.saveSettings();
        ctx.requestApply();
        void ctx.auditLog.record("preset.apply", { preset: preset.id, changes: changes.length });
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
        await ctx.saveSettings();
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
        void ctx.auditLog.record("cleanup.enqueue", {
          enqueued: added,
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
        void ctx.auditLog.record("crosspost", {
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
          void ctx.auditLog.record("aria2.cancel", { gid });
          return { ok: true };
        }
        return { ok: false, ...(result.error ? { error: result.error } : {}) };
      },
      recentIntegrationErrors() {
        return recentIntegrationErrors(ctx.auditLog.snapshot().entries);
      },
      async rebuildSemanticIndex() {
        if (!semanticIndex) {
          semanticIndex = new SemanticIndex(ctx.storage, ctx.integrationUsage);
          await semanticIndex.load();
        }
        rebuildSearchIndex();
        const store = getCheckpointStore();
        const records = collectAllRecords(store);
        const result = await semanticIndex.embedAndIndex(
          ctx.settings.integrations.semanticSearch,
          records
        );
        void ctx.auditLog.record("semantic.index", {
          added: result.added,
          skipped: result.skipped,
          errors: result.errors,
          dropped: result.dropped,
          blocked: result.blocked
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
      getIntegrationUsage(): ControlCenterUsageStatus | undefined {
        if (!ctx.integrationUsage) return undefined;
        return ctx.integrationUsage.status(
          defaultAiBudget(ctx.settings.integrations.ai),
          defaultEmbeddingBudget(ctx.settings.integrations.semanticSearch),
          isLocalOnly()
        );
      },
      async clearIntegrationUsage() {
        await ctx.integrationUsage?.clear();
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
          failed: result.failed,
          cancelled: result.cancelled
        });
        return {
          total: result.total,
          downloaded: result.downloaded,
          duplicate: result.duplicate,
          failed: result.failed,
          cancelled: result.cancelled
        };
      },
      pauseMediaBatch,
      resumeMediaBatch,
      cancelMediaBatch,
      async resumePendingMediaJobs() {
        const result = await resumePendingMediaJobs(ctx);
        return {
          total: result.total,
          downloaded: result.downloaded,
          duplicate: result.duplicate,
          failed: result.failed,
          cancelled: result.cancelled
        };
      },
      async retryFailedMediaJobs() {
        const result = await retryFailedMediaJobs(ctx);
        return {
          total: result.total,
          downloaded: result.downloaded,
          duplicate: result.duplicate,
          failed: result.failed,
          cancelled: result.cancelled
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
        reportInput.version = AVIARY_VERSION;
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
    archiveImportJobs = undefined;
    archiveLibrary = undefined;
    ctx.diagnostics.info("Control Center destroyed");
  }
};

async function processArchiveImport(
  ctx: FeatureContext,
  jobs: ArchiveImportJobStore,
  jobId: string
): Promise<{
  records: number;
  warnings: number;
  errors: number;
  recognizedFiles: number;
  skippedFiles: number;
  malformedFiles: number;
}> {
  const source = jobs.source(jobId);
  if (!source) {
    const message = "The durable archive source is unavailable or corrupted.";
    await jobs.fail(jobId, message);
    return { records: 0, warnings: 0, errors: 1, recognizedFiles: 0, skippedFiles: 0, malformedFiles: 0 };
  }
  await jobs.markRunning(jobId);
  try {
    const result = await importOfficialArchive(source, "archive");
    const state = jobs.get(jobId);
    // Pause/cancel is checked after parsing because ZIP inflation is a single asynchronous
    // operation. No records are committed when the user changes the job state while it runs.
    if (state?.status === "cancelled" || state?.status === "paused") {
      await jobs.updateProgress(jobId, {
        filesParsed: result.filesParsed.length,
        recordCount: 0,
        warningCount: result.warnings.length,
        errorCount: result.errors.length
      });
      return {
        records: 0,
        warnings: result.warnings.length,
        errors: result.errors.length,
        recognizedFiles: result.recognizedFiles.length,
        skippedFiles: result.skippedFiles.length,
        malformedFiles: result.malformedFiles.length
      };
    }

    if (result.errors.length > 0) {
      await jobs.updateProgress(jobId, {
        filesParsed: result.filesParsed.length,
        recordCount: 0,
        warningCount: result.warnings.length,
        errorCount: result.errors.length
      });
      await jobs.fail(jobId, result.errors.join("; "));
      return {
        records: 0,
        warnings: result.warnings.length,
        errors: result.errors.length,
        recognizedFiles: result.recognizedFiles.length,
        skippedFiles: result.skippedFiles.length,
        malformedFiles: result.malformedFiles.length
      };
    }

    if (archiveLibrary && hasArchiveCollections(result.collections)) {
      await archiveLibrary.merge(result.collections, jobId);
    }
    const store = getCheckpointStore();
    if (result.records.length > 0 && store) {
      if (!store.list().some((job) => job.jobId === jobId)) {
        await store.start(jobId, "archive", ["json"], false);
      } else {
        await store.resume(jobId);
      }
      // CheckpointStore dedupes records by tweet identity, so a restart after append but before
      // finish cannot duplicate the imported library.
      await store.append(jobId, result.records);
      await store.finish(jobId);
      rebuildSearchIndex();
    }
    if (result.records.length > 0 || hasArchiveCollections(result.collections)) {
      void ctx.auditLog.record("settings.import", {
        archive: jobs.get(jobId)?.filename ?? "archive.zip",
        records: result.records.length,
        collections: result.recognizedFiles.length,
        warnings: result.warnings.length
      });
    }
    await jobs.updateProgress(jobId, {
      filesParsed: result.filesParsed.length,
      recordCount: result.records.length,
      warningCount: result.warnings.length,
      errorCount: result.errors.length
    });
    await jobs.complete(jobId, {
      filesParsed: result.filesParsed.length,
      recordCount: result.records.length,
      warningCount: result.warnings.length,
      errorCount: result.errors.length
    });
    return {
      records: result.records.length,
      warnings: result.warnings.length,
      errors: result.errors.length,
      recognizedFiles: result.recognizedFiles.length,
      skippedFiles: result.skippedFiles.length,
      malformedFiles: result.malformedFiles.length
    };
  } catch (error) {
    await jobs.fail(jobId, error);
    const store = getCheckpointStore();
    if (store?.list().some((job) => job.jobId === jobId)) {
      await store.fail(jobId, error);
    }
    throw error;
  }
}

async function processArchiveImportAction(
  ctx: FeatureContext,
  jobs: ArchiveImportJobStore,
  jobId: string
): Promise<ArchiveImportJobActionResult> {
  const result = await processArchiveImport(ctx, jobs, jobId);
  if (result.errors > 0 && result.records === 0) {
    return { ok: false, error: "Archive import produced no records" };
  }
  return { ok: true };
}

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

function reloadPage(): void {
  if (typeof globalThis.location?.reload === "function") {
    globalThis.location.reload();
  }
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

function countRecordsForSurface(
  store: ReturnType<typeof getCheckpointStore>,
  surface: string
): number {
  if (!store) return 0;
  let total = 0;
  for (const job of store.list()) {
    total += store.records(job.jobId).filter((record) => record.surface === surface).length;
  }
  return total;
}

function hasArchiveCollections(collections: import("../library/archive-types").ArchiveCollections): boolean {
  return Boolean(
    collections.profile ||
      collections.account ||
      collections.directMessages.length > 0 ||
      collections.media.length > 0 ||
      collections.followers.length > 0 ||
      collections.following.length > 0 ||
      collections.lists.length > 0
  );
}

function rebuildSearchIndex(): void {
  const store = getCheckpointStore();
  searchIndex.rebuild(collectAllRecords(store));
}

function searchOfflineLibrary(query: string): OfflineQueryHit[] {
  const index = new OfflineQueryIndex();
  const documents = collectOfflineDocuments();
  index.rebuild(documents);
  return index.search(query, { limit: 30 });
}

function collectOfflineDocuments() {
  const documents = collectAllRecords(getCheckpointStore()).map(documentFromExportRecord);
  documents.push(...getBookmarks().map(documentFromBookmark));
  documents.push(...Object.entries(getUserNotes()).map(([handle, note]) => documentFromNote(handle, note)));
  documents.push(...(getSnapshotStore()?.list() ?? []).map(documentFromSnapshot));
  documents.push(...(semanticIndex?.list() ?? []).map(documentFromSemanticEntry));
  if (archiveLibrary) {
    documents.push(...documentsFromArchiveLibrary(archiveLibrary.snapshot()));
  }
  return documents;
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
  diagnosticsStore?: { snapshot(): unknown[] };
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
    events,
    // Warnings and errors from earlier page loads, which the in-memory ring above cannot hold.
    persisted: ctx.diagnosticsStore?.snapshot() ?? []
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
