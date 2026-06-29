import type { Clock } from "@/shared/clock";
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
      return parsed.ok ? ok({ database: parsed.value, migrated: false }) : parsed;
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
    const stagingKey = `${DATABASE_STORAGE_KEY}:staging`;
    await this.target.set(stagingKey, serialized);
    const staged = await this.target.get(stagingKey);
    if (staged === null || !parseCurrentDatabase(staged).ok) {
      await this.target.remove(stagingKey);
      return err({
        code: "invalid-data",
        source: "conversations",
        message: "Staged database failed verification",
      });
    }
    await this.target.set(DATABASE_STORAGE_KEY, serialized);
    await this.target.remove(stagingKey);
    return ok({ database: migrated.value, migrated: true });
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
  return ok(value as AppDatabase);
}
