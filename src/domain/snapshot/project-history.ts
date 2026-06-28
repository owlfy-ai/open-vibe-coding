import type { ConversationId, MessageId } from "@/domain/conversation";
import type { ProjectPath, ProjectTree } from "@/domain/project";
import type { Clock } from "@/shared/clock";
import type { IdGenerator } from "@/shared/id";
import { err, ok, type Result } from "@/shared/result";
import type {
  ProjectArchive,
  ProjectDelta,
  ProjectSnapshot,
  SnapshotError,
  SnapshotId,
} from "./types";

export class ProjectHistory {
  private readonly records: ProjectSnapshot[];

  constructor(
    private readonly conversationId: ConversationId,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly checkpointInterval = 10,
    records: readonly ProjectSnapshot[] = [],
  ) {
    if (checkpointInterval < 1) throw new Error("checkpointInterval must be at least 1");
    this.records = [...records];
  }

  list(): readonly ProjectSnapshot[] {
    return [...this.records];
  }

  capture(
    messageId: MessageId,
    tree: ProjectTree,
    createdAt = this.clock.now(),
  ): Result<ProjectSnapshot | null, SnapshotError> {
    const previous = this.records.at(-1);
    let previousTree: ProjectTree = emptyTree();
    if (previous) {
      const reconstructed = this.reconstruct(previous.id);
      if (!reconstructed.ok) return reconstructed;
      previousTree = reconstructed.value;
      if (sameTree(previousTree, tree)) return ok(null);
    }

    const base = {
      id: this.ids.next("snapshot") as SnapshotId,
      conversationId: this.conversationId,
      messageId,
      projectRevision: tree.revision,
      integrityHash: hashProjectTree(tree),
      createdAt,
    };
    const shouldCheckpoint = this.records.length === 0 || this.records.length % this.checkpointInterval === 0;
    const snapshot: ProjectSnapshot = shouldCheckpoint
      ? { ...base, kind: "checkpoint", archive: archiveTree(tree) }
      : { ...base, kind: "delta", delta: createDelta(previousTree, tree) };
    this.records.push(snapshot);
    return ok(snapshot);
  }

  reconstruct(snapshotId: SnapshotId): Result<ProjectTree, SnapshotError> {
    const targetIndex = this.records.findIndex((record) => record.id === snapshotId);
    if (targetIndex < 0) {
      return err({
        code: "not-found",
        snapshotId,
        message: `Snapshot not found: ${snapshotId}`,
      });
    }
    let checkpointIndex = targetIndex;
    while (checkpointIndex >= 0 && this.records[checkpointIndex].kind !== "checkpoint") {
      checkpointIndex -= 1;
    }
    if (checkpointIndex < 0) {
      return err({
        code: "missing-checkpoint",
        snapshotId,
        message: `No checkpoint exists before ${snapshotId}`,
      });
    }

    const checkpoint = this.records[checkpointIndex];
    if (checkpoint.kind !== "checkpoint") throw new Error("unreachable checkpoint state");
    let tree = restoreArchive(checkpoint.archive, checkpoint.projectRevision);
    const checkpointValidation = validateTree(checkpoint, tree);
    if (!checkpointValidation.ok) return checkpointValidation;

    for (let index = checkpointIndex + 1; index <= targetIndex; index += 1) {
      const record = this.records[index];
      if (record.kind === "checkpoint") tree = restoreArchive(record.archive, record.projectRevision);
      else tree = applyDelta(tree, record.delta, record.projectRevision);
      const validation = validateTree(record, tree);
      if (!validation.ok) return validation;
    }
    return ok(tree);
  }
}

export function hashProjectTree(tree: ProjectTree): string {
  const canonical = JSON.stringify({
    revision: tree.revision,
    files: [...tree.files.entries()].sort(([a], [b]) => a.localeCompare(b)),
    directories: [...tree.directories].sort(),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function emptyTree(): ProjectTree {
  return { revision: 0, files: new Map(), directories: new Set() };
}

function archiveTree(tree: ProjectTree): ProjectArchive {
  return {
    files: Object.fromEntries(tree.files),
    directories: [...tree.directories],
  };
}

function restoreArchive(archive: ProjectArchive, revision: number): ProjectTree {
  return {
    revision,
    files: new Map(Object.entries(archive.files) as [ProjectPath, string][]),
    directories: new Set(archive.directories),
  };
}

function createDelta(previous: ProjectTree, current: ProjectTree): ProjectDelta {
  const upsertedFiles: Record<ProjectPath, string> = {};
  const deletedFiles: ProjectPath[] = [];
  for (const [path, content] of current.files) {
    if (previous.files.get(path) !== content) upsertedFiles[path] = content;
  }
  for (const path of previous.files.keys()) {
    if (!current.files.has(path)) deletedFiles.push(path);
  }
  return {
    upsertedFiles,
    deletedFiles,
    createdDirectories: [...current.directories].filter((path) => !previous.directories.has(path)),
    deletedDirectories: [...previous.directories].filter((path) => !current.directories.has(path)),
  };
}

function applyDelta(previous: ProjectTree, delta: ProjectDelta, revision: number): ProjectTree {
  const files = new Map(previous.files);
  const directories = new Set(previous.directories);
  for (const path of delta.deletedFiles) files.delete(path);
  for (const [path, content] of Object.entries(delta.upsertedFiles) as [ProjectPath, string][]) {
    files.set(path, content);
  }
  for (const path of delta.deletedDirectories) directories.delete(path);
  for (const path of delta.createdDirectories) directories.add(path);
  return { revision, files, directories };
}

function validateTree(
  snapshot: ProjectSnapshot,
  tree: ProjectTree,
): Result<void, SnapshotError> {
  const actual = hashProjectTree(tree);
  return actual === snapshot.integrityHash
    ? ok(undefined)
    : err({
        code: "integrity-failed",
        snapshotId: snapshot.id,
        message: `Snapshot integrity check failed: expected ${snapshot.integrityHash}, got ${actual}`,
      });
}

function sameTree(left: ProjectTree, right: ProjectTree): boolean {
  if (left.files.size !== right.files.size || left.directories.size !== right.directories.size) return false;
  for (const [path, content] of left.files) {
    if (right.files.get(path) !== content) return false;
  }
  for (const path of left.directories) {
    if (!right.directories.has(path)) return false;
  }
  return true;
}
