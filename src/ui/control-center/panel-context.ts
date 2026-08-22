import type {
  AviarySettings,
  FilterAction,
  FilterSurface,
  MediaLayout,
  ReduceMotionMode
} from "../../platform/settings.ts";
import type { LibraryBackupPreview } from "../../features/core/library-backup.ts";
import type { RuleSetImportPreview } from "../../features/filtering/rules.ts";
import type { ControlCenterOptions } from "../control-center.ts";

export type LocalizedCopy =
  | string
  | {
      source: string;
      values: Record<string, string | number>;
    };

export type DraftRollback = () => Promise<void>;
export type DraftCommit = Promise<void> | Promise<DraftRollback>;
export type RowCommitMode = "page" | "action";

export interface PanelState {
  bookmarkQuery: string;
  libraryQuery: string;
  unifiedSemantic: boolean;
  pendingFilterRuleImport: string;
  pendingFilterRulePreview: RuleSetImportPreview | null;
  pendingLibraryBackupPayload: string | null;
  pendingLibraryBackupPreview: LibraryBackupPreview | null;
  libraryRestoreRunning: boolean;
  libraryRestoreAbort: AbortController | null;
}

export interface PanelContext {
  readonly options: ControlCenterOptions;
  readonly settings: AviarySettings;
  readonly state: PanelState;
  readonly t: (text: string) => string;
  readonly formatCopy: (template: string, values: Record<string, string | number>) => string;
  readonly localizedCopy: (source: string, values: Record<string, string | number>) => string;
  readonly setStatus: (message: string) => void;
  readonly setStatusCopy: (source: string, values: Record<string, string | number>) => void;
  readonly save: (message: string) => Promise<void>;
  readonly render: () => void;
  readonly guardDraft: () => boolean;
  readonly actionRow: (
    label: string,
    description: LocalizedCopy,
    onClick: () => Promise<void>,
    failureMessage?: string
  ) => HTMLElement;
  readonly toggleRow: (
    label: string,
    description: string,
    checked: boolean,
    onChange: (checked: boolean) => Promise<void>
  ) => HTMLElement;
  readonly selectRow: (
    label: string,
    value: string,
    options: Array<[string, string]>,
    onChange: (value: string) => Promise<void>,
    description?: string,
    translateOptions?: boolean,
    mode?: RowCommitMode
  ) => HTMLElement;
  readonly readonlyRow: (label: string, value: string) => HTMLElement;
  readonly dataRow: (label: string, value: string) => HTMLElement;
  readonly textInputRow: (
    label: string,
    description: string,
    value: string,
    onChange: (value: string) => DraftCommit,
    mode?: RowCommitMode,
    actionLabel?: string
  ) => HTMLElement;
  readonly secretInputRow: (
    label: string,
    description: string,
    value: string,
    onChange: (value: string) => DraftCommit,
    mode?: RowCommitMode
  ) => HTMLElement;
  readonly integerInputRow: (
    label: string,
    description: string,
    value: number,
    onChange: (value: number) => DraftCommit,
    bounds?: { min?: number; max?: number },
    mode?: RowCommitMode,
    actionLabel?: string
  ) => HTMLElement;
  readonly textareaRow: (
    label: string,
    description: string,
    lines: string[],
    onChange: (lines: string[]) => DraftCommit,
    actionLabel?: string,
    mode?: RowCommitMode
  ) => HTMLElement;
  readonly surfaceRow: (
    label: string,
    description: string,
    selected: FilterSurface[],
    onChange: (next: FilterSurface[]) => Promise<void>
  ) => HTMLElement;
  readonly bookmarkField: (label: string, value: string, placeholder: string) => HTMLInputElement;
  readonly splitBookmarkTags: (value: string) => string[];
  readonly toDatetimeLocal: (value: string | null) => string;
  readonly fromDatetimeLocal: (value: string) => string | null;
  readonly coerceReduceMotion: (value: string) => ReduceMotionMode;
  readonly coerceFilterAction: (value: string) => FilterAction;
  readonly coerceLayout: (value: string) => MediaLayout;
  readonly formatBytes: (value: number) => string;
  readonly defaultAiEndpoint: (provider: string) => string;
  readonly isThemeId: (value: string) => value is AviarySettings["appearance"]["theme"];
  readonly el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string
  ) => HTMLElementTagNameMap[K];
  readonly button: (label: string, className: string) => HTMLButtonElement;
  readonly presetIcon: (id: string) => SVGSVGElement;
  readonly coverageRow: () => HTMLElement;
  readonly storageHealthRow: () => HTMLElement;
  readonly storageStatusRow: () => HTMLElement;
  readonly beaconRows: () => HTMLElement[];
  readonly pageScopeReason: (code: string) => string;
  readonly selectorHealthRows: () => HTMLElement[];
  readonly selectorSummary: () => string;
}
