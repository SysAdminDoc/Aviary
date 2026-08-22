import type { StorageGateway } from "../../platform/storage.ts";
import { mutateStored } from "../../platform/storage-lock.ts";

export const UNDER_THE_HOOD_KEY = "aviary.library.underTheHood.v1";
export const UNDER_THE_HOOD_STORE_VERSION = 1 as const;
export const MAX_UNDER_THE_HOOD_BYTES = 2 * 1024 * 1024;
export const MAX_UNDER_THE_HOOD_REPORTS = 24;
const MAX_LABELS_PER_REPORT = 100;
const MAX_TEXT_LENGTH = 2_000;

export interface UnderTheHoodPeriod {
  startDate: string;
  endDate: string;
  timezone: string;
}

export interface UnderTheHoodPostLabel {
  label: string;
  about: string;
  effect: string;
  posts: number;
  totalPostsInMonth: number;
  percentageOfPosts: number;
}

export interface UnderTheHoodAccountLabel {
  label: string;
  about: string;
  effect: string;
  days: number;
  daysInPeriod: number;
  percentageOfDays: number;
  activeDays: number[];
}

export interface UnderTheHoodReport {
  id: string;
  source: "x-under-the-hood";
  importedAt: string;
  generatedAt: string | null;
  period: UnderTheHoodPeriod;
  postCount: number;
  postLabels: UnderTheHoodPostLabel[];
  accountLabels: UnderTheHoodAccountLabel[];
  totalPostLabels: number;
  totalAccountLabels: number;
  notes: string | null;
}

export interface UnderTheHoodStoreState {
  version: typeof UNDER_THE_HOOD_STORE_VERSION;
  reports: UnderTheHoodReport[];
}

export interface UnderTheHoodParseResult {
  report: UnderTheHoodReport | null;
  warnings: string[];
  errors: string[];
}

export interface UnderTheHoodReportSummary {
  id: string;
  period: string;
  startDate: string;
  endDate: string;
  generatedAt: string | null;
  importedAt: string;
  postCount: number;
  postLabelCount: number;
  accountLabelDayCount: number;
  postLabels: string[];
  accountLabels: string[];
}

export interface UnderTheHoodLabelChange {
  label: string;
  previous: number;
  current: number;
  delta: number;
}

export interface UnderTheHoodComparison {
  earlier: string;
  later: string;
  postCountDelta: number;
  postLabelCountDelta: number;
  accountLabelDayCountDelta: number;
  addedPostLabels: string[];
  removedPostLabels: string[];
  addedAccountLabels: string[];
  removedAccountLabels: string[];
  postLabelChanges: UnderTheHoodLabelChange[];
  accountLabelChanges: UnderTheHoodLabelChange[];
}

export interface UnderTheHoodStatus {
  reportCount: number;
  latest: UnderTheHoodReportSummary | null;
  previous: UnderTheHoodReportSummary | null;
  comparison: UnderTheHoodComparison | null;
}

export interface UnderTheHoodExportArtifact {
  filename: string;
  contentType: "application/json";
  data: Uint8Array;
  reports: number;
  bytes: number;
}

const EMPTY_STATE: UnderTheHoodStoreState = {
  version: UNDER_THE_HOOD_STORE_VERSION,
  reports: []
};

/**
 * Reads X's downloadable monthly report. The parser deliberately accepts only the public report
 * shape, not arbitrary JSON, and stores a bounded normalized copy instead of the original file.
 */
