import { useEffect, useRef } from "react";
import { useSandpack, useSandpackConsole } from "@codesandbox/sandpack-react";
import type {
  PreviewConsoleEntry,
  PreviewCoordinator,
} from "@/application/preview";
import {
  PREVIEW_FILE_SYNC_DELAY_MS,
  PREVIEW_INFRASTRUCTURE_FAILURE_MESSAGE,
  PREVIEW_INFRASTRUCTURE_RETRYING_MESSAGE,
  shouldDeferFileSync,
} from "./preview-stability";

export {
  PREVIEW_INFRASTRUCTURE_FAILURE_MESSAGE,
  PREVIEW_INFRASTRUCTURE_RETRYING_MESSAGE,
} from "./preview-stability";

export interface SandpackBridgeProps {
  readonly conversationId: string;
  readonly revision: number;
  readonly active: boolean;
  readonly externalFiles: Record<string, { readonly code: string }>;
  /** Externally selected file (Sandpack path, leading "/"). */
  readonly activeFile: string;
  readonly coordinator: PreviewCoordinator;
  readonly onFileChange: (path: string, content: string) => void;
  readonly editDebounceMs?: number;
  readonly syncEditorChanges?: boolean;
  /** Sandpack template name — used to settle ready for static clients. */
  readonly template?: string;
  /** Called when Vite finished booting (or returned to idle after a restart). */
  readonly onBootSettled?: () => void;
  /** Called when a fatal Sandpack infrastructure fault is detected.
   *  Return true if a retry was scheduled so the bridge can avoid marking failed yet. */
  readonly onInfrastructureFault?: () => boolean;
}

/** Reports Sandpack state through the revision-aware preview port. */
export function SandpackBridge({
  conversationId,
  revision,
  active,
  externalFiles,
  activeFile,
  coordinator,
  onFileChange,
  editDebounceMs = 400,
  syncEditorChanges = true,
  template = "vite-react-ts",
  onBootSettled,
  onInfrastructureFault,
}: SandpackBridgeProps) {
  const { sandpack, listen } = useSandpack();
  const { files, status, error } = sandpack;
  const currentFile = sandpack.activeFile;
  const code = files[currentFile]?.code;
  const syncedRevision = useRef<number | null>(null);
  const pendingSync = useRef<{
    readonly revision: number;
    readonly files: Record<string, { readonly code: string }>;
  } | null>(null);
  const syncTimer = useRef<number | undefined>(undefined);
  const infraFaultReported = useRef<number | null>(null);
  const infraRetryScheduled = useRef(false);
  const { logs } = useSandpackConsole({
    resetOnPreviewRestart: true,
    showSyntaxError: true,
  });

  // Seed the synced revision from the provider's initial files so the first
  // boot does not immediately call updateFile and fight Vite startup.
  useEffect(() => {
    if (syncedRevision.current === null) syncedRevision.current = revision;
  }, [revision]);

  const flushPendingSync = (next: {
    readonly revision: number;
    readonly files: Record<string, { readonly code: string }>;
  }) => {
    if (syncedRevision.current === next.revision) return;
    syncedRevision.current = next.revision;
    pendingSync.current = null;
    sandpack.updateFile(next.files, undefined, true);
  };

  const scheduleSync = (next: {
    readonly revision: number;
    readonly files: Record<string, { readonly code: string }>;
  }) => {
    pendingSync.current = next;
    if (shouldDeferFileSync(status)) return;
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      const pending = pendingSync.current;
      if (!pending) return;
      flushPendingSync(pending);
    }, PREVIEW_FILE_SYNC_DELAY_MS);
  };

  // Push committed revisions into Sandpack, but never during an active Vite boot.
  useEffect(() => {
    if (!active) return;
    if (syncedRevision.current === revision) return;
    scheduleSync({ revision, files: externalFiles });
    return () => window.clearTimeout(syncTimer.current);
    // scheduleSync closes over latest sandpack/status; deps cover the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, externalFiles, revision, sandpack, status]);

  // When boot finishes, flush any revision that arrived while status=running.
  useEffect(() => {
    if (!active) return;
    if (shouldDeferFileSync(status)) return;
    const pending = pendingSync.current;
    if (pending && pending.revision !== syncedRevision.current) {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => {
        const latest = pendingSync.current;
        if (!latest) return;
        flushPendingSync(latest);
      }, PREVIEW_FILE_SYNC_DELAY_MS);
    }
    if (status === "done" || status === "idle") onBootSettled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onBootSettled, sandpack, status]);

  // Sandpack only honors options.activeFile on mount, so clicks in our file
  // tree (which change the prop) wouldn't switch the editor. Push the selected
  // file into Sandpack's internal state so the editor follows.
  useEffect(() => {
    if (!active) return undefined;
    if (activeFile && activeFile !== currentFile) sandpack.setActiveFile(activeFile);
    return undefined;
  }, [active, activeFile, currentFile, sandpack]);

  useEffect(() => {
    if (!active) return undefined;
    const target = { conversationId, revision };
    if (status === "running") {
      coordinator.markCompiling(target);
      return;
    }
    if (status === "timeout") {
      coordinator.markFailed(target, "Sandpack compilation timed out");
      return;
    }
    // Provider status is never "done" in current sandpack-react (only
    // initial/running/idle/timeout). Idle means no clients yet or after
    // teardown — for static templates this is a valid settled state.
    if (status === "idle" || status === "done") {
      coordinator.markReady(target);
      return;
    }
    return undefined;
  }, [active, conversationId, coordinator, error, revision, status]);

  // Bundler "done" is the real compile-finished signal while provider status
  // stays "running" (sandpack-react never sets status to "done").
  useEffect(() => {
    if (!active) return undefined;
    const target = { conversationId, revision };
    const staticLike = template === "static" || template === "vanilla" || template === "vanilla-ts";
    return listen((message) => {
      if (message.type === "start") {
        coordinator.markCompiling(target);
        return;
      }
      if (message.type === "done" && message.compilatonError !== true) {
        coordinator.markReady(target);
        return;
      }
      // Pure static clients may never emit a compile "done"; connected is enough.
      if (staticLike && message.type === "connected") {
        coordinator.markReady(target);
      }
    });
  }, [active, conversationId, coordinator, listen, revision, template]);

  useEffect(() => {
    if (!active || !error) return;
    const kind = classifySandpackConsoleEntry({
      id: `sandpack-error-${revision}`,
      method: "error",
      data: [error.message],
    });
    if (kind === "app") {
      coordinator.markFailed({ conversationId, revision }, error.message);
    }
  }, [active, conversationId, coordinator, error, revision]);

  useEffect(() => {
    if (!active) return;
    const target = { conversationId, revision };
    const consoleLogs: PreviewConsoleEntry[] = [];
    let sawInfraFatal = false;

    for (const entry of logs) {
      const normalized: PreviewConsoleEntry = {
        id: entry.id,
        method: normalizeMethod(entry.method),
        data: entry.data ?? [],
      };
      const kind = classifySandpackConsoleEntry(normalized);
      if (kind === "noise") continue;
      if (kind === "infra-fatal") {
        sawInfraFatal = true;
        continue;
      }
      consoleLogs.push(normalized);
    }

    if (error?.message) {
      const sandpackError: PreviewConsoleEntry = {
        id: `sandpack-error-${revision}`,
        method: "error",
        data: [error.message],
      };
      const kind = classifySandpackConsoleEntry(sandpackError);
      if (kind === "app") consoleLogs.push(sandpackError);
      else if (kind === "infra-fatal") sawInfraFatal = true;
    }

    if (sawInfraFatal) {
      // Logs can re-fire while the worker is dead; only schedule one retry episode
      // per Bridge mount / revision so we do not burn the backoff budget.
      if (infraFaultReported.current !== revision) {
        infraFaultReported.current = revision;
        infraRetryScheduled.current = onInfrastructureFault?.() === true;
        if (!infraRetryScheduled.current) {
          coordinator.markFailed(target, PREVIEW_INFRASTRUCTURE_FAILURE_MESSAGE);
        }
      }
      consoleLogs.push({
        id: `preview-infra-failure-${revision}`,
        method: "error",
        data: [
          infraRetryScheduled.current
            ? PREVIEW_INFRASTRUCTURE_RETRYING_MESSAGE
            : PREVIEW_INFRASTRUCTURE_FAILURE_MESSAGE,
        ],
      });
    }

    coordinator.recordConsole(target, consoleLogs);
  }, [active, conversationId, coordinator, error, logs, onInfrastructureFault, revision]);

  useEffect(() => {
    if (!active || !syncEditorChanges) return undefined;
    const timer = setTimeout(() => {
      if (currentFile && code !== undefined) {
        onFileChange(stripLeadingSlash(currentFile), code);
      }
    }, editDebounceMs);
    return () => clearTimeout(timer);
  }, [active, currentFile, code, editDebounceMs, onFileChange, syncEditorChanges]);

  return null;
}

