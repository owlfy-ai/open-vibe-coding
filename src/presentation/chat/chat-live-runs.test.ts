import { describe, expect, it } from "vitest";
import type { ConversationId } from "@/domain/conversation";
import { liveRunFor, reduceChatLiveRuns, type ChatLiveRuns } from "./chat-live-runs";

describe("chat live runs", () => {
  it("keeps simultaneous streaming output isolated by conversation", () => {
    const first = "conversation-a" as ConversationId;
    const second = "conversation-b" as ConversationId;
    let runs: ChatLiveRuns = {};

    runs = reduceChatLiveRuns(runs, { type: "delta", conversationId: first, kind: "text", value: "first" });
    runs = reduceChatLiveRuns(runs, { type: "delta", conversationId: second, kind: "text", value: "second" });
    runs = reduceChatLiveRuns(runs, { type: "delta", conversationId: first, kind: "text", value: " reply" });

    expect(liveRunFor(runs, first).text).toBe("first reply");
    expect(liveRunFor(runs, second).text).toBe("second");
  });

  it("clears only the conversation whose assistant message was persisted", () => {
    const first = "conversation-a" as ConversationId;
    const second = "conversation-b" as ConversationId;
    let runs: ChatLiveRuns = {};

    runs = reduceChatLiveRuns(runs, { type: "delta", conversationId: first, kind: "reasoning", value: "thinking" });
    runs = reduceChatLiveRuns(runs, { type: "delta", conversationId: second, kind: "text", value: "still running" });
    runs = reduceChatLiveRuns(runs, { type: "clear-output", conversationId: first });

    expect(liveRunFor(runs, first)).toMatchObject({ text: "", reasoning: "", state: { status: "idle" } });
    expect(liveRunFor(runs, second).text).toBe("still running");
  });
});
