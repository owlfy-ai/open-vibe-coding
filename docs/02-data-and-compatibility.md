# Data, Persistence, and Compatibility

## Current Database

Application startup is handled by `bootstrapApplication`. It creates browser storage adapters, runs `DatabaseMigrationService.migrateIfNeeded()`, and constructs `ApplicationSession` from the migrated database.

The current database is managed by `AppDatabaseRepository` and contains:

- settings: model, search, assets, theme, language, and privacy settings.
- conversations: conversation metadata, messages, and project revision.
- projects: files, directories, template, and revision for each session.
- memories: long-term memory entries.
- compressed context: conversation summary and the message index where it starts taking effect.

The database schema lives in `src/infrastructure/persistence/schema.ts`.

## Startup Migration

The migration service has two inputs:

- target storage: the current-version database.
- legacy sources: historical settings, conversation, snapshot, and memory data sources.

Migration requirements:

- Idempotent: repeated startup must not duplicate or corrupt data.
- Conservative: migration failure must preserve the original data and never clear user content.
- Atomic: the target database is saved as a complete structure through the repository.
- Testable: damaged data, legacy formats, and current formats are all covered by persistence tests.

Trailing-slash directory keys from legacy structures are converted into explicit directories during migration and do not enter `files`.

## Settings Model

The settings domain model lives in `src/domain/settings/settings.ts`:

- `ai`: provider, API key, base URL, and model name.
- `webSearch`: disabled, Tavily, Firecrawl, or provider builtin.
- `assetSearch`: disabled, Pixabay, or Unsplash.
- `system`: language and theme, both supporting system preference.
- `privacy`: long-term memory toggle.

`validateAiSettings` only validates AI configuration required for model execution. Search and image-asset configuration is checked by the corresponding tool at execution time.

`redactSettings` is used for logging or display contexts. API keys and search keys must not appear in error messages, tool results, or exported projects.

## Message Model

Domain messages live in `src/domain/conversation/message.ts`:

- user: text, image, and file content blocks.
- assistant: text, reasoning, and tool-call content blocks.
- tool: tool-call result, normalized as an ok/error structure.

Persisted messages keep the domain structure. Provider adaptation happens in `infrastructure/ai/message-mapper.ts`. Attachment capabilities for different providers are checked at the adapter boundary instead of leaking into the domain model.

## Hidden Context

Some interactions need to send extra context to the model without showing it to the user. One example is source-location information after selecting a DOM element in the preview.

Implementation:

- The UI persists only the user-entered prompt as a normal user message.
- `CodingAgentService.run` supports a `hiddenContext` option.
- Before the run, hidden context is temporarily appended to the user message sent to the model.
- The persisted database and chat history still contain only user-visible content.

This lets the Agent precisely edit selected elements while keeping internal instructions out of the chat history.

## Long-Term Memory

Long-term memory is managed by `MemoryBook` and `DefaultMemoryPolicy`:

- Memory can be disabled from settings.
- Credentials, keys, and other sensitive data are rejected by policy.
- Memory is updated through the `manage_memories` tool.
- `CodingAgentService` injects the current memory summary into the system prompt.

## Data Clearing Boundary

The application only clears its own repository and staging keys. It does not call origin-wide `localforage.clear()`. This avoids deleting data from the same origin that does not belong to this application.
