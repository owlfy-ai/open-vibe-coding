import type {
  AssistantContent,
  Conversation,
  ConversationId,
  ConversationMessage,
  JsonValue,
  MessageId,
  ToolCallId,
  UserContent,
} from "@/domain/conversation";
import { importLegacyProjectFiles } from "@/domain/project";
import { ProjectHistory, type ProjectSnapshot } from "@/domain/snapshot";
import type { MemoryId, MemoryItem } from "@/domain/memory";
import type { AppSettings } from "@/domain/settings";
import { applyPatch } from "diff";
import type { Clock } from "@/shared/clock";
import type { IdGenerator } from "@/shared/id";
import { err, ok, type Result } from "@/shared/result";
import {
  CURRENT_DATABASE_VERSION,
  type AppDatabaseV1,
  type PersistedConversation,
} from "./schema";

export interface LegacyPayloads {
  readonly settings: string | null;
  readonly conversations: string | null;
  readonly snapshots: string | null;
  readonly memories: string | null;
}

export interface MigrationError {
  readonly code: "invalid-json" | "invalid-envelope" | "invalid-data" | "storage-error";
  readonly source: keyof LegacyPayloads;
  readonly message: string;
}

type UnknownRecord = Record<string, unknown>;

export function migrateLegacyPayloads(
  payloads: LegacyPayloads,
  ids: IdGenerator,
  clock: Clock,
): Result<AppDatabaseV1, MigrationError> {
  const settingsState = readEnvelope(payloads.settings, "settings");
  if (!settingsState.ok) return settingsState;
  const conversationState = readEnvelope(payloads.conversations, "conversations");
  if (!conversationState.ok) return conversationState;
  const snapshotState = readEnvelope(payloads.snapshots, "snapshots");
  if (!snapshotState.ok) return snapshotState;
  const memoryState = readEnvelope(payloads.memories, "memories");
  if (!memoryState.ok) return memoryState;

  const migratedConversations = migrateConversations(conversationState.value, ids);
  if (!migratedConversations.ok) return migratedConversations;
  const snapshots = migrateSnapshots(
    snapshotState.value,
    migratedConversations.value.snapshotMessageIds,
    ids,
    clock,
  );
  if (!snapshots.ok) return snapshots;
  const memories = migrateMemories(memoryState.value);
  if (!memories.ok) return memories;

  const requestedActive = optionalString(conversationState.value.activeId);
  const activeConversationId =
    requestedActive && requestedActive in migratedConversations.value.conversations
      ? (requestedActive as ConversationId)
      : null;

  return ok({
    schemaVersion: CURRENT_DATABASE_VERSION,
    migratedAt: clock.now(),
    activeConversationId,
    settings: migrateSettings(settingsState.value),
    conversations: migratedConversations.value.conversations,
    snapshots: snapshots.value,
    memories: memories.value,
  });
}

function readEnvelope(
  raw: string | null,
  source: keyof LegacyPayloads,
): Result<UnknownRecord, MigrationError> {
  if (raw === null) return ok({});
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ code: "invalid-json", source, message: `${source} contains invalid JSON` });
  }
  if (!isRecord(parsed)) {
    return err({ code: "invalid-envelope", source, message: `${source} must be an object` });
  }
  const state = "state" in parsed ? parsed.state : parsed;
  if (!isRecord(state)) {
    return err({ code: "invalid-envelope", source, message: `${source}.state must be an object` });
  }
  return ok(state);
}

function migrateConversations(
  state: UnknownRecord,
  ids: IdGenerator,
): Result<
  {
    conversations: Record<ConversationId, PersistedConversation>;
    snapshotMessageIds: Record<ConversationId, Readonly<Record<string, MessageId>>>;
  },
  MigrationError
