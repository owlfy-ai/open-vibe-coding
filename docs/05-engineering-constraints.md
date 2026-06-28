# Engineering Quality and Constraints

## Dependency Direction

Long-term maintenance constraints:

- `domain` does not import UI, browser APIs, AI SDK, Sandpack, or Tauri.
- `application` does not depend on React components and does not directly read browser storage.
- `infrastructure` implements external adapters and may depend on concrete SDKs.
- `presentation` does not directly execute diff, ZIP, persistence migration, or provider calls.
- Cross-layer data is represented through domain models, ports, and Result types.

New features should fit into existing boundaries first instead of having the UI directly access lower-level implementations.

## Sources of State

Project files, conversation messages, settings, and memories are sourced from the database snapshot in `ApplicationSession`. The following state may remain in the UI:

- Currently selected tab or file.
- Device size.
- Whether the console is expanded.
- Input draft and attachment draft.
- Whether DOM selection mode is enabled.

Agent tools, user edits, and export must all read the same project state to avoid multiple sources of truth across Sandpack, the editor, and the session database.

## Error Handling

The application uses `Result` to represent recoverable business errors. Recommended strategy:

- Domain and application layers return `{ ok: false, error }`.
- UI displays recoverable errors without blanking the whole application.
- Provider, search, tool, and storage errors are normalized at boundaries.
- API keys, search keys, and credentials must not enter error details.
- Preview-application errors are contained inside the iframe and preview state.

JSON errors, `package.json` errors, JS runtime errors, and unhandled rejections should be caught by internal error cards or console tooling instead of escaping to the host application level.

## Test Layers

Current test focus:

- domain: paths, workspace changes, messages, settings, memory, snapshots.
- application: Agent state machine, tool registry, session service, preview coordination, context compaction.
- infrastructure: AI message mapping, persistence migration, research adapters, Tauri proxy.
- smoke: production dist and browser startup.
- Rust: Tauri proxy URL, headers, and security boundaries.

Common commands:

```bash
npm run lint
npm run test
npm run check:ui
npm run build
npm run smoke:dist
```

When browser integration is involved, run:

```bash
npm run smoke:browser
```

When Tauri Rust code is involved, run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Presentation Complexity Budget

`scripts/check-presentation-complexity.mjs` checks the line count of every TS/TSX file under `src/presentation`. The current budget is 500 lines.

This budget is not a formatting rule. It is an architecture signal: when components keep growing, split out pure presentational components, local hooks, or application services.

## Bundle Budget

`scripts/check-bundle-budget.mjs` sets gzip chunk budgets for production builds. Vite manual chunks are split by functional domain:

- Sandpack runtime.
- AI SDK.
- archive/ZIP.
- Tauri.
- vendor.

When adding heavy dependencies, check whether they enter the first-screen main bundle. Use lazy imports when necessary.

## Security and Privacy

Security boundaries:

- Secrets are stored only in settings and transport calls; they do not enter project ZIP files.
- The memory tool must obey `MemoryPolicy` and reject credentials.
- The Tauri proxy rejects missing hosts, credentialed URLs, and unsafe headers.
- The Rust proxy does not automatically follow redirects.
- The Web runtime does not install the Tauri proxy.
- Tool results and logs should redact sensitive URLs or credentials.

## Accessibility and Child-Friendly Product Voice

UI copy should stay simple, encouraging, and understandable. Agent replies can be friendly, but code and tool behavior must remain rigorous.

Interactive components should provide:

- Clear button labels and titles.
- Keyboard-usable inputs and submission.
- A way to stop running tasks.
- Recoverable error states.
- No internal terminology exposed to child users.
