import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationsConfig } from "@/app/operations-config";
import type { ModelRequest, ModelStreamEvent } from "@/application/ports/language-model";
import { BackendClient, isBackendAuthRequiredError } from "./backend-client";
import { BackendLanguageModelAdapter, BackendModelAccessError } from "./backend-language-model";

const config: OperationsConfig = {
  appId: "qidea.ai", backendUrl: "https://api.example.test", clerkPublishableKey: "pk-test",
  liteLlmBaseUrl: "https://api.example.test/litellm/v1", liteLlmModel: "backup_qidea", appName: "Qidea",
};
const user = { ID: 42, email: "test@example.test" };
const reply = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const request: ModelRequest = { messages: [], tools: [], signal: new AbortController().signal };

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

async function login() {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(reply({ token: "qidea-token", user }))
    .mockResolvedValueOnce(reply({ userInfo: user }));
  vi.stubGlobal("fetch", fetcher);
  const client = new BackendClient(config);
  await client.clerkLogin("email", "clerk-token");
  return { client, fetcher };
}

describe("official model account access", () => {
  it("requests login only when there is no backend session", async () => {
    const adapter = new BackendLanguageModelAdapter(new BackendClient(config));
    await expect(adapter.stream(request)[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "backend-auth-required" });
  });

  it("keeps a signed-in account when model access is unavailable", async () => {
    const { client, fetcher } = await login();
    fetcher.mockResolvedValueOnce(reply({ userInfo: user }));
    const adapter = new BackendLanguageModelAdapter(client);
    await expect(adapter.stream(request)[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(BackendModelAccessError);
    expect(client.current()?.accessToken).toBe("qidea-token");
    expect(isBackendAuthRequiredError(new BackendModelAccessError())).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("refreshes an old session and uses the new model key for agent tool calls", async () => {
    const { client, fetcher } = await login();
    fetcher.mockResolvedValueOnce(reply({ userInfo: { ...user, liteLlmKey: "model-key" } }));
    const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({
      id: "chat-1", created: 1, model: "backup_qidea",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
    fetcher.mockResolvedValueOnce(new Response(
      chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"src/App.tsx"}' } }] })
      + chunk({}, "tool_calls") + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    ));
    const events: ModelStreamEvent[] = [];
    for await (const event of new BackendLanguageModelAdapter(client).stream({
      ...request,
      messages: [{ id: "message-1" as never, role: "user", createdAt: 1, content: [{ type: "text", text: "Read the app" }] }],
      tools: [{ name: "read_file", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
    })) events.push(event);
    expect(events).toContainEqual({ type: "tool-call", callId: "call-1", toolName: "read_file", input: { path: "src/App.tsx" } });
    expect(events).toContainEqual({ type: "finish", reason: "tool-calls" });
    const [url, options] = fetcher.mock.calls[3];
    expect(url).toBe("https://api.example.test/litellm/v1/chat/completions");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer model-key");
    expect(JSON.parse(options.body).model).toBe("backup_qidea");
    expect(options.body).not.toContain("qidea-token");
    expect(fetcher.mock.calls[2][1].headers["X-App-ID"]).toBe("qidea.ai");
  });
});
