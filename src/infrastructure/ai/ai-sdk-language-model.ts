import {
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { JsonValue, ToolCallId } from "@/domain/conversation";
import type {
  LanguageModelPort,
  ModelRequest,
  ModelStreamEvent,
} from "@/application/ports/language-model";
import { mapDomainMessages } from "./message-mapper";
import type { AiProviderType } from "./provider-factory";

export interface AiSdkLanguageModelOptions {
  readonly model: LanguageModel;
  readonly providerType: AiProviderType;
  readonly systemPrompt?: string;
  readonly providerOptions?: Record<string, Record<string, unknown>>;
  readonly providerTools?: ToolSet;
  readonly providerManagedToolNames?: ReadonlySet<string>;
}

export class AiSdkLanguageModelAdapter implements LanguageModelPort {
  constructor(private readonly options: AiSdkLanguageModelOptions) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const localTools: ToolSet = {};
    for (const definition of request.tools) {
      localTools[definition.name] = tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.inputSchema as never),
      });
    }
    const tools = { ...localTools, ...(this.options.providerTools ?? {}) };
    const result = streamText({
      model: this.options.model,
      messages: mapDomainMessages(
        request.messages,
        this.options.providerType,
        request.systemPrompt ?? this.options.systemPrompt,
      ),
      tools,
      abortSignal: request.signal,
      maxRetries: 0,
      providerOptions: this.options.providerOptions as never,
    });
    let localToolCalls = 0;
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        yield { type: "text-delta", delta: part.text };
      } else if (part.type === "reasoning-delta") {
        yield { type: "reasoning-delta", delta: part.text };
      } else if (part.type === "tool-call") {
        if (this.options.providerManagedToolNames?.has(part.toolName)) continue;
        localToolCalls += 1;
        yield {
          type: "tool-call",
          callId: part.toolCallId as ToolCallId,
          toolName: part.toolName,
          input: toJsonValue(part.input),
        };
      } else if (part.type === "error") {
        throw part.error;
      } else if (part.type === "abort") {
        throw new DOMException("The model stream was aborted", "AbortError");
      } else if (part.type === "finish") {
        yield {
          type: "finish",
          reason: finishReason(part.finishReason, localToolCalls),
        };
      }
    }
  }
}

function finishReason(
  reason: string,
  localToolCalls: number,
): "stop" | "tool-calls" | "length" {
  if (localToolCalls > 0) return "tool-calls";
  return reason === "length" ? "length" : "stop";
}

function toJsonValue(input: unknown): JsonValue {
  if (input === null || typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return input;
  }
  if (Array.isArray(input)) return input.map(toJsonValue);
  if (typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, toJsonValue(value)]),
    );
  }
  return String(input ?? "");
}
