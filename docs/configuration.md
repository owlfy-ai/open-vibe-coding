# Configuration Guide

Most runtime configuration is managed inside the app settings UI.

## AI Provider

Configure:

- provider type: OpenAI, Anthropic, Google, or OpenAI-compatible
- API base URL
- API key
- model name

The app validates required AI settings before creating runtime services.

## Web Search

Supported modes:

- disabled
- provider builtin search
- Tavily
- Firecrawl

Provider-specific API keys and base URLs are configured in the settings UI.

## Image Search

Supported modes:

- disabled
- Pixabay
- Unsplash

Image search is exposed to the Agent as the `image_search` tool. There is no separate image-search UI.

## Tauri Proxy

In the Tauri desktop runtime, the app automatically installs a fetch/XHR proxy for cross-origin HTTP(S) requests. Web builds do not install this proxy.

The proxy does not handle same-origin requests, `data:`, `blob:`, or already proxied `proxy://` requests.

## Build-Time Environment

The Web build can use:

```bash
VITE_BASE_PATH=/open-vibe-coding/
```

This is mainly used when deploying to GitHub Pages under a repository subpath.

See [.env.example](../.env.example).

## GitHub Actions Secrets

Release workflows may use optional platform secrets, including:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

Only configure the secrets needed for the release targets you use.
