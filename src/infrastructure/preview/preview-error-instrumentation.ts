import type { RuntimeFiles } from "./source-instrumentation";

export const PREVIEW_ERROR_SOURCE = "open-vibe-coding.preview-error";
export const PREVIEW_ERROR_CAPTURE_MARKER = "open-vibe-coding-preview-error-capture";
export const PREVIEW_ERROR_BOUNDARY_MARKER = "KvcPreviewErrorBoundary";
export const PREVIEW_ERROR_BOUNDARY_PATH = "/src/__kvc_preview_error_boundary.jsx";

const ENTRY_CANDIDATES = [
  "/src/main.tsx",
  "/src/main.jsx",
  "/src/index.tsx",
  "/src/index.jsx",
  "/main.tsx",
  "/main.jsx",
  "/index.tsx",
  "/index.jsx",
  "src/main.tsx",
  "src/main.jsx",
  "src/index.tsx",
  "src/index.jsx",
  "main.tsx",
  "main.jsx",
  "index.tsx",
  "index.jsx",
] as const;

/** Script injected into preview HTML to forward runtime / React errors to the host. */
export function buildPreviewErrorCaptureScript(source = PREVIEW_ERROR_SOURCE): string {
  return `(() => {
  if (window.__kvcPreviewErrorCaptureInstalled) return;
  window.__kvcPreviewErrorCaptureInstalled = true;
  const source = ${JSON.stringify(source)};
  const send = (payload) => {
    try {
      window.parent.postMessage({ source, ...payload }, "*");
    } catch {
      /* noop */
    }
  };
  const formatArg = (value) => {
    if (value instanceof Error) {
      return (value.name ? value.name + ": " : "") + (value.message || String(value)) + (value.stack ? "\\n" + value.stack : "");
    }
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof value.message === "string") {
      return value.message + (value.stack ? "\\n" + value.stack : "");
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const shouldReportConsoleError = (text, args) => {
    if (args.some((item) => item instanceof Error)) return true;
    return /occurred in the <|error boundary|minified react error|uncaught|typeerror|referenceerror|cannot read propert|is not a function|is not defined|react\\.dev\\/errors/i.test(text);
  };
  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    try {
      originalConsoleError(...args);
    } catch {
      /* noop */
    }
    try {
      const message = args.map(formatArg).filter(Boolean).join("\\n");
      if (!message || !shouldReportConsoleError(message, args)) return;
      const errorArg = args.find((item) => item instanceof Error);
      send({
        kind: "console.error",
        message,
        stack: errorArg && errorArg.stack ? String(errorArg.stack) : "",
      });
    } catch {
      /* noop */
    }
  };
  window.addEventListener("error", (event) => {
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
    const reason = event.reason;
    send({
      kind: "unhandledrejection",
      message: reason && reason.message ? String(reason.message) : String(reason || "Unhandled promise rejection"),
      stack: reason && reason.stack ? String(reason.stack) : "",
    });
  });
})();`;
}

const ERROR_BOUNDARY_SOURCE = `import React from "react";

const SOURCE = ${JSON.stringify(PREVIEW_ERROR_SOURCE)};

function report(error, info) {
  const message = error && error.message ? String(error.message) : String(error || "Unknown render error");
  const stack = [
    error && error.stack ? String(error.stack) : "",
    info && info.componentStack ? String(info.componentStack) : "",
  ].filter(Boolean).join("\\n");
  try {
    console.error("[Preview Error Boundary]", error, info && info.componentStack);
  } catch {
    /* noop */
  }
  try {
    window.parent.postMessage({
      source: SOURCE,
      kind: "react",
      message,
      stack,
    }, "*");
  } catch {
    /* noop */
  }
}

export class ${PREVIEW_ERROR_BOUNDARY_MARKER} extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error("Unknown render error") };
  }

  componentDidCatch(error, info) {
    report(error, info);
  }

  render() {
    if (this.state.error) {
      const text = String(this.state.error.stack || this.state.error.message || this.state.error);
      return React.createElement(
        "div",
        {
          role: "alert",
          style: {
            boxSizing: "border-box",
            minHeight: "100vh",
            margin: 0,
            padding: 16,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 13,
            lineHeight: 1.45,
            color: "#7f1d1d",
            background: "#fff1f2",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          },
        },
        React.createElement("strong", { style: { display: "block", marginBottom: 8 } }, "Preview crashed"),
        React.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap" } }, text),
      );
    }
    return this.props.children;
  }
}
`;