export function parseUnderTheHoodJson(
  payload: string | unknown,
  importedAt = new Date().toISOString()
): UnderTheHoodParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let root: unknown;

  if (typeof payload === "string") {
    if (new TextEncoder().encode(payload).byteLength > MAX_UNDER_THE_HOOD_BYTES) {
      return { report: null, warnings, errors: ["The Under the Hood file is larger than 2 MiB."] };
    }
    try {
      root = JSON.parse(payload) as unknown;
    } catch {
      return { report: null, warnings, errors: ["The Under the Hood file is not valid JSON."] };
    }
  } else {
    root = payload;
  }

  const source = unwrapReport(root);
  if (!isRecord(source)) {
    return { report: null, warnings, errors: ["The file does not contain an X Under the Hood report."] };
  }

  const period = parsePeriod(source, warnings);
  if (!period) errors.push("The report does not include a valid UTC reporting period.");

  const postCountValue = firstValue(source, ["postCount", "eligiblePostCount", "eligiblePosts"]);
  const postCount = nonNegativeInteger(postCountValue);
  if (postCount === null) {
    warnings.push("The report did not include an eligible post count; using 0.");
  }

  const postLabels = parsePostLabels(firstArray(source, ["postLabels", "postLabelAgg"]), warnings);
  const accountLabels = parseAccountLabels(
    firstArray(source, ["accountLabels", "accountLabelAgg"]),
    warnings
  );
  const generatedAt = parseTimestamp(source.generatedAt, warnings);
  const notes = boundedText(source.notes, MAX_TEXT_LENGTH);
  const imported = parseTimestamp(importedAt, []) ?? new Date().toISOString();

  if (errors.length > 0 || !period) return { report: null, warnings, errors };

  const report: UnderTheHoodReport = {
    id: reportId(period),
    source: "x-under-the-hood",
    importedAt: imported,
    generatedAt,
    period,
    postCount: postCount ?? 0,
    postLabels,
    accountLabels,
    totalPostLabels: postLabels.length,
    totalAccountLabels: accountLabels.length,
    notes
  };
  return { report, warnings, errors };
}

export class UnderTheHoodStore {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  #state: UnderTheHoodStoreState = cloneState(EMPTY_STATE);
  #loaded = false;

  constructor(storage: StorageGateway, limit = MAX_UNDER_THE_HOOD_REPORTS) {
    this.#storage = storage;
    this.#limit = Math.max(2, Math.min(MAX_UNDER_THE_HOOD_REPORTS, Math.floor(limit)));
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const stored = await this.#storage.get<unknown>(UNDER_THE_HOOD_KEY, EMPTY_STATE);
    this.#state = normalizeState(stored, this.#limit);
    this.#loaded = true;
  }

  list(): UnderTheHoodReport[] {
    return this.#state.reports.map(cloneReport);
  }

