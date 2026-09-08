import type { FeatureContext, FeatureModule } from "../registry.ts";
import { ft } from "../core/feature-i18n.ts";
import { removeFeatureToast, showFeatureToast } from "../core/feature-toast.ts";
import { storageCapReport } from "../../platform/durable-storage.ts";
import { recordStoredBytes } from "../library/cleanup-preview.ts";
import { sanitizeFolderHint, type AviarySettings } from "../../platform/settings.ts";
import { SemanticIndex } from "../integrations/semantic-search.ts";
import {
  buildExportPackageManifest,
  prepareExportPackage,
  sha256Hex,
  type ExportPackageFile
} from "./assets.ts";
import { collectExportRecords } from "./collector.ts";
import { captureExportRecordMedia } from "../media/downloader.ts";
import { getCapturedMediaMetadata } from "../media/media-buttons.ts";
import { CheckpointStore } from "./jobs.ts";
import { formatExport } from "./formatters.ts";
import { discoverQueryIds, type QueryRegistry } from "./query-discovery.ts";
import { reconstructExportOrder, reconstructThreads } from "./thread-reconstruction.ts";
import { buildExportViewer } from "./viewer.ts";
import { buildStaticArchive } from "./static-archive.ts";
import { serializeActivityStreamsOutbox } from "./activitystreams.ts";
import { buildZip, type ZipFileEntry } from "./zip-store.ts";
import type { ExportFormat, ExportRecord } from "./types.ts";
import {
  DEFAULT_EXPORT_AUDIENCE,
  filterShareRecords,
  isShareOrientedFormat,
  normalizeAudienceSelection,
  summarizeAudience,
  type ExportAudienceSelection,
  type ExportAudienceSummary
} from "./audience.ts";

let checkpointStore: CheckpointStore | undefined;
let queryRegistry: QueryRegistry | undefined;
let activeJobId: string | undefined;
let lastExportEnabled = false;
let lastAutoDiscoverQueryIds = false;
let lifecycleQueue: Promise<void> = Promise.resolve();
let sessionSequence = 0;
let manuallyPausedJobId: string | undefined;

export const exportFeature: FeatureModule = {
  id: "export.core",
  title: "Export core",
  category: "export",

  async init(ctx) {
    // init() is followed by the first apply() pass. Keep the prior capture state explicitly off
    // so a setting that was already enabled at boot opens its session exactly once there.
    activeJobId = undefined;
    queryRegistry = undefined;
    lastExportEnabled = false;
    lastAutoDiscoverQueryIds = false;
    lifecycleQueue = Promise.resolve();
    manuallyPausedJobId = undefined;
    checkpointStore = new CheckpointStore(ctx.storage);
    const retention = await checkpointStore.load();
    if (retention.removedJobs > 0 || retention.removedRecords > 0) {
      ctx.diagnostics.info("Checkpoint retention sweep", { ...retention });
    }
    if (ctx.settings.export.autoDiscoverQueryIds) {
      await discoverQueryIdsForContext(ctx);
    }
    // Mark the initial value as observed so the first apply does not rediscover it. A user
    // toggle back through false is the explicit retry boundary after a failed discovery.
    lastAutoDiscoverQueryIds = ctx.settings.export.autoDiscoverQueryIds;
  },

  async apply(ctx, root, addedNodes) {
    // Route changes, MutationObserver delivery, and settings saves can all request apply at the
    // same time. Serializing the lifecycle makes each transition observe the latest settings and
    // prevents two callers from opening duplicate jobs or finishing the same one concurrently.
    const next = lifecycleQueue.then(() => reconcileExportState(ctx, root, addedNodes));
    lifecycleQueue = next.catch(() => undefined);
    await next;
  },

  async destroy(ctx) {
    // A queued append must settle before the final finish, otherwise a late mutation can reopen
    // the job after teardown has marked it done.
    await lifecycleQueue;
    await finishCaptureSession(ctx);
    checkpointStore = undefined;
    queryRegistry = undefined;
    activeJobId = undefined;
    lastExportEnabled = false;
    lastAutoDiscoverQueryIds = false;
    manuallyPausedJobId = undefined;
    lifecycleQueue = Promise.resolve();
    // The storage-cap notice is the only toast this feature raises, and it must not outlive the
    // feature that raised it.
    removeFeatureToast();
    ctx.diagnostics.info("Export core destroyed");
  },

  getStatus() {
    if (!checkpointStore) {
      return { ok: true, message: "Export idle" };
    }
    const jobs = checkpointStore.list();
    return {
      ok: true,
      message: `${jobs.length} export jobs tracked`,
      details: { queries: queryRegistry?.queries ? Object.keys(queryRegistry.queries).length : 0 }
    };
  }
};

