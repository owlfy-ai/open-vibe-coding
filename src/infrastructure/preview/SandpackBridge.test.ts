import { describe, expect, it } from "vitest";
import { isSandpackInfrastructureNoise } from "./SandpackBridge";
import type { PreviewConsoleEntry } from "@/application/preview";

describe("SandpackBridge console filtering", () => {
  it("filters CodeSandbox service worker bridge noise", () => {
    expect(isSandpackInfrastructureNoise(error("__csb_sw.hash.js:105 Failed to handle POST https://preview/cdn-cgi/rum? request: no response received from the BroadcastChannel within timeout. There's likely an issue with the bridge/worker communication."))).toBe(true);
    expect(isSandpackInfrastructureNoise(error("__csb_sw.hash.js:105 DataCloneError: Failed to execute 'postMessage' on 'MessagePort': A ReadableStream could not be cloned because it was not transferred."))).toBe(true);
  });

  it("keeps application errors visible", () => {
    expect(isSandpackInfrastructureNoise(error("TypeError: Cannot read properties of undefined"))).toBe(false);
  });
});

function error(message: string): PreviewConsoleEntry {
  return {
    id: message,
    method: "error",
    data: [message],
  };
}
