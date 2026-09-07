export const AD_RULE_SYNC_MESSAGE = "AVIARY_SYNC_AD_RULE";
/**
 * The id used by the pre-1.48 dynamic rule. It is retired, but kept so upgrades can remove it.
 * Session rules use the browser tab id as their own id and never share this global rule.
 */
export const AD_LOGGER_RULE_ID = 73_001;
export const AD_LOGGER_SESSION_RULE_ID_MAX = 2_147_483_647;
export const AD_LOGGER_STATE_KEY = "aviary.runtime.adLoggerRule.v1";

export interface DynamicNetRequestRule {
  id: number;
  priority: number;
  action: { type: "block" };
  condition: {
    regexFilter: string;
    requestDomains: string[];
    resourceTypes: string[];
    tabIds?: number[];
  };
}

export interface ExtensionAdRuleApi {
  runtime?: {
    sendMessage?: (message: unknown) => Promise<unknown>;
  };
  declarativeNetRequest?: {
    updateSessionRules?(options: {
      removeRuleIds: number[];
      addRules: DynamicNetRequestRule[];
    }): Promise<void>;
    updateDynamicRules?(options: {
      removeRuleIds: number[];
      addRules: DynamicNetRequestRule[];
    }): Promise<void>;
    getSessionRules?(): Promise<DynamicNetRequestRule[]>;
  };
  storage?: {
    local?: {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove?(keys: string | string[]): Promise<void>;
    };
  };
}

export interface AdRuleSyncMessage {
  type: typeof AD_RULE_SYNC_MESSAGE;
  enabled: boolean;
  /** Optional privileged-page target. Content scripts rely on sender.tab instead. */
  tabId?: number;
}

export interface AdRuleSyncResult {
  ok: boolean;
  enabled: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Browser-owned parity for the page-world promoted-content logger guard.
 *
 * Native sponsored records share HomeTimeline with organic posts, so the mixed GraphQL transport
 * must remain reachable. This rule covers only the independently requestable logger, on the same
 * exact X/Twitter hosts and path as `page-agent.ts`, and only for request-like resource classes.
 */
export const AD_LOGGER_RULE: DynamicNetRequestRule = {
  id: AD_LOGGER_RULE_ID,
  priority: 1,
  action: { type: "block" },
  condition: {
    regexFilter: "^https://[^/]+/i/api/1[.]1/promoted_content/log[.]json([?].*)?$",
    requestDomains: [
      "x.com",
      "www.x.com",
      "twitter.com",
      "www.twitter.com",
      "pro.x.com",
    ],
    resourceTypes: ["xmlhttprequest", "ping", "other"]
  }
};

/**
 * DNR rule ids are scoped to a ruleset, so a tab id is a stable, collision-free owner for one
 * session rule. Chrome and Firefox both expose non-negative integer tab ids; tab 0 maps to rule 1
 * because DNR reserves zero. Keeping the mapping deterministic lets a service-worker restart
 * update or remove a rule without a second durable allocation table.
 */
export function adLoggerRuleIdForTab(tabId: number): number {
  const normalized = validateTabId(tabId);
  return normalized === 0 ? 1 : normalized;
}

/** Creates the one rule that is allowed to exist for a particular tab. */
export function createAdLoggerSessionRule(tabId: number): DynamicNetRequestRule {
  const normalized = validateTabId(tabId);
  return {
    ...AD_LOGGER_RULE,
    id: adLoggerRuleIdForTab(normalized),
    condition: {
      ...AD_LOGGER_RULE.condition,
      tabIds: [normalized]
    }
  };
}

export function isAdRuleSyncMessage(value: unknown): value is AdRuleSyncMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AdRuleSyncMessage>;
  return (
    candidate.type === AD_RULE_SYNC_MESSAGE &&
    typeof candidate.enabled === "boolean" &&
    (candidate.tabId === undefined || isValidTabId(candidate.tabId))
  );
}

let sessionMutationTail: Promise<void> = Promise.resolve();

/** Serializes session-rule writes so a prune cannot erase a concurrent tab enable. */
function enqueueSessionMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = sessionMutationTail.then(task);
  sessionMutationTail = run.then(() => undefined, () => undefined);
  return run;
}

/** Atomically replaces this tab's session rule. The setting never becomes extension-global. */
export function syncSessionAdRule(
  api: ExtensionAdRuleApi,
  tabId: number,
  enabled: boolean
): Promise<void> {
  const normalized = validateTabId(tabId);
  const ruleId = adLoggerRuleIdForTab(normalized);
  return enqueueSessionMutation(async () => {
    const dnr = api.declarativeNetRequest;
    if (!dnr?.updateSessionRules) {
      throw new Error("declarativeNetRequest session rules are unavailable");
    }
    await dnr.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: enabled ? [createAdLoggerSessionRule(normalized)] : []
    });
  });
}