export function getCheckpointStore(): CheckpointStore | undefined {
  return checkpointStore;
}

export function getDiscoveredQueries(): QueryRegistry | undefined {
  return queryRegistry;
}

export interface ExportArtifact {
  data: Uint8Array;
  filename: string;
}

export interface ExportRunResult {
  jobId: string;
  records: number;
  /** One entry per ZIP. `media.zipChunkSize` caps how many records each one carries. */
  artifacts: ExportArtifact[];
  filename: string;
  audience: ExportAudienceSummary;
}

export interface CapturedThreadExportResult {
  data: Uint8Array | null;
  filename: string;
  records: number;
  threads: number;
}

export interface ExportJobActionResult {
  ok: boolean;
  error?: string;
}

export async function runExportOfVisibleTweets(ctx: FeatureContext): Promise<ExportRunResult> {
  if (!checkpointStore) {
    checkpointStore = new CheckpointStore(ctx.storage);
    await checkpointStore.load();
  }

  const jobId = `job-${Date.now()}`;
  const formats = selectSupportedFormats(ctx.settings.export.formats);
  await checkpointStore.start(jobId, ctx.route.surface, formats, ctx.settings.export.preserveRawPayloads);
  void ctx.auditLog.record("export.start", { jobId, formats, surface: ctx.route.surface });
  try {
    const initialRecords = collectExportRecords(document, ctx.route.surface, {
      mediaMetadata: getCapturedMediaMetadata
    });
    await checkpointStore.append(jobId, initialRecords);

    const records = checkpointStore.records(jobId);
    let packageRecords = reconstructExportOrder(records);
    if (ctx.settings.export.captureMediaBytes) {
      await warnIfCaptureCrossesCap(ctx, records);
      packageRecords = await captureExportMedia(records, ctx.settings.export);
    }
    await checkpointStore.updateProgress(jobId, { completed: packageRecords.length, total: packageRecords.length });
    // Handing the user an empty ZIP is worse than telling them nothing was captured.
    const audience = summarizeAudience(packageRecords, {
      includeProtected: ctx.settings.export.includeProtected,
      includeUnknown: ctx.settings.export.includeUnknown
    });
    const artifacts =
      records.length === 0
        ? []
        : await buildExportZipChunks(
            packageRecords,
            formats,
            ctx.settings.media.lastSaveFolder,
            ctx.settings.media.zipChunkSize,
            { audience: {
              includeProtected: ctx.settings.export.includeProtected,
              includeUnknown: ctx.settings.export.includeUnknown
            } }
          );
    await checkpointStore.finish(jobId);
    ctx.diagnostics.info("Export completed", { records: packageRecords.length, formats });
    void ctx.auditLog.record("export.complete", { jobId, records: packageRecords.length, formats });
    if (ctx.settings.integrations.semanticSearch.autoIndex) {
      void autoIndexExport(ctx, packageRecords);
    }
    return {
      jobId,
      records: packageRecords.length,
      artifacts,
      filename: artifacts[0]?.filename ?? zipFilename(ctx.settings.media.lastSaveFolder),
      audience
    };
  } catch (error) {
    await checkpointStore.fail(jobId, error);
    ctx.diagnostics.error("Export failed", errorDetails(error));
    void ctx.auditLog.record("export.failed", { jobId, error: String((error as Error)?.message ?? error) });
    throw error;
  }
}

