import type { IntegrationSettings } from "../../platform/settings.ts";
import { NETWORK_TIMEOUTS, withNetworkTimeout } from "../../platform/network.ts";
import { assertOutboundAllowed } from "./network-policy.ts";
import {
  defaultAiBudget,
  estimateAiRequestBytes,
  IntegrationUsageLedger
} from "./usage.ts";

export interface AiProviderRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface AiProviderResponse {
  ok: boolean;
  text?: string;
  error?: string;
  blocked?: "budget";
}

export interface AiProviderOptions {
  usage?: IntegrationUsageLedger;
}

type CompletionLimitParameter = "max_completion_tokens" | "max_tokens";

// Keep the negotiated choice in memory only. The endpoint is user configuration, and persisting
// provider capability responses would make the redacted diagnostics boundary much harder to audit.
const completionLimitByEndpoint = new Map<string, CompletionLimitParameter>();

function completionEndpointKey(endpoint: string): string {
  return endpoint.trim().replace(/\/$/, "").toLowerCase();
}

function boundedProviderText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 4096) : undefined;
}

function providerErrorMessage(body: string): string | undefined {
  const trimmed = body.trim().slice(0, 4096);
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const value = typeof parsed.error === "string"
      ? parsed.error
      : parsed.error && typeof parsed.error === "object"
        ? parsed.error.message
        : parsed.message;
    return boundedProviderText(value);
  } catch {
    return boundedProviderText(trimmed);
  }
}

function namesUnsupportedCompletionLimit(message: string | undefined): boolean {
  if (!message) return false;
  return /(?:unsupported|unknown|unrecognized|invalid|not\s+permitted)[^\n]{0,100}(?:max_completion_tokens|max_tokens)|(?:max_completion_tokens|max_tokens)[^\n]{0,100}(?:unsupported|unknown|unrecognized|invalid|not\s+permitted)/i.test(message);
}

export async function runAiPrompt(
  config: IntegrationSettings["ai"],
  request: AiProviderRequest,
  options: AiProviderOptions = {}
): Promise<AiProviderResponse> {
  if (!config.enabled) return { ok: false, error: "AI provider integration disabled" };
  if (!config.apiKey) return { ok: false, error: "AI provider API key missing" };
  if (!config.model) return { ok: false, error: "AI provider model missing" };
  assertOutboundAllowed("The AI request");
  if (options.usage) {
    const decision = await options.usage.reserveAi(
      estimateAiRequestBytes(config, request),
      defaultAiBudget(config)
    );
    if (!decision.allowed) {
      return {
        ok: false,
        error: decision.reason ?? "AI request blocked by usage budget",
        blocked: "budget"
      };
    }
  }

  try {
    switch (config.provider) {
      case "anthropic":
        return await callAnthropic(config, request);
      case "openai":
      case "openai-compatible":
      default:
        return await callOpenAiCompatible(config, request);
    }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

async function callAnthropic(
  config: IntegrationSettings["ai"],
  request: AiProviderRequest
): Promise<AiProviderResponse> {
  const endpoint = config.endpoint || "https://api.anthropic.com/v1/messages";
  const result = await withNetworkTimeout(async (signal) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens ?? 1024,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.prompt }]
      }),
      signal
    });
    if (!response.ok) return { status: response.status } as const;
    return {
      payload: (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        error?: { message?: string };
      }
    } as const;
  }, NETWORK_TIMEOUTS.ai);
  if ("status" in result) {
    return { ok: false, error: `Anthropic HTTP ${result.status}` };
  }
  const payload = result.payload;
  if (payload?.error) return { ok: false, error: payload.error.message ?? "Anthropic error" };
  const text = payload?.content?.filter((block) => block?.type === "text").map((block) => block.text ?? "").join("\n");
  return { ok: true, text: text ?? "" };
}

async function callOpenAiCompatible(
  config: IntegrationSettings["ai"],
  request: AiProviderRequest
): Promise<AiProviderResponse> {
  const endpoint = config.endpoint || "https://api.openai.com/v1/chat/completions";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.apiKey}`
  };
  const key = completionEndpointKey(endpoint);
  const remembered = completionLimitByEndpoint.get(key);
  const first: CompletionLimitParameter = remembered ?? "max_completion_tokens";
  const second: CompletionLimitParameter = first === "max_completion_tokens" ? "max_tokens" : "max_completion_tokens";

  async function send(limitParameter: CompletionLimitParameter) {
    return withNetworkTimeout(async (signal) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          [limitParameter]: request.maxTokens ?? 1024,
          messages: [
            ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
            { role: "user", content: request.prompt }
          ]
        }),
        signal
      });
      if (!response.ok) {
        return { status: response.status, message: providerErrorMessage(await response.text()) } as const;
      }
      return {
        payload: (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string };
        },
        limitParameter
      } as const;
    }, NETWORK_TIMEOUTS.ai);
  }

  let result = await send(first);
  if ("status" in result && result.status === 400 && namesUnsupportedCompletionLimit(result.message)) {
    result = await send(second);
    if ("status" in result && result.status === 400 && namesUnsupportedCompletionLimit(result.message)) {
      return {
        ok: false,
        error: `Provider HTTP 400: neither ${first} nor ${second} is supported${result.message ? ` (${result.message})` : ""}`
      };
    }
  }
  if ("status" in result) {
    return { ok: false, error: `Provider HTTP ${result.status}${result.message ? `: ${result.message}` : ""}` };
  }
  completionLimitByEndpoint.set(key, result.limitParameter);
  const payload = result.payload;
  if (payload?.error) {
    return { ok: false, error: providerErrorMessage(JSON.stringify(payload.error)) ?? "Provider error" };
  }
  const text = payload?.choices?.[0]?.message?.content ?? "";
  return { ok: true, text };
}
