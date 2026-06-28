import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxTree,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  type Diagnostic,
  lintGutter,
  linter,
  lintKeymap,
} from "@codemirror/lint";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import type { Extension } from "@codemirror/state";

/**
 * Picks a CodeMirror language extension for a project file. Returns `null` for
 * unknown types (plain text — defaultHighlightStyle still applies as a fallback).
 */
function languageForPath(path: string): Extension | null {
  if (path.endsWith(".json")) return json();
  if (/\.(t|j)sx$/.test(path)) return javascript({ jsx: true, typescript: path.endsWith(".tsx") });
  if (path.endsWith(".ts") || path.endsWith(".cts") || path.endsWith(".mts")) return javascript({ typescript: true });
  if (path.endsWith(".js") || path.endsWith(".cjs") || path.endsWith(".mjs")) return javascript();
  if (path.endsWith(".css")) return css();
  if (/\.(html?|svg)$/i.test(path)) return html();
  return null;
}

function syntaxErrorMessage(path: string): string {
  if (path.endsWith(".json")) return "Invalid JSON syntax";
  if (path.endsWith(".css")) return "Invalid CSS syntax";
  if (/\.(html?|svg)$/i.test(path)) return "Invalid HTML syntax";
  if (/\.(t|j)sx?$/.test(path) || /\.(c|m)(t|j)s$/.test(path)) return "Invalid JavaScript/TypeScript syntax";
  return "Syntax error";
}

function syntaxDiagnostics(path: string) {
  return (view: EditorView): readonly Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const seen = new Set<string>();
    const docLength = view.state.doc.length;
    const message = syntaxErrorMessage(path);

    syntaxTree(view.state).iterate({
      enter(node) {
        if (!node.type.isError) return;
        const from = Math.max(0, Math.min(node.from, docLength));
        const to = Math.max(from, Math.min(node.to > node.from ? node.to : node.from + 1, docLength));
        const key = `${from}:${to}`;
        if (seen.has(key)) return;
        seen.add(key);
        diagnostics.push({
          from,
          to,
          severity: "error",
          source: "syntax",
          message,
        });
      },
    });

    return diagnostics;
  };
}

/**
 * Chrome colors read from the app's CSS variables, so the editor follows the
 * light/dark theme automatically. Token colors come from defaultHighlightStyle.
 */
const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--ob-surface)",
    color: "var(--ob-text)",
    height: "100%",
    fontSize: "0.84rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--ob-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    lineHeight: "1.6",
  },
  ".cm-gutters": {
    backgroundColor: "var(--ob-surface-sunken)",
    color: "var(--ob-text-faint)",
    border: "none",
  },
  ".cm-content ::selection, .cm-line::selection": {
    backgroundColor: "var(--ob-code-selection) !important",
  },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "var(--ob-code-selection) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--ob-surface-subtle)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--ob-surface-subtle)" },
  ".cm-content": { padding: "10px 0" },
});

/**
 * Standalone CodeMirror 6 editor (the same engine Sandpack's editor uses),
 * bound straight to the project files. Keeping editing outside Sandpack gives
 * us predictable write-back for CSS/JS/TS and still lets users fix files when
 * Sandpack itself can't mount (e.g. broken package.json). Remount on `path`
 * (via key) to switch files / language.
 */
export function CodeMirrorEditor({
  path,
  value,
  onDebouncedChange,
  debounceMs = 400,
}: {
  readonly path: string;
  readonly value: string;
  readonly onDebouncedChange: (path: string, content: string) => void;
  readonly debounceMs?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // True while the user has typed something not yet flushed to the store, so an
  // external change (e.g. the assistant rewriting the file) doesn't clobber it.
  const pendingWrite = useRef(false);
  const writeTimer = useRef<number | undefined>(undefined);

  // Keep latest props in refs so the editor (created once) always reads fresh
  // values without needing to be re-created.
  const onChangeRef = useRef(onDebouncedChange);
  onChangeRef.current = onDebouncedChange;
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const language = languageForPath(path);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          editorTheme,
          EditorView.lineWrapping,
          lintGutter(),
          linter(syntaxDiagnostics(path), { delay: 350 }),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
          ]),
          language ?? [],
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            pendingWrite.current = true;
            window.clearTimeout(writeTimer.current);
            writeTimer.current = window.setTimeout(() => {
              pendingWrite.current = false;
              onChangeRef.current(pathRef.current, update.state.doc.toString());
            }, debounceMs);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      window.clearTimeout(writeTimer.current);
      if (pendingWrite.current) {
        pendingWrite.current = false;
        onChangeRef.current(pathRef.current, view.state.doc.toString());
      }
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per file (parent remounts via key when path changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external store changes unless the user is mid-edit.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || pendingWrite.current) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div className="ob-codemirror-host" ref={hostRef} />;
}