/** Inject a runtime-only React error boundary around the preview entry render tree. */
export function injectReactErrorBoundary(files: RuntimeFiles): RuntimeFiles {
  const entryPath = ENTRY_CANDIDATES.find((path) => files[path]?.code);
  if (!entryPath) return files;

  const entryCode = files[entryPath].code;
  if (entryCode.includes(PREVIEW_ERROR_BOUNDARY_MARKER)) {
    return files[PREVIEW_ERROR_BOUNDARY_PATH]
      ? files
      : {
          ...files,
          [PREVIEW_ERROR_BOUNDARY_PATH]: { code: ERROR_BOUNDARY_SOURCE },
        };
  }

  const wrapped = wrapRenderWithErrorBoundary(entryCode);
  if (wrapped === entryCode) {
    return {
      ...files,
      [PREVIEW_ERROR_BOUNDARY_PATH]: { code: ERROR_BOUNDARY_SOURCE },
      [entryPath]: {
        code: `${buildBoundaryImport(entryPath)}\n${entryCode}`,
      },
    };
  }

  return {
    ...files,
    [PREVIEW_ERROR_BOUNDARY_PATH]: { code: ERROR_BOUNDARY_SOURCE },
    [entryPath]: {
      code: `${buildBoundaryImport(entryPath)}\n${wrapped}`,
    },
  };
}

export function wrapRenderWithErrorBoundary(code: string): string {
  if (code.includes(`<${PREVIEW_ERROR_BOUNDARY_MARKER}`)) return code;

  const createRootIndex = code.search(/\.render\s*\(/);
  if (createRootIndex >= 0) {
    const openParen = code.indexOf("(", createRootIndex);
    const closeParen = findMatchingParen(code, openParen);
    if (closeParen > openParen) {
      const child = code.slice(openParen + 1, closeParen).trim();
      if (child && !child.includes(PREVIEW_ERROR_BOUNDARY_MARKER)) {
        return (
          code.slice(0, openParen + 1) +
          `<${PREVIEW_ERROR_BOUNDARY_MARKER}>${child}</${PREVIEW_ERROR_BOUNDARY_MARKER}>` +
          code.slice(closeParen)
        );
      }
    }
  }

  const reactDomIndex = code.search(/ReactDOM\.render\s*\(/);
  if (reactDomIndex >= 0) {
    const openParen = code.indexOf("(", reactDomIndex);
    const closeParen = findMatchingParen(code, openParen);
    if (closeParen > openParen) {
      const args = code.slice(openParen + 1, closeParen);
      const comma = findTopLevelComma(args);
      if (comma >= 0) {
        const element = args.slice(0, comma).trim();
        const rest = args.slice(comma);
        if (element && !element.includes(PREVIEW_ERROR_BOUNDARY_MARKER)) {
          return (
            code.slice(0, openParen + 1) +
            `<${PREVIEW_ERROR_BOUNDARY_MARKER}>${element}</${PREVIEW_ERROR_BOUNDARY_MARKER}>` +
            rest +
            code.slice(closeParen)
          );
        }
      }
    }
  }

  return code;
}

function findMatchingParen(code: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = openIndex; index < code.length; index += 1) {
    const char = code[index];
    const previous = code[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findTopLevelComma(code: string): number {
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    const previous = code[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) return index;
  }
  return -1;
}

function buildBoundaryImport(entryPath: string): string {
  const normalized = entryPath.replace(/^\//, "");
  const inSrc = normalized.startsWith("src/");
  const specifier = inSrc
    ? "./__kvc_preview_error_boundary.jsx"
    : "./src/__kvc_preview_error_boundary.jsx";
  return `import { ${PREVIEW_ERROR_BOUNDARY_MARKER} } from ${JSON.stringify(specifier)};`;
}
