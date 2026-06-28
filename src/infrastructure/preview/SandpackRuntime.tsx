import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SandpackProvider,
  type SandpackPredefinedTemplate,
  type SandpackThemeProp,
} from "@codesandbox/sandpack-react";
import type { PreviewCoordinator, PreviewElementPromptRequest, PreviewElementSelection } from "@/application/preview";
import { SandpackBridge } from "./SandpackBridge";
import { instrumentPreviewSources, PREVIEW_SOURCE_ATTR, type RuntimeFiles } from "./source-instrumentation";

const PREVIEW_ERROR_SOURCE = "web-vibe-coding.preview-error";
const PREVIEW_SELECT_SOURCE = "web-vibe-coding.preview-select";
const PREVIEW_SELECT_COMMAND_SOURCE = "web-vibe-coding.preview-select-command";
const PREVIEW_ERROR_CAPTURE_MARKER = "web-vibe-coding-preview-error-capture";
const PREVIEW_SELECT_CAPTURE_MARKER = "web-vibe-coding-preview-select-capture";
const PREVIEW_ERROR_CAPTURE_SCRIPT = `(() => {
  const source = ${JSON.stringify(PREVIEW_ERROR_SOURCE)};
  const send = (payload) => {
    try {
      window.parent.postMessage({ source, ...payload }, "*");
    } catch {
      /* noop */
    }
  };
  window.onerror = (message, filename, lineno, colno, error) => {
    send({
      kind: "error",
      message: String(message || "Script error"),
      filename,
      lineno,
      colno,
      stack: error && error.stack ? String(error.stack) : "",
    });
    return true;
  };
  window.addEventListener("error", (event) => {
    event.preventDefault();
    send({
      kind: "error",
      message: event.message || (event.error && event.error.message) || "Script error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error && event.error.stack ? String(event.error.stack) : "",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    const reason = event.reason;
    send({
      kind: "unhandledrejection",
      message: reason && reason.message ? String(reason.message) : String(reason || "Unhandled promise rejection"),
      stack: reason && reason.stack ? String(reason.stack) : "",
    });
  });
})();`;

export interface PreviewElementPromptLabels {
  readonly dialogLabel: string;
  readonly placeholder: string;
  readonly submit: string;
  readonly cancel: string;
}

const DEFAULT_ELEMENT_PROMPT_LABELS: PreviewElementPromptLabels = {
  dialogLabel: "Edit selected element",
  placeholder: "Describe the change...",
  submit: "Go",
  cancel: "Cancel",
};

