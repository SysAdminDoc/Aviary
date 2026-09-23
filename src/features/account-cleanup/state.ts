export const ACCOUNT_CLEANUP_KEY = "aviary.accountCleanup.v1";
export const ACCOUNT_CLEANUP_TAB_TOKEN_KEY = "aviary.accountCleanup.tabToken.v1";

export const ACCOUNT_CLEANUP_CATEGORIES = [
  "bookmarks",
  "likes",
  "reposts",
  "replies",
  "posts"
] as const;

export type AccountCleanupCategory = (typeof ACCOUNT_CLEANUP_CATEGORIES)[number];
export type AccountCleanupMode = "preview" | "cleanup";
export type AccountCleanupPacing = "careful" | "balanced" | "brisk";
export type AccountCleanupRunStatus = "running" | "paused" | "blocked" | "complete" | "stopped";

export interface AccountCleanupCategoryDefinition {
  readonly label: string;
  readonly description: string;
  readonly route: (handle: string) => string;
  readonly acceptedRoutes: (handle: string) => readonly string[];
}

export const ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS: Record<
  AccountCleanupCategory,
  AccountCleanupCategoryDefinition
> = {
  bookmarks: {
    label: "Bookmarks",
    description: "Remove saved posts from X History.",
    route: () => "/i/history",
    acceptedRoutes: () => ["/i/history", "/i/bookmarks"]
  },
  likes: {
    label: "Likes",
    description: "Remove likes from X History.",
    route: () => "/i/history/likes",
    acceptedRoutes: (handle) => ["/i/history/likes", `/${handle}/likes`]
  },
  reposts: {
    label: "Reposts",
    description: "Undo reposts from your Reposts tab.",
    route: (handle) => `/${handle}/reposts`,
    acceptedRoutes: (handle) => [`/${handle}/reposts`]
  },
  replies: {
    label: "Replies",
    description: "Delete replies written by you without touching parent posts.",
    route: (handle) => `/${handle}/with_replies`,
    acceptedRoutes: (handle) => [`/${handle}/with_replies`]
  },
  posts: {
    label: "Posts",
    description: "Delete posts and quote posts written by you.",
    route: (handle) => `/${handle}`,
    acceptedRoutes: (handle) => [`/${handle}`]
  }
};

export interface AccountCleanupPacingDefinition {
  readonly label: string;
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  readonly batchSize: number;
  readonly batchPauseMs: number;
}

export const ACCOUNT_CLEANUP_PACING: Record<
  AccountCleanupPacing,
  AccountCleanupPacingDefinition
> = {
  careful: {
    label: "Careful",
    minDelayMs: 2_000,
    maxDelayMs: 3_500,
    batchSize: 40,
    batchPauseMs: 20_000
  },
  balanced: {
    label: "Balanced",
    minDelayMs: 1_000,
    maxDelayMs: 1_800,
    batchSize: 60,
    batchPauseMs: 12_000
  },
  brisk: {
    label: "Brisk",
    minDelayMs: 400,
    maxDelayMs: 900,
    batchSize: 80,
    batchPauseMs: 6_000
  }
};

export const ACCOUNT_CLEANUP_TIMING = {
  actionTimeoutMs: 8_000,
  menuTimeoutMs: 2_500,
  scrollPauseMs: 1_600,
  idleScrollLimit: 14,
  maxScrollsWithoutAction: 60,
  /** Consecutive stale outcomes for one item before it counts as a failed action. */
  staleRetryLimit: 3,
  /** How long the signed-in handle may stay unreadable mid-pass before the run blocks. */
  missingHandleLimitMs: 12_000,
  missingHandlePollMs: 500,
  requiredEmptyVerificationPasses: 1,
  likeRateWindowActionLimit: 500,
  likeRateWindowMs: 15 * 60_000,
  rateWindowGraceMs: 5_000,
  recoveryFailureThreshold: 2,
  maxPageRecoveryAttempts: 5,
  recoveryPauseBaseMs: 30_000,
  recoveryPauseMaxMs: 300_000,
  failureBackoffBaseMs: 4_000,
  failureBackoffMaxMs: 90_000,
  leaseMs: 30_000,
  leaseRenewMs: 10_000
} as const;

export interface AccountCleanupSettings {
  mode: AccountCleanupMode;
  categories: Record<AccountCleanupCategory, boolean>;
  pacing: AccountCleanupPacing;
  maxActions: number;
}