/** Builds a local-only reader from every captured post already in the checkpoint store. */
export async function rebuildCapturedThreads(ctx: FeatureContext): Promise<CapturedThreadExportResult> {
  if (!checkpointStore) {
    checkpointStore = new CheckpointStore(ctx.storage);
    await checkpointStore.load();
  }
  const byKey = new Map<string, ExportRecord>();
  for (const job of checkpointStore.list()) {
    for (const record of checkpointStore.records(job.jobId)) {
      if (!record.tweetId) continue;
      const key = `tweet:${record.tweetId}`;
      const previous = byKey.get(key);
      if (!previous || record.media.length > previous.media.length || record.text.length > previous.text.length) {
        byKey.set(key, record);
      }
    }
  }
  const records = reconstructExportOrder([...byKey.values()]);
  const threads = reconstructThreads(records);
  if (records.length === 0) {
    return { data: null, filename: "aviary-threads.zip", records: 0, threads: 0 };
  }
  return {
    data: await buildExportZip(records, ["json"], "aviary-threads"),
    filename: "aviary-threads.zip",
    records: records.length,
    threads: threads.length
  };
}

/**
 * Says so before the capture runs, and then runs it.
 *
 * The cap does not stop the capture and never removes anything: it exists so a person notices
 * their library is about to pass a number they chose, in time to change the capture settings or
 * clear something first. A cap that silently refused would leave the reader with an export that
 * quietly lost media, which is worse than a large library.
 */
async function warnIfCaptureCrossesCap(
  ctx: FeatureContext,
  records: readonly ExportRecord[]
): Promise<void> {
  const capBytes = ctx.settings.export.storageCapBytes;
  if (capBytes <= 0) return;
  // A backend that cannot weigh itself says so, and no cap warning is raised at all: guessing a
  // total from the keys Aviary happens to remember would put a number on screen that is not one.
  const breakdown = await ctx.storage.measureCollections?.().catch(() => null);
  if (!breakdown) return;
  const storedBytes = breakdown.totalBytes;
  const incomingBytes = records.reduce((total, record) => total + recordStoredBytes(record), 0);
  const report = storageCapReport({ capBytes, storedBytes, incomingBytes });
  if (report.state === "under" || report.state === "off") return;
  ctx.diagnostics.warn("Library storage cap reached", {
    state: report.state,
    capBytes: report.capBytes,
    storedBytes: report.storedBytes
  });
  showFeatureToast(
    report.state === "over"
      ? ft(ctx, "Your local library is already past the storage cap you set. Nothing was deleted.")
      : ft(ctx, "This capture takes your local library past the storage cap you set. Nothing was deleted."),
    { tone: "error", ctx }
  );
}

async function captureExportMedia(
  records: ExportRecord[],
  settings: AviarySettings["export"]
): Promise<ExportRecord[]> {
  // Capture is opt-in because it performs bounded, user-initiated media requests. Each failure
  // remains on the record as a remote-reference or missing item, so a partial run never claims
  // that an interrupted response is inside the package.
  //
  // The size settings apply from here, to this run only. Records already in the library are not
  // reopened: a capture setting decides what the next capture keeps, and rewriting stored bytes
  // to match a preference changed afterwards would destroy the original nobody asked to lose.
  const size = {
    imageScale: settings.captureImageScale,
    posterFrameOnly: settings.capturePosterFramesOnly
  };
  return Promise.all(records.map((record) => captureExportRecordMedia(record, size)));
}

export async function pauseExportJob(jobId: string): Promise<ExportJobActionResult> {
  if (!checkpointStore) return { ok: false, error: "Export store is not loaded" };
  const ok = await checkpointStore.pause(jobId);
  if (ok && activeJobId === jobId) {
    activeJobId = undefined;
    manuallyPausedJobId = jobId;
  }
  return actionResult(ok);
}

