# Open Vibe Coding Design Documents

This directory describes the current Open Vibe Coding implementation: product boundaries, technical framework, module responsibilities, and key runtime mechanisms. It is intended to support future development, debugging, and architecture reviews.

Open Vibe Coding is an online vibe coding agent for beginners. Users describe ideas with natural language and images. The Agent creates or modifies Web application files through project tools. Sandpack compiles and previews the result in a browser iframe, and console output plus runtime errors feed back into the Agent for diagnosis and repair.

## Document Index

- [01-system-overview.md](./01-system-overview.md): product capabilities, runtime environments, and system composition
- [02-data-and-compatibility.md](./02-data-and-compatibility.md): data model, persistence compatibility, and user data boundaries
- [03-architecture.md](./03-architecture.md): layered architecture, module responsibilities, and dependency direction
- [04-runtime-flows.md](./04-runtime-flows.md): major runtime flows and cross-module data flow
- [05-engineering-constraints.md](./05-engineering-constraints.md): engineering quality, testing, performance, and security constraints
- [06-agent-runtime.md](./06-agent-runtime.md): Agent runtime, tools, preview diagnostics, and element-selection details
- [development.md](./development.md): local development setup and checks
- [configuration.md](./configuration.md): AI, search, image, Tauri proxy, and build-time configuration
- [deployment.md](./deployment.md): GitHub Pages, Tauri desktop, Android, and iOS deployment notes
- [privacy.md](./privacy.md): local data, API keys, external requests, memory, and proxy privacy notes

## Technology Stack

- Frontend: React 19, Vite, TypeScript.
- Code editing: CodeMirror 6.
- Preview runtime: `@codesandbox/sandpack-react`.
- Model access: AI SDK, supporting OpenAI, Anthropic, Google, and OpenAI-compatible providers.
- Persistence: browser storage plus localforage/IndexedDB migration sources. The current unified database is managed by `AppDatabaseRepository`.
- Desktop and mobile container: Tauri 2. The Rust side provides an HTTP reverse proxy and SSE bridge.
- Tests and guardrails: Vitest, TypeScript, Vite build, bundle budget, presentation complexity budget, dist/browser smoke tests, and Rust tests.

## Current Project Boundaries

```text
src/
  app/             bootstrap and runtime service composition
  domain/          pure domain models and rules
  application/     use cases, Agent, tools, preview coordination, and ports
  infrastructure/  adapters for AI, storage, Sandpack, search, Tauri, archive export
  presentation/    React UI, theme, i18n, chat, sessions, and workspace
  shared/          shared primitives such as Result, Clock, and Id
```

The core constraint is one-way dependency flow: `domain` does not import React, Sandpack, Tauri, or AI SDK; `application` describes external capabilities through ports; `infrastructure` implements those ports; `presentation` calls runtime services and renders state.

## Common Verification Commands

```bash
npm run lint
npm run test
npm run check:ui
npm run build
npm run smoke:dist
```

When Tauri-side Rust logic changes, also run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
