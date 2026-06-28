import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import {
  AppDatabaseRepository,
  InMemoryKeyValueStorage,
  createEmptyDatabase,
} from "@/infrastructure/persistence";
import { ApplicationSession } from "@/application/session";
import { CodingAgentService } from "@/application/agent";
import { ConversationIntelligenceService } from "@/application/conversation";
import { PreviewCoordinator } from "@/application/preview";
import { createRuntimeServices } from "./runtime-services";

describe("runtime service assembly", () => {
  it("refuses to construct providers from incomplete settings", () => {
    const ids = new SequentialIdGenerator();
    const clock = new FixedClock(100);
    const repository = new AppDatabaseRepository(new InMemoryKeyValueStorage());
    const session = new ApplicationSession(createEmptyDatabase(1), repository, ids, clock);
    expect(
      createRuntimeServices({ session, repository, migrated: false, ids, clock }),
    ).toMatchObject({ ok: false, error: { code: "invalid-settings" } });
  });

  it("assembles the complete new runtime from valid settings", () => {
    const ids = new SequentialIdGenerator();
    const clock = new FixedClock(100);
    const repository = new AppDatabaseRepository(new InMemoryKeyValueStorage());
    const database = {
      ...createEmptyDatabase(1),
      settings: {
        ...DEFAULT_SETTINGS,
        ai: {
          apiType: "openai-compatible" as const,
          apiKey: "key",
          apiBaseUrl: "https://example.test",
          model: "model",
        },
      },
    };
    const session = new ApplicationSession(database, repository, ids, clock);
    expect(
      createRuntimeServices({ session, repository, migrated: false, ids, clock }),
    ).toMatchObject({
      ok: true,
      value: {
        agent: expect.any(CodingAgentService),
        conversations: expect.any(ConversationIntelligenceService),
        preview: expect.any(PreviewCoordinator),
      },
    });
  });
});
