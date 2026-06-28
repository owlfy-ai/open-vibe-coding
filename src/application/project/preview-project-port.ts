import type {
  FileChangeSet,
  FileOperation,
  ProjectTree,
  WorkspaceError,
} from "@/domain/project";
import type { Result } from "@/shared/result";
import type { PreviewCoordinator } from "@/application/preview";
import type { ConversationId } from "@/domain/conversation";
import type { ProjectToolPort } from "./project-tools";

export class PreviewProjectToolPort implements ProjectToolPort {
  constructor(
    private readonly source: ProjectToolPort,
    private readonly preview: PreviewCoordinator,
    private readonly conversationId?: ConversationId,
  ) {}

  snapshot(): Promise<ProjectTree> {
    return this.source.snapshot();
  }

  readFiles(
    paths: readonly string[],
  ): Promise<Result<{ revision: number; files: Readonly<Record<string, string>> }, WorkspaceError>> {
    return this.source.readFiles(paths);
  }

  async apply(
    operations: readonly FileOperation[],
  ): Promise<Result<FileChangeSet, WorkspaceError>> {
    const result = await this.source.apply(operations);
    if (result.ok && result.value.changes.length > 0) {
      const dependenciesChanged = operations.some(
        (operation) =>
          "path" in operation &&
          (operation.path === "package.json" || operation.path.endsWith("/package.json")),
      );
      this.preview.request({
        conversationId: this.conversationId,
        revision: result.value.revision,
        reason: dependenciesChanged ? "dependencies-changed" : "files-changed",
        restart: dependenciesChanged,
      });
    }
    return result;
  }
}
