import type { AppSettings } from "@/domain/settings";
import type {
  ResearchError,
  WebPageResult,
  WebResearchPort,
  WebSearchResult,
} from "@/application/ports/research";
import type { HttpClient, HttpError } from "@/infrastructure/http";
import { err, ok, type Result } from "@/shared/result";

type RecordValue = Record<string, unknown>;

export class WebResearchAdapter implements WebResearchPort {
  constructor(private readonly http: HttpClient) {}

  async search(
    settings: AppSettings["webSearch"],
    query: string,
    maxResults: number,
    signal: AbortSignal,
  ): Promise<Result<{ answer: string | null; results: readonly WebSearchResult[] }, ResearchError>> {
    if (settings.engine === "disabled" || settings.engine === "builtin") {
      return err({ code: "disabled", message: "External web search is disabled" });
    }
    const limit = clamp(maxResults, 1, 10);
    if (settings.engine === "tavily") {
      const response = await this.http.json<RecordValue>(`${settings.tavilyApiUrl}/search`, {
        method: "POST",
        body: {
          api_key: settings.tavilyApiKey,
          query,
          max_results: limit,
          include_answer: true,
        },
        signal,
      });
      if (!response.ok) return requestFailure(response.error);
      return ok({
        answer: stringOrNull(response.value.answer),
        results: arrayOfRecords(response.value.results).map(mapSearchResult),
      });
    }
    const response = await this.http.json<RecordValue>(`${settings.firecrawlApiUrl}/v2/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.firecrawlApiKey}` },
      body: { query, limit, scrapeOptions: { formats: ["markdown"] } },
      signal,
    });
    if (!response.ok) return requestFailure(response.error);
    return ok({
      answer: null,
      results: arrayOfRecords(response.value.data).map(mapSearchResult),
    });
  }

  async read(
    settings: AppSettings["webSearch"],
    urls: readonly string[],
    signal: AbortSignal,
  ): Promise<Result<{ pages: readonly WebPageResult[] }, ResearchError>> {
    const valid = validateUrls(urls);
    if (!valid.ok) return valid;
    if (settings.engine === "tavily") {
      const response = await this.http.json<RecordValue>(`${settings.tavilyApiUrl}/extract`, {
        method: "POST",
        body: { api_key: settings.tavilyApiKey, urls: valid.value },
        signal,
      });
      if (response.ok) {
        const pages = arrayOfRecords(response.value.results).map(
          (page): WebPageResult => ({
            url: stringOr(page.url),
            ok: true,
            content: stringOr(page.raw_content),
          }),
        );
        if (pages.length > 0) return ok({ pages });
      }
      return this.readWithJina(valid.value, signal);
    }
    if (settings.engine === "firecrawl") {
      const response = await this.http.json<RecordValue>(
        `${settings.firecrawlApiUrl}/v2/batch/scrape`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${settings.firecrawlApiKey}` },
          body: { urls: valid.value, formats: ["markdown"] },
          signal,
        },
      );
      if (!response.ok) return requestFailure(response.error);
      return ok({
        pages: arrayOfRecords(response.value.data).map((page) => {
          const metadata = isRecord(page.metadata) ? page.metadata : {};
          return {
            url: stringOr(metadata.sourceURL) || stringOr(page.url),
            ok: page.success !== false,
            content: stringOr(page.markdown) || stringOr(page.content),
          };
        }),
      });
    }
    return this.readWithJina(valid.value, signal);
  }

  private async readWithJina(
    urls: readonly string[],
    signal: AbortSignal,
  ): Promise<Result<{ pages: readonly WebPageResult[] }, ResearchError>> {
    const pages: WebPageResult[] = [];
    for (const url of urls) {
      const response = await this.http.text(`https://r.jina.ai/${url}`, {
        headers: { Accept: "text/plain" },
        signal,
      });
      pages.push(
        response.ok
          ? { url, ok: true, content: response.value }
          : { url, ok: false, error: response.error.message },
      );
    }
    return pages.some((page) => page.ok)
      ? ok({ pages })
      : err({ code: "request-failed", message: "No web page could be read" });
  }
}

function validateUrls(urls: readonly string[]): Result<readonly string[], ResearchError> {
  if (urls.length === 0 || urls.length > 10) {
    return err({ code: "invalid-input", message: "urls must contain between 1 and 10 items" });
  }
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
    } catch {
      return err({ code: "invalid-input", message: `Invalid HTTP(S) URL: ${value}` });
    }
  }
  return ok(urls);
}

function requestFailure(error: HttpError): Result<never, ResearchError> {
  return err({ code: "request-failed", message: error.message });
}

function mapSearchResult(value: RecordValue): WebSearchResult {
  return {
    title: stringOr(value.title) || stringOr(value.url),
    url: stringOr(value.url),
    content: stringOr(value.content) || stringOr(value.markdown),
  };
}

function arrayOfRecords(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}
