import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  redactSettings,
  validateAiSettings,
} from "./settings";

describe("settings domain", () => {
  it("normalizes URLs and credentials at the domain boundary", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      ai: {
        apiType: "openai" as const,
        apiKey: " key ",
        apiBaseUrl: "https://api.example.test///",
        model: " model ",
      },
    };
    expect(normalizeSettings(settings).ai).toEqual({
      apiType: "openai",
      apiKey: "key",
      apiBaseUrl: "https://api.example.test",
      model: "model",
    });
  });

  it("returns all validation failures instead of a single boolean", () => {
    const result = validateAiSettings(DEFAULT_SETTINGS);
    expect(result).toMatchObject({
      ok: false,
      error: [
        { code: "missing-api-key" },
        { code: "missing-base-url" },
        { code: "missing-model" },
      ],
    });
  });

  it("fills settings added after existing browser data was saved", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      assetSearch: {
        engine: "disabled" as const,
        pixabayApiKey: "",
        pixabayApiUrl: "https://pixabay.com/api/",
        unsplashApiKey: "",
        unsplashApiUrl: "https://api.unsplash.com/",
      },
    };

    expect(normalizeSettings(settings).assetSearch).toEqual(DEFAULT_SETTINGS.assetSearch);
  });

  it("redacts every configured secret without mutating settings", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      ai: { ...DEFAULT_SETTINGS.ai, apiKey: "sk-sensitive-value" },
      webSearch: { ...DEFAULT_SETTINGS.webSearch, tavilyApiKey: "tavily-secret" },
    };
    const redacted = redactSettings(settings);
    expect(redacted.ai.apiKey).toBe("sk••••ue");
    expect(redacted.webSearch.tavilyApiKey).toBe("ta••••et");
    expect(settings.ai.apiKey).toBe("sk-sensitive-value");
  });
});