> {
  const input = state.conversations ?? {};
  if (!isRecord(input)) {
    return invalidData("conversations", "conversations must be an object");
  }
  const output: Record<ConversationId, PersistedConversation> = {};
  const snapshotMessageIds: Record<ConversationId, Record<string, MessageId>> = {};
  for (const [legacyId, rawConversation] of Object.entries(input)) {
    if (!isRecord(rawConversation)) {
      return invalidData("conversations", `conversation ${legacyId} must be an object`);
    }
    const rawFiles = rawConversation.files ?? {};
    if (!isStringRecord(rawFiles)) {
      return invalidData("conversations", `conversation ${legacyId} files must be strings`);
    }
    const project = importLegacyProjectFiles(rawFiles);
    if (!project.ok) {
      return invalidData("conversations", `conversation ${legacyId}: ${project.error.message}`);
    }
    const messageResult = migrateMessages(rawConversation.messages, ids);
    if (!messageResult.ok) return messageResult;
    const conversationId = legacyId as ConversationId;
    const createdAt = numberOr(rawConversation.createdAt, 0);
    const updatedAt = numberOr(rawConversation.updatedAt, createdAt);
    const conversation: Conversation = {
      id: conversationId,
      title: normalizeLegacyTitle(optionalString(rawConversation.title)),
      messages: messageResult.value.messages,
      projectRevision: 0,
      template: optionalString(rawConversation.template) ?? "vite-react-ts",
      pinned: rawConversation.pinned === true,
      archived: rawConversation.archived === true,
      createdAt,
      updatedAt,
    };
    const compressed = isRecord(rawConversation.compressedContext)
      ? {
          summary: optionalString(rawConversation.compressedContext.summary) ?? "",
          fromIndex: numberOr(rawConversation.compressedContext.fromIndex, 0),
        }
      : undefined;
    output[conversationId] = {
      conversation,
      project: {
        revision: project.value.revision,
        files: Object.fromEntries(project.value.files),
        directories: [...project.value.directories],
        initialized: rawConversation.isProjectInitialized === true,
      },
      ...(compressed ? { compressedContext: compressed } : {}),
    };
    snapshotMessageIds[conversationId] = messageResult.value.snapshotMessageIds;
  }
  return ok({ conversations: output, snapshotMessageIds });
}

function migrateMessages(
  rawMessages: unknown,
  ids: IdGenerator,
): Result<
  { messages: ConversationMessage[]; snapshotMessageIds: Record<string, MessageId> },
  MigrationError
> {
  if (rawMessages === undefined) return ok({ messages: [], snapshotMessageIds: {} });
  if (!Array.isArray(rawMessages)) {
    return invalidData("conversations", "conversation messages must be an array");
  }
  const callIds = new Map<string, ToolCallId>();
  const messages: ConversationMessage[] = [];
  const snapshotMessageIds: Record<string, MessageId> = {};
  for (let rawIndex = 0; rawIndex < rawMessages.length; rawIndex += 1) {
    const rawMessage = rawMessages[rawIndex];
    if (!isRecord(rawMessage)) {
      return invalidData("conversations", "message must be an object");
    }
    const id = ids.next("message") as MessageId;
    const createdAt = numberOr(rawMessage.createdAt, 0);
    if (rawMessage.role === "user") {
      messages.push({ id, role: "user", createdAt, content: migrateUserContent(rawMessage.content) });
    } else if (rawMessage.role === "assistant") {
      snapshotMessageIds[`assistant-${rawIndex}`] = id;
      const content: AssistantContent[] = [];
      const text = optionalString(rawMessage.content);
      if (text) content.push({ type: "text", text });
      const thinking = optionalString(rawMessage.thinking);
      if (thinking) content.push({ type: "reasoning", text: thinking });
      if (Array.isArray(rawMessage.tool_calls)) {
        for (const rawCall of rawMessage.tool_calls) {
          if (!isRecord(rawCall) || !isRecord(rawCall.function)) continue;
          const oldId = optionalString(rawCall.id) ?? String(ids.next("tool-call"));
          const callId = ids.next("tool-call");
          callIds.set(oldId, callId);
          content.push({
            type: "tool-call",
            callId,
            toolName: optionalString(rawCall.function.name) ?? "unknown",
            input: parseJsonValue(optionalString(rawCall.function.arguments)),
          });
        }
      }
      messages.push({ id, role: "assistant", createdAt, content });
    } else if (rawMessage.role === "tool") {
      const oldCallId = optionalString(rawMessage.tool_call_id) ?? "";
      const callId = callIds.get(oldCallId) ?? ids.next("tool-call");
      messages.push({
        id,
        role: "tool",
        createdAt,
        callId,
        toolName: findToolName(messages, callId),
        output: { ok: true, value: toJsonValue(rawMessage.content) },
      });
    }
  }
  return ok({ messages, snapshotMessageIds });
}