export async function resumeExportJob(jobId: string): Promise<ExportJobActionResult> {
  if (!checkpointStore) return { ok: false, error: "Export store is not loaded" };
  const ok = await checkpointStore.resume(jobId);
  if (ok) {
    activeJobId = jobId;
    manuallyPausedJobId = undefined;
  }
  return actionResult(ok);
}

export async function cancelExportJob(jobId: string): Promise<ExportJobActionResult> {
  if (!checkpointStore) return { ok: false, error: "Export store is not loaded" };
  const ok = await checkpointStore.cancel(jobId);
  if (activeJobId === jobId) {
    activeJobId = undefined;
    lastExportEnabled = false;
  }
  if (manuallyPausedJobId === jobId) {
    manuallyPausedJobId = undefined;
  }
  return actionResult(ok);
}

export async function buildExportZip(
  records: ExportRecord[],
  formats: readonly ExportFormat[],
  folder: string,
  options: { audience?: Partial<ExportAudienceSelection> } = {}
): Promise<Uint8Array> {
  const entries: ZipFileEntry[] = [];
  const safeFolder = sanitizeFolder(folder);
  // One time for the whole package. The manifest and the static site declaring different moments
  // for the same export is the kind of small disagreement that makes an archive hard to trust.
  const generatedAt = new Date();
  const prepared = prepareExportPackage(reconstructExportOrder(records));
  const audience = normalizeAudienceSelection(options.audience ?? DEFAULT_EXPORT_AUDIENCE);
  const shareRecords = filterShareRecords(prepared.records, audience);
  const packageFiles: ExportPackageFile[] = [];

  for (const format of formats) {
    const artifact = formatExport(format, isShareOrientedFormat(format) ? shareRecords : prepared.records);
    const filename = packagePath(safeFolder, artifact.filename);
    entries.push({
      filename,
      data: artifact.data
    });
    packageFiles.push({
      path: filename,
      kind: "artifact",
      contentType: artifact.contentType,
      byteLength: artifact.data.byteLength,
      sha256: sha256Hex(artifact.data)
    });
  }

  for (const asset of prepared.assets) {
    const filename = packagePath(safeFolder, asset.path);
    entries.push({ filename, data: asset.data });
    packageFiles.push({
      path: filename,
      kind: "media",
      contentType: asset.contentType,
      byteLength: asset.data.byteLength,
      sha256: sha256Hex(asset.data)
    });
  }

  const viewer = buildExportViewer(prepared.records, { audience });
  const viewerPath = packagePath(safeFolder, "viewer.html");
  entries.push({ filename: viewerPath, data: viewer });
  packageFiles.push({
    path: viewerPath,
    kind: "artifact",
    contentType: "text/html",
    byteLength: viewer.byteLength,
    sha256: sha256Hex(viewer)
  });

  // The static site sits beside the viewer and shares the same `media/` folder, so the package
  // carries one set of bytes and two ways to read them: the viewer for searching a library, plain
  // pages and a feed for keeping it.
  for (const entry of buildStaticArchive(prepared.records, { audience, generatedAt })) {
    const filename = packagePath(safeFolder, entry.filename);
    entries.push({ filename, data: entry.data });
    packageFiles.push({
      path: filename,
      kind: "artifact",
      contentType: staticArchiveContentType(entry.filename),
      byteLength: entry.data.byteLength,
      sha256: sha256Hex(entry.data)
    });
  }

  // AS2 beside the rest of it. Nothing imports posts from it today; it is here because it is the
  // one social-post schema with tooling that already parses it, and it costs one mapping.
  const outbox = serializeActivityStreamsOutbox(prepared.records, { audience, generatedAt });
  const outboxPath = packagePath(safeFolder, "outbox.json");
  entries.push({ filename: outboxPath, data: outbox });
  packageFiles.push({
    path: outboxPath,
    kind: "artifact",
    contentType: "application/activity+json",
    byteLength: outbox.byteLength,
    sha256: sha256Hex(outbox)
  });

  const manifestPath = packagePath(safeFolder, "manifest.json");
  const manifest = buildExportPackageManifest(
    prepared.records,
    packageFiles,
    safeFolder,
    generatedAt.toISOString()
  );
  entries.push({
    filename: manifestPath,
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  });
  return buildZip(entries);
}

