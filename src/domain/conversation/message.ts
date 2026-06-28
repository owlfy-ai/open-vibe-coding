import type { EntityId } from "@/shared/id";

export type MessageId = EntityId<"message">;
export type ToolCallId = EntityId<"tool-call">;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type UserContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly mediaType: string;
      readonly data: string;
      readonly name?: string;
    }
  | {
      readonly type: "file";
      readonly mediaType: string;
      readonly data: string;
      readonly name: string;
      readonly size: number;
    };

export type AssistantContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning"; readonly text: string }
  | {
      readonly type: "tool-call";
      readonly callId: ToolCallId;
      readonly toolName: string;
      readonly input: JsonValue;
    };

export interface UserMessage {
  readonly id: MessageId;
  readonly role: "user";
  readonly createdAt: number;
  readonly content: readonly UserContent[];
}

export interface AssistantMessage {
  readonly id: MessageId;
  readonly role: "assistant";
  readonly createdAt: number;
  readonly content: readonly AssistantContent[];
}

export interface ToolMessage {
  readonly id: MessageId;
  readonly role: "tool";
  readonly createdAt: number;
  readonly callId: ToolCallId;
  readonly toolName: string;
  readonly output:
    | { readonly ok: true; readonly value: JsonValue }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
}

export type ConversationMessage = UserMessage | AssistantMessage | ToolMessage;

export function textOf(message: ConversationMessage): string {
  if (message.role === "tool") {
    return message.output.ok
      ? JSON.stringify(message.output.value)
      : message.output.error.message;
  }
  return message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}