export interface AccountCleanupCategoryStats {
  completed: number;
  previewed: number;
  failed: number;
  skipped: number;
}

export interface AccountCleanupRun {
  schema: 1;
  id: string;
  ownerId: string;
  account: string;
  status: AccountCleanupRunStatus;
  phase: string;
  reason: string | null;
  plan: AccountCleanupCategory[];
  stepIndex: number;
  settings: AccountCleanupSettings;
  stats: Record<AccountCleanupCategory, AccountCleanupCategoryStats>;
  processed: Record<AccountCleanupCategory, string[]>;
  failures: Record<string, number>;
  pageRecoveryAttempts: number;
  categoryVerificationPasses: number;
  likeRateWindowStartedAt: number | null;
  likeRateWindowActions: number;
  actionsThisSession: number;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  leaseUntil: number;
}

export interface AccountCleanupStatus {
  activeHandle: string | null;
  run: AccountCleanupRun | null;
  runningInThisTab: boolean;
  /** English rendering of `copy`, for diagnostics and anything that cannot translate. */
  message: string;
  copy: AccountCleanupCopy;
}

/**
 * A status sentence in its English catalog form plus the values it fills in. The panel translates
 * `text` and labels any `category` value in the reader's language. tools/i18n-extract.mjs harvests
 * the string literal at every cleanupCopy call site, which is why the first argument is always a
 * plain string.
 */
export interface AccountCleanupCopy {
  text: string;
  values?: Record<string, string | number>;
}

export function cleanupCopy(text: string, values?: Record<string, string | number>): AccountCleanupCopy {
  return values ? { text, values } : { text };
}

/**
 * Fills a copy's placeholders. `category` and `categoryLower` carry a category id, rendered as that
 * category's label so a translated sentence never embeds an English one.
 */
export function formatAccountCleanupCopy(
  copy: AccountCleanupCopy,
  translate: (text: string) => string = (text) => text
): string {
  const values = localizeAccountCleanupValues(copy, translate);
  return translate(copy.text).replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    values[key] === undefined ? placeholder : String(values[key])
  );
}

/** The copy's values with category ids replaced by their labels in the reader's language. */
export function localizeAccountCleanupValues(
  copy: AccountCleanupCopy,
  translate: (text: string) => string = (text) => text
): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(copy.values ?? {})) {
    if ((key === "category" || key === "categoryLower") && isAccountCleanupCategory(value)) {
      // Both forms are always supplied: a translation may capitalize where English does not,
      // German nouns for one, so it can name either placeholder.
      const label = translate(ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS[value].label);
      values.category ??= label;
      values.categoryLower ??= label.toLocaleLowerCase();
    } else {
      values[key] = value;
    }
  }
  return values;
}

export interface AccountCleanupStartOptions {
  categories: Record<AccountCleanupCategory, boolean>;
  pacing: AccountCleanupPacing;
  maxActions: number;
}

export interface AccountCleanupCommandResult {
  ok: boolean;
  reason?: string;
}

const RESERVED_PATHS = new Set([
  "compose",
  "explore",
  "home",
  "i",
  "messages",
  "notifications",
  "search",
  "settings"
]);

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,30}$/;

export function normalizeAccountCleanupHandle(value: unknown): string | null {
  const candidate = String(value ?? "").trim().replace(/^@/, "");
  if (!HANDLE_PATTERN.test(candidate)) return null;
  if (RESERVED_PATHS.has(candidate.toLocaleLowerCase())) return null;
  return candidate;
}

export function accountCleanupHandleFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const parsed = new URL(href, "https://x.com");
    return normalizeAccountCleanupHandle(parsed.pathname.split("/").filter(Boolean)[0]);
  } catch {
    return null;
  }
}

export function readActiveAccountHandle(documentObject: Document = document): string | null {
  const profileLink = documentObject.querySelector<HTMLAnchorElement>(
    'a[data-testid="AppTabBar_Profile_Link"]'
  );
  const fromProfileLink = accountCleanupHandleFromHref(profileLink?.getAttribute("href"));
  if (fromProfileLink) return fromProfileLink;

  const accountSwitcher = documentObject.querySelector<HTMLElement>(
    '[data-testid="SideNav_AccountSwitcher_Button"]'
  );
  const handleText = accountSwitcher?.textContent?.match(/@([A-Za-z0-9_]{1,30})/);
  return normalizeAccountCleanupHandle(handleText?.[1]);
}

export function sameAccountCleanupHandle(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left.toLocaleLowerCase() === right.toLocaleLowerCase());
}

