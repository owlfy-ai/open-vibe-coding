# Deployment Guide

## GitHub Pages

The Web app can be deployed to GitHub Pages. The workflow builds the app with:

```bash
VITE_BASE_PATH=/${{ github.event.repository.name }}/
```

For the repository `owlfy-ai/web-vibe-coding`, the expected base path is:

```bash
/web-vibe-coding/
```

## Desktop Releases

Desktop releases are built with Tauri. The release workflow targets:

- macOS Apple Silicon
- macOS Intel
- Linux
- Windows

Some platforms require signing secrets. See [configuration.md](./configuration.md).

## Android and iOS

Android and iOS workflows are present but may require platform-specific signing, SDK, and store configuration before they can produce distributable builds.

## Release Notes

`CHANGELOG.md` is kept as the release changelog source. It currently contains a placeholder and should be updated when code changes are released.
