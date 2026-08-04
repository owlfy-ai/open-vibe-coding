import { describe, expect, it } from "vitest";
import {
  classifySandpackConsoleEntry,
  isSandpackInfrastructureNoise,
} from "./SandpackBridge";
import type { PreviewConsoleEntry } from "@/application/preview";

describe("SandpackBridge console filtering", () => {
  it("classifies CodeSandbox bridge faults as infrastructure failures", () => {
    expect(classifySandpackConsoleEntry(error("__csb_sw.hash.js:105 Failed to handle POST https://preview/cdn-cgi/rum? request: no response received from the BroadcastChannel within timeout. There's likely an issue with the bridge/worker communication."))).toBe("noise");
    expect(classifySandpackConsoleEntry(error("__csb_sw.hash.js:105 Failed to handle GET https://ek13nsk-5173.nodebox.codesandbox.io/src/index.tsx request: no response received from the BroadcastChannel within timeout. There's likely an issue with the bridge/worker communication."))).toBe("infra-fatal");
    expect(classifySandpackConsoleEntry(error("__csb_sw.hash.js:105 DataCloneError: Failed to execute 'postMessage' on 'MessagePort': A ReadableStream could not be cloned because it was not transferred."))).toBe("infra-fatal");
    expect(isSandpackInfrastructureNoise(error("TypeError: Cannot read properties of undefined"))).toBe(false);
  });

  it("keeps application errors visible", () => {
    expect(classifySandpackConsoleEntry(error("TypeError: Cannot read properties of undefined"))).toBe("app");
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
