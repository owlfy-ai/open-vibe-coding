import { err, ok, type Result } from "@/shared/result";
import type { MigrationError } from "./legacy-migration";
import { parseCurrentDatabase } from "./migration-service";
import { DATABASE_STORAGE_KEY, type AppDatabase } from "./schema";
import type { KeyValueStorage } from "./storage";

export class AppDatabaseRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  async load(): Promise<Result<AppDatabase | null, MigrationError>> {
    try {
      const raw = await this.storage.get(DATABASE_STORAGE_KEY);
      return raw === null ? ok(null) : parseCurrentDatabase(raw);
    } catch (error) {
      return storageFailure(error);
    }
  }

  async save(database: AppDatabase): Promise<Result<void, MigrationError>> {
    try {
      const serialized = JSON.stringify(database);
      // IndexedDB commits a single key atomically. Writing the complete database
      // to a staging key first would temporarily consume twice the storage.
      await this.storage.set(DATABASE_STORAGE_KEY, serialized);
      const committed = await this.storage.get(DATABASE_STORAGE_KEY);
      const verified = committed === null ? null : parseCurrentDatabase(committed);
      if (committed !== serialized || !verified?.ok) {
        return err({
          code: "invalid-data",
          source: "conversations",
          message: "Database write verification failed",
        });
      }
      return ok(undefined);
    } catch (error) {
      return storageFailure(error);
    }
  }

  async clear(): Promise<void> {
    await this.storage.remove(DATABASE_STORAGE_KEY);
    await this.storage.remove(`${DATABASE_STORAGE_KEY}:staging`);
  }
}

function storageFailure<T>(error: unknown): Result<T, MigrationError> {
  return err({
    code: "storage-error",
    source: "conversations",
    message: error instanceof Error ? error.message : "Storage operation failed",
  });
}
