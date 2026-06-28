import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@/domain/conversation";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import {
  AppDatabaseRepository,
  InMemoryKeyValueStorage,
  createEmptyDatabase,
} from "@/infrastructure/persistence";
import type {
  LanguageModelPort,
  ModelRequest,
  ModelStreamEvent,
} from "@/application/ports/language-model";
import { ApplicationSession } from "@/application/session";
import { ConversationIntelligenceService } from "./conversation-intelligence";

class TextModel implements LanguageModelPort {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly responses: readonly string[]) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: "text-delta", delta: this.responses[this.requests.length - 1] ?? "" };
    yield { type: "finish", reason: "stop" };
  }
}

describe("ConversationIntelligenceService", () => {
  it("compresses only completed history and preserves raw messages", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    const messages: ConversationMessage[] = [
      {
        id: ids.next("message"),
        role: "user",
        createdAt: 1,
        content: [{ type: "text", text: "Build a dashboard" }],
      },
      {
        id: ids.next("message"),
        role: "assistant",
        createdAt: 2,
        content: [{ type: "text", text: "Created the dashboard" }],
      },
      {
        id: ids.next("message"),
        role: "user",
        createdAt: 3,
        content: [{ type: "text", text: "Add charts" }],
      },
    ];
    await session.appendConversationMessages(created.value, messages);
    const model = new TextModel(["Dashboard exists; charts are the current task."]);
    const service = new ConversationIntelligenceService(
      session,
      model,
      ids,
      new FixedClock(100),
    );
    const result = await service.compress(created.value);
    expect(result).toEqual({
      ok: true,
      value: {
        summary: "Dashboard exists; charts are the current task.",
        fromIndex: 2,
      },
    });
    const persisted = session.snapshot().conversations[created.value];
    expect(persisted.conversation.messages).toHaveLength(3);
    expect(persisted.compressedContext).toEqual(result.ok ? result.value : null);
    expect(model.requests[0].messages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("Build a dashboard") }],
    });
  });

  it("generates, sanitizes and persists a stable title", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    await session.appendConversationMessages(created.value, [
      {
        id: ids.next("message"),
        role: "user",
        createdAt: 1,
        content: [{ type: "text", text: "Build a weather dashboard" }],
      },
    ]);
    const service = new ConversationIntelligenceService(
      session,
      new TextModel(['"Weather Dashboard Builder."']),
      ids,
      new FixedClock(100),
    );
    expect(await service.generateTitle(created.value)).toEqual({
      ok: true,
      value: "Weather Dashboard Builder",
    });
    expect(session.snapshot().conversations[created.value].conversation.title).toBe(
      "Weather Dashboard Builder",
    );
  });

  it("requires enough history before compression", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    expect(
      await new ConversationIntelligenceService(
        session,
        new TextModel([]),
        ids,
        new FixedClock(100),
      ).compress(created.value),
    ).toMatchObject({ ok: false, error: { code: "insufficient-history" } });
  });
});
