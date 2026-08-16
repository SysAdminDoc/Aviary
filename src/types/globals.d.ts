declare global {
  var GM_getValue: (<T>(key: string, defaultValue: T) => T | Promise<T>) | undefined;
  var GM_setValue: (<T>(key: string, value: T) => void | Promise<void>) | undefined;
  var GM_deleteValue: ((key: string) => void | Promise<void>) | undefined;
  var GM_download:
    | ((options: {
        url: string;
        name: string;
        onload?: () => void;
        onerror?: (error: unknown) => void;
        ontimeout?: () => void;
      }) => unknown)
    | undefined;

  interface TrustedTypePolicyFactory {
    createPolicy(name: string, rules: TrustedTypePolicyOptions): TrustedTypePolicy;
  }

  interface TrustedTypePolicyOptions {
    createHTML?: (input: string) => string;
  }

  interface TrustedTypePolicy {
    createHTML(input: string): TrustedHTML;
  }

  interface TrustedHTML {
    toString(): string;
  }

  interface Window {
    trustedTypes?: TrustedTypePolicyFactory;
  }

  var chrome: {
    runtime?: {
      id?: string;
      getManifest?: () => { name?: string; version?: string };
      openOptionsPage?: () => Promise<void>;
      onInstalled?: {
        addListener(listener: (details?: { reason?: string }) => void): void;
      };
      onStartup?: {
        addListener(listener: () => void): void;
      };
      onMessage?: {
        addListener(
          listener: (
            message: unknown,
            sender: unknown,
            sendResponse: (response?: unknown) => void
          ) => boolean | void
        ): void;
        removeListener(
          listener: (
            message: unknown,
            sender: unknown,
            sendResponse: (response?: unknown) => void
          ) => boolean | void
        ): void;
      };
      sendMessage?: (message: unknown) => Promise<unknown>;
      lastError?: { message?: string };
    };
    storage?: {
      local?: {
        get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
        remove(keys: string | string[]): Promise<void>;
      };
    };
    declarativeNetRequest?: {
      updateDynamicRules(options: {
        removeRuleIds: number[];
        addRules: Array<{
          id: number;
          priority: number;
          action: { type: "block" };
          condition: { regexFilter: string; requestDomains: string[]; resourceTypes: string[] };
        }>;
      }): Promise<void>;
    };
    downloads?: {
      download(options: { url: string; filename?: string; conflictAction?: "uniquify" | "overwrite" | "prompt" }): Promise<number>;
      onChanged?: {
        addListener(
          listener: (delta: {
            id: number;
            state?: { current?: "in_progress" | "interrupted" | "complete" };
          }) => void
        ): void;
      };
    };
    permissions?: {
      contains(permissions: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
      request(permissions: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
      remove(permissions: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
    };
    action?: {
      onClicked?: {
        addListener(listener: () => void): void;
      };
    };
    contextMenus?: {
      create(
        properties: {
          id: string;
          title: string;
          contexts?: string[];
          documentUrlPatterns?: string[];
        },
        callback?: () => void
      ): string | number;
      removeAll(callback?: () => void): void | Promise<void>;
      onClicked?: {
        addListener(
          listener: (
            info: { menuItemId: string | number; mediaType?: string; srcUrl?: string },
            tab?: { id?: number }
          ) => void
        ): void;
      };
    };
    tabs?: {
      sendMessage(tabId: number, message: unknown): Promise<unknown>;
    };
  } | undefined;
}

export {};