function stripLeadingSlash(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

function normalizeMethod(method: string): PreviewConsoleEntry["method"] {
  return method === "info" ||
    method === "warn" ||
    method === "error" ||
    method === "debug"
    ? method
    : "log";
}

export type SandpackConsoleKind = "app" | "noise" | "infra-fatal";

export function classifySandpackConsoleEntry(entry: PreviewConsoleEntry): SandpackConsoleKind {
  if (entry.method !== "error" && entry.method !== "warn") return "app";
  const text = entry.data.map(formatConsoleValue).join(" ");
  if (!text) return "app";

  // Harmless telemetry / RUM noise.
  if (text.includes("/cdn-cgi/rum")) return "noise";
  if (text.includes("Unkown preview message") || text.includes("Unknown preview message")) return "noise";
  if (text.includes("child:spawn called")) return "noise";

  // Fatal worker/bridge faults that leave the preview blank.
  if (/Failed to get shell by ID/i.test(text)) return "infra-fatal";
  if (text.includes("BroadcastChannel") && text.includes("bridge/worker communication")) return "infra-fatal";
  if (text.includes("ReadableStream could not be cloned")) return "infra-fatal";
  if (text.includes("no response received from the BroadcastChannel")) return "infra-fatal";
  if (text.includes("Failed to handle GET") && text.includes("nodebox.codesandbox.io")) return "infra-fatal";
  if (text.includes("net::ERR_FAILED") && text.includes("nodebox.codesandbox.io")) return "infra-fatal";
  if (text.includes("__csb_sw") && /timeout|BroadcastChannel|ReadableStream|Failed to handle/i.test(text)) {
    return "infra-fatal";
  }

  return "app";
}

/** @deprecated Prefer classifySandpackConsoleEntry; kept for existing imports/tests. */
export function isSandpackInfrastructureNoise(entry: PreviewConsoleEntry): boolean {
  const kind = classifySandpackConsoleEntry(entry);
  return kind === "noise" || kind === "infra-fatal";
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
