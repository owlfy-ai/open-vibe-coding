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
      const stagingKey = `${DATABASE_STORAGE_KEY}:staging`;
      await this.storage.set(stagingKey, serialized);
      const staged = await this.storage.get(stagingKey);
      const verified = staged === null ? null : parseCurrentDatabase(staged);
      if (!verified?.ok) {
        await this.storage.remove(stagingKey);
        return err({
          code: "invalid-data",
          source: "conversations",
          message: "Database write verification failed",
        });
      }
      await this.storage.set(DATABASE_STORAGE_KEY, serialized);
      await this.storage.remove(stagingKey);
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
