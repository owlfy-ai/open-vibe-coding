import type { ConversationId, MessageId } from "@/domain/conversation";
import type { ProjectPath } from "@/domain/project";
import type { EntityId } from "@/shared/id";

export type SnapshotId = EntityId<"snapshot">;

export interface ProjectArchive {
  readonly files: Readonly<Record<ProjectPath, string>>;
  readonly directories: readonly ProjectPath[];
}

export interface ProjectDelta {
  readonly upsertedFiles: Readonly<Record<ProjectPath, string>>;
  readonly deletedFiles: readonly ProjectPath[];
  readonly createdDirectories: readonly ProjectPath[];
  readonly deletedDirectories: readonly ProjectPath[];
}

interface SnapshotBase {
  readonly id: SnapshotId;
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  readonly projectRevision: number;
  readonly integrityHash: string;
  readonly createdAt: number;
}

export type ProjectSnapshot =
  | (SnapshotBase & { readonly kind: "checkpoint"; readonly archive: ProjectArchive })
  | (SnapshotBase & { readonly kind: "delta"; readonly delta: ProjectDelta });

export interface SnapshotError {
  readonly code: "not-found" | "missing-checkpoint" | "integrity-failed";
  readonly snapshotId: string;
  readonly message: string;
}
