import { createTauriSseResponse } from "./sse-bridge";

const PROXY_SCHEME = "proxy";

let installed = false;

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function installTauriProxy(): void {
  if (installed || !isTauriRuntime()) return;
  installFetchProxy(window.fetch.bind(window));
  installXhrProxy(XMLHttpRequest.prototype.open);
  installed = true;
}

function installFetchProxy(nativeFetch: typeof window.fetch): void {
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!shouldProxy(url)) return nativeFetch(input, init);
    if (isStreamingRequest(url, init, input)) {
      return createTauriSseResponse({
        url,
        method: init?.method ?? (input instanceof Request ? input.method : "POST"),
        headers: requestHeaders(input, init),
        body: typeof init?.body === "string" ? init.body : undefined,
        signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
      });
    }
    if (input instanceof Request) return nativeFetch(new Request(toProxyUrl(url), input), init);
    return nativeFetch(toProxyUrl(url), init);
  };
}

function installXhrProxy(nativeOpen: typeof XMLHttpRequest.prototype.open): void {
  const patchedOpen = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    const value = typeof url === "string" ? url : url.href;
    nativeOpen.call(this, method, shouldProxy(value) ? toProxyUrl(value) : url, async ?? true, username, password);
  };
  XMLHttpRequest.prototype.open = patchedOpen as typeof XMLHttpRequest.prototype.open;
}

function shouldProxy(value: string): boolean {
  if (value.startsWith(`${PROXY_SCHEME}://`) || value.startsWith("data:") || value.startsWith("blob:")) {
    return false;
  }
  try {
    const url = new URL(value, window.location.href);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

function toProxyUrl(value: string): string {
  const url = new URL(value, window.location.href);
  return `${PROXY_SCHEME}://${url.host}${url.pathname}${url.search}`;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return Object.fromEntries(headers.entries());
}

function isStreamingRequest(url: string, init?: RequestInit, input?: RequestInfo | URL): boolean {
  if (url.includes(":streamGenerateContent")) return true;
  const body = typeof init?.body === "string" ? init.body : input instanceof Request ? undefined : undefined;
  return typeof body === "string" && /"stream"\s*:\s*true/.test(body);
}
