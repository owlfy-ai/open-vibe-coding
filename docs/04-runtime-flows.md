# Runtime Flows

## Startup Flow

```text
main.tsx
  -> AppRoot
  -> bootstrapApplication
  -> createBrowserPersistenceStores
  -> DatabaseMigrationService.migrateIfNeeded
  -> AppDatabaseRepository
  -> ApplicationSession
  -> ApplicationProvider
  -> AppShell
```

If startup fails, the app shows an error page and tells the user that local data was not modified. If startup succeeds and no sessions exist, `AppShell` automatically creates a new session.

## Service Composition Flow

```text
ApplicationRuntime
  -> createRuntimeServices
  -> validateAiSettings
  -> createAiProviderRuntime
  -> AiSdkLanguageModelAdapter
  -> RetryingLanguageModel
  -> research adapters
  -> CodingAgentService
```

`createRuntimeServices` builds runtime services from the current settings each time. Web search, image search, and npm research are injected into the Agent as tools.

## Normal Prompt Execution Flow

```text
ChatPanel.submit
  -> services.agent.run(conversationId, userContent)
  -> CodingAgentService.run
  -> append user message
  -> create ToolRegistry
  -> AgentRunController.run
  -> model.stream
  -> assistant delta to UI
  -> tool calls execute
  -> append assistant/tool messages
```

The user message is persisted first, so refreshes do not lose the user's input. Assistant and tool messages are persisted in order during generation, allowing the UI to show tool cards and output live.

## Project Modification Through Tools

```text
Agent tool call
  -> ProjectToolPort.apply
  -> SessionProjectToolPort
  -> ApplicationSession.applyProjectOperations
  -> ProjectWorkspace.apply
  -> repository save
  -> PreviewProjectToolPort
  -> PreviewCoordinator.request
  -> SandpackBridge updateFile / runtime restart
```

Changes to `package.json` are treated as dependencies-changed and trigger a preview restart. Normal file changes update the current runtime only.

## User Code Editing Flow

```text
CodeMirrorEditor
  -> debounced onDebouncedChange
  -> WorkspacePanel.updateFile
  -> ApplicationSession.applyProjectOperations
  -> project revision changes
  -> SandpackRuntime receives new files
  -> SandpackBridge.updateFile
```

The code editor is owned by the application, not by Sandpack's built-in editor. This allows CSS, JS, TS, HTML, JSON, and related files to be edited and saved consistently.

## Preview Error Flow

```text
Preview iframe
  -> injected error capture script
  -> postMessage(open-vibe-coding.preview-error)
  -> SandpackRuntime host listener
  -> PreviewCoordinator.markFailed
  -> PreviewCoordinator.recordConsole
  -> get_console_logs tool
```

Captured errors include `window.onerror`, resource errors, and `unhandledrejection`. The injected script exists only in the Sandpack runtime HTML copy and is not written back to project files.

## DOM Element Selection Flow

```text
Workspace select button
  -> SandpackRuntime posts select command to iframe
  -> iframe runtime highlights DOM nodes with source id
  -> user clicks element
  -> inline prompt bar appears near selected element
  -> user submits visible prompt
  -> host receives PreviewElementPromptRequest
  -> ChatPanel runs Agent with visible prompt + hidden context
```

Source mapping is generated through runtime instrumentation:

- Lowercase DOM tags in HTML, JSX, and TSX receive `data-kvc-source-id`.
- The source map stores file name, line, column, opening tag, and nearby source snippet.
- Markers exist only in runtime files passed to Sandpack and do not pollute project files.

Chat history shows only the prompt the user typed in the inline prompt bar. Selected-element context is passed to the model through `hiddenContext`.

## Context Compaction Flow

```text
Chat shortcut
  -> ConversationIntelligenceService.compress
  -> model summarizes old turns
  -> ApplicationSession stores compressedContext
  -> future CodingAgentService.run
  -> system prompt includes summary
  -> live messages start at fromIndex
```

Compaction does not delete chat history. It only changes how context is organized for future model requests.

## Project Export Flow

```text
Workspace download
  -> services.projectArchive.download
  -> BrowserProjectArchive
  -> JSZip
  -> file-saver
```

Exported content comes from the current session's project files. It does not include API keys, memories, or the application database.
