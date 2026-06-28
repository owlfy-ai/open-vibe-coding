# System Overview

## Product Capabilities

Web Vibe Coding provides a creation environment built around chat, live preview, and editable code:

1. Users enter natural-language prompts in the chat area and can attach images.
2. The Agent calls a model and executes project tools to create, read, search, modify, or delete project files.
3. Project files are stored in the application session and synchronized into the Sandpack preview runtime.
4. Users can directly edit HTML, CSS, JS, TS, JSON, and related files in the code area.
5. Console output, syntax errors, and runtime errors from the Sandpack iframe enter application state. The Agent can read them through the `get_console_logs` tool.
6. Users can select DOM elements directly in the preview and enter a local edit prompt next to the element. Hidden source-location context is passed to the Agent without being shown in the chat history.

## Runtime Environments

- Web: native browser `fetch`, local storage, and the Sandpack iframe.
- Tauri Desktop: automatically installs a fetch/XHR reverse proxy. Cross-origin HTTP(S) requests go through the Rust-side proxy to avoid CORS and WebView restrictions.
- Tauri Mobile: reuses Tauri configuration and local WebView capabilities. Its network boundary matches the desktop container.

The application is client-first. A user project is not a host filesystem directory; it is a `ProjectTree` stored in the application database and mapped to Sandpack files during preview.

## Main UI Areas

- Session sidebar: create, switch, fork, pin, archive, and delete sessions.
- Chat area: displays user messages, Agent replies, collapsible reasoning, tool-call cards, and streaming state.
- Prompt composer: supports image attachments, stopping a run, context compaction, and project review shortcuts.
- Workspace: provides preview/code switching, device-size controls, console, download, and DOM element selection.
- Settings panel: configures model, search, image assets, theme, language, and long-term memory.

## Core Services

Runtime services are composed in `src/app/runtime-services.ts`:

- `CodingAgentService`: manages one Agent run, tool loops, hidden context, and message persistence.
- `ConversationIntelligenceService`: handles conversation title generation, context compaction, and related conversation intelligence.
- `PreviewCoordinator`: records preview status, console logs, and restart commands for each session/project revision.
- `BrowserProjectArchive`: exports a complete project ZIP.

Service creation depends on the current settings. If model settings are missing an API key, base URL, or model name, the UI remains available and prompts the user to configure the AI service.

## Project File Model

Projects are managed by `ProjectWorkspace`. Key properties:

- Files and explicit directories are separate, avoiding fake trailing-slash files for empty directories.
- All file changes are submitted atomically through `FileOperation[]`.
- Every valid commit produces a revision and change set.
- Empty strings are valid file contents.
- Failed patches or invalid paths do not commit partial revisions.

Agent tools and user code edits share the same project source of truth: `ApplicationSession.applyProjectOperations`.

## Preview Model

Sandpack is a preview adapter, not the source of truth for project state.

- `WorkspacePanel` converts the current project files into Sandpack files.
- `SandpackRuntime` receives files, template, theme, active file, and revision.
- `SandpackBridge` explicitly calls `sandpack.updateFile` when the revision changes.
- `package.json` or dependency changes emit a restart intent through `PreviewCoordinator`; the adapter converts that intent into a Sandpack remount internally.
- User-application errors are contained inside the preview iframe and written to console entries for the current revision.

## Agent Tools

Built-in project tools:

- `init_project`
- `list_files`
- `read_files`
- `write_file`
- `patch_file`
- `search_in_files`
- `delete_file`
- `manage_dependencies`
- `get_console_logs`
- `manage_memories`

Optional research tools:

- `web_search`
- `web_reader`
- `image_search`
- `search_npm_packages`
- `get_npm_package_detail`

Tool registration depends on settings, API keys, and runtime service composition.
