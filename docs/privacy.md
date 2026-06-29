# Privacy Notes

Open Vibe Coding is a client-first application. Project files, conversation data, settings, and memory are stored locally by the application unless users configure external services or deploy their own hosting.

## Local Data

The app stores:

- conversations
- generated project files
- settings
- long-term memory entries
- compressed conversation summaries

These are managed by the app persistence layer.

## API Keys

Users can enter API keys for AI, search, and image providers. Keys are used for requests to those providers and should never be included in issues, logs, screenshots, or exported projects.

## External Requests

Depending on settings, the app may send requests to:

- AI model providers
- Tavily or Firecrawl
- Pixabay or Unsplash
- npm package registry endpoints

The content sent depends on the feature being used. Users should review provider policies before entering sensitive prompts or data.

## Long-Term Memory

Long-term memory can be disabled in settings. The memory policy rejects credentials and other sensitive values where possible, but users should still avoid asking the Agent to store secrets.

## Tauri Proxy

In Tauri desktop builds, cross-origin HTTP(S) requests are proxied through the local Rust runtime to avoid WebView network limitations. Web builds use native browser networking.