export function accountCleanupRouteFor(category: AccountCleanupCategory, handle: string): string {
  return ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS[category].route(handle);
}

export function accountCleanupRouteMatches(
  category: AccountCleanupCategory,
  handle: string,
  pathname: string
): boolean {
  const normalized = normalizePath(pathname).toLocaleLowerCase();
  return ACCOUNT_CLEANUP_CATEGORY_DEFINITIONS[category].acceptedRoutes(handle).some(
    (route) => normalizePath(route).toLocaleLowerCase() === normalized
  );
}

/** Nothing is selected until the reader chooses: Run starts deleting with no confirmation step. */
export function defaultAccountCleanupCategories(): Record<AccountCleanupCategory, boolean> {
  return Object.fromEntries(
    ACCOUNT_CLEANUP_CATEGORIES.map((category) => [category, false])
  ) as Record<AccountCleanupCategory, boolean>;
}

export function normalizeAccountCleanupSettings(value: unknown): AccountCleanupSettings {
  const source = value && typeof value === "object"
    ? value as Partial<AccountCleanupSettings>
    : {};
  const categories = Object.fromEntries(
    ACCOUNT_CLEANUP_CATEGORIES.map((category) => [
      category,
      source.categories?.[category] === true
    ])
  ) as Record<AccountCleanupCategory, boolean>;
  const pacing = source.pacing && source.pacing in ACCOUNT_CLEANUP_PACING
    ? source.pacing
    : "balanced";
  return {
    mode: source.mode === "cleanup" ? "cleanup" : "preview",
    categories,
    pacing,
    maxActions: clampInteger(source.maxActions, 0, 100_000, 0)
  };
}

export function createAccountCleanupStats(): Record<
  AccountCleanupCategory,
  AccountCleanupCategoryStats
> {
  return Object.fromEntries(
    ACCOUNT_CLEANUP_CATEGORIES.map((category) => [category, {
      completed: 0,
      previewed: 0,
      failed: 0,
      skipped: 0
    }])
  ) as Record<AccountCleanupCategory, AccountCleanupCategoryStats>;
}

export function normalizeAccountCleanupRun(value: unknown): AccountCleanupRun | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<AccountCleanupRun>;
  if (source.schema !== 1) return null;
  const account = normalizeAccountCleanupHandle(source.account);
  if (!account || typeof source.id !== "string" || typeof source.ownerId !== "string") return null;

  const settings = normalizeAccountCleanupSettings(source.settings);
  const plan = Array.isArray(source.plan)
    ? source.plan.filter(isAccountCleanupCategory)
    : [];
  const stats = createAccountCleanupStats();
  for (const category of ACCOUNT_CLEANUP_CATEGORIES) {
    const incoming = source.stats?.[category];
    stats[category] = {
      completed: clampInteger(incoming?.completed, 0, 10_000_000, 0),
      previewed: clampInteger(incoming?.previewed, 0, 10_000_000, 0),
      failed: clampInteger(incoming?.failed, 0, 10_000_000, 0),
      skipped: clampInteger(incoming?.skipped, 0, 10_000_000, 0)
    };
  }
  const processed = Object.fromEntries(
    ACCOUNT_CLEANUP_CATEGORIES.map((category) => {
      const ids = Array.isArray(source.processed?.[category])
        ? source.processed[category]
            .filter((id) => /^\d+$/.test(String(id)))
            .map(String)
            .slice(-5_000)
        : [];
      return [category, [...new Set(ids)]];
    })
  ) as Record<AccountCleanupCategory, string[]>;
  const failures = Object.fromEntries(
    Object.entries(source.failures ?? {})
      .filter(([key]) => /^(bookmarks|likes|reposts|replies|posts):\d+$/.test(key))
      .slice(-2_000)
      .map(([key, attempts]) => [key, clampInteger(attempts, 0, 20, 0)] as const)
      .filter(([, attempts]) => attempts > 0)
  );
  const status = isAccountCleanupStatus(source.status) ? source.status : "paused";
  return {
    schema: 1,
    id: source.id,
    ownerId: source.ownerId,
    account,
    status,
    phase: typeof source.phase === "string" ? source.phase : "idle",
    reason: typeof source.reason === "string" ? source.reason : null,
    plan,
    stepIndex: clampInteger(source.stepIndex, 0, plan.length, 0),
    settings,
    stats,
    processed,
    failures,
    pageRecoveryAttempts: clampInteger(
      source.pageRecoveryAttempts,
      0,
      ACCOUNT_CLEANUP_TIMING.maxPageRecoveryAttempts,
      0
    ),
    categoryVerificationPasses: clampInteger(
      source.categoryVerificationPasses,
      0,
      ACCOUNT_CLEANUP_TIMING.requiredEmptyVerificationPasses,
      0
    ),
    likeRateWindowStartedAt: source.likeRateWindowStartedAt === null
      ? null
      : finiteNumber(source.likeRateWindowStartedAt, null),
    likeRateWindowActions: clampInteger(
      source.likeRateWindowActions,
      0,
      ACCOUNT_CLEANUP_TIMING.likeRateWindowActionLimit,
      0
    ),
    actionsThisSession: clampInteger(source.actionsThisSession, 0, 10_000_000, 0),
    startedAt: finiteNumber(source.startedAt, Date.now()),
    updatedAt: finiteNumber(source.updatedAt, Date.now()),
    finishedAt: source.finishedAt === null ? null : finiteNumber(source.finishedAt, null),
    leaseUntil: finiteNumber(source.leaseUntil, 0)
  };
}

