import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendClient } from "./backend-client";
import type { OperationsConfig } from "@/app/operations-config";

const config: OperationsConfig = {
  appId: "qidea.ai",
  backendUrl: "https://api.owlfy.ai",
  clerkPublishableKey: "pk_live_Y2xlcmsucWlkZWEuYWkk",
  liteLlmBaseUrl: "https://api.owlfy.ai/litellm/v1",
  liteLlmModel: "test",
  appName: "Qidea",
};
const user = { ID: 42, email: "test@example.test", nickName: "Test" };
const reply = (data: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify({ code: 0, data }), { headers });

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", { location: { origin: "https://qidea.ai" } });
});
afterEach(() => vi.unstubAllGlobals());

async function loggedInClient() {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(reply({ token: "qidea-token", user }))
    .mockResolvedValueOnce(reply({ userInfo: user }));
  vi.stubGlobal("fetch", fetcher);
  const client = new BackendClient(config);
  await client.clerkLogin("email", "clerk-token");
  return { client, fetcher };
}

describe("product-scoped backend integration", () => {
  it("selects qidea.ai for login and subsequent authenticated requests", async () => {
    localStorage.setItem("ovc.backend.session", JSON.stringify({ accessToken: "old-owlfy-token" }));
    const { client, fetcher } = await loggedInClient();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.owlfy.ai/api/base/unified-login");
    expect(JSON.parse(request.body)).toEqual({ app_id: "qidea.ai", provider: "email", sessionToken: "clerk-token" });
    expect(request.headers["X-App-ID"]).toBe("qidea.ai");
    expect(request.headers["X-Token"]).toBeUndefined();
    expect(fetcher.mock.calls[1][1].headers["X-Token"]).toBe("qidea-token");
    expect(fetcher.mock.calls[1][1].headers["X-App-ID"]).toBe("qidea.ai");
    expect(client.current()?.user.id).toBe("42");
  });

  it("isolates stored credentials by product, backend and Clerk instance", async () => {
    await loggedInClient();
    expect(new BackendClient(config).current()?.accessToken).toBe("qidea-token");
    for (const patch of [
      { appId: "owlfy" }, { backendUrl: "https://other.test" }, { clerkPublishableKey: "different-instance" },
    ]) {
      const other = new BackendClient({ ...config, ...patch });
      expect(other.current()).toBeNull();
      await other.logout();
      expect(new BackendClient(config).current()?.accessToken).toBe("qidea-token");
    }
  });

  it("keeps rotated tokens when refreshing account information", async () => {
    const { client, fetcher } = await loggedInClient();
    fetcher.mockResolvedValueOnce(reply({ userInfo: user }, { "new-token": "rotated-token" }));
    await client.refresh();
    expect(client.current()?.accessToken).toBe("rotated-token");
  });

  it("uses the product billing portal without putting the backend token in a website URL", async () => {
    const { client, fetcher } = await loggedInClient();
    fetcher.mockResolvedValueOnce(reply({ portalUrl: "https://billing.stripe.com/test" }));
    expect(await client.createBillingPortal()).toBe("https://billing.stripe.com/test");
    const [url, request] = fetcher.mock.calls[2];
    expect(url).toBe("https://api.owlfy.ai/api/stripe/create-portal-session");
    expect(JSON.parse(request.body)).toEqual({ returnUrl: "https://qidea.ai/" });
    expect(request.headers["X-App-ID"]).toBe("qidea.ai");
  });
});
