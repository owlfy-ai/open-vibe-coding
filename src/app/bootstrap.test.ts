import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import {
  InMemoryKeyValueStorage,
  type BrowserPersistenceStores,
} from "@/infrastructure/persistence";
import { bootstrapApplication } from "./bootstrap";

function stores(conversations = new InMemoryKeyValueStorage()): BrowserPersistenceStores {
  return {
    target: new InMemoryKeyValueStorage(),
    legacy: {
      settings: new InMemoryKeyValueStorage(),
      conversations,
      snapshots: new InMemoryKeyValueStorage(),
      memories: new InMemoryKeyValueStorage(),
    },
  };
}

describe("application bootstrap", () => {
  it("migrates once and returns a ready application session", async () => {
    const persistence = stores();
    const dependencies = {
      stores: persistence,
      ids: new SequentialIdGenerator(),
      clock: new FixedClock(100),
    };
    const first = await bootstrapApplication(dependencies);
    expect(first.migrated).toBe(true);
    expect(first.session.snapshot()).toMatchObject({ schemaVersion: 1, migratedAt: 100 });
    const created = await first.session.createConversation();
    expect(created.ok).toBe(true);

    const second = await bootstrapApplication({
      ...dependencies,
      ids: new SequentialIdGenerator(),
      clock: new FixedClock(999),
    });
    expect(second.migrated).toBe(false);
    expect(Object.keys(second.session.snapshot().conversations)).toHaveLength(1);
    expect(second.session.snapshot().migratedAt).toBe(100);
  });

  it("surfaces a recoverable error and leaves corrupt legacy data untouched", async () => {
    const legacyConversationsKey = "open-vibe-coding-conversations";
    const legacy = new InMemoryKeyValueStorage({
      [legacyConversationsKey]: "{broken",
    });
    const persistence = stores(legacy);
    await expect(
      bootstrapApplication({
        stores: persistence,
        ids: new SequentialIdGenerator(),
        clock: new FixedClock(100),
      }),
    ).rejects.toMatchObject({
      name: "ApplicationBootstrapError",
      code: "invalid-json",
      source: "conversations",
    });
    expect(legacy.snapshot()[legacyConversationsKey]).toBe("{broken");
    expect((persistence.target as InMemoryKeyValueStorage).snapshot()).toEqual({});
  });
});
