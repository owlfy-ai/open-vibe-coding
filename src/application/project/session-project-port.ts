import type { ConversationId } from "@/domain/conversation";
import type {
  FileChangeSet,
  FileOperation,
  ProjectTree,
  WorkspaceError,
} from "@/domain/project";
import { err, type Result } from "@/shared/result";
import type { ApplicationSession } from "@/application/session";
import type { ProjectToolPort } from "./project-tools";

export class SessionProjectToolPort implements ProjectToolPort {
  constructor(
    private readonly session: ApplicationSession,
    private readonly conversationId: ConversationId,
  ) {}

  async snapshot(): Promise<ProjectTree> {
    const result = await this.session.projectSnapshot(this.conversationId);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  async readFiles(
    paths: readonly string[],
  ): Promise<
    Result<{ revision: number; files: Readonly<Record<string, string>> }, WorkspaceError>
  > {
    const result = await this.session.readProjectFiles(this.conversationId, paths);
    return result.ok
      ? result
      : err(
          result.error.workspace ??
            toWorkspaceError(result.error.message, paths[0] ?? "project"),
        );
  }

  async apply(
    operations: readonly FileOperation[],
  ): Promise<Result<FileChangeSet, WorkspaceError>> {
    const result = await this.session.applyProjectOperations(this.conversationId, operations);
    return result.ok
      ? result
      : err(
          result.error.workspace ??
            toWorkspaceError(result.error.message, operations[0]?.type ?? "project"),
        );
  }
}

function toWorkspaceError(message: string, path: string): WorkspaceError {
  return {
    code: "not-found",
    operationIndex: 0,
    path,
    message,
  };
}
