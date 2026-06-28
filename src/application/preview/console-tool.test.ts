import { describe, expect, it } from "vitest";
import { createPreviewConsoleTool } from "./console-tool";
import { PreviewCoordinator } from "./preview-coordinator";

describe("preview console tool", () => {
  it("waits for the exact project revision", async () => {
    const preview = new PreviewCoordinator();
    preview.request({ revision: 3, reason: "files-changed", restart: false });
    const tool = createPreviewConsoleTool(preview, () => 3);
    const execution = tool.execute({}, { signal: new AbortController().signal });
    preview.recordConsole(3, [
      { id: "1", method: "log", data: ["ready", { count: 1 }] },
    ]);
    preview.markReady(3);
    await expect(execution).resolves.toEqual({
      ok: true,
      value: {
        revision: 3,
        status: "ready",
        logs: [{ method: "log", data: ["ready", '{"count":1}'] }],
      },
    });
  });
});
