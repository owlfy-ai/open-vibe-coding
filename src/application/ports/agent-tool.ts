import type { JsonValue } from "@/domain/conversation";
import type { ModelToolDefinition } from "./language-model";

export type ToolExecutionResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface ToolExecutionContext {
  readonly signal: AbortSignal;
}

export interface AgentTool {
  readonly definition: ModelToolDefinition;
  execute(input: JsonValue, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: readonly AgentTool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: AgentTool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool already registered: ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  definitions(): readonly ModelToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async execute(
    name: string,
    input: JsonValue,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        error: { code: "unknown-tool", message: `Unknown tool: ${name}` },
      };
    }
    try {
      return await tool.execute(input, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      return { ok: false, error: { code: "tool-execution-failed", message } };
    }
  }
}
