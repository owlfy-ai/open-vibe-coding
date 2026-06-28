import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import { DatabaseMigrationService } from "./migration-service";
import { DATABASE_STORAGE_KEY } from "./schema";
import { InMemoryKeyValueStorage } from "./storage";

const LEGACY_CONVERSATIONS_KEY = "web-vibe-coding-conversations";

function sources(conversations: InMemoryKeyValueStorage) {
  return {
    settings: new InMemoryKeyValueStorage(),
    conversations,
    snapshots: new InMemoryKeyValueStorage(),
    memories: new InMemoryKeyValueStorage(),
  };
}

describe("DatabaseMigrationService", () => {
  it("stages, verifies and commits a migration without deleting legacy data", async () => {
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
