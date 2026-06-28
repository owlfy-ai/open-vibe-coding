import type { AgentTool } from "@/application/ports/agent-tool";
import { PreviewCoordinator, type PreviewTarget } from "./preview-coordinator";

export function createPreviewConsoleTool(
  preview: PreviewCoordinator,
  revision: () => PreviewTarget,
): AgentTool {
  return {
    definition: {
      name: "get_console_logs",
      description:
        "Wait for the current project revision to finish compiling, then return its browser console output.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute(_input, context) {
      if (context.signal.aborted) {
        return { ok: false, error: { code: "aborted", message: "Console check was aborted" } };
      }
      const targetRevision = revision();
      const settled = await preview.waitUntilSettled(targetRevision, 15_000, context.signal);
      if (!settled.ok) {
        return {
          ok: false,
          error: { code: `preview.${settled.error.code}`, message: settled.error.message },
        };
      }
      return {
        ok: true,
        value: {
          revision: typeof targetRevision === "number" ? targetRevision : targetRevision.revision,
          status: settled.value.status,
          logs: settled.value.logs.map((entry) => ({
            method: entry.method,
            data: entry.data.map(formatConsoleValue),
          })),
        },
      };
    },
  };
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
