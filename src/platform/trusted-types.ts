export type SafeHtml = string | TrustedHTML;

export interface TrustedHtmlPolicy {
  html(input: string): SafeHtml;
}

export function createTrustedHtmlPolicy(name = "aviary"): TrustedHtmlPolicy {
  const factory = globalThis.window?.trustedTypes;

  if (!factory) {
    return {
      html(input: string): string {
        return input;
      }
    };
  }

  let policy: TrustedTypePolicy | undefined;
  try {
    policy = factory.createPolicy(name, {
      createHTML(input: string): string {
        return input;
      }
    });
  } catch {
    policy = undefined;
  }

  return {
    html(input: string): SafeHtml {
      return policy ? policy.createHTML(input) : input;
    }
  };
}
