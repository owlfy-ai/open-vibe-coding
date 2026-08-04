import { describe, expect, it } from "vitest";
import {
  fingerprintPreviewFiles,
  infraRetryDelayMs,
  PREVIEW_INFRA_MAX_RETRIES,
  PREVIEW_INFRA_RETRY_BACKOFF_MS,
  shouldDeferFileSync,
} from "./preview-stability";

describe("preview stability helpers", () => {
  it("defers file sync only while Sandpack reports running", () => {
    expect(shouldDeferFileSync("running")).toBe(true);
    expect(shouldDeferFileSync("done")).toBe(false);
    expect(shouldDeferFileSync("idle")).toBe(false);
    expect(shouldDeferFileSync(undefined)).toBe(false);
  });

  it("exposes bounded exponential infra retry delays", () => {
    expect(PREVIEW_INFRA_RETRY_BACKOFF_MS).toHaveLength(PREVIEW_INFRA_MAX_RETRIES);
    expect(infraRetryDelayMs(0)).toBe(700);
    expect(infraRetryDelayMs(1)).toBe(1_600);
    expect(infraRetryDelayMs(2)).toBe(3_200);
    expect(infraRetryDelayMs(3)).toBeNull();
  });

  it("fingerprints file maps by path and content", () => {
    const first = fingerprintPreviewFiles({
      "/src/App.tsx": { code: "export default function App(){return null}" },
      "/package.json": { code: "{\"name\":\"demo\"}" },
    });
    const same = fingerprintPreviewFiles({
      "/package.json": { code: "{\"name\":\"demo\"}" },
      "/src/App.tsx": { code: "export default function App(){return null}" },
    });
    const changed = fingerprintPreviewFiles({
      "/src/App.tsx": { code: "export default function App(){return 1}" },
      "/package.json": { code: "{\"name\":\"demo\"}" },
    });
    expect(first).toBe(same);
    expect(first).not.toBe(changed);
  });
});
