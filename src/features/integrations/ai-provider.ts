import type { IntegrationSettings } from "../../platform/settings";
import { assertOutboundAllowed } from "./network-policy";

export interface AiProviderRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface AiProviderResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

export async function runAiPrompt(
  config: IntegrationSettings["ai"],
  request: AiProviderRequest
): Promise<AiProviderResponse> {
  assertOutboundAllowed("The AI request");
  if (!config.enabled) return { ok: false, error: "AI provider integration disabled" };
  if (!config.apiKey) return { ok: false, error: "AI provider API key missing" };
  if (!config.model) return { ok: false, error: "AI provider model missing" };

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
    })
  });
  if (!response.ok) {
    return { ok: false, error: `Anthropic HTTP ${response.status}` };
  }
  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: [
        ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
        { role: "user", content: request.prompt }
      ]
    })
  });
  if (!response.ok) {
    return { ok: false, error: `Provider HTTP ${response.status}` };
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (payload?.error) return { ok: false, error: payload.error.message ?? "Provider error" };
  const text = payload?.choices?.[0]?.message?.content ?? "";
  return { ok: true, text };
}
