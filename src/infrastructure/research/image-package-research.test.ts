import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { FixedClock } from "@/shared/clock";
import { FetchHttpClient } from "@/infrastructure/http";
import { ImageResearchAdapter } from "./image-research";
import { PackageResearchAdapter } from "./package-research";

describe("image and npm research adapters", () => {
  it("maps Unsplash images and keeps credentials out of result data", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              urls: { regular: "https://image.test/full", thumb: "https://image.test/thumb" },
              width: 1200,
              height: 800,
              alt_description: "Mountain",
            },
          ],
        }),
      ),
    );
    const adapter = new ImageResearchAdapter(new FetchHttpClient(fetcher));
    const result = await adapter.search(
      {
        ...DEFAULT_SETTINGS.assetSearch,
        engine: "unsplash",
        unsplashApiKey: "secret",
      },
      { query: "mountain" },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          url: "https://image.test/full",
          thumbnail: "https://image.test/thumb",
          description: "Mountain",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("searches Pexels images with authorization header", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          photos: [
            {
              id: 2014422,
              width: 3024,
              height: 3024,
              url: "https://www.pexels.com/photo/brown-rocks-during-golden-hour-2014422/",
              photographer: "Joey Farina",
              src: {
                large2x: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?large2x",
                tiny: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?tiny",
              },
              alt: "Brown Rocks During Golden Hour",
            },
          ],
        }),
      ),
    );
    const adapter = new ImageResearchAdapter(new FetchHttpClient(fetcher));
    const result = await adapter.search(
      {
        ...DEFAULT_SETTINGS.assetSearch,
        engine: "pexels",
        pexelsApiKey: "pexels-secret",
      },
      { query: "golden rocks", orientation: "horizontal", color: "brown", limit: 3 },
      new AbortController().signal,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.pexels.com/v1/search?query=golden+rocks&per_page=3&orientation=landscape&color=brown",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "pexels-secret" }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          url: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?large2x",
          thumbnail: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?tiny",
          width: 3024,
          height: 3024,
          description: "Brown Rocks During Golden Hour",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("pexels-secret");
  });

  it("caches npm responses until the TTL expires", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              package: { name: "pkg", version: "1.0.0", description: "Package" },
              score: {
                final: 0.91,
                detail: { quality: 0.8, popularity: 0.7, maintenance: 0.9 },
              },
            },
          ],
        }),
      ),
    );
    const clock = new FixedClock(100);
    const adapter = new PackageResearchAdapter(new FetchHttpClient(fetcher), clock, 1_000);
    const signal = new AbortController().signal;
    await adapter.search("query", 5, signal);
    await adapter.search("query", 5, signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock.set(1_101);
    await adapter.search("query", 5, signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed npm names without a request", async () => {
    const fetcher = vi.fn();
    const adapter = new PackageResearchAdapter(
      new FetchHttpClient(fetcher),
      new FixedClock(100),
    );
    expect(
      await adapter.detail("../../secret", new AbortController().signal),
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