function createPreviewElementSelectScript(labels: PreviewElementPromptLabels): string {
  return `(() => {
  const commandSource = ${JSON.stringify(PREVIEW_SELECT_COMMAND_SOURCE)};
  const eventSource = ${JSON.stringify(PREVIEW_SELECT_SOURCE)};
  const sourceAttr = ${JSON.stringify(PREVIEW_SOURCE_ATTR)};
  const labels = ${JSON.stringify(labels)};
  let enabled = false;
  let highlighted = null;
  let popup = null;
  let previousOutline = "";
  let previousOutlineOffset = "";
  let previousCursor = "";

  const sourceSelector = "[" + sourceAttr + "]";
  const findSourceElement = (target) => target && target.closest ? target.closest(sourceSelector) : null;
  const send = (payload) => {
    try {
      window.parent.postMessage({ source: eventSource, ...payload }, "*");
    } catch {
      /* noop */
    }
  };
  const clearHighlight = () => {
    if (!highlighted) return;
    highlighted.style.outline = previousOutline;
    highlighted.style.outlineOffset = previousOutlineOffset;
    highlighted.style.cursor = previousCursor;
    highlighted = null;
  };
  const removePopup = () => {
    if (!popup) return;
    popup.remove();
    popup = null;
    clearHighlight();
  };
  const highlight = (element) => {
    if (highlighted === element) return;
    clearHighlight();
    highlighted = element;
    previousOutline = element.style.outline;
    previousOutlineOffset = element.style.outlineOffset;
    previousCursor = element.style.cursor;
    element.style.outline = "2px solid #2563eb";
    element.style.outlineOffset = "2px";
    element.style.cursor = "crosshair";
  };
  const setEnabled = (value) => {
    enabled = value;
    document.documentElement.style.cursor = enabled ? "crosshair" : "";
    if (!enabled && !popup) clearHighlight();
  };
  const submitSelection = (element, prompt) => {
    const value = prompt.trim();
    if (!value) return;
    const text = (element.innerText || element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 500);
    send({
      id: element.getAttribute(sourceAttr),
      prompt: value,
      dom: {
        tag: element.tagName ? element.tagName.toLowerCase() : "",
        id: element.id || "",
        className: typeof element.className === "string" ? element.className : "",
        text,
      },
    });
    removePopup();
  };
  const showPrompt = (element) => {
    removePopup();
    highlight(element);
    const rect = element.getBoundingClientRect();
    popup = document.createElement("form");
    setEnabled(false);
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", labels.dialogLabel);
    popup.style.position = "fixed";
    popup.style.zIndex = "2147483647";
    popup.style.display = "flex";
    popup.style.alignItems = "center";
    popup.style.gap = "8px";
    popup.style.width = "min(420px, calc(100vw - 24px))";
    popup.style.padding = "8px";
    popup.style.border = "1px solid rgba(0, 0, 0, 0.14)";
    popup.style.borderRadius = "14px";
    popup.style.background = "rgba(255, 255, 255, 0.98)";
    popup.style.boxShadow = "0 12px 32px rgba(15, 23, 42, 0.18)";
    popup.style.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    popup.style.boxSizing = "border-box";
    const maxLeft = Math.max(12, window.innerWidth - 432);
    const left = Math.min(Math.max(12, rect.left), maxLeft);
    const below = rect.bottom + 10;
    const top = below + 54 > window.innerHeight ? Math.max(12, rect.top - 64) : below;
    popup.style.left = left + "px";
    popup.style.top = top + "px";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = labels.placeholder;
    input.style.flex = "1";
    input.style.minWidth = "0";
    input.style.height = "34px";
    input.style.border = "0";
    input.style.outline = "none";
    input.style.borderRadius = "10px";
    input.style.padding = "0 10px";
    input.style.background = "#f1f5f9";
    input.style.color = "#0f172a";
    input.style.font = "inherit";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = labels.submit;
    submit.style.height = "34px";
    submit.style.border = "0";
    submit.style.borderRadius = "10px";
    submit.style.padding = "0 14px";
    submit.style.background = "#111827";
    submit.style.color = "#fff";
    submit.style.font = "inherit";
    submit.style.fontWeight = "700";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "×";
    cancel.setAttribute("aria-label", labels.cancel);
    cancel.style.width = "34px";
    cancel.style.height = "34px";
    cancel.style.border = "0";
    cancel.style.borderRadius = "10px";
    cancel.style.background = "#f1f5f9";
    cancel.style.color = "#475569";
    cancel.style.font = "20px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    popup.append(input, submit, cancel);
    popup.addEventListener("mousedown", (event) => event.stopPropagation());
    popup.addEventListener("click", (event) => event.stopPropagation());
    popup.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      submitSelection(element, input.value);
    });
    const cancelPrompt = () => {
      removePopup();
      setEnabled(true);
    };
    cancel.addEventListener("click", cancelPrompt);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") cancelPrompt();
    });
    document.body.append(popup);
    window.setTimeout(() => input.focus(), 0);
  };
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== commandSource) return;
    if (data.enabled) {
      if (!popup) setEnabled(true);
      return;
    }
    removePopup();
    setEnabled(false);
  });
  document.addEventListener("mouseover", (event) => {
    if (!enabled) return;
    const element = findSourceElement(event.target);
    if (element) highlight(element);
  }, true);
  document.addEventListener("mouseout", (event) => {
    if (!enabled || !highlighted) return;
    const next = event.relatedTarget;
    if (next && highlighted.contains(next)) return;
    clearHighlight();
  }, true);
  document.addEventListener("click", (event) => {
    if (!enabled) return;
    const element = findSourceElement(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    showPrompt(element);
  }, true);
})();`;
}