export function createAccountCleanupRun(input: {
  account: string;
  ownerId: string;
  mode: AccountCleanupMode;
  options: AccountCleanupStartOptions;
  now?: number;
}): AccountCleanupRun {
  const now = input.now ?? Date.now();
  const settings = normalizeAccountCleanupSettings({
    ...input.options,
    mode: input.mode
  });
  const plan = ACCOUNT_CLEANUP_CATEGORIES.filter((category) => settings.categories[category]);
  return {
    schema: 1,
    id: createAccountCleanupToken(),
    ownerId: input.ownerId,
    account: normalizeAccountCleanupHandle(input.account) ?? input.account,
    status: "running",
    phase: "starting",
    reason: null,
    plan,
    stepIndex: 0,
    settings,
    stats: createAccountCleanupStats(),
    processed: Object.fromEntries(
      ACCOUNT_CLEANUP_CATEGORIES.map((category) => [category, [] as string[]])
    ) as Record<AccountCleanupCategory, string[]>,
    failures: {},
    pageRecoveryAttempts: 0,
    categoryVerificationPasses: 0,
    likeRateWindowStartedAt: null,
    likeRateWindowActions: 0,
    actionsThisSession: 0,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    leaseUntil: now + ACCOUNT_CLEANUP_TIMING.leaseMs
  };
}

export function accountCleanupNeedsResume(value: unknown): boolean {
  const run = normalizeAccountCleanupRun(value);
  if (!run || run.status !== "running") return false;
  return readAccountCleanupTabToken() === run.ownerId;
}

export function readAccountCleanupTabToken(
  storage?: Storage
): string | null {
  try {
    return (storage ?? globalThis.sessionStorage)?.getItem(ACCOUNT_CLEANUP_TAB_TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeAccountCleanupTabToken(
  token: string | null,
  storage?: Storage
): void {
  try {
    const target = storage ?? globalThis.sessionStorage;
    if (token) target?.setItem(ACCOUNT_CLEANUP_TAB_TOKEN_KEY, token);
    else target?.removeItem(ACCOUNT_CLEANUP_TAB_TOKEN_KEY);
  } catch {
    // Session storage can be disabled. The current page can still finish its pass.
  }
}

export function createAccountCleanupToken(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function clearAccountCleanupTransientState(run: AccountCleanupRun): void {
  for (const category of ACCOUNT_CLEANUP_CATEGORIES) run.processed[category] = [];
  run.failures = {};
  run.pageRecoveryAttempts = 0;
  run.categoryVerificationPasses = 0;
  run.likeRateWindowStartedAt = null;
  run.likeRateWindowActions = 0;
  run.leaseUntil = 0;
}

function normalizePath(pathname: string): string {
  const withoutTrailingSlash = String(pathname || "/").replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}

function isAccountCleanupCategory(value: unknown): value is AccountCleanupCategory {
  return typeof value === "string" && ACCOUNT_CLEANUP_CATEGORIES.includes(
    value as AccountCleanupCategory
  );
}

function isAccountCleanupStatus(value: unknown): value is AccountCleanupRunStatus {
  return value === "running" || value === "paused" || value === "blocked" ||
    value === "complete" || value === "stopped";
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)));
}

function finiteNumber(value: unknown, fallback: number): number;
function finiteNumber(value: unknown, fallback: null): number | null;
function finiteNumber(value: unknown, fallback: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
