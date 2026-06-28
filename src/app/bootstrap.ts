import { ApplicationSession } from "@/application/session";
import { CryptoIdGenerator, type IdGenerator } from "@/shared/id";
import { SystemClock, type Clock } from "@/shared/clock";
import {
  AppDatabaseRepository,
  DatabaseMigrationService,
  createBrowserPersistenceStores,
  type BrowserPersistenceStores,
} from "@/infrastructure/persistence";

export interface ApplicationRuntime {
  readonly session: ApplicationSession;
  readonly repository: AppDatabaseRepository;
  readonly migrated: boolean;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface BootstrapDependencies {
  readonly stores?: BrowserPersistenceStores;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
}

export class ApplicationBootstrapError extends Error {
  constructor(
    readonly code: string,
    readonly source: string,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationBootstrapError";
  }
}

export async function bootstrapApplication(
  dependencies: BootstrapDependencies = {},
): Promise<ApplicationRuntime> {
  const stores = dependencies.stores ?? createBrowserPersistenceStores();
  const ids = dependencies.ids ?? new CryptoIdGenerator();
  const clock = dependencies.clock ?? new SystemClock();
  const migration = new DatabaseMigrationService(
    stores.target,
    stores.legacy,
    ids,
    clock,
  );
  try {
    const result = await migration.migrateIfNeeded();
    if (!result.ok) {
      throw new ApplicationBootstrapError(
        result.error.code,
        result.error.source,
        result.error.message,
      );
    }
    const repository = new AppDatabaseRepository(stores.target);
    return {
      session: new ApplicationSession(result.value.database, repository, ids, clock),
      repository,
      migrated: result.value.migrated,
      ids,
      clock,
    };
  } catch (error) {
    if (error instanceof ApplicationBootstrapError) throw error;
    throw new ApplicationBootstrapError(
      "storage-error",
      "database",
      error instanceof Error ? error.message : "Application bootstrap failed",
    );
  }
}
