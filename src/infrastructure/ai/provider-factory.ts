import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, ToolSet } from "ai";
import type { ProviderType } from "@/domain/settings";

export type AiProviderType = ProviderType;

export interface AiProviderConfig {
  readonly type: AiProviderType;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface AiProviderRuntime {
  readonly model: LanguageModel;
  readonly providerOptions: Record<string, Record<string, unknown>>;
  readonly providerTools: ToolSet;
  readonly providerManagedToolNames: ReadonlySet<string>;
}

const VERSION_PATHS: Readonly<Record<AiProviderType, string>> = {
  "openai-compatible": "/v1",
  openai: "/v1",
  anthropic: "/v1",
  google: "/v1beta",
};

export function resolveProviderBaseUrl(baseUrl: string, type: AiProviderType): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return /\/v\d+(?:\w*)$/.test(normalized)
    ? normalized
    : `${normalized}${VERSION_PATHS[type]}`;
}

export function createAiProviderRuntime(
  config: AiProviderConfig,
  options: { readonly thinkingBudget?: number; readonly builtinSearch?: boolean } = {},
): AiProviderRuntime {
  const baseURL = resolveProviderBaseUrl(config.baseUrl, config.type);
  const headers = { ...config.headers };
  const thinkingBudget = options.thinkingBudget ?? 10_000;
  let model: LanguageModel;
  let providerTools: ToolSet = {};

  if (config.type === "openai") {
    const provider = createOpenAI({ apiKey: config.apiKey, baseURL, headers });
    model = provider.responses(config.model);
    if (options.builtinSearch) {
      providerTools = {
        web_search_preview: provider.tools.webSearch({ searchContextSize: "high" }),
      };
    }
  } else if (config.type === "anthropic") {
    const provider = createAnthropic({
      apiKey: config.apiKey,
      baseURL,
      headers: {
        "anthropic-dangerous-direct-browser-access": "true",
        ...headers,
      },
    });
    model = provider(config.model);
    if (options.builtinSearch) {
      providerTools = {
        web_search: provider.tools.webSearch_20250305({ maxUses: 10 }),
      };
    }
  } else if (config.type === "google") {
    const provider = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL, headers });
    model = provider(config.model);
    if (options.builtinSearch) {
      providerTools = { google_search: provider.tools.googleSearch({}) };
    }
  } else {
    const provider = createOpenAICompatible({
      name: providerName(baseURL),
      baseURL,
      apiKey: config.apiKey,
      headers,
    });
    model = provider(config.model);
  }

  return {
    model,
    providerOptions: providerOptions(config.type, thinkingBudget),
    providerTools,
    providerManagedToolNames: new Set(Object.keys(providerTools)),
  };
}

function providerOptions(
  type: AiProviderType,
  thinkingBudget: number,
): Record<string, Record<string, unknown>> {
  if (type === "anthropic") {
    return { anthropic: { thinking: { type: "enabled", budgetTokens: thinkingBudget } } };
  }
  if (type === "openai") return { openai: { reasoningSummary: "detailed" } };
  if (type === "google") {
    return { google: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } };
  }
  return { openai: { reasoningEffort: "high" } };
}

function providerName(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "custom";
  }
}
