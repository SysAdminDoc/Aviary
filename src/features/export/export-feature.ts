import type { FeatureContext, FeatureModule } from "../registry";
import { SemanticIndex } from "../integrations/semantic-search";
import { collectExportRecords } from "./collector";
import { CheckpointStore } from "./jobs";
import { formatExport } from "./formatters";
import { discoverQueryIds, type QueryRegistry } from "./query-discovery";
import { buildStoreZip, type ZipFileEntry } from "./zip-store";
import type { ExportFormat, ExportRecord } from "./types";

let checkpointStore: CheckpointStore | undefined;
let queryRegistry: QueryRegistry | undefined;
let activeJobId: string | undefined;

export const exportFeature: FeatureModule = {
  id: "export.core",
  title: "Export core",
  category: "export",
  defaultEnabled: true,

  async init(ctx) {
    checkpointStore = new CheckpointStore(ctx.storage);
    const retention = await checkpointStore.load();
    if (retention.removedJobs > 0 || retention.removedRecords > 0) {
      ctx.diagnostics.info("Checkpoint retention sweep", { ...retention });
    }
    if (ctx.settings.export.autoDiscoverQueryIds) {
      try {
        queryRegistry = await discoverQueryIds(ctx.storage);
        ctx.diagnostics.info("Query IDs discovered", {
          count: Object.keys(queryRegistry.queries).length
        });
      } catch (error) {
        ctx.diagnostics.warn("Query ID discovery failed", errorDetails(error));
      }
    }
  },

  async apply(ctx, root, addedNodes) {
    if (!ctx.settings.export.enabled || !checkpointStore || !activeJobId) {
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
  },

  destroy(ctx) {
    checkpointStore = undefined;
    queryRegistry = undefined;
    activeJobId = undefined;
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

export async function runExportOfVisibleTweets(ctx: FeatureContext): Promise<ExportRunResult> {
  if (!checkpointStore) {
    checkpointStore = new CheckpointStore(ctx.storage);
    await checkpointStore.load();
  }

  const jobId = `job-${Date.now()}`;
  const formats = selectSupportedFormats(ctx.settings.export.formats);
  await checkpointStore.start(jobId, ctx.route.surface, formats, ctx.settings.export.preserveRawPayloads);
  void ctx.auditLog.record("export.start", { jobId, formats, surface: ctx.route.surface });

  activeJobId = jobId;
  const initialRecords = collectExportRecords(document, ctx.route.surface);
  await checkpointStore.append(jobId, initialRecords);
  activeJobId = undefined;

  const records = checkpointStore.records(jobId);
  // Handing the user an empty ZIP is worse than telling them nothing was captured.
  const artifacts =
    records.length === 0
      ? []
      : buildExportZipChunks(
          records,
          formats,
          ctx.settings.media.lastSaveFolder,
          ctx.settings.media.zipChunkSize
        );
  await checkpointStore.finish(jobId);
  ctx.diagnostics.info("Export completed", { records: records.length, formats });
  void ctx.auditLog.record("export.complete", { jobId, records: records.length, formats });
  if (ctx.settings.integrations.semanticSearch.autoIndex) {
    void autoIndexExport(ctx, records);
  }
  return {
    jobId,
    records: records.length,
    artifacts,
    filename: artifacts[0]?.filename ?? zipFilename(ctx.settings.media.lastSaveFolder)
  };
}

export function buildExportZip(
  records: ExportRecord[],
  formats: readonly ExportFormat[],
  folder: string
): Uint8Array {
  const entries: ZipFileEntry[] = [];
  const safeFolder = sanitizeFolder(folder);

  for (const format of formats) {
    const artifact = formatExport(format, records);
    entries.push({
      filename: safeFolder ? `${safeFolder}/${artifact.filename}` : artifact.filename,
      data: artifact.data
    });
  }
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

function zipFilename(folder: string): string {
  const safe = sanitizeFolder(folder);
  const base = safe.length > 0 ? safe.replace(/\//g, "_") : "aviary-export";
  return `${base}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

async function autoIndexExport(ctx: FeatureContext, records: readonly ExportRecord[]): Promise<void> {
  try {
    const index = new SemanticIndex(ctx.storage);
    await index.load();
    const result = await index.embedAndIndex(ctx.settings.integrations.semanticSearch, records);
    ctx.diagnostics.info("Auto-embedding finished", result);
    void ctx.auditLog.record("export.complete", {
      kind: "auto-semantic-index",
      added: result.added,
      skipped: result.skipped,
      errors: result.errors
    });
  } catch (error) {
    ctx.diagnostics.warn("Auto-embedding failed", errorDetails(error));
  }
}
