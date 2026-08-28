import type { Clock } from "@/shared/clock";
import { normalizeSettings } from "@/domain/settings";
import type { IdGenerator } from "@/shared/id";
import { err, ok, type Result } from "@/shared/result";
import {
  migrateLegacyPayloads,
  type LegacyPayloads,
  type MigrationError,
} from "./legacy-migration";
import {
  CURRENT_DATABASE_VERSION,
  DATABASE_STORAGE_KEY,
  type AppDatabase,
} from "./schema";
import type { KeyValueStorage } from "./storage";

const LEGACY_KEYS = {
  settings: "open-vibe-coding-settings",
  conversations: "open-vibe-coding-conversations",
  snapshots: "open-vibe-coding-snapshots",
  memories: "open-vibe-coding-memories",
} as const;

export interface LegacyStorageSources {
  /** The v1 monolithic database previously stored in localStorage. */
  readonly currentDatabase: KeyValueStorage;
  readonly settings: KeyValueStorage;
  readonly conversations: KeyValueStorage;
  readonly snapshots: KeyValueStorage;
  readonly memories: KeyValueStorage;
}

export type DatabaseMigrationResult =
  | { readonly database: AppDatabase; readonly migrated: true }
  | { readonly database: AppDatabase; readonly migrated: false };

export class DatabaseMigrationService {
  constructor(
    private readonly target: KeyValueStorage,
    private readonly legacy: LegacyStorageSources,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async migrateIfNeeded(): Promise<Result<DatabaseMigrationResult, MigrationError>> {
    const existing = await this.target.get(DATABASE_STORAGE_KEY);
    if (existing !== null) {
      const parsed = parseCurrentDatabase(existing);
      if (!parsed.ok) return parsed;
      await this.removeLegacyCurrentDatabase();
      return ok({ database: parsed.value, migrated: false });
    }

    const localDatabase = await this.legacy.currentDatabase.get(DATABASE_STORAGE_KEY);
    if (localDatabase !== null) {
      const parsed = parseCurrentDatabase(localDatabase);
      if (!parsed.ok) return parsed;
      const persisted = await this.persistVerified(localDatabase);
      if (!persisted.ok) return persisted;
      await this.removeLegacyCurrentDatabase();
      return ok({ database: parsed.value, migrated: true });
    }

    const payloads: LegacyPayloads = {
      settings: await this.legacy.settings.get(LEGACY_KEYS.settings),
      conversations: await this.legacy.conversations.get(LEGACY_KEYS.conversations),
      snapshots: await this.legacy.snapshots.get(LEGACY_KEYS.snapshots),
      memories: await this.legacy.memories.get(LEGACY_KEYS.memories),
    };
    const migrated = migrateLegacyPayloads(payloads, this.ids, this.clock);
    if (!migrated.ok) return migrated;

    const serialized = JSON.stringify(migrated.value);
    const persisted = await this.persistVerified(serialized);
    if (!persisted.ok) return persisted;
    return ok({ database: migrated.value, migrated: true });
  }

  private async persistVerified(serialized: string): Promise<Result<void, MigrationError>> {
    // IndexedDB commits a single key atomically, so a second full-size staging
    // value is unnecessary and would temporarily double storage usage.
    await this.target.set(DATABASE_STORAGE_KEY, serialized);
    const committed = await this.target.get(DATABASE_STORAGE_KEY);
    if (committed !== serialized || !parseCurrentDatabase(committed).ok) {
      return err({
        code: "invalid-data",
        source: "conversations",
        message: "Database write verification failed",
      });
    }
    return ok(undefined);
  }

  private async removeLegacyCurrentDatabase(): Promise<void> {
    try {
      await this.legacy.currentDatabase.remove(DATABASE_STORAGE_KEY);
      await this.legacy.currentDatabase.remove(`${DATABASE_STORAGE_KEY}:staging`);
    } catch {
      // The verified IndexedDB copy is authoritative. A leftover localStorage
      // copy is harmless and can be retried on a later cleanup.
    }
  }
}

export function parseCurrentDatabase(raw: string): Result<AppDatabase, MigrationError> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return err({ code: "invalid-json", source: "conversations", message: "Current database is invalid JSON" });
  }
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !== CURRENT_DATABASE_VERSION
  ) {
    return err({
      code: "invalid-data",
      source: "conversations",
      message: "Current database has an unsupported schema version",
    });
  }
  const database = value as AppDatabase;
  return ok({ ...database, settings: normalizeSettings(database.settings) });
}
