import { describe, expect, it } from "vitest";
import type { ConversationId, ToolCallId } from "@/domain/conversation";
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
import { PreviewCoordinator } from "@/application/preview";
import { ApplicationSession } from "@/application/session";
import { CodingAgentService } from "./coding-agent-service";
import { buildCodingAgentPrompt } from "./coding-agent-service";

class ScriptedModel implements LanguageModelPort {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly scripts: readonly (readonly ModelStreamEvent[])[]) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    for (const event of this.scripts[this.requests.length - 1] ?? []) yield event;
  }
}

class InterruptibleModel implements LanguageModelPort {
  readonly requests: ModelRequest[] = [];
  private firstRequestStarted: (() => void) | null = null;
  readonly firstRequestReady = new Promise<void>((resolve) => {
    this.firstRequestStarted = resolve;
  });

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      this.firstRequestStarted?.();
      await new Promise<void>((_, reject) => {
        request.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return;
    }
    yield { type: "text-delta", delta: "Updated direction." };
    yield { type: "finish", reason: "stop" };
  }
}

describe("CodingAgentService", () => {
  it("persists user messages, tool-driven project changes and assistant output", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    const callId = ids.next("tool-call") as ToolCallId;
    const model = new ScriptedModel([
      [
        {
          type: "tool-call",
          callId,
          toolName: "write_file",
          input: { path: "src/App.tsx", content: "export default function App() {}" },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", delta: "Application created." },
        { type: "finish", reason: "stop" },
      ],
      [
        { type: "text-delta", delta: "Application created." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const preview = new PreviewCoordinator();
    const commands: unknown[] = [];
    preview.subscribeCommands((command) => {
      commands.push(command);
      preview.markReady({ conversationId: command.conversationId, revision: command.revision });
    });
    const service = new CodingAgentService(
      session,
      model,
      preview,
      ids,
      new FixedClock(100),
    );

    const result = await service.run(created.value, [
      { type: "text", text: "Build an application" },
    ]);
    expect(result).toMatchObject({ ok: true, value: { state: { status: "completed" } } });
    const persisted = session.snapshot().conversations[created.value];
    expect(persisted.project.files).toEqual({
      "src/App.tsx": "export default function App() {}",
    });
    expect(persisted.conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(commands).toEqual([
      { conversationId: created.value, revision: 1, reason: "files-changed", restart: false },
    ]);
    expect(model.requests[0].systemPrompt).toContain("The project is currently empty");
    expect(model.requests[2].messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
  });

  it("rejects missing conversations before contacting the model", async () => {
    const ids = new SequentialIdGenerator();
    const model = new ScriptedModel([]);
    const service = new CodingAgentService(
      new ApplicationSession(
        createEmptyDatabase(1),
        new AppDatabaseRepository(new InMemoryKeyValueStorage()),
        ids,
        new FixedClock(100),
      ),
      model,
      new PreviewCoordinator(),
      ids,
      new FixedClock(100),
    );
    expect(
      await service.run("missing" as ConversationId, [{ type: "text", text: "Build" }]),
    ).toMatchObject({ ok: false, error: { code: "conversation-not-found" } });
    expect(model.requests).toEqual([]);
  });

  it("keeps hidden context out of persisted user messages while sending it to the model", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    const model = new ScriptedModel([
      [
        { type: "text-delta", delta: "Done." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const service = new CodingAgentService(
      session,
      model,
      new PreviewCoordinator(),
      ids,
      new FixedClock(100),
    );

    const result = await service.run(
      created.value,
      [{ type: "text", text: "改成蓝色背景" }],
      { hiddenContext: "Selected element edit task: div.score-board only" },
    );

    expect(result).toMatchObject({ ok: true });
    const persisted = session.snapshot().conversations[created.value].conversation.messages[0];
    expect(persisted).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "改成蓝色背景" }],
    });
    expect(model.requests[0].messages[0]).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: "改成蓝色背景\n\nSelected element edit task: div.score-board only",
        },
      ],
    });
    expect(model.requests[0].systemPrompt).toContain("Infer the user's language from the latest visible user request");
    expect(model.requests[0].systemPrompt).toContain("Latest visible user request:\n改成蓝色背景");
    expect(model.requests[0].systemPrompt).not.toContain("Latest visible user request:\nSelected element edit task");
  });

  it("interrupts an active run and restarts with the latest user request in context", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    const model = new InterruptibleModel();
    const service = new CodingAgentService(
      session,
      model,
      new PreviewCoordinator(),
      ids,
      new FixedClock(100),
    );

    const firstRun = service.run(created.value, [{ type: "text", text: "Build a puzzle game" }]);
    await model.firstRequestReady;
    const secondRun = await service.interruptAndRun(created.value, [
      { type: "text", text: "Actually make it a racing game" },
    ]);
    const firstResult = await firstRun;

    expect(firstResult).toMatchObject({ ok: true, value: { state: { status: "cancelled" } } });
    expect(secondRun).toMatchObject({ ok: true, value: { state: { status: "completed" } } });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1].messages.map((message) => message.role)).toEqual(["user", "user"]);
    expect(model.requests[1].messages[1]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "Actually make it a racing game" }],
    });
    expect(model.requests[1].systemPrompt).toContain("The previous agent run was interrupted");
    expect(session.snapshot().conversations[created.value].conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "user",
      "assistant",
    ]);
  });

  it("places compressed history in the system prompt", () => {
    expect(
      buildCodingAgentPrompt(["src/App.tsx"], "", "Earlier dashboard work is complete"),
    ).toContain(
      "<conversation_summary>\nEarlier dashboard work is complete\n</conversation_summary>",
    );
  });
});
