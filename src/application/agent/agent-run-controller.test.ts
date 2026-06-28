import { describe, expect, it, vi } from "vitest";
import type { ToolCallId, UserMessage } from "@/domain/conversation";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import { ToolRegistry, type AgentTool } from "../ports/agent-tool";
import type {
  LanguageModelPort,
  ModelRequest,
  ModelStreamEvent,
} from "../ports/language-model";
import { AgentRunController } from "./agent-run-controller";

class ScriptedModel implements LanguageModelPort {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly scripts: readonly (readonly ModelStreamEvent[])[]) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    const script = this.scripts[this.requests.length - 1];
    if (!script) throw new Error("No model script configured");
    for (const event of script) yield event;
  }
}

describe("AgentRunController", () => {
  it("runs provider-neutral tool loops with stable messages", async () => {
    const ids = new SequentialIdGenerator();
    const callId = ids.next("tool-call");
    const model = new ScriptedModel([
      [
        { type: "reasoning-delta", delta: "Need " },
        { type: "reasoning-delta", delta: "files" },
        { type: "tool-call", callId, toolName: "list_files", input: {} },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", delta: "Done" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const execute = vi.fn(async () => ({ ok: true as const, value: ["src/App.tsx"] }));
    const tool: AgentTool = {
      definition: { name: "list_files", description: "List files", inputSchema: {} },
      execute,
    };
    const controller = new AgentRunController(
      model,
      new ToolRegistry([tool]),
      ids,
      new FixedClock(100),
    );
    const user: UserMessage = {
      id: ids.next("message"),
      role: "user",
      createdAt: 100,
      content: [{ type: "text", text: "Build" }],
    };
    const states: string[] = [];
    const result = await controller.run([user], {
      onStateChange: (state) => states.push(state.status),
    });

    expect(result.state).toMatchObject({ status: "completed", iterations: 2 });
    expect(states).toEqual([
      "preparing",
      "streaming",
      "executing-tools",
      "preparing",
      "streaming",
      "completed",
    ]);
    expect(execute).toHaveBeenCalledOnce();
    expect(model.requests[1].messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    const assistant = result.messages.at(-1);
    expect(assistant).toMatchObject({ role: "assistant", content: [{ type: "text", text: "Done" }] });
    expect(new Set(result.messages.map((message) => message.id)).size).toBe(result.messages.length);
  });

  it("returns structured errors for unregistered tools", async () => {
    const ids = new SequentialIdGenerator();
    const callId = ids.next("tool-call") as ToolCallId;
    const model = new ScriptedModel([
      [
        { type: "tool-call", callId, toolName: "missing", input: null },
        { type: "finish", reason: "tool-calls" },
      ],
      [{ type: "finish", reason: "stop" }],
    ]);
    const controller = new AgentRunController(
      model,
      new ToolRegistry(),
      ids,
      new FixedClock(100),
    );
    const result = await controller.run([]);
    expect(result.messages.find((message) => message.role === "tool")).toMatchObject({
      output: { ok: false, error: { code: "unknown-tool" } },
    });
  });

  it("forces a console check after project mutations before completing", async () => {
    const ids = new SequentialIdGenerator();
    const writeCallId = ids.next("tool-call");
    const model = new ScriptedModel([
      [
        { type: "tool-call", callId: writeCallId, toolName: "write_file", input: { path: "src/App.tsx", content: "ok" } },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", delta: "Done" },
        { type: "finish", reason: "stop" },
      ],
      [
        { type: "text-delta", delta: "Ready" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const writeTool: AgentTool = {
      definition: { name: "write_file", description: "Write", inputSchema: {} },
      execute: vi.fn(async () => ({ ok: true as const, value: { revision: 2, changes: [] } })),
    };
    const consoleTool: AgentTool = {
      definition: { name: "get_console_logs", description: "Console", inputSchema: {} },
      execute: vi.fn(async () => ({
        ok: true as const,
        value: { revision: 2, status: "ready", logs: [] },
      })),
    };
    const controller = new AgentRunController(
      model,
      new ToolRegistry([writeTool, consoleTool]),
      ids,
      new FixedClock(100),
    );
    const result = await controller.run([]);

    expect(consoleTool.execute).toHaveBeenCalledOnce();
    expect(result.messages.map((message) => message.role)).toEqual([
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Ready" }],
    });
  });

  it("keeps running when the forced console check reports errors", async () => {
    const ids = new SequentialIdGenerator();
    const writeCallId = ids.next("tool-call");
    const fixCallId = ids.next("tool-call");
    const model = new ScriptedModel([
      [
        { type: "tool-call", callId: writeCallId, toolName: "write_file", input: { path: "src/App.tsx", content: "bad" } },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", delta: "Done" },
        { type: "finish", reason: "stop" },
      ],
      [
        { type: "tool-call", callId: fixCallId, toolName: "patch_file", input: { path: "src/App.tsx", patches: [] } },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", delta: "Fixed" },
        { type: "finish", reason: "stop" },
      ],
      [
        { type: "text-delta", delta: "Ready" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    let consoleChecks = 0;
    const mutationTool: AgentTool = {
      definition: { name: "write_file", description: "Write", inputSchema: {} },
      execute: vi.fn(async () => ({ ok: true as const, value: { revision: 2, changes: [] } })),
    };
    const patchTool: AgentTool = {
      definition: { name: "patch_file", description: "Patch", inputSchema: {} },
      execute: vi.fn(async () => ({ ok: true as const, value: { revision: 3, changes: [] } })),
    };
    const consoleTool: AgentTool = {
      definition: { name: "get_console_logs", description: "Console", inputSchema: {} },
      execute: vi.fn(async () => {
        consoleChecks += 1;
        return {
          ok: true as const,
          value: {
            revision: consoleChecks === 1 ? 2 : 3,
            status: "ready",
            logs: consoleChecks === 1 ? [{ method: "error", data: ["Boom"] }] : [],
          },
        };
      }),
    };
    const controller = new AgentRunController(
      model,
      new ToolRegistry([mutationTool, patchTool, consoleTool]),
      ids,
      new FixedClock(100),
    );
    const result = await controller.run([]);

    expect(consoleTool.execute).toHaveBeenCalledTimes(2);
    expect(patchTool.execute).toHaveBeenCalledOnce();
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Ready" }],
    });
  });
});
