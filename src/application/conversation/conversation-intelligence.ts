import {
  textOf,
  type Conversation,
  type ConversationId,
  type ConversationMessage,
  type UserMessage,
} from "@/domain/conversation";
import type { Clock } from "@/shared/clock";
import type { IdGenerator } from "@/shared/id";
import { err, ok, type Result } from "@/shared/result";
import type { LanguageModelPort } from "@/application/ports/language-model";
import type { ApplicationSession } from "@/application/session";
import { collectModelText } from "./model-text";

export interface ConversationIntelligenceError {
  readonly code: "conversation-not-found" | "insufficient-history" | "empty-result" | "session-error" | "backend-auth-required";
  readonly message: string;
}

export class ConversationIntelligenceService {
  constructor(
    private readonly session: ApplicationSession,
    private readonly model: LanguageModelPort,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async compress(
    conversationId: ConversationId,
    signal = new AbortController().signal,
  ): Promise<Result<{ summary: string; fromIndex: number }, ConversationIntelligenceError>> {
    const persisted = this.session.snapshot().conversations[conversationId];
    if (!persisted) return this.notFound(conversationId);
    const messages = persisted.conversation.messages;
    const userIndices = messages.flatMap((message, index) =>
      message.role === "user" ? [index] : [],
    );
    if (userIndices.length < 2) {
      return err({
        code: "insufficient-history",
        message: "At least two user turns are required before compression",
      });
    }
    const fromIndex = userIndices.at(-1) ?? 0;
    const existing = persisted.compressedContext;
    const source = [
      ...(existing ? [`Previous summary:\n${existing.summary}`] : []),
      serializeMessages(messages.slice(existing?.fromIndex ?? 0, fromIndex)),
    ]
      .filter(Boolean)
      .join("\n\n");
    const summaryResult = await this.collectText(
      "Summarize this coding conversation. Preserve requirements, architecture decisions, changed files, unresolved errors, and the current task. Return only the concise summary.",
      [this.textMessage(source)],
      signal,
    );
    if (!summaryResult.ok) return summaryResult;
    const summary = summaryResult.value;
    if (!summary) return err({ code: "empty-result", message: "The model returned an empty summary" });
    const context = { summary, fromIndex };
    const saved = await this.session.setCompressedContext(conversationId, context);
    return saved.ok ? ok(context) : err({ code: "session-error", message: saved.error.message });
  }

  async generateTitle(
    conversationId: ConversationId,
    signal = new AbortController().signal,
  ): Promise<Result<string, ConversationIntelligenceError>> {
    const persisted = this.session.snapshot().conversations[conversationId];
    if (!persisted) return this.notFound(conversationId);
    const source = serializeMessages(
      persisted.conversation.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .slice(0, 6),
      240,
    );
    if (!source) return err({ code: "insufficient-history", message: "No conversation text is available" });
    const titleResult = await this.collectText(
      "Create a concise 4-12 word title for this coding task in the user's language. Return only the title.",
      [this.textMessage(source)],
      signal,
    );
    if (!titleResult.ok) return titleResult;
    const title = sanitizeTitle(titleResult.value);
    if (!title) return err({ code: "empty-result", message: "The model returned an invalid title" });
    const saved = await this.session.updateConversation(conversationId, { title });
    return saved.ok ? ok(title) : err({ code: "session-error", message: saved.error.message });
  }

  async generateInitialTitle(
    conversationId: ConversationId,
    signal = new AbortController().signal,
  ): Promise<Result<string | null, ConversationIntelligenceError>> {
    const persisted = this.session.snapshot().conversations[conversationId];
    if (!persisted) return this.notFound(conversationId);
    if (!canAutoTitleInitialConversation(persisted.conversation)) return ok(null);

    const source = serializeMessages(
      persisted.conversation.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .slice(0, 6),
      240,
    );
    if (!source) return ok(null);
    const title = sanitizeTitle(
      await collectModelText(
        this.model,
        "Create a short, descriptive title for this first completed coding task in the user's language. Return only the title, without quotation marks, Markdown, or ending punctuation.",
        [this.textMessage(source)],
        signal,
      ),
    );
    if (!title) return err({ code: "empty-result", message: "The model returned an invalid title" });

    // The user may rename the conversation or start another turn while the
    // title request is in flight. Check again before replacing anything.
    const latest = this.session.snapshot().conversations[conversationId];
    if (!latest) return this.notFound(conversationId);
    if (!canAutoTitleInitialConversation(latest.conversation)) return ok(null);
    const saved = await this.session.updateConversation(conversationId, { title });
    return saved.ok ? ok(title) : err({ code: "session-error", message: saved.error.message });
  }

  private textMessage(text: string): UserMessage {
    return {
      id: this.ids.next("message"),
      role: "user",
      createdAt: this.clock.now(),
      content: [{ type: "text", text }],
    };
  }

  private async collectText(
    systemPrompt: string,
    messages: readonly UserMessage[],
    signal: AbortSignal,
  ): Promise<Result<string, ConversationIntelligenceError>> {
    try {
      return ok(await collectModelText(this.model, systemPrompt, messages, signal));
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : undefined;
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
      if (status === 401 || code === "backend-auth-required") {
        return err({
          code: "backend-auth-required",
          message: error instanceof Error ? error.message : "Sign in required",
        });
      }
      throw error;
    }
  }

  private notFound<T>(conversationId: ConversationId): Result<T, ConversationIntelligenceError> {
    return err({ code: "conversation-not-found", message: `Conversation not found: ${conversationId}` });
  }
}

function serializeMessages(messages: readonly ConversationMessage[], limit = 2_000): string {
  return messages
    .map((message) => `${message.role}: ${textOf(message).slice(0, limit)}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

function sanitizeTitle(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!。！]+$/, "")
    .slice(0, 80)
    .trim();
}

function canAutoTitleInitialConversation(conversation: Conversation): boolean {
  return !conversation.title?.trim() &&
    conversation.messages.filter((message) => message.role === "user").length === 1 &&
    conversation.messages.some((message) => message.role === "assistant");
}
