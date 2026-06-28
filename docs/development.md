# Development Guide

## Prerequisites

- Node.js 20 or newer
- pnpm 9
- Rust and Tauri prerequisites when working on desktop or mobile builds

## Install

```bash
pnpm install
```

## Run Locally

```bash
pnpm dev
```

## Build

```bash
pnpm build
```

## Tests and Checks

```bash
pnpm lint
pnpm test
pnpm check:ui
pnpm build
pnpm smoke:dist
```

Use browser smoke tests when changing bootstrap, routing, preview behavior, or build output:

```bash
pnpm smoke:browser
```

Use Rust tests when changing Tauri proxy or SSE behavior:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Architecture Notes

Keep changes within the existing layer boundaries:

- `domain`: pure TypeScript rules and models
- `application`: use cases, ports, Agent runtime, tools
- `infrastructure`: adapters for external systems
- `presentation`: React UI and view state
- `app`: bootstrap and runtime service composition

Avoid moving persistence, provider calls, ZIP export, or Agent tool execution directly into presentation components.