  status(): UnderTheHoodStatus {
    const reports = [...this.#state.reports].sort(compareReports);
    const latest = reports.at(-1) ?? null;
    const previous = reports.at(-2) ?? null;
    return {
      reportCount: reports.length,
      latest: latest ? summarizeReport(latest) : null,
      previous: previous ? summarizeReport(previous) : null,
      comparison: latest && previous ? compareUnderTheHoodReports(previous, latest) : null
    };
  }

  async importPayload(payload: string): Promise<UnderTheHoodParseResult> {
    await this.load();
    const parsed = parseUnderTheHoodJson(payload);
    if (!parsed.report) return parsed;

    const next = await mutateStored<UnderTheHoodStoreState>(
      this.#storage,
      UNDER_THE_HOOD_KEY,
      EMPTY_STATE,
      (stored) => {
        const state = normalizeState(stored, this.#limit);
        const index = state.reports.findIndex((entry) => entry.id === parsed.report!.id);
        if (index >= 0) {
          state.reports[index] = parsed.report!;
        } else {
          state.reports.push(parsed.report!);
        }
        state.reports.sort(compareReports);
        state.reports = state.reports.slice(-this.#limit);
        return state;
      }
    );
    this.#state = normalizeState(next, this.#limit);
    return { ...parsed, report: cloneReport(parsed.report) };
  }

  async clear(): Promise<void> {
    await this.load();
    const next = cloneState(EMPTY_STATE);
    await this.#storage.set(UNDER_THE_HOOD_KEY, next);
    this.#state = next;
  }

  exportArtifact(exportedAt = new Date().toISOString()): UnderTheHoodExportArtifact {
    const value = {
      generator: "Aviary" as const,
      schemaVersion: 1 as const,
      source: "X Under the Hood monthly summaries" as const,
      exportedAt,
      provenance:
        "Reports are X's own aggregate summaries for the stated month. They do not include production ranking weights or prove how every post was ranked.",
      reports: this.#state.reports.map(cloneReport)
    };
    const text = JSON.stringify(value, null, 2);
    const data = new TextEncoder().encode(text);
    const date = exportedAt.slice(0, 10).replace(/[^0-9]/g, "") || "local";
    return {
      filename: `aviary-under-the-hood-${date}.json`,
      contentType: "application/json",
      data,
      reports: value.reports.length,
      bytes: data.byteLength
    };
  }
}

export function compareUnderTheHoodReports(
  earlier: UnderTheHoodReport,
  later: UnderTheHoodReport
): UnderTheHoodComparison {
  const earlierPosts = countPostLabels(earlier);
  const laterPosts = countPostLabels(later);
  const earlierAccountDays = countAccountLabelDays(earlier);
  const laterAccountDays = countAccountLabelDays(later);
  const postLabelChanges = labelChanges(earlier.postLabels, later.postLabels, (entry) => entry.posts);
  const accountLabelChanges = labelChanges(earlier.accountLabels, later.accountLabels, (entry) => entry.days);
  const earlierPostNames = new Set(earlier.postLabels.map((entry) => entry.label));
  const laterPostNames = new Set(later.postLabels.map((entry) => entry.label));
  const earlierAccountNames = new Set(earlier.accountLabels.map((entry) => entry.label));
  const laterAccountNames = new Set(later.accountLabels.map((entry) => entry.label));
  return {
    earlier: earlier.period.startDate.slice(0, 7),
    later: later.period.startDate.slice(0, 7),
    postCountDelta: later.postCount - earlier.postCount,
    postLabelCountDelta: laterPosts - earlierPosts,
    accountLabelDayCountDelta: laterAccountDays - earlierAccountDays,
    addedPostLabels: sortedDifference(laterPostNames, earlierPostNames),
    removedPostLabels: sortedDifference(earlierPostNames, laterPostNames),
    addedAccountLabels: sortedDifference(laterAccountNames, earlierAccountNames),
    removedAccountLabels: sortedDifference(earlierAccountNames, laterAccountNames),
    postLabelChanges,
    accountLabelChanges
  };
}

function unwrapReport(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (typeof value.reportJson === "string") {
    try {
      return JSON.parse(value.reportJson) as unknown;
    } catch {
      return null;
    }
  }
  if (isRecord(value.reportJson)) return value.reportJson;
  if (isRecord(value.report)) return value.report;
  return value;
}

function parsePeriod(value: Record<string, unknown>, warnings: string[]): UnderTheHoodPeriod | null {
  const raw = isRecord(value.period) ? value.period : null;
  let start = raw?.startDate;
  let end = raw?.endDate;
  if (typeof start !== "string" || typeof end !== "string") {
    const month = firstValue(value, ["month", "monthBucket", "reportPeriod"]);
    const derived = monthDates(month);
    if (derived) {
      start = derived.startDate;
      end = derived.endDate;
      warnings.push("The report period was inferred from its month field.");
    }
  }
  if (typeof start !== "string" || typeof end !== "string") return null;
  const startDate = normalizeDateOnly(start);
  const endDate = normalizeDateOnly(end);
  if (!startDate || !endDate || startDate > endDate) return null;
  const timezone = boundedText(raw?.timezone, 64) ?? "UTC";
  return { startDate, endDate, timezone };
}

function parsePostLabels(value: unknown[], warnings: string[]): UnderTheHoodPostLabel[] {
  const result: UnderTheHoodPostLabel[] = [];
  for (const entry of value.slice(0, MAX_LABELS_PER_REPORT)) {
    if (!isRecord(entry)) {
      warnings.push("A post label entry was ignored because it was not an object.");
      continue;
    }
    const label = boundedText(firstValue(entry, ["label", "name"]), 256);
    if (!label) {
      warnings.push("A post label entry was ignored because it had no label name.");
      continue;
    }
    result.push({
      label,
      about: boundedText(entry.about, MAX_TEXT_LENGTH) ?? "",
      effect: boundedText(entry.effect, MAX_TEXT_LENGTH) ?? "",
      posts: nonNegativeInteger(firstValue(entry, ["posts", "count"])) ?? 0,
      totalPostsInMonth:
        nonNegativeInteger(firstValue(entry, ["totalPostsInMonth", "postCount"])) ?? 0,
      percentageOfPosts: percentage(firstValue(entry, ["percentageOfPosts", "percentage"]))
    });
  }
  if (value.length > MAX_LABELS_PER_REPORT) warnings.push("Extra post labels were ignored after the 100-entry limit.");
  return dedupePostLabels(result);
}

function parseAccountLabels(value: unknown[], warnings: string[]): UnderTheHoodAccountLabel[] {
  const result: UnderTheHoodAccountLabel[] = [];
  for (const entry of value.slice(0, MAX_LABELS_PER_REPORT)) {
    if (!isRecord(entry)) {
      warnings.push("An account label entry was ignored because it was not an object.");
      continue;
    }
    const label = boundedText(firstValue(entry, ["label", "name"]), 256);
    if (!label) {
      warnings.push("An account label entry was ignored because it had no label name.");
      continue;
    }
    result.push({
      label,
      about: boundedText(entry.about, MAX_TEXT_LENGTH) ?? "",
      effect: boundedText(entry.effect, MAX_TEXT_LENGTH) ?? "",
      days: nonNegativeInteger(firstValue(entry, ["days", "count"])) ?? 0,
      daysInPeriod: nonNegativeInteger(entry.daysInPeriod) ?? 0,
      percentageOfDays: percentage(firstValue(entry, ["percentageOfDays", "percentage"])),
      activeDays: normalizeActiveDays(entry.activeDays)
    });
  }
  if (value.length > MAX_LABELS_PER_REPORT) warnings.push("Extra account labels were ignored after the 100-entry limit.");
  return dedupeAccountLabels(result);
}

function dedupePostLabels(labels: UnderTheHoodPostLabel[]): UnderTheHoodPostLabel[] {
  const byName = new Map<string, UnderTheHoodPostLabel>();
  for (const label of labels) {
    const current = byName.get(label.label);
    if (!current) {
      byName.set(label.label, label);
      continue;
    }
    byName.set(label.label, {
      ...label,
      posts: current.posts + label.posts,
      totalPostsInMonth: Math.max(current.totalPostsInMonth, label.totalPostsInMonth)
    });
  }
  return [...byName.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function dedupeAccountLabels(labels: UnderTheHoodAccountLabel[]): UnderTheHoodAccountLabel[] {
  const byName = new Map<string, UnderTheHoodAccountLabel>();
  for (const label of labels) {
    const current = byName.get(label.label);
    if (!current) {
      byName.set(label.label, label);
      continue;
    }
    byName.set(label.label, {
      ...label,
      days: current.days + label.days,
      daysInPeriod: Math.max(current.daysInPeriod, label.daysInPeriod),
      activeDays: [...new Set([...current.activeDays, ...label.activeDays])].sort((a, b) => a - b)
    });
  }
  return [...byName.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function labelChanges<T extends { label: string }>(
  earlier: T[],
  later: T[],
  value: (entry: T) => number
): UnderTheHoodLabelChange[] {
  const previous = new Map(earlier.map((entry) => [entry.label, value(entry)]));
  const current = new Map(later.map((entry) => [entry.label, value(entry)]));
  const names = new Set([...previous.keys(), ...current.keys()]);
  return [...names]
    .map((label) => ({
      label,
      previous: previous.get(label) ?? 0,
      current: current.get(label) ?? 0,
      delta: (current.get(label) ?? 0) - (previous.get(label) ?? 0)
    }))
    .filter((entry) => entry.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.label.localeCompare(right.label))
    .slice(0, MAX_LABELS_PER_REPORT);
}

function summarizeReport(report: UnderTheHoodReport): UnderTheHoodReportSummary {
  return {
    id: report.id,
    period: report.period.startDate.slice(0, 7),
    startDate: report.period.startDate,
    endDate: report.period.endDate,
    generatedAt: report.generatedAt,
    importedAt: report.importedAt,
    postCount: report.postCount,
    postLabelCount: countPostLabels(report),
    accountLabelDayCount: countAccountLabelDays(report),
    postLabels: report.postLabels.map((entry) => entry.label),
    accountLabels: report.accountLabels.map((entry) => entry.label)
  };
}

function countPostLabels(report: UnderTheHoodReport): number {
  return report.postLabels.reduce((sum, entry) => sum + entry.posts, 0);
}

function countAccountLabelDays(report: UnderTheHoodReport): number {
  return report.accountLabels.reduce((sum, entry) => sum + entry.days, 0);
}

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort((a, b) => a.localeCompare(b));
}

function normalizeState(value: unknown, limit: number): UnderTheHoodStoreState {
  if (!isRecord(value)) return cloneState(EMPTY_STATE);
  const reports = Array.isArray(value.reports)
    ? value.reports.map((entry) => normalizeReport(entry)).filter((entry): entry is UnderTheHoodReport => entry !== null)
    : [];
  const unique = new Map(reports.map((entry) => [entry.id, entry]));
  return {
    version: UNDER_THE_HOOD_STORE_VERSION,
    reports: [...unique.values()].sort(compareReports).slice(-limit)
  };
}

function normalizeReport(value: unknown): UnderTheHoodReport | null {
  if (!isRecord(value) || value.source !== "x-under-the-hood") return null;
  const period = parsePeriod(value, []);
  if (!period) return null;
  const postLabels = parsePostLabels(firstArray(value, ["postLabels"]), []);
  const accountLabels = parseAccountLabels(firstArray(value, ["accountLabels"]), []);
  const postCount = nonNegativeInteger(value.postCount);
  if (postCount === null) return null;
  return {
    id: reportId(period),
    source: "x-under-the-hood",
    importedAt: parseTimestamp(value.importedAt, []) ?? new Date(0).toISOString(),
    generatedAt: parseTimestamp(value.generatedAt, []),
    period,
    postCount,
    postLabels,
    accountLabels,
    totalPostLabels: postLabels.length,
    totalAccountLabels: accountLabels.length,
    notes: boundedText(value.notes, MAX_TEXT_LENGTH)
  };
}

function cloneState(state: UnderTheHoodStoreState): UnderTheHoodStoreState {
  return { version: UNDER_THE_HOOD_STORE_VERSION, reports: state.reports.map(cloneReport) };
}

function cloneReport(report: UnderTheHoodReport): UnderTheHoodReport {
  return {
    ...report,
    period: { ...report.period },
    postLabels: report.postLabels.map((entry) => ({ ...entry })),
    accountLabels: report.accountLabels.map((entry) => ({ ...entry, activeDays: [...entry.activeDays] }))
  };
}

function compareReports(left: UnderTheHoodReport, right: UnderTheHoodReport): number {
  return left.period.startDate.localeCompare(right.period.startDate) || left.id.localeCompare(right.id);
}

function reportId(period: UnderTheHoodPeriod): string {
  return `uth-${period.startDate}-${period.endDate}`;
}

function parseTimestamp(value: unknown, warnings: string[]): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    warnings.push("A timestamp was ignored because it was not a date value.");
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    warnings.push("A timestamp was ignored because it was not a valid date.");
    return null;
  }
  return date.toISOString();
}

function normalizeDateOnly(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function monthDates(value: unknown): UnderTheHoodPeriod | null {
  let month: string;
  if (typeof value === "number" && Number.isInteger(value)) {
    month = String(value);
  } else if (typeof value === "string") {
    month = value.trim().replace(/[^0-9]/g, "");
  } else {
    return null;
  }
  if (!/^\d{6}$/.test(month)) return null;
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(4));
  if (monthNumber < 1 || monthNumber > 12) return null;
  const last = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return {
    startDate: `${month.slice(0, 4)}-${month.slice(4)}-01`,
    endDate: last,
    timezone: "UTC"
  };
}

function percentage(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Number(value.replace(/%/g, "").trim());
    if (Number.isFinite(parsed)) return clamp(parsed, 0, 100);
  }
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 100) : 0;
}

function normalizeActiveDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry >= 1 && entry <= 31))].sort((a, b) => a - b);
}

function boundedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, limit) : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function firstArray(value: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
  return [];
}

function firstValue(value: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key];
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
