# Architecture

## Layering Principles

Web Vibe Coding uses a layered architecture to control complexity:

```text
presentation -> app -> application -> domain
                         ^
                         |
                  infrastructure
```

Dependency rules:

- `domain` contains pure TypeScript domain rules. It does not depend on React, AI SDK, Sandpack, Tauri, or browser APIs.
- `application` orchestrates use cases and ports. It owns Agent services, project tools, conversation services, and preview coordination.
- `infrastructure` adapts external capabilities such as AI providers, browser storage, Sandpack, HTTP, Tauri, and ZIP export.
- `presentation` is responsible for React UI, user events, and view state.
- `app` handles startup, migration, and runtime service composition.

## Directory Responsibilities

```text
src/app
  bootstrap.ts              startup migration and ApplicationRuntime
  runtime-services.ts       composes Agent, search, preview, and export services from settings

src/domain
  agent/                    Agent state machine
  conversation/             conversation and message model
  memory/                   long-term memory policy
  project/                  paths, file tree, workspace changes
  settings/                 settings, validation, redaction
  snapshot/                 project history, delta, hash

src/application
  agent/                    CodingAgentService and AgentRunController
  conversation/             titles and context compaction
  memory/                   memory tool
  ports/                    ports for AI, tools, research, templates
  preview/                  PreviewCoordinator, console tool, element-selection types
  project/                  file tools, init tool, preview project port, export port
  research/                 web/image/npm tool wrappers
  session/                  ApplicationSession

src/infrastructure
  ai/                       AI SDK provider and message mapping
  http/                     fetch HTTP client
  persistence/              schema, repository, migration, browser storage
  preview/                  Sandpack runtime, bridge, template catalog
  project/                  ZIP export
  research/                 web, image, and npm research adapters
  tauri/                    fetch/XHR proxy and SSE bridge

src/presentation
  chat/                     chat messages, composer, tool cards
  sessions/                 session sidebar
  settings/                 settings panel
  shell/                    desktop layout
  theme/                    theme resolution and application
  workspace/                preview, code editor, file tree
```

## ApplicationSession

`ApplicationSession` is the session facade shared by UI and tools. It is responsible for:

- Creating, forking, switching, and updating sessions.
- Appending messages.
- Applying project file operations.
- Updating settings and memory.
- Writing to the repository.

It queues persistence writes to prevent concurrent UI events and Agent tool calls from overwriting each other.

## AgentRunController

`AgentRunController` is the state machine for one Agent run:

```text
idle
  -> preparing
  -> streaming
  -> executing-tools
  -> streaming
  -> completed | cancelled | failed
```

It depends only on `LanguageModelPort`, `ToolRegistry`, `IdGenerator`, and `Clock`. It does not save to the database and does not know about React UI.

## CodingAgentService

`CodingAgentService` is the Agent run use case:

1. Checks whether the same conversation already has an active run.
2. Persists the user message.
3. Creates a registry with project tools, memory tools, preview console tools, and research tools.
4. Builds the system prompt from compressed context, memory, and the current project file list.
5. Calls `AgentRunController`.
6. Persists assistant/tool messages in the order they are produced.
7. Releases the active run when execution ends.

It also supports `hiddenContext`, used to send internal location information to the model without writing it into chat history.

## PreviewCoordinator

`PreviewCoordinator` is the application-level source of truth for preview state:

- Records compiling, ready, and failed status for each `{ conversationId, revision }`.
- Stores console entries for the corresponding revision.
- Publishes preview restart commands.
- Lets `get_console_logs` wait for the current revision to settle.

Sandpack remounting, iframes, and console UI components are constrained to the infrastructure/presentation layers.

## ToolRegistry

Each tool consists of a definition and an execute function. Tool results use a unified structure:

```ts
{ ok: true, value: JsonValue }
{ ok: false, error: { code: string; message: string } }
```

The provider adapter converts tool schemas and results into provider messages at the AI SDK boundary. The application layer does not depend on any specific provider tool protocol.

## Presentation Constraints

The UI layer can own short-lived view state such as the current tab, device size, input draft, and console expansion state. Persistent state and business transactions must go through `ApplicationSession` or runtime services.

`scripts/check-presentation-complexity.mjs` sets a 500-line budget for TS/TSX files under `src/presentation`, preventing page components from growing unchecked.
