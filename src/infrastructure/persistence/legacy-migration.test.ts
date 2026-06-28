import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import { migrateLegacyPayloads, type LegacyPayloads } from "./legacy-migration";

function envelope(state: unknown, version = 0): string {
  return JSON.stringify({ state, version });
}

function completeFixture(): LegacyPayloads {
  return {
    settings: envelope({
      ai: {
        apiType: "openai-compatible",
        apiKey: "secret-key",
        apiUrl: "https://example.test/v1/chat/completions",
        model: "test-model",
      },
      webSearch: { tavilyApiKey: "tavily" },
      system: { language: "zh", theme: "dark", reverseProxy: true },
    }),
    conversations: envelope({
      activeId: "conv-1",
      conversations: {
        "conv-1": {
          id: "conv-1",
          title: "新应用",
          template: "vite-react-ts",
          isProjectInitialized: true,
          files: {
            "src/components/": "",
            "src/App.tsx": "export default function App() {}",
          },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Build it" },
                { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
              ],
            },
            {
              role: "assistant",
              content: "Working",
              thinking: "Plan",
              tool_calls: [
                {
                  id: "legacy-call",
                  function: { name: "write_file", arguments: '{"path":"src/App.tsx"}' },
                },
              ],
            },
            { role: "tool", tool_call_id: "legacy-call", content: "OK" },
          ],
          compressedContext: { summary: "Earlier work", fromIndex: 1 },
          pinned: true,
          createdAt: 10,
          updatedAt: 20,
        },
      },
    }),
    snapshots: envelope({
      snapshots: {
        "conv-1": [
          {
            id: "snapshot-1",
            conversationId: "conv-1",
            messageId: "assistant-1",
            patches: {},
            addedFiles: { "src/App.tsx": "export default function App() {}" },
            deletedFiles: [],
            createdAt: 20,
          },
        ],
      },
    }),
    memories: envelope({
      memories: [
        {
          id: "memory-1",
          content: "The user prefers React",
          category: "preference",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    }),
  };
}

describe("legacy database migration", () => {
  it("migrates all four stores without fake directory files", () => {
    const result = migrateLegacyPayloads(
      completeFixture(),
      new SequentialIdGenerator(),
      new FixedClock(1000),
    );
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value).toMatchObject({
      schemaVersion: 1,
      migratedAt: 1000,
      activeConversationId: "conv-1",
      settings: {
        ai: {
          apiKey: "secret-key",
          apiBaseUrl: "https://example.test/v1",
          model: "test-model",
        },
        webSearch: { engine: "tavily", tavilyApiKey: "tavily" },
        system: { language: "zh", theme: "dark" },
      },
      memories: [{ id: "memory-1", category: "preference" }],
    });
    const migrated = result.value.conversations["conv-1" as never];
    expect(migrated.conversation.title).toBeNull();
    expect(migrated.project.files).toEqual({
      "src/App.tsx": "export default function App() {}",
    });
    expect(migrated.project.directories).toContain("src/components");
    expect(migrated.project.initialized).toBe(true);
    expect(migrated.conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);

    const assistant = migrated.conversation.messages[1];
    const tool = migrated.conversation.messages[2];
    expect(assistant).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "Working" },
        { type: "reasoning", text: "Plan" },
        { type: "tool-call", toolName: "write_file" },
      ],
    });
    expect(tool).toMatchObject({ role: "tool", toolName: "write_file" });
    if (assistant.role !== "assistant" || tool.role !== "tool") throw new Error("invalid fixture");
    const call = assistant.content.find((block) => block.type === "tool-call");
    expect(call?.type === "tool-call" ? call.callId : null).toBe(tool.callId);

    // Legacy snapshot assistant index is rewritten to the stable assistant message ID.
    expect(result.value.snapshots["conv-1" as never][0].messageId).toBe(assistant.id);
  });

  it("returns a source-specific error for corrupted data", () => {
    const result = migrateLegacyPayloads(
      { ...completeFixture(), snapshots: "{bad-json" },
      new SequentialIdGenerator(),
      new FixedClock(1000),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-json",
        source: "snapshots",
        message: "snapshots contains invalid JSON",
      },
    });
  });

  it("creates a valid empty database when no legacy data exists", () => {
    const result = migrateLegacyPayloads(
      { settings: null, conversations: null, snapshots: null, memories: null },
      new SequentialIdGenerator(),
      new FixedClock(1000),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        activeConversationId: null,
        conversations: {},
        snapshots: {},
        memories: [],
      },
    });
  });
});
