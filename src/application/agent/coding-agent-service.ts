import type {
  ConversationId,
  ConversationMessage,
  UserContent,
  UserMessage,
} from "@/domain/conversation";
import type { Clock } from "@/shared/clock";
import type { IdGenerator } from "@/shared/id";
import { err, ok, type Result } from "@/shared/result";
import { createMemoryTool } from "@/application/memory";
import { ToolRegistry } from "@/application/ports/agent-tool";
import type { AgentTool } from "@/application/ports/agent-tool";
import type { LanguageModelPort } from "@/application/ports/language-model";
import type { TemplateCatalog } from "@/application/ports/template-catalog";
import {
  createProjectTools,
  createInitProjectTool,
  PreviewProjectToolPort,
  SessionProjectToolPort,
} from "@/application/project";
import {
  createPreviewConsoleTool,
  type PreviewCoordinator,
} from "@/application/preview";
import type {
  ApplicationError,
  ApplicationSession,
} from "@/application/session";
import {
  AgentRunController,
  type AgentRunObserver,
  type AgentRunResult,
} from "./agent-run-controller";

export interface CodingAgentError {
  readonly code: "conversation-not-found" | "run-already-active" | "session-error";
  readonly message: string;
}

export interface CodingAgentRunOptions {
  readonly observer?: AgentRunObserver;
  readonly extraTools?: ConstructorParameters<typeof ToolRegistry>[0];
  readonly hiddenContext?: string;
  readonly interruptedPreviousRun?: boolean;
}

interface ActiveAgentRun {
  readonly controller: AgentRunController;
  readonly finished: Promise<Result<AgentRunResult, CodingAgentError>>;
}

export class CodingAgentService {
  private readonly activeRuns = new Map<ConversationId, ActiveAgentRun>();

  constructor(
    private readonly session: ApplicationSession,
    private readonly model: LanguageModelPort,
    private readonly preview: PreviewCoordinator,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly templates?: TemplateCatalog,
    private readonly baseTools: readonly AgentTool[] = [],
  ) {}

  async run(
    conversationId: ConversationId,
    userContent: readonly UserContent[],
    options: CodingAgentRunOptions = {},
  ): Promise<Result<AgentRunResult, CodingAgentError>> {
    if (this.activeRuns.has(conversationId)) {
      return err({
        code: "run-already-active",
        message: `An Agent run is already active for ${conversationId}`,
      });
    }
    const persisted = this.session.snapshot().conversations[conversationId];
    if (!persisted) {
      return err({ code: "conversation-not-found", message: `Conversation not found: ${conversationId}` });
    }
    const userMessage: UserMessage = {
      id: this.ids.next("message"),
      role: "user",
      createdAt: this.clock.now(),
      content: userContent,
    };
    const appended = await this.session.appendConversationMessages(conversationId, [userMessage]);
    if (!appended.ok) return this.sessionError(appended.error);

    const sessionProject = new SessionProjectToolPort(this.session, conversationId);
    const project = new PreviewProjectToolPort(sessionProject, this.preview, conversationId);
    const tools = new ToolRegistry([
      ...(this.templates
        ? [createInitProjectTool(this.session, conversationId, this.templates, this.preview)]
        : []),
      ...createProjectTools(project),
      createMemoryTool(this.session),
      createPreviewConsoleTool(
        this.preview,
        () =>
          ({
            conversationId,
            revision: this.session.snapshot().conversations[conversationId]?.conversation.projectRevision ?? -1,
          }),
      ),
      ...(options.extraTools ?? []),
      ...this.baseTools,
    ]);
    const controller = new AgentRunController(this.model, tools, this.ids, this.clock);
    const runPromise = this.executeRun({
      conversationId,
      userMessage,
      userContent,
      options,
      controller,
      sessionProject,
    });
    this.activeRuns.set(conversationId, { controller, finished: runPromise });
    return runPromise;
  }

  async interruptAndRun(
    conversationId: ConversationId,
    userContent: readonly UserContent[],
    options: CodingAgentRunOptions = {},
  ): Promise<Result<AgentRunResult, CodingAgentError>> {
    const active = this.activeRuns.get(conversationId);
    if (active) {
      active.controller.cancel();
      await active.finished;
    }
    return this.run(conversationId, userContent, {
      ...options,
      interruptedPreviousRun: true,
    });
  }

  cancel(conversationId: ConversationId): boolean {
    const active = this.activeRuns.get(conversationId);
    if (!active) return false;
    active.controller.cancel();
    return true;
  }

