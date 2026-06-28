import { err, ok, type Result } from "@/shared/result";

export type ProviderType = "openai-compatible" | "openai" | "anthropic" | "google";
export type WebSearchEngine = "tavily" | "firecrawl" | "builtin" | "disabled";
export type AssetSearchEngine = "pixabay" | "unsplash" | "disabled";
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
    apiType: "openai-compatible",
    apiKey: "",
    apiBaseUrl: "",
    model: "",
  },
  webSearch: {
    engine: "disabled",
    tavilyApiKey: "",
    tavilyApiUrl: "https://api.tavily.com",
    firecrawlApiKey: "",
    firecrawlApiUrl: "https://api.firecrawl.dev",
  },
  assetSearch: {
    engine: "disabled",
    pixabayApiKey: "",
    pixabayApiUrl: "https://pixabay.com/api",
    unsplashApiKey: "",
    unsplashApiUrl: "https://api.unsplash.com",
  },
  system: {
    language: "system",
    theme: "system",
  },
  privacy: {
    memoryEnabled: true,
  },
};

export function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ai: {
      apiType: settings.ai.apiType,
      apiKey: settings.ai.apiKey.trim(),
      apiBaseUrl: trimTrailingSlash(settings.ai.apiBaseUrl.trim()),
      model: settings.ai.model.trim(),
    },
    webSearch: {
      engine: settings.webSearch.engine,
      tavilyApiKey: settings.webSearch.tavilyApiKey,
      tavilyApiUrl: trimTrailingSlash(settings.webSearch.tavilyApiUrl.trim()),
      firecrawlApiKey: settings.webSearch.firecrawlApiKey,
      firecrawlApiUrl: trimTrailingSlash(settings.webSearch.firecrawlApiUrl.trim()),
    },
    assetSearch: {
      engine: settings.assetSearch.engine,
      pixabayApiKey: settings.assetSearch.pixabayApiKey,
      pixabayApiUrl: trimTrailingSlash(settings.assetSearch.pixabayApiUrl.trim()),
      unsplashApiKey: settings.assetSearch.unsplashApiKey,
      unsplashApiUrl: trimTrailingSlash(settings.assetSearch.unsplashApiUrl.trim()),
    },
    system: {
      language: settings.system.language,
      theme: settings.system.theme,
    },
    privacy: {
      memoryEnabled: settings.privacy.memoryEnabled,
    },
  };
}

export function validateAiSettings(
  settings: AppSettings,
): Result<AppSettings, readonly SettingsValidationError[]> {
  const normalized = normalizeSettings(settings);
  const errors: SettingsValidationError[] = [];
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
