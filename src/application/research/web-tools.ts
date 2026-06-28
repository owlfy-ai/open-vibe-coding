import type { JsonValue } from "@/domain/conversation";
import type { AppSettings } from "@/domain/settings";
import type { AgentTool } from "@/application/ports/agent-tool";
import type { WebResearchPort } from "@/application/ports/research";

export function createWebResearchTools(
  research: WebResearchPort,
  settings: () => AppSettings,
): readonly AgentTool[] {
  const current = settings().webSearch;
  const tools: AgentTool[] = [webReaderTool(research, settings)];
  if (current.engine === "tavily" || current.engine === "firecrawl") {
    tools.unshift(webSearchTool(research, settings));
  }
  return tools;
}

function webSearchTool(
  research: WebResearchPort,
  settings: () => AppSettings,
): AgentTool {
  return {
    definition: {
      name: "web_search",
      description: "Search the web for current information and return source URLs and excerpts.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "number", minimum: 1, maximum: 10 },
        },
        required: ["query"],
      },
    },
    async execute(input, context) {
      const query = stringField(input, "query");
      if (!query) return invalid("query must be a non-empty string");
      const maxResults = numberField(input, "max_results") ?? 5;
      const result = await research.search(
        settings().webSearch,
        query,
        maxResults,
        context.signal,
      );
      return result.ok
        ? { ok: true, value: toJsonValue(result.value) }
        : { ok: false, error: result.error };
    },
  };
}

function webReaderTool(
  research: WebResearchPort,
  settings: () => AppSettings,
): AgentTool {
  return {
    definition: {
      name: "web_reader",
      description: "Read the primary text content of one or more HTTP(S) pages.",
      inputSchema: {
        type: "object",
        properties: {
          urls: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
        },
        required: ["urls"],
      },
    },
    async execute(input, context) {
      const urls = stringArrayField(input, "urls");
      if (!urls) return invalid("urls must be a non-empty string array");
      const result = await research.read(settings().webSearch, urls, context.signal);
      return result.ok
        ? { ok: true, value: toJsonValue(result.value) }
        : { ok: false, error: result.error };
    },
  };
}

function object(input: JsonValue): Readonly<Record<string, JsonValue>> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Readonly<Record<string, JsonValue>>)
    : null;
}

function stringField(input: JsonValue, key: string): string | null {
  const value = object(input)?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(input: JsonValue, key: string): number | null {
  const value = object(input)?.[key];
  return typeof value === "number" ? value : null;
}

function stringArrayField(input: JsonValue, key: string): readonly string[] | null {
  const value = object(input)?.[key];
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
    ? (value as readonly string[])
    : null;
}

function invalid(message: string) {
  return { ok: false as const, error: { code: "invalid-input", message } };
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
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
