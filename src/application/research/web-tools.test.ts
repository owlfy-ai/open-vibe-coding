import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { ok } from "@/shared/result";
import type { WebResearchPort } from "@/application/ports/research";
import { createWebResearchTools } from "./web-tools";

describe("web research tools", () => {
  it("exposes Jina reader but not duplicate search for provider builtin mode", () => {
    const port: WebResearchPort = {
      search: vi.fn(),
      read: vi.fn(),
    };
    const tools = createWebResearchTools(port, () => ({
      ...DEFAULT_SETTINGS,
      webSearch: { ...DEFAULT_SETTINGS.webSearch, engine: "builtin" },
    }));
    expect(tools.map((tool) => tool.definition.name)).toEqual(["web_reader"]);
  });

  it("returns structured search output", async () => {
    const port: WebResearchPort = {
      search: vi.fn(async () =>
        ok({
          answer: null,
          results: [{ title: "A", url: "https://a.test", content: "B" }],
        }),
      ),
      read: vi.fn(),
    };
    const tools = createWebResearchTools(port, () => ({
      ...DEFAULT_SETTINGS,
      webSearch: { ...DEFAULT_SETTINGS.webSearch, engine: "tavily" },
    }));
    const search = tools.find((tool) => tool.definition.name === "web_search");
    expect(
      await search?.execute(
        { query: "current docs", max_results: 3 },
        { signal: new AbortController().signal },
      ),
    ).toMatchObject({ ok: true, value: { results: [{ title: "A" }] } });
  });
});
