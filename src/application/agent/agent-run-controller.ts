import {
  transitionAgentRun,
  type AgentRunState,
} from "@/domain/agent";
import type {
  AssistantContent,
  AssistantMessage,
  ConversationMessage,
  ToolMessage,
  ToolCallId,
  UserMessage,
} from "@/domain/conversation";
import type { ToolExecutionResult } from "../ports/agent-tool";
import type { Clock } from "@/shared/clock";
import type { IdGenerator } from "@/shared/id";
import type { ToolRegistry } from "../ports/agent-tool";
import type { LanguageModelPort } from "../ports/language-model";

const CONSOLE_TOOL_NAME = "get_console_logs";
const DEFAULT_MAX_ITERATIONS = 60;
const PROJECT_MUTATION_TOOLS = new Set([
  "init_project",
  "manage_dependencies",
  "write_file",
  "patch_file",
  "delete_file",
]);

export interface AgentRunObserver {
  onStateChange?(state: AgentRunState): void;
  onMessage?(message: ConversationMessage): void;
  onDelta?(delta: { type: "text" | "reasoning"; value: string }): void;
}

export interface AgentRunResult {
  readonly state: AgentRunState;
  readonly messages: readonly ConversationMessage[];
}

export class AgentRunController {
  private state: AgentRunState = { status: "idle" };
  private abortController: AbortController | null = null;

  constructor(
    private readonly model: LanguageModelPort,
    private readonly tools: ToolRegistry,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly maxIterations = DEFAULT_MAX_ITERATIONS,
  ) {}

  get currentState(): AgentRunState {
    return this.state;
  }

  cancel(): void {
    this.abortController?.abort();
  }

  async run(
    initialMessages: readonly ConversationMessage[],
    observer: AgentRunObserver = {},
    options: { readonly systemPrompt?: string } = {},
  ): Promise<AgentRunResult> {
    if (this.state.status === "preparing" || this.state.status === "streaming" || this.state.status === "executing-tools") {
      throw new Error("An agent run is already active");
    }

    const messages = [...initialMessages];
    const runId = this.ids.next("agent-run");
    let needsConsoleCheck = false;
    let consoleErrorsNeedFix = false;
    this.abortController = new AbortController();
    this.change(transitionAgentRun({ status: "idle" }, { type: "start", runId }), observer);

    try {
      for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
        if (this.abortController.signal.aborted) return this.cancelled(messages, observer);
        this.change(transitionAgentRun(this.state, { type: "stream-started" }), observer);

        const assistantContent: AssistantContent[] = [];
        let finishReason: "stop" | "tool-calls" | "length" = "stop";
        for await (const event of this.model.stream({
          systemPrompt: options.systemPrompt,
          messages: [...messages],
          tools: this.tools.definitions(),
          signal: this.abortController.signal,
        })) {
          if (event.type === "text-delta") {
            this.appendDelta(assistantContent, "text", event.delta);
            observer.onDelta?.({ type: "text", value: event.delta });
          } else if (event.type === "reasoning-delta") {
            this.appendDelta(assistantContent, "reasoning", event.delta);
            observer.onDelta?.({ type: "reasoning", value: event.delta });
          } else if (event.type === "tool-call") {
            assistantContent.push({
              type: "tool-call",
              callId: event.callId,
              toolName: event.toolName,
              input: event.input,
            });
          } else {
            finishReason = event.reason;
          }
        }

        const calls = assistantContent.filter(
          (block): block is Extract<AssistantContent, { type: "tool-call" }> =>
            block.type === "tool-call",
        );

        if (calls.length === 0 || finishReason !== "tool-calls") {
          if (needsConsoleCheck) {
            const result = await this.forceConsoleCheck(messages, observer);
            needsConsoleCheck = false;
            consoleErrorsNeedFix = hasConsoleProblems(result);
            continue;
          }
          if (consoleErrorsNeedFix) {
            messages.push(this.hiddenConsoleFixRequest());
            continue;
          }

          const assistant: AssistantMessage = {
            id: this.ids.next("message"),
            role: "assistant",
            createdAt: this.clock.now(),
            content: assistantContent,
          };
          messages.push(assistant);
          observer.onMessage?.(assistant);
          this.change(transitionAgentRun(this.state, { type: "complete" }), observer);
          return { state: this.state, messages };
        }

        const assistant: AssistantMessage = {
          id: this.ids.next("message"),
          role: "assistant",
          createdAt: this.clock.now(),
          content: assistantContent,
        };
        messages.push(assistant);
        observer.onMessage?.(assistant);

        this.change(
          transitionAgentRun(this.state, { type: "tools-requested", count: calls.length }),
          observer,
        );
        for (const call of calls) {
          if (this.abortController.signal.aborted) return this.cancelled(messages, observer);
          const output = await this.tools.execute(call.toolName, call.input, {
            signal: this.abortController.signal,
          });
          if (isProjectMutationTool(call.toolName) && output.ok) {
            needsConsoleCheck = true;
            consoleErrorsNeedFix = false;
          }
          if (call.toolName === CONSOLE_TOOL_NAME) {
            needsConsoleCheck = false;
            consoleErrorsNeedFix = hasConsoleProblems(output);
          }
          const toolMessage: ToolMessage = {
            id: this.ids.next("message"),
            role: "tool",
            createdAt: this.clock.now(),
            callId: call.callId,
            toolName: call.toolName,
            output,
          };
          messages.push(toolMessage);
          observer.onMessage?.(toolMessage);
        }
        this.change(transitionAgentRun(this.state, { type: "tools-completed" }), observer);
      }

      const error = {
        code: "max-iterations",
        message: `Agent exceeded ${this.maxIterations} iterations`,
        retryable: true,
      };
      this.change(transitionAgentRun(this.state, { type: "fail", error }), observer);
      return { state: this.state, messages };
    } catch (error) {
      if (this.abortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return this.cancelled(messages, observer);
      }
      const failure = {
        code: agentErrorCode(error),
        message: error instanceof Error ? error.message : "Agent run failed",
        retryable: true,
      };
      this.change(transitionAgentRun(this.state, { type: "fail", error: failure }), observer);
      return { state: this.state, messages };
    } finally {
      this.abortController = null;
    }
  }

  private async forceConsoleCheck(
    messages: ConversationMessage[],
    observer: AgentRunObserver,
  ): Promise<ToolExecutionResult> {
    const callId = this.ids.next("tool-call") as ToolCallId;
    const assistant: AssistantMessage = {
      id: this.ids.next("message"),
      role: "assistant",
      createdAt: this.clock.now(),
      content: [{ type: "tool-call", callId, toolName: CONSOLE_TOOL_NAME, input: {} }],
    };
    messages.push(assistant);
    observer.onMessage?.(assistant);
    this.change(transitionAgentRun(this.state, { type: "tools-requested", count: 1 }), observer);

    const output = await this.tools.execute(CONSOLE_TOOL_NAME, {}, {
      signal: this.abortController?.signal ?? new AbortController().signal,
    });
    const toolMessage: ToolMessage = {
      id: this.ids.next("message"),
      role: "tool",
      createdAt: this.clock.now(),
      callId,
      toolName: CONSOLE_TOOL_NAME,
      output,
    };
    messages.push(toolMessage);
    observer.onMessage?.(toolMessage);
    this.change(transitionAgentRun(this.state, { type: "tools-completed" }), observer);
    return output;
  }

  private hiddenConsoleFixRequest(): UserMessage {
    return {
      id: this.ids.next("message"),
      role: "user",
      createdAt: this.clock.now(),
      content: [{
        type: "text",
        text: [
          "Internal validation failed: the preview console still reports errors.",
          "Fix the reported syntax or runtime errors with project tools,",
          "then call get_console_logs again before giving a final response.",
        ].join(" "),
      }],
    };
  }

  private appendDelta(
    content: AssistantContent[],
    type: "text" | "reasoning",
    delta: string,
  ): void {
    const last = content.at(-1);
    if (last?.type === type) content[content.length - 1] = { type, text: last.text + delta };
    else content.push({ type, text: delta });
  }

  private cancelled(
    messages: readonly ConversationMessage[],
    observer: AgentRunObserver,
  ): AgentRunResult {
    this.change(transitionAgentRun(this.state, { type: "cancel" }), observer);
    return { state: this.state, messages };
  }

  private change(state: AgentRunState, observer: AgentRunObserver): void {
    this.state = state;
    observer.onStateChange?.(state);
  }
}

function agentErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "agent-run-failed";
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  const status = "status" in error ? Number((error as { status: unknown }).status) : undefined;
  if (code) return code;
  if (status === 401) return "backend-auth-required";
  return "agent-run-failed";
}

function isProjectMutationTool(toolName: string): boolean {
  return PROJECT_MUTATION_TOOLS.has(toolName);
}

function hasConsoleProblems(output: ToolExecutionResult): boolean {
  if (!output.ok) return true;
  const value = output.value;
  if (!isJsonRecord(value)) return false;
  const status = value.status;
  if (status === "failed") return true;
  const logs = value.logs;
  return Array.isArray(logs) && logs.some((entry) => {
    return isJsonRecord(entry) && (
      entry.method === "error" ||
      hasTerminalErrorText(entry.data)
    );
  });
}

function hasTerminalErrorText(data: unknown): boolean {
  const text = formatConsoleData(data)
    .split(/\r?\n/)
    .filter((line) => !isKnownConsoleNoise(line))
    .join("\n");
  if (!text) return false;
  return [
    /\bInternal server error\b/i,
    /\bThe service is no longer running\b/i,
    /\bThe service was stopped\b/i,
    /\bFailed to compile\b/i,
    /\bCompilation failed\b/i,
    /\bBuild failed\b/i,
    /\bTransform failed\b/i,
    /\bSyntaxError\b/i,
    /\bReferenceError\b/i,
    /\bTypeError\b/i,
    /\bError:\s+/i,
  ].some((pattern) => pattern.test(text));
}

function isKnownConsoleNoise(text: string): boolean {
  return [
    /"clearScreenDown" is not yet implemented/i,
  ].some((pattern) => pattern.test(text));
}

function formatConsoleData(data: unknown): string {
  if (Array.isArray(data)) return data.map(formatConsoleData).join("\n");
  if (typeof data === "string") return data;
  if (data instanceof Error) return `${data.name}: ${data.message}\n${data.stack ?? ""}`;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function isJsonRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