function migrateUserContent(rawContent: unknown): UserContent[] {
  if (typeof rawContent === "string") return [{ type: "text", text: rawContent }];
  if (!Array.isArray(rawContent)) return [];
  const content: UserContent[] = [];
  for (const rawPart of rawContent) {
    if (!isRecord(rawPart)) continue;
    if (rawPart.type === "text" && typeof rawPart.text === "string") {
      const fileMatch = /^\[File: (.+?) \| (\d+)\]\n([\s\S]*)$/.exec(rawPart.text);
      if (fileMatch) {
        content.push({
          type: "file",
          name: fileMatch[1],
          size: Number(fileMatch[2]),
          mediaType: "text/plain",
          data: fileMatch[3],
        });
      } else content.push({ type: "text", text: rawPart.text });
    } else if (rawPart.type === "image_url" && isRecord(rawPart.image_url)) {
      const data = optionalString(rawPart.image_url.url);
      if (data) content.push({ type: "image", mediaType: mediaTypeOfDataUrl(data), data });
    }
  }
  return content;
}

function migrateSettings(state: UnknownRecord): AppSettings {
  const ai = recordOrEmpty(state.ai);
  const webSearch = recordOrEmpty(state.webSearch);
  const assetSearch = recordOrEmpty(state.assetSearch);
  const system = recordOrEmpty(state.system);
  const legacyUrl = optionalString(ai.apiUrl)?.replace(/\/chat\/completions$/, "");
  return {
    ai: {
      apiType: enumOr(ai.apiType, ["openai-compatible", "openai", "anthropic", "google"], "openai-compatible"),
      apiKey: optionalString(ai.apiKey) ?? "",
      apiBaseUrl: (optionalString(ai.apiBaseUrl) ?? legacyUrl ?? "").replace(/\/+$/, ""),
      model: optionalString(ai.model) ?? "",
    },
    webSearch: {
      engine: enumOr(
        webSearch.engine,
        ["tavily", "firecrawl", "builtin", "disabled"],
        optionalString(webSearch.tavilyApiKey) ? "tavily" : "disabled",
      ),
      tavilyApiKey: optionalString(webSearch.tavilyApiKey) ?? "",
      tavilyApiUrl: optionalString(webSearch.tavilyApiUrl) ?? "https://api.tavily.com",
      firecrawlApiKey: optionalString(webSearch.firecrawlApiKey) ?? "",
      firecrawlApiUrl: optionalString(webSearch.firecrawlApiUrl) ?? "https://api.firecrawl.dev",
    },
    assetSearch: {
      engine: enumOr(assetSearch.engine, ["pixabay", "unsplash", "pexels", "disabled"], "disabled"),
      pixabayApiKey: optionalString(assetSearch.pixabayApiKey) ?? "",
      pixabayApiUrl: optionalString(assetSearch.pixabayApiUrl) ?? "https://pixabay.com/api",
      unsplashApiKey: optionalString(assetSearch.unsplashApiKey) ?? "",
      unsplashApiUrl: optionalString(assetSearch.unsplashApiUrl) ?? "https://api.unsplash.com",
      pexelsApiKey: optionalString(assetSearch.pexelsApiKey) ?? "",
      pexelsApiUrl: optionalString(assetSearch.pexelsApiUrl) ?? "https://api.pexels.com/v1",
    },
    system: {
      language: enumOr(system.language, ["system", "zh", "en"], "system"),
      theme: enumOr(system.theme, ["system", "light", "dark"], "system"),
    },
    privacy: {
      memoryEnabled: recordOrEmpty(state.privacy).memoryEnabled !== false,
    },
  };
}

