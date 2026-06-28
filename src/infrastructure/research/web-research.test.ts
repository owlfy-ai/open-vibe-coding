import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { FetchHttpClient } from "@/infrastructure/http";
import { WebResearchAdapter } from "./web-research";

describe("WebResearchAdapter", () => {
  it("maps Tavily search into a provider-neutral result", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          answer: "Current answer",
          results: [{ title: "Source", url: "https://source.test", content: "Excerpt" }],
        }),
      ),
    );
    const adapter = new WebResearchAdapter(new FetchHttpClient(fetcher));
    const result = await adapter.search(
      {
        ...DEFAULT_SETTINGS.webSearch,
        engine: "tavily",
        tavilyApiKey: "key",
      },
      "query",
      5,
      new AbortController().signal,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        answer: "Current answer",
        results: [{ title: "Source", url: "https://source.test", content: "Excerpt" }],
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("falls back from Tavily extraction to Jina page-by-page", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/extract")) return new Response("failure", { status: 500 });
      return new Response("Readable page", { status: 200 });
    });
    const adapter = new WebResearchAdapter(new FetchHttpClient(fetcher));
    const result = await adapter.read(
      { ...DEFAULT_SETTINGS.webSearch, engine: "tavily", tavilyApiKey: "key" },
      ["https://page.test/article"],
      new AbortController().signal,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        pages: [{ url: "https://page.test/article", ok: true, content: "Readable page" }],
      },
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://r.jina.ai/https://page.test/article",
      expect.anything(),
    );
  });

  it("rejects non-HTTP page schemes before network access", async () => {
    const fetcher = vi.fn();
    const result = await new WebResearchAdapter(new FetchHttpClient(fetcher)).read(
      DEFAULT_SETTINGS.webSearch,
      ["file:///etc/passwd"],
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