/** Removes one tab's session rule after navigation, profile switch, or tab close. */
export function clearSessionAdRule(api: ExtensionAdRuleApi, tabId: number): Promise<void> {
  const ruleId = adLoggerRuleIdForTab(tabId);
  return enqueueSessionMutation(async () => {
    const dnr = api.declarativeNetRequest;
    if (!dnr?.updateSessionRules) {
      throw new Error("declarativeNetRequest session rules are unavailable");
    }
    await dnr.updateSessionRules({ removeRuleIds: [ruleId], addRules: [] });
  });
}

/**
 * Removes stale Aviary session rules after a worker restart. The caller supplies the currently
 * open tab ids, so a closed tab cannot leave a blocker behind even if its close event was missed.
 */
export function pruneSessionAdRules(
  api: ExtensionAdRuleApi,
  liveTabIds: readonly number[]
): Promise<number> {
  const live = new Set(liveTabIds.filter(isValidTabId));
  return enqueueSessionMutation(async () => {
    const dnr = api.declarativeNetRequest;
    if (!dnr?.getSessionRules || !dnr.updateSessionRules) {
      return 0;
    }
    const rules = await dnr.getSessionRules();
    const removeRuleIds = rules
      .filter((rule) => {
        const tabId = ownedRuleTabId(rule);
        return tabId !== null && !live.has(tabId);
      })
      .map((rule) => rule.id);
    if (removeRuleIds.length === 0) {
      return 0;
    }
    await dnr.updateSessionRules({ removeRuleIds, addRules: [] });
    return removeRuleIds.length;
  }).then((count) => count);
}

/** Removes the pre-1.48 global dynamic rule and its global state mirror during upgrade/startup. */
export async function removeLegacyDynamicAdRule(api: ExtensionAdRuleApi): Promise<void> {
  const dnr = api.declarativeNetRequest;
  if (dnr?.updateDynamicRules) {
    await dnr.updateDynamicRules({
      removeRuleIds: [AD_LOGGER_RULE_ID],
      addRules: []
    });
  }
  const storage = api.storage?.local;
  if (storage?.remove) {
    await storage.remove(AD_LOGGER_STATE_KEY);
  }
}

/** Returns the tab id encoded by an Aviary-owned session rule, or null for unrelated rules. */
function ownedRuleTabId(rule: DynamicNetRequestRule): number | null {
  const tabIds = rule.condition?.tabIds;
  if (
    !Array.isArray(tabIds) ||
    tabIds.length !== 1 ||
    !isValidTabId(tabIds[0]) ||
    rule.condition.regexFilter !== AD_LOGGER_RULE.condition.regexFilter ||
    rule.action?.type !== "block"
  ) {
    return null;
  }
  return tabIds[0]!;
}

function isValidTabId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= AD_LOGGER_SESSION_RULE_ID_MAX
  );
}

function validateTabId(value: number): number {
  if (!isValidTabId(value)) {
    throw new Error("tab id must be a non-negative safe integer");
  }
  return value;
}

/**
 * Sends the normalized active-profile preference to the extension background.
 * Userscripts keep their document-start page-world guard and never cross this boundary.
 */
export async function requestExtensionAdRuleSync(
  source: "userscript" | "extension",
  enabled: boolean
): Promise<AdRuleSyncResult> {
  if (source !== "extension") {
    return { ok: true, enabled, skipped: true };
  }

  const api = globalThis.chrome as unknown as ExtensionAdRuleApi | undefined;
  const sendMessage = api?.runtime?.sendMessage;
  if (typeof sendMessage !== "function") {
    return { ok: false, enabled, error: "extension messaging is unavailable" };
  }

  try {
    const response = await sendMessage({ type: AD_RULE_SYNC_MESSAGE, enabled });
    if (!response || typeof response !== "object") {
      return { ok: false, enabled, error: "background returned no ad-rule status" };
    }
    const result = response as Partial<AdRuleSyncResult>;
    if (result.ok === true && result.enabled === enabled) {
      return { ok: true, enabled };
    }
    return {
      ok: false,
      enabled,
      error: typeof result.error === "string" ? result.error : "background rejected the ad-rule state"
    };
  } catch (error) {
    return { ok: false, enabled, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
