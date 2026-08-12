import type { FeatureContext, FeatureModule } from "../registry";
import { SemanticIndex } from "../integrations/semantic-search";
import {
  buildExportPackageManifest,
  prepareExportPackage,
  sha256Hex,
  type ExportPackageFile
} from "./assets";
import { collectExportRecords } from "./collector";
import { captureExportRecordMedia } from "../media/downloader";
import { CheckpointStore } from "./jobs";
import { formatExport } from "./formatters";
import { discoverQueryIds, type QueryRegistry } from "./query-discovery";
import { buildExportViewer } from "./viewer";
import { buildStoreZip, type ZipFileEntry } from "./zip-store";
import type { ExportFormat, ExportRecord } from "./types";

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
  defaultEnabled: true,

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
    const initialRecords = collectExportRecords(document, ctx.route.surface);
    await checkpointStore.append(jobId, initialRecords);

    const records = checkpointStore.records(jobId);
    let packageRecords = records;
    if (ctx.settings.export.captureMediaBytes) {
      packageRecords = await captureExportMedia(records);
    }
    await checkpointStore.updateProgress(jobId, { completed: packageRecords.length, total: packageRecords.length });
    // Handing the user an empty ZIP is worse than telling them nothing was captured.
    const artifacts =
      records.length === 0
        ? []
        : buildExportZipChunks(
            packageRecords,
            formats,
            ctx.settings.media.lastSaveFolder,
            ctx.settings.media.zipChunkSize
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
      filename: artifacts[0]?.filename ?? zipFilename(ctx.settings.media.lastSaveFolder)
    };
  } catch (error) {
    await checkpointStore.fail(jobId, error);
    ctx.diagnostics.error("Export failed", errorDetails(error));
    void ctx.auditLog.record("export.failed", { jobId, error: String((error as Error)?.message ?? error) });
    throw error;
  }
}

async function captureExportMedia(records: ExportRecord[]): Promise<ExportRecord[]> {
  // Capture is opt-in because it performs bounded, user-initiated media requests. Each failure
  // remains on the record as a remote-reference or missing item, so a partial run never claims
  // that an interrupted response is inside the package.
  return Promise.all(records.map((record) => captureExportRecordMedia(record)));
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

export function buildExportZip(
  records: ExportRecord[],
  formats: readonly ExportFormat[],
  folder: string
): Uint8Array {
  const entries: ZipFileEntry[] = [];
  const safeFolder = sanitizeFolder(folder);
  const prepared = prepareExportPackage(records);
  const packageFiles: ExportPackageFile[] = [];

  for (const format of formats) {
    const artifact = formatExport(format, prepared.records);
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

  const viewer = buildExportViewer(prepared.records);
  const viewerPath = packagePath(safeFolder, "viewer.html");
  entries.push({ filename: viewerPath, data: viewer });
  packageFiles.push({
    path: viewerPath,
    kind: "artifact",
    contentType: "text/html",
    byteLength: viewer.byteLength,
    sha256: sha256Hex(viewer)
  });

  const manifestPath = packagePath(safeFolder, "manifest.json");
  const manifest = buildExportPackageManifest(prepared.records, packageFiles, safeFolder);
  entries.push({
    filename: manifestPath,
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  });
  return buildStoreZip(entries);
}

/**
 * Splits an export into one ZIP per `chunkSize` records. A single archive of a long profile
 * scrape can reach a size the browser's download path and the user's unzip tool both handle
 * badly, which is what `media.zipChunkSize` was added for -- it just never did anything.
 *
 * A run that fits in one chunk keeps the plain single-file name, so the common case is
 * unchanged; only a split run gets `-part1of3` suffixes.
 */
export function buildExportZipChunks(
  records: ExportRecord[],
  formats: readonly ExportFormat[],
  folder: string,
  chunkSize: number
): ExportArtifact[] {
  if (records.length === 0) {
    return [];
  }
  const size = Math.max(1, Math.trunc(chunkSize) || records.length);
  const base = zipFilename(folder);
  if (records.length <= size) {
    return [{ data: buildExportZip(records, formats, folder), filename: base }];
  }

  const total = Math.ceil(records.length / size);
  const artifacts: ExportArtifact[] = [];
  for (let index = 0; index < total; index += 1) {
    const slice = records.slice(index * size, (index + 1) * size);
    artifacts.push({
      data: buildExportZip(slice, formats, folder),
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
  const cleaned = folder.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return cleaned.slice(0, 80);
}

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
