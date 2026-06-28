import { describe, expect, it, vi } from "vitest";
import type { ConversationId, MessageId } from "@/domain/conversation";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import {
  AppDatabaseRepository,
  InMemoryKeyValueStorage,
  createEmptyDatabase,
  type KeyValueStorage,
} from "@/infrastructure/persistence";
import { ApplicationSession } from "./application-session";

describe("ApplicationSession", () => {
  it("serializes conversation commands and persists their project revisions", async () => {
    const storage = new InMemoryKeyValueStorage();
    const repository = new AppDatabaseRepository(storage);
    const clock = new FixedClock(100);
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      repository,
      new SequentialIdGenerator(),
      clock,
    );
    const listener = vi.fn();
    session.subscribe(listener);

    const created = await session.createConversation("vite-vue-ts");
    if (!created.ok) throw new Error(created.error.message);
    const id = created.value;
    const changed = await session.applyProjectOperations(id, [
      { type: "write-file", path: "src/App.vue", content: "<template />" },
    ]);
    expect(changed).toMatchObject({ ok: true, value: { revision: 1 } });
    const persisted = session.snapshot().conversations[id];
    expect(persisted.conversation).toMatchObject({
      id,
      template: "vite-vue-ts",
      projectRevision: 1,
    });
    expect(persisted.project.files).toEqual({ "src/App.vue": "<template />" });
    expect(listener).toHaveBeenCalledTimes(2);

    const loaded = await repository.load();
    expect(loaded).toMatchObject({
      ok: true,
      value: { activeConversationId: id },
    });
  });

  it("keeps conversation and snapshot deletion in one commit", async () => {
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    const first = await session.createConversation();
    const second = await session.createConversation();
    if (!first.ok || !second.ok) throw new Error("create failed");
    expect(session.snapshot().activeConversationId).toBe(second.value);
    expect(await session.deleteConversation(second.value)).toEqual({ ok: true, value: undefined });
    expect(session.snapshot().activeConversationId).toBe(first.value);
    expect(session.snapshot().conversations[second.value]).toBeUndefined();
    expect(session.snapshot().snapshots[second.value]).toBeUndefined();
  });

  it("rolls back workspace state when persistence fails", async () => {
    const workingStorage = new InMemoryKeyValueStorage();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(workingStorage),
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");

    const failing: KeyValueStorage = {
      get: (key) => workingStorage.get(key),
      set: async () => {
        throw new Error("disk full");
      },
      remove: (key) => workingStorage.remove(key),
    };
    const failingSession = new ApplicationSession(
      session.snapshot(),
      new AppDatabaseRepository(failing),
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    const result = await failingSession.applyProjectOperations(created.value, [
      { type: "write-file", path: "src/App.tsx", content: "not persisted" },
    ]);
    expect(result).toEqual({
      ok: false,
      error: { code: "persistence-error", message: "disk full" },
    });
    expect(failingSession.snapshot().conversations[created.value].project.files).toEqual({});
  });

  it("stores stable messages and applies the privacy-controlled memory book", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    const message = {
      id: ids.next("message") as MessageId,
      role: "user" as const,
      createdAt: 100,
      content: [{ type: "text" as const, text: "Use React" }],
    };
    expect(await session.appendConversationMessages(created.value, [message])).toEqual({
      ok: true,
      value: undefined,
    });
    expect(session.snapshot().conversations[created.value].conversation.messages[0].id).toBe(
      message.id,
    );

    expect(
      await session.applyMemoryOperations([
        { type: "add", content: "The user prefers React", category: "preference" },
      ]),
    ).toEqual({ ok: true, value: undefined });
    expect(session.memoryPrompt()).toContain("prefers React");

    await session.updateSettings({
      ...DEFAULT_SETTINGS,
      privacy: { memoryEnabled: false },
    });
    expect(session.memoryPrompt()).toBe("");
    expect(
      await session.applyMemoryOperations([
        { type: "add", content: "Use Vue", category: "preference" },
      ]),
    ).toMatchObject({ ok: false, error: { code: "memory-error" } });
  });

  it("rejects unknown conversation ids without persisting", async () => {
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    expect(await session.switchConversation("missing" as ConversationId)).toMatchObject({
      ok: false,
      error: { code: "conversation-not-found" },
    });
  });
});
