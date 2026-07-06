import type { AgentTool } from "@/application/ports/agent-tool";
import { PreviewCoordinator, type PreviewTarget } from "./preview-coordinator";

const DEFAULT_RUNTIME_ERROR_SETTLE_MS = 1_000;

export function createPreviewConsoleTool(
  preview: PreviewCoordinator,
  revision: () => PreviewTarget,
  options: { readonly runtimeErrorSettleMs?: number } = {},
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
      await waitForLateRuntimeErrors(options.runtimeErrorSettleMs ?? DEFAULT_RUNTIME_ERROR_SETTLE_MS, context.signal);
      const latest = preview.state(targetRevision) ?? settled.value;
      return {
        ok: true,
        value: {
          revision: typeof targetRevision === "number" ? targetRevision : targetRevision.revision,
          status: latest.status,
          logs: latest.logs.map((entry) => ({
            method: entry.method,
            data: entry.data.map(formatConsoleValue),
          })),
          ...("error" in latest ? { error: latest.error } : {}),
        },
      };
    },
  };
}

async function waitForLateRuntimeErrors(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
