# Contributing

Thank you for your interest in contributing to Open Vibe Coding.

## Development Setup

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

Run the usual checks before opening a pull request:

```bash
pnpm lint
pnpm test
pnpm check:ui
pnpm build
pnpm smoke:dist
```

If you change Tauri Rust code, also run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Pull Request Guidelines

- Keep changes focused and describe the user-facing behavior they affect.
- Add or update tests when changing domain, application, persistence, Agent, or preview behavior.
- Update documentation when changing setup, configuration, deployment, privacy, or architecture.
- Do not commit API keys, tokens, personal data, generated secrets, or local machine paths.
- Follow the existing layered architecture: domain, application, infrastructure, presentation, and app.

## Issue Reports

When reporting bugs, include:

- What you expected to happen.
- What actually happened.
- Reproduction steps.
- Browser or Tauri platform details.
- Relevant console output with secrets removed.

For security issues, see [SECURITY.md](./SECURITY.md).