  private async executeRun({
    conversationId,
    userMessage,
    userContent,
    options,
    controller,
    sessionProject,
  }: {
    readonly conversationId: ConversationId;
    readonly userMessage: UserMessage;
    readonly userContent: readonly UserContent[];
    readonly options: CodingAgentRunOptions;
    readonly controller: AgentRunController;
    readonly sessionProject: SessionProjectToolPort;
  }): Promise<Result<AgentRunResult, CodingAgentError>> {
    try {
      const current = this.session.snapshot().conversations[conversationId];
      const conversation = current.conversation;
      const initialMessages = current.compressedContext
        ? conversation.messages.slice(current.compressedContext.fromIndex)
        : conversation.messages;
      const modelMessages = options.hiddenContext
        ? withHiddenContext(initialMessages, userMessage.id, options.hiddenContext)
        : initialMessages;
      const projectTree = await sessionProject.snapshot();
      // Persist each generated message as soon as it is produced, so assistant
      // text, tool calls and tool results render live during the run instead of
      // appearing all at once when it finishes. The session queue preserves order.
      let persistChain: Promise<Result<void, ApplicationError>> = Promise.resolve(ok(undefined));
      const liveObserver: AgentRunObserver = {
        onStateChange: options.observer?.onStateChange,
        onDelta: options.observer?.onDelta,
        onMessage: (message) => {
          persistChain = persistChain.then(() =>
            this.session.appendConversationMessages(conversationId, [message]),
          );
          options.observer?.onMessage?.(message);
        },
      };
      const result = await controller.run(modelMessages, liveObserver, {
        systemPrompt: buildCodingAgentPrompt(
          projectTree.files.keys(),
          this.session.memoryPrompt(),
          current.compressedContext?.summary,
          runInstructionForUserContent(userContent, options.interruptedPreviousRun === true),
        ),
      });
      const persisted = await persistChain;
      return persisted.ok ? ok(result) : this.sessionError(persisted.error);
    } finally {
      this.activeRuns.delete(conversationId);
    }
  }

  private sessionError<T>(error: ApplicationError): Result<T, CodingAgentError> {
    return err({ code: "session-error", message: error.message });
  }
}

function withHiddenContext(
  messages: readonly ConversationMessage[],
  targetId: UserMessage["id"],
  hiddenContext: string,
): readonly ConversationMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || message.id !== targetId) return message;
    const textIndex = message.content.findIndex((part) => part.type === "text");
    if (textIndex === -1) {
      return {
        ...message,
        content: [{ type: "text" as const, text: hiddenContext }, ...message.content],
      };
    }
    return {
      ...message,
      content: message.content.map((part, index) =>
        index === textIndex && part.type === "text"
          ? { ...part, text: `${part.text}\n\n${hiddenContext}` }
          : part,
      ),
    };
  });
}

export function buildCodingAgentPrompt(
  paths: Iterable<string>,
  memorySection = "",
  conversationSummary?: string,
  languageInstruction = defaultLanguageInstruction(),
): string {
  const files = [...paths].sort();
  return [
    "You are Open Vibe Coding, a friendly online vibe coding agent for beginners.",
    languageInstruction,
    "Turn plain-language ideas into playful, complete, accessible, secure web applications using the provided project tools.",
    "Keep the experience encouraging and easy to understand, while still writing production-quality code.",
    "Always inspect relevant files before editing. Prefer exact patches over full rewrites.",
    "For multi-file apps, organize source files into clear subdirectories such as src/, src/components/, src/styles/, or src/lib/ instead of flattening everything at the project root.",
    "Keep the rendered app connected to the actual Vite entry chain: index.html must load src/index.* or src/main.*, and that entry must render the App/component files you edit. Do not create a second unused App or index file.",
    "Use manage_dependencies by editing package.json only when a dependency is required.",
    "Before declaring completion, call get_console_logs and fix every runtime or syntax error.",
    files.length > 0
      ? `Current project files:\n${files.map((path) => `- ${path}`).join("\n")}`
      : "The project is currently empty.",
    memorySection,
    conversationSummary
      ? `<conversation_summary>\n${conversationSummary}\n</conversation_summary>`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function runInstructionForUserContent(content: readonly UserContent[], interruptedPreviousRun: boolean): string {
  const visibleText = content
    .filter((part): part is Extract<UserContent, { readonly type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return [
    "Language rule for this run:",
    "Infer the user's language from the latest visible user request and use that same language for the entire run.",
    "This applies to all user-visible reasoning text, progress narration, questions, intermediate assistant messages, and the final response.",
    "Do not switch to English unless the user wrote in English or explicitly asks for English.",
    "Ignore hidden technical context, file names, code, package names, logs, and tool outputs when choosing the response language.",
    interruptedPreviousRun ? [
      "Interruption rule:",
      "The previous agent run was interrupted because the user sent a newer request while work was in progress.",
      "Prioritize the latest visible user request below and adapt any partially completed work accordingly.",
      "Do not continue the old direction if it conflicts with this newer request.",
    ].join("\n") : "",
    visibleText ? `Latest visible user request:\n${visibleText}` : "",
  ].filter(Boolean).join("\n");
}

function defaultLanguageInstruction(): string {
  return [
    "Language rule:",
    "Use the same natural language as the user's latest visible request for all user-visible reasoning text, progress narration, questions, intermediate assistant messages, and final responses.",
  ].join("\n");
}
