import { err, ok, type Result } from "@/shared/result";

export type ProviderType = "official" | "openai-compatible" | "openai" | "anthropic" | "google";
export type WebSearchEngine = "tavily" | "firecrawl" | "builtin" | "disabled";
export type AssetSearchEngine = "official" | "pixabay" | "unsplash" | "pexels";
export type LanguagePreference = "system" | "zh" | "en";
export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  readonly ai: {
    readonly apiType: ProviderType;
    readonly apiKey: string;
    readonly apiBaseUrl: string;
    readonly model: string;
  };
  readonly webSearch: {
    readonly engine: WebSearchEngine;
    readonly tavilyApiKey: string;
    readonly tavilyApiUrl: string;
    readonly firecrawlApiKey: string;
    readonly firecrawlApiUrl: string;
  };
  readonly assetSearch: {
    readonly engine: AssetSearchEngine;
    readonly pixabayApiKey: string;
    readonly pixabayApiUrl: string;
    readonly unsplashApiKey: string;
    readonly unsplashApiUrl: string;
    readonly pexelsApiKey: string;
    readonly pexelsApiUrl: string;
  };
  readonly system: {
    readonly language: LanguagePreference;
    readonly theme: ThemePreference;
  };
  readonly privacy: {
    readonly memoryEnabled: boolean;
  };
}

export interface SettingsValidationError {
  readonly code: "missing-api-key" | "missing-base-url" | "invalid-base-url" | "missing-model";
  readonly field: string;
  readonly message: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    apiType: "official",
    apiKey: "",
    apiBaseUrl: "",
    model: "Ultra",
  },
  webSearch: {
    engine: "disabled",
    tavilyApiKey: "",
    tavilyApiUrl: "https://api.tavily.com",
    firecrawlApiKey: "",
    firecrawlApiUrl: "https://api.firecrawl.dev",
  },
  assetSearch: {
    engine: "official",
    pixabayApiKey: "",
    pixabayApiUrl: "https://pixabay.com/api",
    unsplashApiKey: "",
    unsplashApiUrl: "https://api.unsplash.com",
    pexelsApiKey: "",
    pexelsApiUrl: "https://api.pexels.com/v1",
  },
  system: {
    language: "system",
    theme: "system",
  },
  privacy: {
    memoryEnabled: true,
  },
};

type SettingsInput = {
  readonly ai?: Partial<AppSettings["ai"]>;
  readonly webSearch?: Partial<AppSettings["webSearch"]>;
  readonly assetSearch?: Partial<AppSettings["assetSearch"]>;
  readonly system?: Partial<AppSettings["system"]>;
  readonly privacy?: Partial<AppSettings["privacy"]>;
};

