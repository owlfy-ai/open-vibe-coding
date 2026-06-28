import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import {
  AppDatabaseRepository,
  InMemoryKeyValueStorage,
  createEmptyDatabase,
} from "@/infrastructure/persistence";
import { ApplicationSession } from "@/application/session";
import { createMemoryTool } from "./memory-tool";

describe("memory Agent tool", () => {
  it("uses the session instead of a global store and rejects secrets", async () => {
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    const tool = createMemoryTool(session);
    const context = { signal: new AbortController().signal };
    expect(
      await tool.execute(
        {
          operations: [
            { action: "add", content: "Use TypeScript", category: "preference" },
          ],
        },
        context,
      ),
    ).toEqual({ ok: true, value: { count: 1 } });
    expect(
      await tool.execute(
        {
          operations: [
            {
              action: "add",
              content: "access_token=abcdefghijklmnop",
              category: "personal_info",
            },
          ],
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "memory-error" } });
    expect(session.snapshot().memories).toHaveLength(1);
  });
});
