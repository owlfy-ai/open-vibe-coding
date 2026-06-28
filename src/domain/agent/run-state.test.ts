import { describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "@/shared/id";
import {
  InvalidAgentTransitionError,
  transitionAgentRun,
  type AgentRunState,
} from "./run-state";

describe("agent run state machine", () => {
  it("moves through a tool iteration and completes", () => {
    const runId = new SequentialIdGenerator().next("agent-run");
    let state: AgentRunState = { status: "idle" };
    state = transitionAgentRun(state, { type: "start", runId });
    state = transitionAgentRun(state, { type: "stream-started" });
    state = transitionAgentRun(state, { type: "tools-requested", count: 2 });
    state = transitionAgentRun(state, { type: "tools-completed" });
    expect(state).toEqual({ status: "preparing", runId, iteration: 2 });
    state = transitionAgentRun(state, { type: "stream-started" });
    state = transitionAgentRun(state, { type: "complete" });
    expect(state).toEqual({ status: "completed", runId, iterations: 2 });
  });

  it("rejects illegal transitions", () => {
    expect(() => transitionAgentRun({ status: "idle" }, { type: "complete" })).toThrow(
      InvalidAgentTransitionError,
    );
  });
});
