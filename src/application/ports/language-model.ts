import type {
  ConversationMessage,
  JsonValue,
  ToolCallId,
} from "@/domain/conversation";

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonValue;
}

export interface ModelRequest {
  readonly systemPrompt?: string;
  readonly messages: readonly ConversationMessage[];
  readonly tools: readonly ModelToolDefinition[];
  readonly signal: AbortSignal;
}

export type ModelStreamEvent =
  | { readonly type: "text-delta"; readonly delta: string }
  | { readonly type: "reasoning-delta"; readonly delta: string }
  | {
      readonly type: "tool-call";
      readonly callId: ToolCallId;
      readonly toolName: string;
      readonly input: JsonValue;
    }
  | { readonly type: "finish"; readonly reason: "stop" | "tool-calls" | "length" };

export interface LanguageModelPort {
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
