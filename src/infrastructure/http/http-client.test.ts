import { describe, expect, it, vi } from "vitest";
import { FetchHttpClient, redactSensitiveUrl } from "./http-client";

describe("FetchHttpClient", () => {
  it("binds the default fetch implementation to globalThis", async () => {
    const originalFetch = globalThis.fetch;
    const fetcher = vi.fn(function fetchWithRequiredThis(this: typeof globalThis) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
    globalThis.fetch = fetcher as unknown as typeof fetch;
    try {
      const result = await new FetchHttpClient().json<{ ok: boolean }>(
        "https://example.test/data",
      );
      expect(result).toEqual({ ok: true, value: { ok: true } });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes successful JSON responses", async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const result = await new FetchHttpClient(fetcher).json<{ ok: boolean }>(
      "https://example.test/data",
    );
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it("bounds HTTP error details", async () => {
    const fetcher = vi.fn(
      async () => new Response(`  ${"failure ".repeat(100)}`, { status: 429 }),
    );
    const result = await new FetchHttpClient(fetcher).json("https://example.test/data");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "http-error", status: 429 },
    });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.message.length).toBeLessThanOrEqual(510);
  });

  it("distinguishes caller cancellation from timeout", async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const controller = new AbortController();
    const pending = new FetchHttpClient(fetcher, 5_000).text("https://example.test", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "aborted" } });
  });

  it("redacts credentials embedded in query parameters", () => {
    expect(
      redactSensitiveUrl("https://images.test/search?client_id=super-secret&query=cat"),
    ).toBe("https://images.test/search?client_id=%5BREDACTED%5D&query=cat");
  });
});