export function normalizeSettings(settings: AppSettings | SettingsInput): AppSettings {
  const ai = { ...DEFAULT_SETTINGS.ai, ...settings.ai };
  const webSearch = { ...DEFAULT_SETTINGS.webSearch, ...settings.webSearch };
  const assetSearch = { ...DEFAULT_SETTINGS.assetSearch, ...settings.assetSearch };
  const system = { ...DEFAULT_SETTINGS.system, ...settings.system };
  const privacy = { ...DEFAULT_SETTINGS.privacy, ...settings.privacy };
  const apiKey = stringOrDefault(ai.apiKey, DEFAULT_SETTINGS.ai.apiKey).trim();
  const apiBaseUrl = trimTrailingSlash(stringOrDefault(ai.apiBaseUrl, DEFAULT_SETTINGS.ai.apiBaseUrl).trim());
  const rawModel = stringOrDefault(ai.model, DEFAULT_SETTINGS.ai.model).trim();
  const normalizedApiType = enumOr(
    ai.apiType,
    ["official", "openai-compatible", "openai", "anthropic", "google"],
    DEFAULT_SETTINGS.ai.apiType,
  );
  const apiType = isEmptyLegacyProvider(normalizedApiType, apiKey, apiBaseUrl, rawModel)
    ? "official"
    : normalizedApiType;
  const model = apiType === "official" ? normalizeOfficialModel(rawModel) : rawModel;

  return {
    ai: {
      apiType,
      apiKey,
      apiBaseUrl,
      model,
    },
    webSearch: {
      engine: enumOr(webSearch.engine, ["tavily", "firecrawl", "builtin", "disabled"], DEFAULT_SETTINGS.webSearch.engine),
      tavilyApiKey: stringOrDefault(webSearch.tavilyApiKey, DEFAULT_SETTINGS.webSearch.tavilyApiKey),
      tavilyApiUrl: trimTrailingSlash(stringOrDefault(webSearch.tavilyApiUrl, DEFAULT_SETTINGS.webSearch.tavilyApiUrl).trim()),
      firecrawlApiKey: stringOrDefault(webSearch.firecrawlApiKey, DEFAULT_SETTINGS.webSearch.firecrawlApiKey),
      firecrawlApiUrl: trimTrailingSlash(stringOrDefault(webSearch.firecrawlApiUrl, DEFAULT_SETTINGS.webSearch.firecrawlApiUrl).trim()),
    },
    assetSearch: {
      engine: enumOr(assetSearch.engine, ["official", "pixabay", "unsplash", "pexels"], DEFAULT_SETTINGS.assetSearch.engine),
      pixabayApiKey: stringOrDefault(assetSearch.pixabayApiKey, DEFAULT_SETTINGS.assetSearch.pixabayApiKey),
      pixabayApiUrl: trimTrailingSlash(stringOrDefault(assetSearch.pixabayApiUrl, DEFAULT_SETTINGS.assetSearch.pixabayApiUrl).trim()),
      unsplashApiKey: stringOrDefault(assetSearch.unsplashApiKey, DEFAULT_SETTINGS.assetSearch.unsplashApiKey),
      unsplashApiUrl: trimTrailingSlash(stringOrDefault(assetSearch.unsplashApiUrl, DEFAULT_SETTINGS.assetSearch.unsplashApiUrl).trim()),
      pexelsApiKey: stringOrDefault(assetSearch.pexelsApiKey, DEFAULT_SETTINGS.assetSearch.pexelsApiKey),
      pexelsApiUrl: trimTrailingSlash(stringOrDefault(assetSearch.pexelsApiUrl, DEFAULT_SETTINGS.assetSearch.pexelsApiUrl).trim()),
    },
    system: {
      language: enumOr(system.language, ["system", "zh", "en"], DEFAULT_SETTINGS.system.language),
      theme: enumOr(system.theme, ["system", "light", "dark"], DEFAULT_SETTINGS.system.theme),
    },
    privacy: {
      memoryEnabled: privacy.memoryEnabled !== false,
    },
  };
}

export function validateAiSettings(
  settings: AppSettings,
): Result<AppSettings, readonly SettingsValidationError[]> {
  const normalized = normalizeSettings(settings);
  const errors: SettingsValidationError[] = [];
  if (normalized.ai.apiType === "official") return ok(normalized);
  if (!normalized.ai.apiKey) {
    errors.push({ code: "missing-api-key", field: "ai.apiKey", message: "API key is required" });
  }
  if (!normalized.ai.apiBaseUrl) {
    errors.push({ code: "missing-base-url", field: "ai.apiBaseUrl", message: "API base URL is required" });
  } else {
    try {
      const url = new URL(normalized.ai.apiBaseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
    } catch {
      errors.push({
        code: "invalid-base-url",
        field: "ai.apiBaseUrl",
        message: "API base URL must be an HTTP(S) URL",
      });
    }
  }
  if (!normalized.ai.model) {
    errors.push({ code: "missing-model", field: "ai.model", message: "Model is required" });
  }
  return errors.length > 0 ? err(errors) : ok(normalized);
}

export function redactSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    ai: { ...settings.ai, apiKey: redactSecret(settings.ai.apiKey) },
    webSearch: {
      ...settings.webSearch,
      tavilyApiKey: redactSecret(settings.webSearch.tavilyApiKey),
      firecrawlApiKey: redactSecret(settings.webSearch.firecrawlApiKey),
    },
    assetSearch: {
      ...settings.assetSearch,
      pixabayApiKey: redactSecret(settings.assetSearch.pixabayApiKey),
      unsplashApiKey: redactSecret(settings.assetSearch.unsplashApiKey),
      pexelsApiKey: redactSecret(settings.assetSearch.pexelsApiKey),
    },
  };
}

function redactSecret(secret: string): string {
  if (!secret) return "";
  return secret.length <= 4 ? "••••" : `${secret.slice(0, 2)}••••${secret.slice(-2)}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isEmptyLegacyProvider(
  apiType: ProviderType,
  apiKey: string,
  apiBaseUrl: string,
  model: string,
): boolean {
  return apiType === "openai-compatible" && !apiKey && !apiBaseUrl && !model;
}

function normalizeOfficialModel(model: string): string {
  void model;
  return "Ultra";
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}
