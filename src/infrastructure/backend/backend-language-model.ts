import type {
  LanguageModelPort,
  ModelRequest,
  ModelStreamEvent,
} from "@/application/ports/language-model";
import type { JsonValue, ToolCallId } from "@/domain/conversation";
import type { BackendClient } from "./backend-client";

export class BackendLanguageModelAdapter implements LanguageModelPort {
  constructor(private readonly backend: BackendClient) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const payload = toJsonValue({
      ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
      messages: request.messages,
      tools: request.tools,
    });
    for await (const event of this.backend.streamAgent(payload, request.signal)) {
      yield normalizeStreamEvent(event);
    }
  }
}

function normalizeStreamEvent(value: JsonValue): ModelStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Backend stream event is not valid");
  }
  if (value.type === "text-delta") {
    return { type: "text-delta", delta: String(value.delta ?? "") };
  }
  if (value.type === "reasoning-delta") {
    return { type: "reasoning-delta", delta: String(value.delta ?? "") };
  }
  if (value.type === "tool-call") {
    return {
      type: "tool-call",
      callId: String(value.callId ?? "") as ToolCallId,
      toolName: String(value.toolName ?? ""),
      input: toJsonValue(value.input),
    };
  }
  if (value.type === "finish") {
    return {
      type: "finish",
      reason: value.reason === "tool-calls" || value.reason === "length" ? value.reason : "stop",
    };
  }
  throw new Error(`Unsupported backend stream event: ${value.type}`);
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }
  return String(value ?? "");
}
