import { useEffect, useRef } from "react";
import { useSandpack, useSandpackConsole } from "@codesandbox/sandpack-react";
import type {
  PreviewConsoleEntry,
  PreviewCoordinator,
} from "@/application/preview";

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
}: SandpackBridgeProps) {
  const { sandpack } = useSandpack();
  const { files, status, error } = sandpack;
  const currentFile = sandpack.activeFile;
  const code = files[currentFile]?.code;
  const syncedRevision = useRef<number | null>(null);
  const { logs } = useSandpackConsole({
    resetOnPreviewRestart: true,
    showSyntaxError: true,
  });

  // The app owns the code editor, so user edits update the project store first.
  // Push each committed revision into Sandpack explicitly; relying only on
  // SandpackProvider prop reconciliation can leave the preview running an older
  // bundle while the file tree/editor already show newer content.
  useEffect(() => {
    if (!active) return;
    if (syncedRevision.current === revision) return;
    syncedRevision.current = revision;
    sandpack.updateFile(externalFiles, undefined, true);
  }, [active, externalFiles, revision, sandpack]);

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
    if (status === "done") {
      coordinator.markReady(target);
      return;
    }
    if (!error) {
      const timer = window.setTimeout(() => coordinator.markReady(target), 250);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [active, conversationId, coordinator, error, revision, status]);

  useEffect(() => {
    if (active && error) coordinator.markFailed({ conversationId, revision }, error.message);
  }, [active, conversationId, coordinator, error, revision]);

  useEffect(() => {
    if (!active) return;
    const consoleLogs: PreviewConsoleEntry[] = logs.map(
      (entry): PreviewConsoleEntry => ({
        id: entry.id,
        method: normalizeMethod(entry.method),
        data: entry.data ?? [],
      }),
    );
    if (error?.message) {
      consoleLogs.push({
        id: `sandpack-error-${revision}`,
        method: "error",
        data: [error.message],
      });
    }
    coordinator.recordConsole(
      { conversationId, revision },
      consoleLogs,
    );
  }, [active, conversationId, coordinator, error, logs, revision]);

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
