<div align="center">
<<<<<<< HEAD
  <img src="./public/logo.png" alt="Open Vibe Coding logo" width="96" />
=======
  <img src="./public/logo.svg" alt="Open Vibe Coding logo" width="96" />
>>>>>>> origin/main

  # Open Vibe Coding

  **Turn an idea into a working web app by describing it in plain language.**

  An open-source, browser-based coding agent with editable source code, instant preview, and an Agent that can inspect and repair what it builds.

  [Live preview](https://qidea.ai/) · [中文 README](./README.zh-CN.md) · [Documentation](./docs/README.md) · [Report an issue](https://github.com/owlfy-ai/open-vibe-coding/issues)

  [![License: MIT](https://img.shields.io/badge/License-MIT-18181b.svg)](./LICENSE)
  [![React](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
  [![Tauri](https://img.shields.io/badge/Tauri-2-24c8db.svg)](https://tauri.app/)
</div>

<video src="https://github.com/user-attachments/assets/66064976-1e5a-470c-ad25-35dbba64203a" controls width="100%"></video>

## What is Open Vibe Coding?

Open Vibe Coding is a complete workspace for building small web applications with AI. Describe what you want, attach a reference image, or point at an element in the preview. The Agent plans the work, creates and edits the project files, installs dependencies, and checks the running application as it goes.

Unlike a chat that only returns code snippets, Open Vibe Coding keeps the conversation, source files, live application, and runtime diagnostics in one place. You can inspect every change, edit the code yourself, and download the finished project at any time.

## Why developers and makers use it

- **Build through conversation** — create a React app, game, prototype, or interactive page without assembling the project by hand.
- **See every file** — generated code stays visible and editable; the Agent works on a real project rather than an opaque artifact.
- **Preview instantly** — Sandpack compiles and runs the app inside the browser while you work.
- **Repair from real errors** — console messages, build failures, and runtime exceptions can be fed back to the Agent for diagnosis.
- **Edit by pointing** — select an element in the preview and describe exactly how that part should change.
- **Bring your own model** — use OpenAI, Anthropic, Google, or an OpenAI-compatible endpoint with your own credentials.
- **Research while building** — optionally give the Agent web search, image search, and npm package discovery tools.
- **Keep ownership** — projects and conversations are stored locally, and the complete source can be exported as a ZIP.
- **Run beyond the browser** — package the application for desktop or mobile with Tauri 2.

## How it works

```text
Your request
    ↓
Coding Agent  ── reads, writes, patches, and searches project files
    ↓
Sandpack      ── installs dependencies and runs the app in the browser
    ↓
Diagnostics   ── returns console and runtime errors to the Agent
    ↓
Editable code + live preview + downloadable project
```

The Agent can use project tools, runtime diagnostics, web research, image search, package research, and privacy-controlled long-term memory. The application keeps these capabilities behind clear interfaces so model providers and runtime adapters can be changed independently.

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- [pnpm](https://pnpm.io/) 9
- A supported model provider API key

### Run locally

```bash
git clone https://github.com/owlfy-ai/open-vibe-coding.git
cd open-vibe-coding
pnpm install
pnpm dev
```

Open the local URL printed by Vite, then choose a model provider in **Settings** and enter its API key, base URL, and model name.

No application backend is required for the open-source build. Provider requests are made from the client, so the selected provider must allow browser requests. The Tauri app includes a native proxy for providers that do not support browser CORS.

## Configuration

Most options are configured at runtime in the Settings panel and remain on your device.

| Capability | Available options |
| --- | --- |
| AI models | OpenAI, Anthropic, Google, OpenAI-compatible services |
| Web research | Provider-native search, Tavily, Firecrawl, or disabled |
| Image search | Pexels, Pixabay, Unsplash, or disabled |
| Personalization | Interface language, theme, optional long-term memory |

See the [configuration guide](./docs/configuration.md) for provider details and build-time settings. Never commit API keys or include them in issue reports.

## Development

```bash
# Type checking
pnpm lint

# Test suite
pnpm test

# Production build
pnpm build

# UI complexity and distribution checks
pnpm check:ui
pnpm smoke:dist
```

For desktop development, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and run:

```bash
pnpm tauri:dev
```

## Architecture

The codebase follows a layered architecture that keeps product rules independent from React, AI providers, Sandpack, and Tauri:

```text
src/
├── domain/          Pure models and business rules
├── application/     Use cases, Agent runtime, tools, and ports
├── infrastructure/  AI, storage, preview, search, and export adapters
├── presentation/    React interface, workspace, chat, theme, and i18n
├── app/             Application bootstrap and service composition
└── shared/          Shared primitives
```

Start with the [system overview](./docs/01-system-overview.md), then explore the [architecture](./docs/03-architecture.md) and [Agent runtime](./docs/06-agent-runtime.md) documents.

## Documentation

- [Development guide](./docs/development.md)
- [Configuration guide](./docs/configuration.md)
- [Deployment guide](./docs/deployment.md)
- [Privacy notes](./docs/privacy.md)
- [Design documents](./docs/README.md)

## Contributing

Bug reports, feature proposals, documentation improvements, and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before starting a larger change, and follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

For security-sensitive reports, follow [SECURITY.md](./SECURITY.md) and do not publish credentials, private data, or exploitable details in a public issue.

## License

Open Vibe Coding is released under the [MIT License](./LICENSE).