/**
 * Splits an export into one ZIP per `chunkSize` records. A single archive of a long profile
 * scrape can reach a size the browser's download path and the user's unzip tool both handle
 * badly, which is what `media.zipChunkSize` was added for -- it just never did anything.
 *
 * A run that fits in one chunk keeps the plain single-file name, so the common case is
 * unchanged; only a split run gets `-part1of3` suffixes.
 */
export async function buildExportZipChunks(
  records: ExportRecord[],
  formats: readonly ExportFormat[],
  folder: string,
  chunkSize: number,
  options: { audience?: Partial<ExportAudienceSelection> } = {}
): Promise<ExportArtifact[]> {
  const orderedRecords = reconstructExportOrder(records);
  if (orderedRecords.length === 0) {
    return [];
  }
  const size = Math.max(1, Math.trunc(chunkSize) || orderedRecords.length);
  const base = zipFilename(folder);
  if (orderedRecords.length <= size) {
    return [{ data: await buildExportZip(orderedRecords, formats, folder, options), filename: base }];
  }

  const total = Math.ceil(orderedRecords.length / size);
  const artifacts: ExportArtifact[] = [];
  for (let index = 0; index < total; index += 1) {
    const slice = orderedRecords.slice(index * size, (index + 1) * size);
    artifacts.push({
      data: await buildExportZip(slice, formats, folder, options),
      filename: base.replace(/\.zip$/, `-part${index + 1}of${total}.zip`)
    });
  }
  return artifacts;
}

export function selectSupportedFormats(input: readonly string[]): ExportFormat[] {
  const allowed: ExportFormat[] = ["json", "csv", "html", "markdown", "xlsx"];
  const result: ExportFormat[] = [];
  for (const candidate of input) {
    if ((allowed as readonly string[]).includes(candidate) && !result.includes(candidate as ExportFormat)) {
      result.push(candidate as ExportFormat);
    }
  }
  return result.length > 0 ? result : ["json"];
}

function sanitizeFolder(folder: string): string {
  // Re-applied here rather than trusting what storage holds: this value also arrives from an
  // imported settings file and from a library restore, and it becomes the ZIP entry prefix.
  return sanitizeFolderHint(folder, 80);
}

/**
 * The manifest describes each file by what it is.
 *
 * `buildStaticArchive` normally emits pages and a feed only, because it reuses the asset paths
 * `prepareExportPackage` already assigned. It still copies bytes of its own when an asset has none
 * of those, and labelling a JPEG `text/html` in the manifest would be a false statement about the
 * package rather than a cosmetic slip.
 */
function staticArchiveContentType(filename: string): string {
  if (filename.endsWith(".xml")) return "application/rss+xml";
  if (filename.endsWith(".html")) return "text/html";
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(filename)?.[1]?.toLowerCase() ?? "";
  return STATIC_ARCHIVE_MEDIA_TYPES[extension] ?? "application/octet-stream";
}

const STATIC_ARCHIVE_MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  vtt: "text/vtt",
  srt: "application/x-subrip"
};

function packagePath(folder: string, path: string): string {
  return folder ? `${folder}/${path}` : path;
}

