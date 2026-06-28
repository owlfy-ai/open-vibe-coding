import { describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "@/shared/id";
import { appendMessages, type Conversation } from "./conversation";

describe("conversation", () => {
  it("uses stable message ids and rejects duplicates", () => {
    const ids = new SequentialIdGenerator();
    const message = {
      id: ids.next("message"),
      role: "user" as const,
      createdAt: 1,
      content: [{ type: "text" as const, text: "build an app" }],
    };
    const conversation: Conversation = {
      id: ids.next("conversation"),
      title: null,
      messages: [],
      projectRevision: 0,
      template: "vite-react-ts",
      pinned: false,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const updated = appendMessages(conversation, [message], 2);
    expect(updated.messages[0].id).toBe(message.id);
    expect(() => appendMessages(updated, [message], 3)).toThrow("Duplicate message id");
  });
});
