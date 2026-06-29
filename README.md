# Open Vibe Coding

Open Vibe Coding is an online vibe coding agent that helps users create Web apps with natural language. It combines a chat-based Agent, editable project files, a Sandpack live preview, runtime diagnostics, and optional desktop/mobile packaging through Tauri.

[中文说明](./README.zh-CN.md)

## Highlights

- Chat with an Agent to create and modify Web applications.
- Edit generated HTML, CSS, JavaScript, TypeScript, JSON, and other project files directly.
- Preview projects live through Sandpack.
- Capture preview console output, syntax errors, and runtime errors for Agent-assisted repair.
- Select DOM elements in the preview and ask the Agent to modify only that element.
- Use optional Web search, image search, npm package research, and long-term memory tools.
- Run as a browser app or package with Tauri for desktop and mobile targets.

## Tech Stack

- React 19, Vite, TypeScript
- CodeMirror 6
- `@codesandbox/sandpack-react`
- AI SDK with OpenAI, Anthropic, Google, and OpenAI-compatible providers
- Tauri 2 for desktop/mobile packaging
- Vitest for tests

## Getting Started

Prerequisites:

- Node.js 20 or newer
- pnpm 9
- Rust and Tauri prerequisites when building desktop or mobile apps

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

Build the Web app:

```bash
pnpm build
```

Run checks:

```bash
pnpm lint
pnpm test
pnpm check:ui
pnpm smoke:dist
```

## Configuration

Most runtime configuration is entered in the app settings UI:

- AI provider, base URL, API key, and model
- Web search provider
- Image search provider
- Theme and language
- Long-term memory toggle

See [docs/configuration.md](./docs/configuration.md) for details.

## Documentation

- [Design documents](./docs/README.md)
- [Development guide](./docs/development.md)
- [Configuration guide](./docs/configuration.md)
- [Deployment guide](./docs/deployment.md)
- [Privacy notes](./docs/privacy.md)

## Security

Please report security issues through GitHub issues, but do not include secrets, API keys, tokens, private user data, or exploit details publicly. See [SECURITY.md](./SECURITY.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before opening pull requests.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