function zipFilename(folder: string): string {
  const safe = sanitizeFolder(folder);
  const base = safe.length > 0 ? safe.replace(/\//g, "_") : "aviary-export";
  return `${base}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
}

async function reconcileExportState(
  ctx: FeatureContext,
  root: ParentNode,
  addedNodes?: Element[]
): Promise<void> {
  if (!checkpointStore) {
    return;
  }

  const autoDiscover = ctx.settings.export.autoDiscoverQueryIds;
  if (autoDiscover && !lastAutoDiscoverQueryIds) {
    await discoverQueryIdsForContext(ctx);
  }
  lastAutoDiscoverQueryIds = autoDiscover;

  const enabled = ctx.settings.export.enabled;
  if (!enabled) {
    if (lastExportEnabled || activeJobId) {
      await finishCaptureSession(ctx);
    }
    lastExportEnabled = false;
    return;
  }

  // Capture-as-you-scroll stays open for the enabled session. A missing active id is also a
  // recoverable start failure, so the next apply may retry without duplicating a healthy job.
  if (!lastExportEnabled || !activeJobId) {
    if (manuallyPausedJobId && checkpointStore.list().some((job) => job.jobId === manuallyPausedJobId && job.status === "paused")) {
      lastExportEnabled = true;
      return;
    }
    await startCaptureSession(ctx);
  }
  lastExportEnabled = true;

  if (!activeJobId) {
    return;
  }
  const records = collectExportRecords(root, ctx.route.surface);
  if (records.length === 0) {
    return;
  }
  await checkpointStore.append(activeJobId, records);
  if (addedNodes) {
    ctx.diagnostics.info("Export captured nodes", { count: records.length });
  }
}

async function discoverQueryIdsForContext(ctx: FeatureContext): Promise<void> {
  try {
    queryRegistry = await discoverQueryIds(ctx.storage);
    ctx.diagnostics.info("Query IDs discovered", {
      count: Object.keys(queryRegistry.queries).length
    });
  } catch (error) {
    ctx.diagnostics.warn("Query ID discovery failed", errorDetails(error));
  }
}

async function startCaptureSession(ctx: FeatureContext): Promise<void> {
  if (!checkpointStore || activeJobId) {
    return;
  }
  const resumable = checkpointStore.listResumable()
    .filter((job) => job.surface === ctx.route.surface)
    .at(-1);
  if (resumable) {
    const resumed = await checkpointStore.resume(resumable.jobId);
    if (resumed) {
      activeJobId = resumable.jobId;
      ctx.diagnostics.info("Export capture session resumed", {
        jobId: resumable.jobId,
        records: resumable.recordCount
      });
      return;
    }
  }
  const jobId = `session-${Date.now()}-${++sessionSequence}`;
  try {
    await checkpointStore.start(
      jobId,
      ctx.route.surface,
      selectSupportedFormats(ctx.settings.export.formats),
      ctx.settings.export.preserveRawPayloads
    );
    activeJobId = jobId;
    ctx.diagnostics.info("Export capture session started", { jobId });
  } catch (error) {
    // Do not leave a phantom id behind when persistence rejects the start. A later apply can
    // retry the transition, while the registry still receives the original failure.
    activeJobId = undefined;
    throw error;
  }
}

async function finishCaptureSession(ctx: FeatureContext): Promise<void> {
  const jobId = activeJobId;
  if (!jobId || !checkpointStore) {
    activeJobId = undefined;
    return;
  }
  try {
    await checkpointStore.finish(jobId);
    ctx.diagnostics.info("Export capture session finished", { jobId });
  } finally {
    if (activeJobId === jobId) {
      activeJobId = undefined;
    }
  }
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

async function autoIndexExport(ctx: FeatureContext, records: readonly ExportRecord[]): Promise<void> {
  try {
    const index = new SemanticIndex(ctx.storage, ctx.integrationUsage);
    await index.load();
    const result = await index.embedAndIndex(ctx.settings.integrations.semanticSearch, records);
    ctx.diagnostics.info("Auto-embedding finished", result);
    void ctx.auditLog.record("export.complete", {
      kind: "auto-semantic-index",
      added: result.added,
      skipped: result.skipped,
      errors: result.errors,
      blocked: result.blocked
    });
  } catch (error) {
    ctx.diagnostics.warn("Auto-embedding failed", errorDetails(error));
  }
}

function actionResult(ok: boolean): ExportJobActionResult {
  return ok ? { ok: true } : { ok: false, error: "The export job is no longer active" };
}
