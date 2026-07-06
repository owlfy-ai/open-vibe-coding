import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
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

  it("accepts the official model option without third-party credentials", () => {
    const result = validateAiSettings(DEFAULT_SETTINGS);
    expect(result).toMatchObject({ ok: true });
  });

  it("always normalizes official model settings to Ultra", () => {
    expect(normalizeSettings({
      ...DEFAULT_SETTINGS,
      ai: { ...DEFAULT_SETTINGS.ai, model: "Standard" },
    }).ai.model).toBe("Ultra");
  });

  it("fills newly added asset-search fields for older persisted settings", () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      assetSearch: {
        engine: "pixabay" as const,
        pixabayApiKey: "pixabay-key",
        pixabayApiUrl: "https://pixabay.com/api///",
        unsplashApiKey: "",
        unsplashApiUrl: "https://api.unsplash.com",
      },
    } as AppSettings;
    expect(normalizeSettings(legacy).assetSearch).toMatchObject({
      engine: "pixabay",
      pixabayApiUrl: "https://pixabay.com/api",
      pexelsApiKey: "",
      pexelsApiUrl: "https://api.pexels.com/v1",
    });
  });

  it("returns all third-party validation failures instead of a single boolean", () => {
    const result = validateAiSettings({
      ...DEFAULT_SETTINGS,
      ai: { ...DEFAULT_SETTINGS.ai, apiType: "openai", model: "" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: [
        { code: "missing-api-key" },
        { code: "missing-base-url" },
        { code: "missing-model" },
      ],
    });
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
