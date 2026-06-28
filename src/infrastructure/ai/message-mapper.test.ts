import { describe, expect, it } from "vitest";
import type {
  ConversationMessage,
  MessageId,
  ToolCallId,
} from "@/domain/conversation";
import {
  UnsupportedAttachmentError,
  assertProviderSupportsAttachments,
  mapDomainMessages,
} from "./message-mapper";

describe("AI SDK message mapper", () => {
  it("maps domain attachments, reasoning and tool pairs without changing domain data", () => {
    const callId = "call-1" as ToolCallId;
    const messages: ConversationMessage[] = [
      {
        id: "message-1" as MessageId,
        role: "user",
        createdAt: 1,
        content: [
          { type: "text", text: "Inspect" },
          { type: "image", mediaType: "image/png", data: "data:image/png;base64,abc" },
          {
            type: "file",
            name: "brief.pdf",
            mediaType: "application/pdf",
            data: "data:application/pdf;base64,abc",
            size: 3,
          },
        ],
      },
      {
        id: "message-2" as MessageId,
        role: "assistant",
        createdAt: 2,
        content: [
          { type: "reasoning", text: "Need files" },
          { type: "tool-call", callId, toolName: "list_files", input: {} },
        ],
      },
      {
        id: "message-3" as MessageId,
        role: "tool",
        createdAt: 3,
        callId,
        toolName: "list_files",
        output: { ok: true, value: ["src/App.tsx"] },
      },
    ];

    const mapped = mapDomainMessages(messages, "openai", "System prompt");
    expect(mapped.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(mapped[1]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "Inspect" },
        { type: "image", mediaType: "image/png" },
        { type: "file", mediaType: "application/pdf", filename: "brief.pdf" },
      ],
    });
    expect(mapped[2]).toMatchObject({
      role: "assistant",
      content: [
        { type: "reasoning", text: "Need files" },
        { type: "tool-call", toolCallId: callId, toolName: "list_files" },
      ],
    });
    expect(mapped[3]).toMatchObject({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: callId, output: { type: "json" } }],
    });
    expect(messages[0].role).toBe("user");
  });

  it("adds the Google thought-signature compatibility marker only at the adapter boundary", () => {
    const messages: ConversationMessage[] = [
      {
        id: "message-1" as MessageId,
        role: "assistant",
        createdAt: 1,
        content: [
          {
            type: "tool-call",
            callId: "call-1" as ToolCallId,
            toolName: "read_files",
            input: { paths: ["src/App.tsx"] },
          },
        ],
      },
    ];
    expect(mapDomainMessages(messages, "google")[0]).toMatchObject({
      content: [
        {
          providerOptions: {
            google: { thoughtSignature: "skip_thought_signature_validator" },
          },
        },
      ],
    });
    expect(messages[0]).not.toHaveProperty("providerOptions");
  });

  it("allows provider-supported image and PDF attachments", () => {
    const messages: ConversationMessage[] = [
      {
        id: "message-1" as MessageId,
        role: "user",
        createdAt: 1,
        content: [
          { type: "image", mediaType: "image/jpeg", data: "data:image/jpeg;base64,abc" },
          {
            type: "file",
            name: "brief.pdf",
            mediaType: "application/pdf",
            data: "data:application/pdf;base64,abc",
            size: 3,
          },
        ],
      },
    ];
    expect(() => assertProviderSupportsAttachments(messages, "openai")).not.toThrow();
    expect(() => assertProviderSupportsAttachments(messages, "anthropic")).not.toThrow();
    expect(() => assertProviderSupportsAttachments(messages, "google")).not.toThrow();
  });

  it("rejects files for OpenAI-compatible providers because their file support is not portable", () => {
    const messages: ConversationMessage[] = [
      {
        id: "message-1" as MessageId,
        role: "user",
        createdAt: 1,
        content: [
          {
            type: "file",
            name: "brief.pdf",
            mediaType: "application/pdf",
            data: "data:application/pdf;base64,abc",
            size: 3,
          },
        ],
      },
    ];
    expect(() => mapDomainMessages(messages, "openai-compatible")).toThrow(UnsupportedAttachmentError);
  });

  it("rejects unsupported file media types with a typed error", () => {
    const messages: ConversationMessage[] = [
      {
        id: "message-1" as MessageId,
        role: "user",
        createdAt: 1,
        content: [
          {
            type: "file",
            name: "archive.zip",
            mediaType: "application/zip",
            data: "data:application/zip;base64,abc",
            size: 3,
          },
        ],
      },
    ];
    expect(() => mapDomainMessages(messages, "openai")).toThrow(UnsupportedAttachmentError);
  });
});
