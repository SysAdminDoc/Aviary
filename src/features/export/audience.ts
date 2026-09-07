import type { ExportFormat, ExportRecord } from "./types.ts";

export type ExportAudience = "public" | "protected" | "unknown";

export interface ExportAudienceSelection {
  includeProtected: boolean;
  includeUnknown: boolean;
}

export interface ExportAudienceSummary {
  total: number;
  public: number;
  protected: number;
  unknown: number;
  excludedProtected: number;
  excludedUnknown: number;
}

export const DEFAULT_EXPORT_AUDIENCE: ExportAudienceSelection = {
  includeProtected: false,
  includeUnknown: false
};

export function normalizeAudience(value: unknown): ExportAudience {
  return value === "public" || value === "protected" || value === "unknown" ? value : "unknown";
}

export function normalizeAudienceSelection(value?: Partial<ExportAudienceSelection> | null): ExportAudienceSelection {
  return {
    includeProtected: value?.includeProtected === true,
    includeUnknown: value?.includeUnknown === true
  };
}

export function audienceOf(record: Pick<ExportRecord, "audience">): ExportAudience {
  return normalizeAudience(record.audience);
}

export function summarizeAudience(
  records: readonly Pick<ExportRecord, "audience">[],
  selection: ExportAudienceSelection = DEFAULT_EXPORT_AUDIENCE
): ExportAudienceSummary {
  const summary: ExportAudienceSummary = {
    total: records.length,
    public: 0,
    protected: 0,
    unknown: 0,
    excludedProtected: 0,
    excludedUnknown: 0
  };
  for (const record of records) {
    const audience = audienceOf(record);
    summary[audience] += 1;
    if (audience === "protected" && !selection.includeProtected) summary.excludedProtected += 1;
    if (audience === "unknown" && !selection.includeUnknown) summary.excludedUnknown += 1;
  }
  return summary;
}

export function filterShareRecords(
  records: readonly ExportRecord[],
  selection: ExportAudienceSelection = DEFAULT_EXPORT_AUDIENCE
): ExportRecord[] {
  return records.filter((record) => {
    const audience = audienceOf(record);
    return audience === "public" ||
      (audience === "protected" && selection.includeProtected) ||
      (audience === "unknown" && selection.includeUnknown);
  });
}

export function isShareOrientedFormat(format: ExportFormat): boolean {
  return format === "html" || format === "markdown";
}
