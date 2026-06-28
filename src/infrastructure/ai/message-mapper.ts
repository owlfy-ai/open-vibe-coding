import type {
  AssistantContent as AiAssistantContent,
  ModelMessage,
  ToolResultPart,
  UserContent as AiUserContent,
} from "ai";
import type { ConversationMessage } from "@/domain/conversation";
import type { AiProviderType } from "./provider-factory";

export class UnsupportedAttachmentError extends Error {
  constructor(
    readonly providerType: AiProviderType,
    readonly mediaType: string,
    readonly partType: "image" | "file",
  ) {
    super(`${providerType} does not support ${partType} attachment: ${mediaType}`);
    this.name = "UnsupportedAttachmentError";
  }
}

const PROVIDER_ATTACHMENT_CAPABILITIES: Readonly<
  Record<
    AiProviderType,
    {
      readonly images: boolean;
      readonly fileMediaTypes: readonly string[];
    }
  >
> = {
  openai: {
    images: true,
    fileMediaTypes: ["application/pdf", "text/plain", "text/markdown", "application/json"],
  },
  anthropic: {
    images: true,
    fileMediaTypes: ["application/pdf", "text/plain", "text/markdown"],
  },
  google: {
    images: true,
    fileMediaTypes: ["application/pdf", "text/plain", "text/markdown"],
  },
  "openai-compatible": {
    images: true,
    fileMediaTypes: [],
  },
};

export function mapDomainMessages(
  messages: readonly ConversationMessage[],
  providerType: AiProviderType,
  systemPrompt?: string,
): ModelMessage[] {
  assertProviderSupportsAttachments(messages, providerType);
  const output: ModelMessage[] = [];
  if (systemPrompt) output.push({ role: "system", content: systemPrompt });

  for (const message of messages) {
    if (message.role === "user") {
      const content: AiUserContent = message.content.map((part) => {
        if (part.type === "text") return { type: "text" as const, text: part.text };
        if (part.type === "image") {
          return {
            type: "image" as const,
            image: part.data,
            mediaType: part.mediaType,
          };
        }
        return {
          type: "file" as const,
          data: part.data,
          mediaType: part.mediaType,
          filename: part.name,
        };
      });
      output.push({ role: "user", content });
      continue;
    }

    if (message.role === "assistant") {
      const content: AiAssistantContent = message.content.map((part) => {
        if (part.type === "text" || part.type === "reasoning") return part;
        return {
          type: "tool-call" as const,
          toolCallId: part.callId,
          toolName: part.toolName,
          input: part.input,
          ...(providerType === "google"
            ? {
                providerOptions: {
                  google: { thoughtSignature: "skip_thought_signature_validator" },
                },
              }
            : {}),
        };
      });
      output.push({ role: "assistant", content });
      continue;
    }

    const result: ToolResultPart = {
      type: "tool-result",
      toolCallId: message.callId,
      toolName: message.toolName,
      output: message.output.ok
        ? { type: "json", value: message.output.value as never }
        : {
            type: "json",
            value: {
              ok: false,
              error: message.output.error,
            },
          },
    };
    const previous = output.at(-1);
    if (previous?.role === "tool" && Array.isArray(previous.content)) {
      previous.content.push(result);
    } else output.push({ role: "tool", content: [result] });
  }
  return output;
}

export function assertProviderSupportsAttachments(
  messages: readonly ConversationMessage[],
  providerType: AiProviderType,
): void {
  const capabilities = PROVIDER_ATTACHMENT_CAPABILITIES[providerType];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.content) {
      if (part.type === "image" && !capabilities.images) {
        throw new UnsupportedAttachmentError(providerType, part.mediaType, "image");
      }
      if (part.type === "file" && !capabilities.fileMediaTypes.includes(part.mediaType)) {
        throw new UnsupportedAttachmentError(providerType, part.mediaType, "file");
      }
    }
  }
}
