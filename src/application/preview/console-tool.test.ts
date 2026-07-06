import { describe, expect, it, vi } from "vitest";
import { createPreviewConsoleTool } from "./console-tool";
import { PreviewCoordinator } from "./preview-coordinator";

describe("preview console tool", () => {
  it("waits for the exact project revision", async () => {
    const preview = new PreviewCoordinator();
    preview.request({ revision: 3, reason: "files-changed", restart: false });
    const tool = createPreviewConsoleTool(preview, () => 3, { runtimeErrorSettleMs: 0 });
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

  it("waits briefly after ready so late runtime errors are captured", async () => {
    vi.useFakeTimers();
    const preview = new PreviewCoordinator();
    preview.request({ revision: 5, reason: "files-changed", restart: false });
    const tool = createPreviewConsoleTool(preview, () => 5, { runtimeErrorSettleMs: 500 });
    const execution = tool.execute({}, { signal: new AbortController().signal });
    preview.markReady(5);
    await vi.advanceTimersByTimeAsync(250);
    preview.markFailed(5, "Runtime error\nReferenceError: createBoard is not defined");
    preview.recordConsole(5, [
      { id: "runtime", method: "error", data: ["ReferenceError: createBoard is not defined"] },
    ]);
    await vi.advanceTimersByTimeAsync(250);
    await expect(execution).resolves.toEqual({
      ok: true,
      value: {
        revision: 5,
        status: "failed",
        error: "Runtime error\nReferenceError: createBoard is not defined",
        logs: [{ method: "error", data: ["ReferenceError: createBoard is not defined"] }],
      },
    });
    vi.useRealTimers();
  });
});
