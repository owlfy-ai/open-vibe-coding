import { useMemo, useState } from "react";
import type { AssistantContent, JsonValue, ToolMessage } from "@/domain/conversation";
import { interpolate, useT, type Translation } from "../i18n";
import { Icon, ToolIcon } from "../icons";

type ToolCall = Extract<AssistantContent, { readonly type: "tool-call" }>;

export function ToolCallCard({
  call,
  result,
}: {
  readonly call: ToolCall;
  readonly result?: ToolMessage;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeTool(call, result, t), [call, result, t]);
  const status = result ? (result.output.ok ? "success" : "error") : "running";
  const statusText = result ? (result.output.ok ? t.tool.done : t.tool.failed) : t.tool.running;

  return (
    <section className={`ob-tool-card is-${status}`}>
      <button className="ob-tool-card-header" onClick={() => setExpanded((value) => !value)}>
        <span className="ob-tool-icon"><ToolIcon name={call.toolName} /></span>
        <span className="ob-tool-title">{t.tool.labels[call.toolName] ?? call.toolName}</span>
        <span className="ob-tool-inline-summary">{summary.text}</span>
        {summary.badge ? <span className="ob-tool-badge">{summary.badge}</span> : null}
        <span className="ob-tool-dot" aria-label={statusText} />
        <span className={`ob-tool-chevron ${expanded ? "is-open" : ""}`}><Icon name="chevronRight" size={15} /></span>
      </button>
      {expanded ? (
        <div className="ob-tool-card-details">
          <ToolDetails call={call} result={result} />
        </div>
      ) : null}
    </section>
  );
}

function ToolDetails({ call, result }: { readonly call: ToolCall; readonly result?: ToolMessage }) {
  const t = useT();
  return (
    <>
      <Detail title={t.tool.input} value={call.input} />
      {result ? (
        result.output.ok ? (
          <Detail title={t.tool.result} value={result.output.value} />
        ) : (
          <pre className="ob-tool-error">{result.output.error.message}</pre>
        )
      ) : (
        <p className="ob-tool-muted">{t.tool.waiting}</p>
      )}
    </>
  );
}

function Detail({ title, value }: { readonly title: string; readonly value: JsonValue }) {
  const t = useT();
  if (title === t.tool.result && isConsoleResult(value)) {
    const issues = value.logs.filter((entry) => entry.method === "error" || entry.method === "warn");
    return issues.length === 0 ? (
      <p className="ob-tool-ok">{t.tool.noConsoleIssues}</p>
    ) : (
      <div className="ob-console-issues">
        {issues.map((entry, index) => (
          <pre className={`is-${entry.method}`} key={index}>
            [{entry.method.toUpperCase()}] {entry.data.join(" ")}
          </pre>
        ))}
      </div>
    );
  }
  if (title === t.tool.result && isListFilesResult(value)) {
    return <pre>{[...value.directories.map((path) => `${path}/`), ...value.files].join("\n")}</pre>;
  }
  return (
    <>
      <strong>{title}</strong>
      <pre>{formatJson(value)}</pre>
    </>
  );
}

function summarizeTool(call: ToolCall, result: ToolMessage | undefined, t: Translation): { readonly text: string; readonly badge?: string } {
  if (!result) return { text: inputSummary(call.input) || t.tool.queued };
  if (!result.output.ok) return { text: result.output.error.message };
  const value = result.output.value;
  if (call.toolName === "list_files" && isListFilesResult(value)) {
    return {
      text: interpolate(t.tool.filesAndDirs, { files: value.files.length, dirs: value.directories.length }),
      badge: interpolate(t.tool.files, { count: value.files.length }),
    };
  }
  if (call.toolName === "read_files" && isReadFilesResult(value)) {
    const paths = Object.keys(value.files);
    return { text: paths.join(", "), badge: interpolate(t.tool.files, { count: paths.length }) };
  }
  if (call.toolName === "write_file" || call.toolName === "patch_file" || call.toolName === "delete_file") {
    return { text: changeSummary(value, t), badge: pathFromInput(call.input) };
  }
  if (call.toolName === "get_console_logs" && isConsoleResult(value)) {
    const errors = value.logs.filter((entry) => entry.method === "error").length;
    const warnings = value.logs.filter((entry) => entry.method === "warn").length;
    return {
      text: errors || warnings ? interpolate(t.tool.consoleIssues, { errors, warnings }) : t.tool.noIssues,
      badge: value.status,
    };
  }
  return { text: compact(formatJson(value), 140), badge: pathFromInput(call.input) };
}

function inputSummary(input: JsonValue): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "";
  const path = pathFromInput(input);
  if (path) return path;
  const paths = arrayField(input, "paths");
  if (paths.length > 0) return paths.join(", ");
  return compact(formatJson(input), 120);
}

function changeSummary(value: JsonValue, t: Translation): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return compact(formatJson(value), 120);
  const changes = (value as { readonly changes?: unknown }).changes;
  if (!Array.isArray(changes)) return compact(formatJson(value), 120);
  return changes
    .map((change) => {
      if (change && typeof change === "object" && "path" in change) {
        const typed = change as { readonly type?: unknown; readonly path?: unknown };
        return `${String(typed.type ?? t.tool.changed)}: ${String(typed.path ?? "")}`;
      }
      return String(change);
    })
    .join("\n");
}

function pathFromInput(input: JsonValue): string | undefined {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? stringField(input, "path")
    : undefined;
}

function stringField(input: object, key: string): string | undefined {
  const value = (input as { readonly [key: string]: unknown })[key];
  return typeof value === "string" ? value : undefined;
}

function arrayField(input: object, key: string): readonly string[] {
  const value = (input as { readonly [key: string]: unknown })[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function isListFilesResult(value: JsonValue): value is { readonly files: readonly string[]; readonly directories: readonly string[] } {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Array.isArray((value as { readonly files?: unknown }).files)
    && Array.isArray((value as { readonly directories?: unknown }).directories);
}

function isReadFilesResult(value: JsonValue): value is { readonly files: Readonly<Record<string, string>> } {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof (value as { readonly files?: unknown }).files === "object"
    && !Array.isArray((value as { readonly files?: unknown }).files);
}

function isConsoleResult(value: JsonValue): value is {
  readonly status: string;
  readonly logs: readonly { readonly method: string; readonly data: readonly string[] }[];
} {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof (value as { readonly status?: unknown }).status === "string"
    && Array.isArray((value as { readonly logs?: unknown }).logs);
}

function formatJson(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

function compact(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
