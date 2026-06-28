import { describe, expect, it } from "vitest";
import type { ConversationId, MessageId } from "@/domain/conversation";
import { ProjectWorkspace } from "@/domain/project";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import { ProjectHistory } from "./project-history";
import type { ProjectSnapshot } from "./types";

describe("ProjectHistory", () => {
  it("uses bounded checkpoint chains and reconstructs every revision", () => {
    const ids = new SequentialIdGenerator();
    const workspace = new ProjectWorkspace();
    const history = new ProjectHistory(
      "conversation-1" as ConversationId,
      ids,
      new FixedClock(100),
      2,
    );
    const snapshots: ProjectSnapshot[] = [];

    for (let revision = 1; revision <= 5; revision += 1) {
      workspace.apply([
        { type: "write-file", path: "src/value.ts", content: String(revision) },
      ]);
      const captured = history.capture(
        `message-${revision}` as MessageId,
        workspace.snapshot(),
      );
      if (!captured.ok || !captured.value) throw new Error("capture failed");
      snapshots.push(captured.value);
    }

    expect(snapshots.map((snapshot) => snapshot.kind)).toEqual([
      "checkpoint",
      "delta",
      "checkpoint",
      "delta",
      "checkpoint",
    ]);
    for (let index = 0; index < snapshots.length; index += 1) {
      const reconstructed = history.reconstruct(snapshots[index].id);
      if (!reconstructed.ok) throw new Error(reconstructed.error.message);
      expect(reconstructed.value.files.get("src/value.ts" as never)).toBe(String(index + 1));
      expect(reconstructed.value.revision).toBe(index + 1);
    }
  });

  it("does not create snapshots when project content is unchanged", () => {
    const ids = new SequentialIdGenerator();
    const workspace = new ProjectWorkspace();
    workspace.apply([{ type: "write-file", path: "src/App.tsx", content: "same" }]);
    const history = new ProjectHistory(
      "conversation-1" as ConversationId,
      ids,
      new FixedClock(100),
    );
    const first = history.capture("message-1" as MessageId, workspace.snapshot());
    const second = history.capture("message-2" as MessageId, workspace.snapshot());
    expect(first).toMatchObject({ ok: true, value: { kind: "checkpoint" } });
    expect(second).toEqual({ ok: true, value: null });
  });

  it("detects corrupted checkpoint and delta records", () => {
    const ids = new SequentialIdGenerator();
    const workspace = new ProjectWorkspace();
    const source = new ProjectHistory(
      "conversation-1" as ConversationId,
      ids,
      new FixedClock(100),
      10,
    );
    workspace.apply([{ type: "write-file", path: "src/App.tsx", content: "one" }]);
    source.capture("message-1" as MessageId, workspace.snapshot());
    workspace.apply([{ type: "write-file", path: "src/App.tsx", content: "two" }]);
    const second = source.capture("message-2" as MessageId, workspace.snapshot());
    if (!second.ok || !second.value) throw new Error("capture failed");
    const records = source.list();
    const corrupted = records.map((record, index) =>
      index === 1 ? { ...record, integrityHash: "00000000" } : record,
    ) as ProjectSnapshot[];
    const history = new ProjectHistory(
      "conversation-1" as ConversationId,
      ids,
      new FixedClock(100),
      10,
      corrupted,
    );
    expect(history.reconstruct(second.value.id)).toMatchObject({
      ok: false,
      error: { code: "integrity-failed" },
    });
  });
});
