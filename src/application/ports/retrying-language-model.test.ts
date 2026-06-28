import { describe, expect, it, vi } from "vitest";
import type {
  LanguageModelPort,
  ModelRequest,
  ModelStreamEvent,
} from "./language-model";
import {
  RetryingLanguageModel,
  type RetryScheduler,
} from "./retrying-language-model";

const request: ModelRequest = {
  messages: [],
  tools: [],
  signal: new AbortController().signal,
};

async function collect(model: LanguageModelPort): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of model.stream(request)) events.push(event);
  return events;
}

describe("RetryingLanguageModel", () => {
  it("retries pre-stream transient failures with bounded exponential delay", async () => {
    let attempts = 0;
    const source: LanguageModelPort = {
      async *stream() {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error("busy"), { status: 503 });
        yield { type: "text-delta", delta: "ok" };
        yield { type: "finish", reason: "stop" };
      },
    };
    const scheduler: RetryScheduler = { wait: vi.fn(async () => undefined) };
    const onRetry = vi.fn();
    const model = new RetryingLanguageModel(source, scheduler, {
      maxAttempts: 3,
      baseDelayMs: 100,
      onRetry,
    });

    expect(await collect(model)).toEqual([
      { type: "text-delta", delta: "ok" },
      { type: "finish", reason: "stop" },
    ]);
    expect(scheduler.wait).toHaveBeenNthCalledWith(1, 100, request.signal);
    expect(scheduler.wait).toHaveBeenNthCalledWith(2, 200, request.signal);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("does not replay a stream after any visible output", async () => {
    let attempts = 0;
    const source: LanguageModelPort = {
      async *stream() {
        attempts += 1;
        yield { type: "text-delta", delta: "partial" };
        throw Object.assign(new Error("connection lost"), { status: 503 });
      },
    };
    const model = new RetryingLanguageModel(
      source,
      { wait: vi.fn(async () => undefined) },
      { maxAttempts: 3 },
    );
    await expect(collect(model)).rejects.toThrow("connection lost");
    expect(attempts).toBe(1);
  });

  it("does not retry non-retryable client errors", async () => {
    const source: LanguageModelPort = {
      async *stream(): AsyncIterable<ModelStreamEvent> {
        throw Object.assign(new Error("unauthorized"), { status: 401 });
      },
    };
    const scheduler: RetryScheduler = { wait: vi.fn(async () => undefined) };
    await expect(
      collect(new RetryingLanguageModel(source, scheduler, { maxAttempts: 3 })),
    ).rejects.toThrow("unauthorized");
    expect(scheduler.wait).not.toHaveBeenCalled();
  });
});
