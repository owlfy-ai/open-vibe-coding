import type { EntityId } from "@/shared/id";

export type AgentRunId = EntityId<"agent-run">;

export type AgentRunState =
  | { readonly status: "idle" }
  | { readonly status: "preparing"; readonly runId: AgentRunId; readonly iteration: number }
  | { readonly status: "streaming"; readonly runId: AgentRunId; readonly iteration: number }
  | {
      readonly status: "executing-tools";
      readonly runId: AgentRunId;
      readonly iteration: number;
      readonly pendingTools: number;
    }
  | { readonly status: "completed"; readonly runId: AgentRunId; readonly iterations: number }
  | { readonly status: "cancelled"; readonly runId: AgentRunId; readonly iteration: number }
  | {
      readonly status: "failed";
      readonly runId: AgentRunId;
      readonly iteration: number;
      readonly error: AgentRunError;
    };

export interface AgentRunError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type AgentRunEvent =
  | { readonly type: "start"; readonly runId: AgentRunId }
  | { readonly type: "stream-started" }
  | { readonly type: "tools-requested"; readonly count: number }
  | { readonly type: "tools-completed" }
  | { readonly type: "complete" }
  | { readonly type: "cancel" }
  | { readonly type: "fail"; readonly error: AgentRunError };

export class InvalidAgentTransitionError extends Error {
  constructor(state: AgentRunState["status"], event: AgentRunEvent["type"]) {
    super(`Cannot apply agent event "${event}" while state is "${state}"`);
    this.name = "InvalidAgentTransitionError";
  }
}

export function transitionAgentRun(
  state: AgentRunState,
  event: AgentRunEvent,
): AgentRunState {
  if (state.status === "idle" && event.type === "start") {
    return { status: "preparing", runId: event.runId, iteration: 1 };
  }
  if (state.status === "preparing" && event.type === "stream-started") {
    return { status: "streaming", runId: state.runId, iteration: state.iteration };
  }
  if (state.status === "streaming" && event.type === "tools-requested" && event.count > 0) {
    return {
      status: "executing-tools",
      runId: state.runId,
      iteration: state.iteration,
      pendingTools: event.count,
    };
  }
  if (state.status === "executing-tools" && event.type === "tools-completed") {
    return { status: "preparing", runId: state.runId, iteration: state.iteration + 1 };
  }
  if ((state.status === "streaming" || state.status === "preparing") && event.type === "complete") {
    return { status: "completed", runId: state.runId, iterations: state.iteration };
  }
  if (
    (state.status === "preparing" ||
      state.status === "streaming" ||
      state.status === "executing-tools") &&
    event.type === "cancel"
  ) {
    return { status: "cancelled", runId: state.runId, iteration: state.iteration };
  }
  if (
    (state.status === "preparing" ||
      state.status === "streaming" ||
      state.status === "executing-tools") &&
    event.type === "fail"
  ) {
    return {
      status: "failed",
      runId: state.runId,
      iteration: state.iteration,
      error: event.error,
    };
  }
  throw new InvalidAgentTransitionError(state.status, event.type);
}
