import { describe, expect, it, vi } from "vitest";
import { PreviewCoordinator } from "./preview-coordinator";

describe("PreviewCoordinator", () => {
  it("returns console logs only from the requested settled revision", async () => {
    const coordinator = new PreviewCoordinator();
    coordinator.request({ revision: 4, reason: "files-changed", restart: false });
    coordinator.markCompiling(4);
    const waiting = coordinator.waitUntilSettled(4);
    coordinator.recordConsole(4, [
      { id: "1", method: "error", data: ["current error"] },
    ]);
    coordinator.markReady(4);
    await expect(waiting).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 4,
        status: "ready",
        logs: [{ data: ["current error"] }],
      },
    });
  });

  it("ignores stale Sandpack events", () => {
    const coordinator = new PreviewCoordinator();
    coordinator.request({ revision: 1, reason: "files-changed", restart: false });
    coordinator.request({ revision: 2, reason: "files-changed", restart: false });
    coordinator.markReady(1);
    coordinator.recordConsole(1, [{ id: "old", method: "error", data: ["stale"] }]);
    expect(coordinator.state(1)).toMatchObject({ status: "queued", logs: [] });
    expect(coordinator.state(2)).toMatchObject({ status: "queued", logs: [] });
  });

  it("settles an older waiter as superseded", async () => {
    const coordinator = new PreviewCoordinator();
    coordinator.request({ revision: 1, reason: "files-changed", restart: false });
    const waiting = coordinator.waitUntilSettled(1);
    coordinator.request({ revision: 2, reason: "dependencies-changed", restart: true });
    await expect(waiting).resolves.toMatchObject({
      ok: false,
      error: { code: "superseded", revision: 1 },
    });
  });

  it("keeps equal or lower revisions isolated between conversations", async () => {
    const coordinator = new PreviewCoordinator();
    coordinator.request({ conversationId: "a", revision: 8, reason: "files-changed", restart: false });
    coordinator.markReady({ conversationId: "a", revision: 8 });
    coordinator.request({ conversationId: "b", revision: 2, reason: "files-changed", restart: false });
    coordinator.recordConsole({ conversationId: "b", revision: 2 }, [
      { id: "b-log", method: "log", data: ["from b"] },
    ]);
    coordinator.markReady({ conversationId: "b", revision: 2 });
    await expect(coordinator.waitUntilSettled({ conversationId: "b", revision: 2 })).resolves.toMatchObject({
      ok: true,
      value: {
        conversationId: "b",
        revision: 2,
        logs: [{ data: ["from b"] }],
      },
    });
  });

  it("reports bounded timeouts", async () => {
    vi.useFakeTimers();
    const coordinator = new PreviewCoordinator();
    coordinator.request({ revision: 1, reason: "files-changed", restart: false });
    const waiting = coordinator.waitUntilSettled(1, 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(waiting).resolves.toMatchObject({
      ok: false,
      error: { code: "timeout", revision: 1 },
    });
    vi.useRealTimers();
  });

  it("settles when Sandpack reports ready without a prior compiling event", async () => {
    const coordinator = new PreviewCoordinator();
    coordinator.request({ revision: 4, reason: "files-changed", restart: false });
    const waiting = coordinator.waitUntilSettled(4);
    coordinator.markReady(4);
    await expect(waiting).resolves.toMatchObject({
      ok: true,
      value: { status: "ready", revision: 4 },
    });
  });

  it("does not move a settled revision back to compiling", () => {
    const coordinator = new PreviewCoordinator();
    coordinator.request({ revision: 4, reason: "files-changed", restart: false });
    coordinator.markReady(4);
    coordinator.markCompiling(4);
    expect(coordinator.state(4)).toMatchObject({ status: "ready" });
  });

  it("supports cancellation while waiting for Sandpack", async () => {
    const coordinator = new PreviewCoordinator();
    coordinator.request({ revision: 1, reason: "files-changed", restart: false });
    const controller = new AbortController();
    const waiting = coordinator.waitUntilSettled(1, 15_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toMatchObject({
      ok: false,
      error: { code: "aborted", revision: 1 },
    });
  });
});
