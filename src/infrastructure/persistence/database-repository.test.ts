import { describe, expect, it } from "vitest";
import { AppDatabaseRepository } from "./database-repository";
import { CURRENT_DATABASE_VERSION, DATABASE_STORAGE_KEY, type AppDatabase } from "./schema";
import { InMemoryKeyValueStorage } from "./storage";

const database: AppDatabase = {
  schemaVersion: CURRENT_DATABASE_VERSION,
  migratedAt: 1,
  activeConversationId: null,
  settings: {
    ai: { apiType: "openai-compatible", apiKey: "", apiBaseUrl: "", model: "" },
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
    system: { language: "system", theme: "system" },
    privacy: { memoryEnabled: true },
  },
  conversations: {},
  snapshots: {},
  memories: [],
};

describe("AppDatabaseRepository", () => {
  it("writes through staging and only clears its own namespace", async () => {
    const storage = new InMemoryKeyValueStorage({ unrelated: "keep" });
    const repository = new AppDatabaseRepository(storage);
    expect(await repository.save(database)).toEqual({ ok: true, value: undefined });
    expect(await repository.load()).toEqual({ ok: true, value: database });
    expect(storage.snapshot()[`${DATABASE_STORAGE_KEY}:staging`]).toBeUndefined();

    await repository.clear();
    expect(storage.snapshot()).toEqual({ unrelated: "keep" });
  });

  it("rejects an unsupported persisted schema", async () => {
    const storage = new InMemoryKeyValueStorage({
      [DATABASE_STORAGE_KEY]: JSON.stringify({ schemaVersion: 999 }),
    });
    const result = await new AppDatabaseRepository(storage).load();
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-data" } });
  });
});
