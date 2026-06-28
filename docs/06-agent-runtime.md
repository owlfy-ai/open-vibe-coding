# Agent Runtime and Preview Diagnostics

## Agent System Prompt

`buildCodingAgentPrompt` builds the Agent's base system prompt. It includes:

- Product identity: a vibe coding agent for beginners.
- Behavioral requirements: turn natural-language ideas into complete, accessible, secure, runnable Web applications.
- Engineering requirements: read relevant files before editing, prefer exact patches, and manage dependencies through `package.json`.
- Verification requirements: call `get_console_logs` before declaring completion and fix every runtime or syntax error.
- Current project file list.
- Long-term memory summary.
- Optional conversation compaction summary.

## Models and Retry

AI calls are abstracted through `LanguageModelPort`. The production implementation is:

```text
AiSdkLanguageModelAdapter
  -> RetryingLanguageModel
  -> CodingAgentService
```

`RetryingLanguageModel` uses exponential backoff for retryable errors. Provider differences are handled in `createAiProviderRuntime` and `message-mapper`:

- OpenAI.
- Anthropic.
- Google.
- OpenAI-compatible.

Provider built-in search is connected through provider tools. Tavily and Firecrawl are connected as normal Agent tools.

## Tool Loop

Each model iteration can produce text, reasoning, and tool calls. Flow:

1. The model stream emits assistant content.
2. If there are no tool calls, or if the finish reason is not `tool-calls`, the run completes.
3. If tool calls exist, `ToolRegistry` executes them in order.
4. Tool results are appended as tool messages.
5. Control returns to the model for the next iteration.

The maximum iteration count is controlled by `AgentRunController` to prevent infinite tool loops.

## Project Tool Semantics

All project tools operate through `ProjectToolPort`:

- `list_files` returns files and explicit directories.
- `read_files` reads one or more files.
- `write_file` creates or replaces a file; empty strings are valid.
- `patch_file` applies ordered exact replacements to one file; any failed replacement fails the whole operation.
- `search_in_files` searches all files with a regular expression.
- `delete_file` deletes a file or directory.
- `manage_dependencies` replaces `package.json` with a complete valid JSON document.

After a tool successfully modifies the project, `PreviewProjectToolPort` notifies `PreviewCoordinator`. Dependency changes trigger restart; normal file changes trigger files-changed.

## Console Tool

`get_console_logs` reads preview results for the current conversation and revision:

- If the preview is still compiling, the tool waits for it to settle.
- If the revision failed, it returns error console entries.
- If there are no issues, it returns empty logs or a no-error status.

This prevents the Agent from reading logs from the previous revision immediately after modifying files.

## JS Runtime Error Capture

`SandpackRuntime` injects an inline error-capture script into the runtime HTML copy:

- `window.onerror`
- `error` event
- `unhandledrejection`

Errors are sent back to the host application through `postMessage` and written into `PreviewCoordinator`. The implementation does not use `externalResources`, avoiding MIME-type errors caused by Sandpack static paths returning HTML for virtual JS resources.

## DOM Element Selection and Local Editing

Element selection is a preview runtime capability. It does not modify user project files.

Implementation has two parts:

1. `instrumentPreviewSources` adds `data-kvc-source-id` to lowercase DOM tags in HTML/JSX/TSX runtime files and builds a source map.
2. The iframe selection script receives host commands, highlights selectable elements on hover, and shows an inline prompt bar next to the clicked element.

After the user enters a prompt in the inline bar:

- The visible prompt is saved as a normal user message.
- The file, line, column, opening tag, and nearby source snippet corresponding to the source id are sent to the model as `hiddenContext`.
- `hiddenContext` explicitly tells the model to modify only the selected DOM element and not change `body`, global theme, or unrelated containers.

This design gives users a natural interaction while still giving the Agent enough precise location information.

## Context Compaction

Compaction is handled by `ConversationIntelligenceService`:

- At least two user messages are required.
- Old context is summarized without deleting visible chat history.
- The result is stored as `{ summary, fromIndex }`.
- Future runs include the summary in the system prompt and use live history starting at `fromIndex`.

Compaction failures return explicit errors, such as insufficient history or an empty model result.

## Image and Research Tools

Research tools are registered according to settings:

- Web: Tavily, Firecrawl, provider builtin, or disabled.
- Images: Pixabay, Unsplash, or disabled.
- npm: package search and package details.

Image search has no standalone UI; it is used as an Agent tool. Tool results include image URL, thumbnail, dimensions, and description. They do not include API keys.

## Tauri Network Runtime

The Tauri desktop runtime automatically installs a fetch/XHR proxy:

- Only cross-origin HTTP(S) requests are proxied.
- Same-origin requests, `data:`, `blob:`, and already proxied `proxy://` requests are not proxied.
- SSE is transported through the Rust bridge.
- The Web runtime keeps native browser network behavior.

This makes model APIs, search, image, and npm requests more reliable inside the desktop WebView without requiring users to manually enable a proxy.
