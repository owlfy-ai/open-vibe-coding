import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import { DatabaseMigrationService } from "./migration-service";
import { CURRENT_DATABASE_VERSION, DATABASE_STORAGE_KEY, createEmptyDatabase } from "./schema";
import { InMemoryKeyValueStorage } from "./storage";

const LEGACY_CONVERSATIONS_KEY = "open-vibe-coding-conversations";

function sources(
  conversations: InMemoryKeyValueStorage,
  currentDatabase = new InMemoryKeyValueStorage(),
) {
  return {
    currentDatabase,
    settings: new InMemoryKeyValueStorage(),
    conversations,
    snapshots: new InMemoryKeyValueStorage(),
    memories: new InMemoryKeyValueStorage(),
  };
}

describe("DatabaseMigrationService", () => {
  it("verifies and commits a migration without deleting legacy multi-store data", async () => {
    const legacyConversations = new InMemoryKeyValueStorage({
      [LEGACY_CONVERSATIONS_KEY]: JSON.stringify({
        state: { conversations: {}, activeId: null },
      }),
    });
    const target = new InMemoryKeyValueStorage();
    const service = new DatabaseMigrationService(
      target,
      sources(legacyConversations),
      new SequentialIdGenerator(),
      new FixedClock(1000),
    );
    const result = await service.migrateIfNeeded();
    expect(result).toMatchObject({ ok: true, value: { migrated: true } });
    expect(target.snapshot()[DATABASE_STORAGE_KEY]).toBeTypeOf("string");
    expect(target.snapshot()[`${DATABASE_STORAGE_KEY}:staging`]).toBeUndefined();
    expect(legacyConversations.snapshot()[LEGACY_CONVERSATIONS_KEY]).toBeTypeOf("string");
  });

  it("moves the current localStorage database into the IndexedDB target", async () => {
    const database = createEmptyDatabase(1234);
    const serialized = JSON.stringify(database);
    const currentDatabase = new InMemoryKeyValueStorage({
      [DATABASE_STORAGE_KEY]: serialized,
      [`${DATABASE_STORAGE_KEY}:staging`]: serialized,
    });
    const target = new InMemoryKeyValueStorage();
    const service = new DatabaseMigrationService(
      target,
      sources(new InMemoryKeyValueStorage(), currentDatabase),
      new SequentialIdGenerator(),
      new FixedClock(9999),
    );

    expect(await service.migrateIfNeeded()).toEqual({
      ok: true,
      value: { database, migrated: true },
    });
    expect(target.snapshot()).toEqual({ [DATABASE_STORAGE_KEY]: serialized });
    expect(currentDatabase.snapshot()).toEqual({});
  });

  it("preserves corrupt localStorage data instead of deleting it", async () => {
    const currentDatabase = new InMemoryKeyValueStorage({
      [DATABASE_STORAGE_KEY]: JSON.stringify({ schemaVersion: CURRENT_DATABASE_VERSION + 1 }),
    });
    const target = new InMemoryKeyValueStorage();
    const service = new DatabaseMigrationService(
      target,
      sources(new InMemoryKeyValueStorage(), currentDatabase),
      new SequentialIdGenerator(),
      new FixedClock(1000),
    );

    expect(await service.migrateIfNeeded()).toMatchObject({
      ok: false,
      error: { code: "invalid-data" },
    });
    expect(target.snapshot()).toEqual({});
    expect(currentDatabase.snapshot()[DATABASE_STORAGE_KEY]).toBeTypeOf("string");
  });

  it("is idempotent and does not regenerate an existing database", async () => {
    const target = new InMemoryKeyValueStorage();
    const legacy = sources(new InMemoryKeyValueStorage());
    const first = new DatabaseMigrationService(
      target,
      legacy,
      new SequentialIdGenerator(),
      new FixedClock(1000),
    );
    const firstResult = await first.migrateIfNeeded();
    if (!firstResult.ok) throw new Error(firstResult.error.message);

    const second = new DatabaseMigrationService(
      target,
      legacy,
      new SequentialIdGenerator(),
      new FixedClock(9999),
    );
    const secondResult = await second.migrateIfNeeded();
    expect(secondResult).toMatchObject({
      ok: true,
      value: { migrated: false, database: { migratedAt: 1000 } },
    });
  });

  it("keeps the verified IndexedDB copy and cleans up a stale localStorage copy", async () => {
    const database = createEmptyDatabase(1000);
    const serialized = JSON.stringify(database);
    const target = new InMemoryKeyValueStorage({ [DATABASE_STORAGE_KEY]: serialized });
    const currentDatabase = new InMemoryKeyValueStorage({
      [DATABASE_STORAGE_KEY]: JSON.stringify(createEmptyDatabase(999)),
      [`${DATABASE_STORAGE_KEY}:staging`]: serialized,
    });
    const service = new DatabaseMigrationService(
      target,
      sources(new InMemoryKeyValueStorage(), currentDatabase),
      new SequentialIdGenerator(),
      new FixedClock(2000),
    );

    expect(await service.migrateIfNeeded()).toEqual({
      ok: true,
      value: { database, migrated: false },
    });
    expect(currentDatabase.snapshot()).toEqual({});
  });

  it("does not write target data when a legacy source is corrupt", async () => {
    const target = new InMemoryKeyValueStorage();
    const legacy = sources(
      new InMemoryKeyValueStorage({ [LEGACY_CONVERSATIONS_KEY]: "not-json" }),
    );
    const service = new DatabaseMigrationService(
      target,
      legacy,
      new SequentialIdGenerator(),
      new FixedClock(1000),
    );
    const result = await service.migrateIfNeeded();
    expect(result).toMatchObject({
      ok: false,
      error: { source: "conversations", code: "invalid-json" },
    });
    expect(target.snapshot()).toEqual({});
  });
});
