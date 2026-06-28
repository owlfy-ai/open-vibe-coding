import type { AppSettings } from "@/domain/settings";
import type {
  ImageResearchPort,
  ImageSearchInput,
  ImageSearchResult,
  ResearchError,
} from "@/application/ports/research";
import type { HttpClient, HttpError } from "@/infrastructure/http";
import { err, ok, type Result } from "@/shared/result";

type RecordValue = Record<string, unknown>;

export class ImageResearchAdapter implements ImageResearchPort {
  constructor(private readonly http: HttpClient) {}

  async search(
    settings: AppSettings["assetSearch"],
    input: ImageSearchInput,
    signal: AbortSignal,
  ): Promise<Result<readonly ImageSearchResult[], ResearchError>> {
    if (settings.engine === "disabled") {
      return err({ code: "disabled", message: "Image search is disabled" });
    }
    const limit = clamp(input.limit ?? 10, 1, 20);
    if (settings.engine === "pixabay") {
      const parameters = new URLSearchParams({
        key: settings.pixabayApiKey,
        q: input.query,
        image_type: input.imageType ?? "all",
        orientation: input.orientation ?? "all",
        per_page: String(limit),
      });
      if (input.color) parameters.set("colors", input.color);
      const response = await this.http.json<RecordValue>(
        `${settings.pixabayApiUrl}/?${parameters}`,
        { signal },
      );
      if (!response.ok) return failure(response.error);
      return ok(records(response.value.hits).map(mapPixabayImage));
    }

    const parameters = new URLSearchParams({
      query: input.query,
      client_id: settings.unsplashApiKey,
      per_page: String(limit),
    });
    if (input.orientation === "horizontal") parameters.set("orientation", "landscape");
    if (input.orientation === "vertical") parameters.set("orientation", "portrait");
    if (input.color) parameters.set("color", input.color);
    const response = await this.http.json<RecordValue>(
      `${settings.unsplashApiUrl}/search/photos?${parameters}`,
      { signal },
    );
    if (!response.ok) return failure(response.error);
    return ok(records(response.value.results).map(mapUnsplashImage));
  }
}

function mapPixabayImage(image: RecordValue): ImageSearchResult {
  return {
    url: string(image.webformatURL),
    thumbnail: string(image.previewURL),
    width: number(image.webformatWidth),
    height: number(image.webformatHeight),
    description: string(image.tags),
  };
}

function mapUnsplashImage(image: RecordValue): ImageSearchResult {
  const urls = record(image.urls);
  const width = number(image.width) || 1;
  const height = number(image.height) || 1;
  return {
    url: string(urls.regular),
    thumbnail: string(urls.thumb),
    width: 1080,
    height: Math.round((1080 * height) / width),
    description: string(image.description) || string(image.alt_description),
  };
}

function failure(error: HttpError): Result<never, ResearchError> {
  return err({ code: "request-failed", message: error.message });
}

function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function record(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}