export function SandpackRuntime({
  conversationId,
  revision,
  active,
  cachedReady,
  theme,
  template,
  files,
  activeFile,
  coordinator,
  onFileChange,
  syncEditorChanges = true,
  selectMode = false,
  elementPromptLabels = DEFAULT_ELEMENT_PROMPT_LABELS,
  onElementSelected,
  onElementPrompt,
  children,
}: {
  readonly conversationId: string;
  readonly revision: number;
  readonly active: boolean;
  readonly cachedReady: boolean;
  readonly theme: SandpackThemeProp;
  readonly template: SandpackPredefinedTemplate;
  readonly files: Record<string, { readonly code: string }>;
  readonly activeFile: string;
  readonly coordinator: PreviewCoordinator;
  readonly onFileChange: (path: string, content: string) => void;
  readonly syncEditorChanges?: boolean;
  readonly selectMode?: boolean;
  readonly elementPromptLabels?: PreviewElementPromptLabels;
  readonly onElementSelected?: (selection: PreviewElementSelection) => void;
  readonly onElementPrompt?: (request: PreviewElementPromptRequest) => void;
  readonly children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const instrumented = useMemo(
    () => instrumentPreviewSources(files),
    [files],
  );
  const elementPromptLabelsKey = [
    elementPromptLabels.dialogLabel,
    elementPromptLabels.placeholder,
    elementPromptLabels.submit,
    elementPromptLabels.cancel,
  ].join("\u0000");
  const runtimeFiles = useMemo<RuntimeFiles>(
    () => injectPreviewScripts(instrumented.files, elementPromptLabels),
    // Keep Sandpack files stable across parent renders. Rebuilding this object
    // restarts the preview iframe, so depend on label values rather than object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elementPromptLabelsKey, instrumented.files],
  );

  useEffect(() => {
    if (!active) return;
    const send = () => {
      const frame = hostRef.current?.querySelector("iframe");
      frame?.contentWindow?.postMessage({
        source: PREVIEW_SELECT_COMMAND_SOURCE,
        enabled: selectMode,
      }, "*");
    };
    send();
    const frame = window.requestAnimationFrame(send);
    const timer = selectMode ? window.setInterval(send, 400) : undefined;
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [active, generation, revision, selectMode]);

  useEffect(() => {
    if (!active) return undefined;
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!isPreviewErrorMessage(data)) return;
      const message = formatPreviewError(data);
      const target = { conversationId, revision };
      coordinator.markFailed(target, message);
      coordinator.recordConsole(target, [
        {
          id: `preview-runtime-error-${revision}-${hashString(message)}`,
          method: "error",
          data: [message],
        },
      ]);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [active, conversationId, coordinator, revision]);

  useEffect(() => {
    if (!active) return undefined;
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!isPreviewElementMessage(data)) return;
      const source = instrumented.sources[data.id];
      if (!source) return;
      const selection = {
        conversationId,
        revision,
        source,
        dom: data.dom,
      };
      if (data.prompt) {
        onElementPrompt?.({
          ...selection,
          requestId: `${revision}-${data.id}-${Date.now()}`,
          prompt: data.prompt,
        });
      } else {
        onElementSelected?.(selection);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [active, conversationId, instrumented.sources, onElementPrompt, onElementSelected, revision]);

  useEffect(() => {
    if (!active) return undefined;
    const unsubscribe = coordinator.subscribeCommands((command) => {
      if (command.conversationId !== undefined && command.conversationId !== conversationId) return;
      if (command.restart && command.revision >= revision) setGeneration((value) => value + 1);
    });
    if (cachedReady) {
      coordinator.markReady({ conversationId, revision });
      return unsubscribe;
    }
    coordinator.request({
      conversationId,
      revision,
      reason: "files-changed",
      restart: false,
    });
    return unsubscribe;
  }, [active, cachedReady, conversationId, coordinator, revision]);

  return (
    <div className="ob-sandpack-runtime-host" ref={hostRef}>
      <SandpackProvider
        key={`${conversationId}-${generation}`}
        theme={theme}
        template={template}
        files={runtimeFiles}
        options={{ activeFile }}
        style={{ height: "100%" }}
      >
        <SandpackBridge
          conversationId={conversationId}
          revision={revision}
          active={active}
          externalFiles={runtimeFiles}
          activeFile={activeFile}
          coordinator={coordinator}
          onFileChange={onFileChange}
          syncEditorChanges={syncEditorChanges}
        />
        {children}
      </SandpackProvider>
    </div>
  );
}

function injectPreviewScripts(
  files: RuntimeFiles,
  elementPromptLabels: PreviewElementPromptLabels,
): RuntimeFiles {
  const htmlPath = files["/index.html"] ? "/index.html" : (files["index.html"] ? "index.html" : null);
  if (!htmlPath) return files;
  const entry = files[htmlPath];
  const code = injectScriptIntoHtml(entry.code, [
    { marker: PREVIEW_ERROR_CAPTURE_MARKER, script: PREVIEW_ERROR_CAPTURE_SCRIPT },
    { marker: PREVIEW_SELECT_CAPTURE_MARKER, script: createPreviewElementSelectScript(elementPromptLabels) },
  ]);
  return code === entry.code ? files : { ...files, [htmlPath]: { code } };
}

function injectScriptIntoHtml(
  html: string,
  scripts: readonly { readonly marker: string; readonly script: string }[],
): string {
  const script = scripts
    .filter(({ marker }) => !html.includes(marker))
    .map(({ marker, script: body }) => [
      `<script data-source="${marker}">`,
      body.replaceAll("</script", "<\\/script"),
      "</script>",
    ].join("\n"))
    .join("\n");
  if (!script) return html;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (match) => `${match}\n${script}`);
  }
  return `${script}\n${html}`;
}

interface PreviewErrorMessage {
  readonly source: typeof PREVIEW_ERROR_SOURCE;
  readonly kind: string;
  readonly message: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly stack?: string;
}

function isPreviewErrorMessage(value: unknown): value is PreviewErrorMessage {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return item.source === PREVIEW_ERROR_SOURCE && typeof item.message === "string";
}

interface PreviewElementMessage {
  readonly source: typeof PREVIEW_SELECT_SOURCE;
  readonly id: string;
  readonly prompt?: string;
  readonly dom: {
    readonly tag: string;
    readonly id?: string;
    readonly className?: string;
    readonly text?: string;
  };
}

function isPreviewElementMessage(value: unknown): value is PreviewElementMessage {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (item.source !== PREVIEW_SELECT_SOURCE || typeof item.id !== "string") return false;
  return typeof item.dom === "object" && item.dom !== null;
}

function formatPreviewError(error: PreviewErrorMessage): string {
  const location = [
    error.filename,
    typeof error.lineno === "number" ? `:${error.lineno}` : "",
    typeof error.colno === "number" ? `:${error.colno}` : "",
  ].join("");
  return [
    error.kind === "unhandledrejection" ? "Unhandled promise rejection" : "Runtime error",
    location,
    error.message,
    error.stack,
  ].filter(Boolean).join("\n");
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
