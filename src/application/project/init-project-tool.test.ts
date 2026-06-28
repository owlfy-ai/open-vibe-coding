import { describe, expect, it } from "vitest";
import type { ConversationId } from "@/domain/conversation";
import { importLegacyProjectFiles } from "@/domain/project";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import { err, ok } from "@/shared/result";
import type { TemplateCatalog } from "@/application/ports/template-catalog";
import { PreviewCoordinator } from "@/application/preview";
import { ApplicationSession } from "@/application/session";
import {
  AppDatabaseRepository,
  InMemoryKeyValueStorage,
  createEmptyDatabase,
} from "@/infrastructure/persistence";
import { createInitProjectTool } from "./init-project-tool";

function catalog(): TemplateCatalog {
  return {
    list: () => ["vite-react-ts"],
    load: (name) => {
      if (name !== "vite-react-ts") {
        return err({ code: "unknown-template", message: `Unknown: ${name}` });
      }
      const tree = importLegacyProjectFiles({
        "package.json": '{"scripts":{"dev":"vite"}}',
        "src/App.tsx": "export default function App() {}",
      });
      if (!tree.ok) return err({ code: "invalid-template", message: tree.error.message });
      return ok({
        name,
        tree: { files: tree.value.files, directories: tree.value.directories },
      });
    },
  };
}

describe("init project tool", () => {
  it("atomically replaces the project and requests a preview restart", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    const preview = new PreviewCoordinator();
    const commands: unknown[] = [];
    preview.subscribeCommands((command) => commands.push(command));
    const tool = createInitProjectTool(session, created.value, catalog(), preview);
    const result = await tool.execute(
      { template: "vite-react-ts" },
      { signal: new AbortController().signal },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { template: "vite-react-ts", revision: 1, files: 2 },
    });
    expect(session.snapshot().conversations[created.value]).toMatchObject({
      conversation: { template: "vite-react-ts", projectRevision: 1 },
      project: { initialized: true },
    });
    expect(commands).toEqual([
      { conversationId: created.value, revision: 1, reason: "template-changed", restart: true },
    ]);
  });

  it("does not mutate the project for an unknown template", async () => {
    const ids = new SequentialIdGenerator();
    const session = new ApplicationSession(
      createEmptyDatabase(1),
      new AppDatabaseRepository(new InMemoryKeyValueStorage()),
      ids,
      new FixedClock(100),
    );
    const created = await session.createConversation();
    if (!created.ok) throw new Error("create failed");
    const result = await createInitProjectTool(
      session,
      created.value as ConversationId,
      catalog(),
      new PreviewCoordinator(),
    ).execute({ template: "missing" }, { signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: false, error: { code: "unknown-template" } });
    expect(session.snapshot().conversations[created.value].project.files).toEqual({});
  });
});
