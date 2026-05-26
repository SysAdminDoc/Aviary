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
      onInstalled?: {
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
      };
      sendMessage?: (message: unknown) => Promise<unknown>;
    };
    storage?: {
      local?: {
        get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
        remove(keys: string | string[]): Promise<void>;
      };
    };
    downloads?: {
      download(options: { url: string; filename?: string; conflictAction?: "uniquify" | "overwrite" | "prompt" }): Promise<number>;
    };
    permissions?: {
      contains(permissions: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
      request(permissions: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
    };
  } | undefined;
}

export {};
