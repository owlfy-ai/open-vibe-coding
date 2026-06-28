import type { MemoryCategory, MemoryId, MemoryOperation } from "@/domain/memory";
import type { JsonValue } from "@/domain/conversation";
import type { AgentTool } from "@/application/ports/agent-tool";
import type { ApplicationSession } from "@/application/session";

const CATEGORIES = new Set<MemoryCategory>([
  "preference",
  "personal_info",
  "instruction",
  "fact",
  "project",
]);

export function createMemoryTool(session: ApplicationSession): AgentTool {
  return {
    definition: {
      name: "manage_memories",
      description:
        "Add, update, or delete non-sensitive long-term user preferences and project context. Never store credentials.",
      inputSchema: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                action: { enum: ["add", "update", "delete"] },
                id: { type: "string" },
                content: { type: "string" },
                category: {
                  enum: ["preference", "personal_info", "instruction", "fact", "project"],
                },
              },
              required: ["action"],
            },
          },
        },
        required: ["operations"],
      },
    },
    async execute(input) {
      const parsed = parseOperations(input);
      if (!parsed.ok) return parsed;
      const result = await session.applyMemoryOperations(parsed.value);
      return result.ok
        ? { ok: true, value: { count: session.snapshot().memories.length } }
        : { ok: false, error: { code: result.error.code, message: result.error.message } };
    },
  };
}

function parseOperations(input: JsonValue):
  | { ok: true; value: readonly MemoryOperation[] }
  | { ok: false; error: { code: string; message: string } } {
  if (!isObject(input) || !Array.isArray(input.operations) || input.operations.length === 0) {
    return invalid("operations must be a non-empty array");
  }
  const operations: MemoryOperation[] = [];
  for (const raw of input.operations) {
    if (!isObject(raw) || typeof raw.action !== "string") {
      return invalid("each memory operation requires an action");
    }
    if (raw.action === "delete") {
      if (typeof raw.id !== "string") return invalid("delete requires id");
      operations.push({ type: "delete", id: raw.id as MemoryId });
    } else if (raw.action === "add") {
      if (
        typeof raw.content !== "string" ||
        typeof raw.category !== "string" ||
        !CATEGORIES.has(raw.category as MemoryCategory)
      ) {
        return invalid("add requires content and a valid category");
      }
      operations.push({
        type: "add",
        content: raw.content,
        category: raw.category as MemoryCategory,
      });
    } else if (raw.action === "update") {
      if (typeof raw.id !== "string" || typeof raw.content !== "string") {
        return invalid("update requires id and content");
      }
      const category =
        typeof raw.category === "string" && CATEGORIES.has(raw.category as MemoryCategory)
          ? (raw.category as MemoryCategory)
          : undefined;
      operations.push({
        type: "update",
        id: raw.id as MemoryId,
        content: raw.content,
        ...(category ? { category } : {}),
      });
    } else return invalid(`unknown memory action: ${raw.action}`);
  }
  return { ok: true, value: operations };
}

function isObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string) {
  return { ok: false as const, error: { code: "invalid-input", message } };
}
