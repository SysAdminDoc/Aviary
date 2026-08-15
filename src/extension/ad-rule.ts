export const AD_RULE_SYNC_MESSAGE = "AVIARY_SYNC_AD_RULE";
export const AD_LOGGER_RULE_ID = 73_001;
export const AD_LOGGER_STATE_KEY = "aviary.runtime.adLoggerRule.v1";

export interface DynamicNetRequestRule {
  id: number;
  priority: number;
  action: { type: "block" };
  condition: {
    regexFilter: string;
    requestDomains: string[];
    resourceTypes: string[];
  };
}

export interface ExtensionAdRuleApi {
  runtime?: {
    sendMessage?: (message: unknown) => Promise<unknown>;
  };
  declarativeNetRequest?: {
    updateDynamicRules(options: {
      removeRuleIds: number[];
      addRules: DynamicNetRequestRule[];
    }): Promise<void>;
  };
  storage?: {
    local?: {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

export interface AdRuleSyncMessage {
  type: typeof AD_RULE_SYNC_MESSAGE;
  enabled: boolean;
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

export function isAdRuleSyncMessage(value: unknown): value is AdRuleSyncMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AdRuleSyncMessage>;
  return candidate.type === AD_RULE_SYNC_MESSAGE && typeof candidate.enabled === "boolean";
}

/** Atomically replaces Aviary's one owned dynamic rule and mirrors the applied state. */
export async function syncDynamicAdRule(
  api: ExtensionAdRuleApi,
  enabled: boolean
): Promise<void> {
  const dnr = api.declarativeNetRequest;
  if (!dnr?.updateDynamicRules) {
    throw new Error("declarativeNetRequest is unavailable");
  }
  await dnr.updateDynamicRules({
    removeRuleIds: [AD_LOGGER_RULE_ID],
    addRules: enabled ? [AD_LOGGER_RULE] : []
  });

  const storage = api.storage?.local;
  if (!storage?.set) {
    throw new Error("extension storage is unavailable");
  }
  await storage.set({ [AD_LOGGER_STATE_KEY]: enabled });
}

/** Re-applies the last content-script decision after a browser or event-page restart. */
export async function restoreDynamicAdRule(
  api: ExtensionAdRuleApi
): Promise<boolean | null> {
  const storage = api.storage?.local;
  if (!storage?.get) {
    return null;
  }
  const stored = await storage.get(AD_LOGGER_STATE_KEY);
  const enabled = stored[AD_LOGGER_STATE_KEY];
  if (typeof enabled !== "boolean") {
    return null;
  }
  await syncDynamicAdRule(api, enabled);
  return enabled;
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
