import type { JsonValue } from "@/domain/conversation";
import type { AppSettings } from "@/domain/settings";
import type { AgentTool } from "@/application/ports/agent-tool";
import type {
  ImageResearchPort,
  ImageSearchInput,
  PackageResearchPort,
} from "@/application/ports/research";

export function createImageSearchTool(
  research: ImageResearchPort,
  settings: () => AppSettings,
): AgentTool | null {
  if (settings().assetSearch.engine === "disabled") return null;
  return {
    definition: {
      name: "image_search",
      description: "Search configured stock-image providers for application-ready images.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          image_type: { enum: ["all", "photo", "illustration", "vector"] },
          orientation: { enum: ["all", "horizontal", "vertical"] },
          color: { type: "string" },
          per_page: { type: "number", minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
    },
    async execute(input, context) {
      const query = stringField(input, "query");
      if (!query) return invalid("query must be a non-empty string");
      const request: ImageSearchInput = {
        query,
        imageType: enumField(input, "image_type", ["all", "photo", "illustration", "vector"]),
        orientation: enumField(input, "orientation", ["all", "horizontal", "vertical"]),
        color: stringField(input, "color") ?? undefined,
        limit: numberField(input, "per_page") ?? undefined,
      };
      const result = await research.search(settings().assetSearch, request, context.signal);
      return result.ok
        ? { ok: true, value: toJsonValue({ images: result.value }) }
        : { ok: false, error: result.error };
    },
  };
}

export function createPackageResearchTools(research: PackageResearchPort): readonly AgentTool[] {
  return [
    {
      definition: {
        name: "search_npm_packages",
        description: "Search npm packages and return quality, popularity and maintenance scores.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            maxResults: { type: "number", minimum: 1, maximum: 15 },
          },
          required: ["query"],
        },
      },
      async execute(input, context) {
        const query = stringField(input, "query");
        if (!query) return invalid("query must be a non-empty string");
        const result = await research.search(
          query,
          numberField(input, "maxResults") ?? 5,
          context.signal,
        );
        return result.ok
          ? { ok: true as const, value: toJsonValue({ packages: result.value }) }
          : { ok: false as const, error: result.error };
      },
    },
    {
      definition: {
        name: "get_npm_package_detail",
        description: "Inspect an npm package's current version, types, dependencies and README.",
        inputSchema: {
          type: "object",
          properties: { packageName: { type: "string" } },
          required: ["packageName"],
        },
      },
      async execute(input, context) {
        const packageName = stringField(input, "packageName");
        if (!packageName) return invalid("packageName must be a non-empty string");
        const result = await research.detail(packageName, context.signal);
        return result.ok
          ? { ok: true as const, value: toJsonValue(result.value) }
          : { ok: false as const, error: result.error };
      },
    },
  ];
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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function enumField<T extends string>(
  input: JsonValue,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = object(input)?.[key];
  return typeof value === "string" && values.includes(value as T) ? (value as T) : undefined;
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
