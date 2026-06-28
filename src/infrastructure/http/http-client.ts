import { err, ok, type Result } from "@/shared/result";

export interface HttpError {
  readonly code: "network-error" | "timeout" | "aborted" | "http-error" | "invalid-json";
  readonly url: string;
  readonly status?: number;
  readonly message: string;
}

export interface HttpRequest {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface HttpClient {
  json<T>(url: string, request?: HttpRequest): Promise<Result<T, HttpError>>;
  text(url: string, request?: HttpRequest): Promise<Result<string, HttpError>>;
}

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class FetchHttpClient implements HttpClient {
  constructor(
    private readonly fetcher: FetchFunction = globalThis.fetch.bind(globalThis),
    private readonly defaultTimeoutMs = 15_000,
  ) {}

  async json<T>(url: string, request: HttpRequest = {}): Promise<Result<T, HttpError>> {
    const response = await this.request(url, request);
    if (!response.ok) return response;
    try {
      return ok((await response.value.json()) as T);
    } catch {
      return err({
        code: "invalid-json",
        url: redactSensitiveUrl(url),
        message: "The response body is not valid JSON",
      });
    }
  }

  async text(url: string, request: HttpRequest = {}): Promise<Result<string, HttpError>> {
    const response = await this.request(url, request);
    return response.ok ? ok(await response.value.text()) : response;
  }

  private async request(
    url: string,
    request: HttpRequest,
  ): Promise<Result<Response, HttpError>> {
    const safeUrl = redactSensitiveUrl(url);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs ?? this.defaultTimeoutMs);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetcher(url, {
        method: request.method ?? "GET",
        headers: {
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...request.headers,
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = sanitizeResponseDetail(await response.text());
        return err({
          code: "http-error",
          url: safeUrl,
          status: response.status,
          message: `HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        });
      }
      return ok(response);
    } catch (error) {
      if (timedOut) return err({ code: "timeout", url: safeUrl, message: "The request timed out" });
      if (request.signal?.aborted) {
        return err({ code: "aborted", url: safeUrl, message: "The request was aborted" });
      }
      return err({
        code: "network-error",
        url: safeUrl,
        message: error instanceof Error ? error.message : "The network request failed",
      });
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function redactSensitiveUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of ["key", "api_key", "client_id", "token", "access_token"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return value.replace(
      /([?&](?:key|api_key|client_id|token|access_token)=)[^&]*/gi,
      "$1[REDACTED]",
    );
  }
}

function sanitizeResponseDetail(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}
