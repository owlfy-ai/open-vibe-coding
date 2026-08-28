import type { AgentRunState } from "@/domain/agent";
import type { ConversationId } from "@/domain/conversation";

export interface ChatLiveRun {
  readonly state: AgentRunState;
  readonly text: string;
  readonly reasoning: string;
  readonly reasoningOpen: boolean;
}

export type ChatLiveRuns = Readonly<Partial<Record<ConversationId, ChatLiveRun>>>;

export type ChatLiveRunEvent =
  | { readonly type: "clear-output"; readonly conversationId: ConversationId }
  | { readonly type: "state"; readonly conversationId: ConversationId; readonly state: AgentRunState }
  | {
      readonly type: "delta";
      readonly conversationId: ConversationId;
      readonly kind: "text" | "reasoning";
      readonly value: string;
    }
  | { readonly type: "reasoning-open"; readonly conversationId: ConversationId; readonly open: boolean };

export const EMPTY_CHAT_LIVE_RUN: ChatLiveRun = {
  state: { status: "idle" },
  text: "",
  reasoning: "",
  reasoningOpen: true,
};

export function reduceChatLiveRuns(current: ChatLiveRuns, event: ChatLiveRunEvent): ChatLiveRuns {
  const previous = current[event.conversationId] ?? EMPTY_CHAT_LIVE_RUN;
  let next: ChatLiveRun;

  switch (event.type) {
    case "clear-output":
      next = { ...previous, text: "", reasoning: "", reasoningOpen: true };
      break;
    case "state":
      next = { ...previous, state: event.state };
      break;
    case "delta":
      next = event.kind === "reasoning"
        ? { ...previous, reasoning: previous.reasoning + event.value }
        : { ...previous, text: previous.text + event.value, reasoningOpen: false };
      break;
    case "reasoning-open":
      next = { ...previous, reasoningOpen: event.open };
      break;
  }

  return { ...current, [event.conversationId]: next };
}

export function liveRunFor(runs: ChatLiveRuns, conversationId: ConversationId | null): ChatLiveRun {
  return conversationId ? runs[conversationId] ?? EMPTY_CHAT_LIVE_RUN : EMPTY_CHAT_LIVE_RUN;
}