function migrateSnapshots(
  state: UnknownRecord,
  messageIds: Readonly<Record<ConversationId, Readonly<Record<string, MessageId>>>>,
  ids: IdGenerator,
  clock: Clock,
): Result<Record<ConversationId, readonly ProjectSnapshot[]>, MigrationError> {
  const raw = state.snapshots ?? {};
  if (!isRecord(raw)) return invalidData("snapshots", "snapshots must be an object");
  const output: Record<ConversationId, ProjectSnapshot[]> = {};
  for (const [conversationId, chain] of Object.entries(raw)) {
    if (!Array.isArray(chain)) return invalidData("snapshots", `${conversationId} snapshots must be an array`);
    const typedConversationId = conversationId as ConversationId;
    const history = new ProjectHistory(typedConversationId, ids, clock);
    const files: Record<string, string> = {};
    for (let index = 0; index < chain.length; index += 1) {
      const snapshot = chain[index];
      if (!isRecord(snapshot)) {
        return invalidData("snapshots", `${conversationId} snapshot ${index} must be an object`);
      }
      const addedFiles = isStringRecord(snapshot.addedFiles) ? snapshot.addedFiles : {};
      for (const [path, content] of Object.entries(addedFiles)) files[path] = content;
      const patches = isStringRecord(snapshot.patches) ? snapshot.patches : {};
      for (const [path, patch] of Object.entries(patches)) {
        const patched = applyPatch(files[path] ?? "", patch);
        if (typeof patched !== "string") {
          return invalidData(
            "snapshots",
            `${conversationId} snapshot ${index} contains an invalid patch for ${path}`,
          );
        }
        files[path] = patched;
      }
      for (const path of stringArrayOrEmpty(snapshot.deletedFiles)) delete files[path];

      const imported = importLegacyProjectFiles(files);
      if (!imported.ok) {
        return invalidData("snapshots", `${conversationId} snapshot ${index}: ${imported.error.message}`);
      }
      const legacyMessageId = optionalString(snapshot.messageId) ?? "";
      const messageId =
        messageIds[typedConversationId]?.[legacyMessageId] ??
        (legacyMessageId as MessageId);
      const captured = history.capture(
        messageId,
        { ...imported.value, revision: index + 1 },
        numberOr(snapshot.createdAt, 0),
      );
      if (!captured.ok) {
        return invalidData("snapshots", captured.error.message);
      }
    }
    output[typedConversationId] = [...history.list()];
  }
  return ok(output);
}

function migrateMemories(state: UnknownRecord): Result<MemoryItem[], MigrationError> {
  const raw = state.memories ?? [];
  if (!Array.isArray(raw)) return invalidData("memories", "memories must be an array");
  const memories: MemoryItem[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.content !== "string") {
      return invalidData("memories", "memory items must contain string content");
    }
    memories.push({
      id: (optionalString(item.id) ?? "") as MemoryId,
      content: item.content,
      category: enumOr(
        item.category,
        ["preference", "personal_info", "instruction", "fact", "project"],
        "fact",
      ),
      createdAt: numberOr(item.createdAt, 0),
      updatedAt: numberOr(item.updatedAt, numberOr(item.createdAt, 0)),
    });
  }
  return ok(memories);
}

function findToolName(messages: readonly ConversationMessage[], callId: ToolCallId): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const call = message.content.find(
      (block) => block.type === "tool-call" && block.callId === callId,
    );
    if (call?.type === "tool-call") return call.toolName;
  }
  return "unknown";
}

function parseJsonValue(input: string | undefined): JsonValue {
  if (!input) return {};
  try {
    return toJsonValue(JSON.parse(input));
  } catch {
    return { raw: input };
  }
}

function toJsonValue(input: unknown): JsonValue {
  if (input === null || typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return input;
  }
  if (Array.isArray(input)) return input.map(toJsonValue);
  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, toJsonValue(value)]),
    );
  }
  return String(input ?? "");
}

function normalizeLegacyTitle(title: string | undefined): string | null {
  return !title || title === "__new_app__" || title === "新应用" || title === "New App" ? null : title;
}

function mediaTypeOfDataUrl(value: string): string {
  return /^data:([^;,]+)/.exec(value)?.[1] ?? "application/octet-stream";
}

function invalidData<T>(
  source: keyof LegacyPayloads,
  message: string,
): Result<T, MigrationError> {
  return err({ code: "invalid-data", source, message });
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function recordOrEmpty(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function enumOr<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;
}
