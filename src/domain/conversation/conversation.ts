import type { EntityId } from "@/shared/id";
import type { ConversationMessage } from "./message";

export type ConversationId = EntityId<"conversation">;

export interface Conversation {
  readonly id: ConversationId;
  readonly title: string | null;
  readonly messages: readonly ConversationMessage[];
  readonly projectRevision: number;
  readonly template: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function appendMessages(
  conversation: Conversation,
  messages: readonly ConversationMessage[],
  timestamp: number,
): Conversation {
  if (messages.length === 0) return conversation;
  const existing = new Set(conversation.messages.map((message) => message.id));
  for (const message of messages) {
    if (existing.has(message.id)) {
      throw new Error(`Duplicate message id: ${message.id}`);
    }
    existing.add(message.id);
  }
  return {
    ...conversation,
    messages: [...conversation.messages, ...messages],
    updatedAt: timestamp,
  };
}
