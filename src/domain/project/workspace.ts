import { err, ok, type Result } from "@/shared/result";
import {
  isDescendant,
  parentPath,
  parseProjectPath,
  type ProjectPath,
} from "./path";
import type {
  FileChange,
  FileChangeSet,
  FileOperation,
  ProjectTree,
  WorkspaceError,
} from "./types";

export type WorkspaceListener = (changeSet: FileChangeSet) => void;

export class ProjectWorkspace {
  private files: Map<ProjectPath, string>;
  private directories: Set<ProjectPath>;
  private currentRevision: number;
  private readonly listeners = new Set<WorkspaceListener>();

  constructor(tree?: Partial<ProjectTree>) {
    this.files = new Map(tree?.files ?? []);
    this.directories = new Set(tree?.directories ?? []);
    this.currentRevision = tree?.revision ?? 0;
    this.addParentDirectories(this.files.keys(), this.directories);
  }

  get revision(): number {
    return this.currentRevision;
  }

  snapshot(): ProjectTree {
    return {
      revision: this.currentRevision,
      files: new Map(this.files),
      directories: new Set(this.directories),
    };
  }

  read(path: string): Result<string, WorkspaceError> {
    const parsed = parseProjectPath(path);
    if (!parsed.ok) return err(this.invalidPath(0, path, parsed.error.message));
    const content = this.files.get(parsed.value);
    return content === undefined
      ? err(this.failure("not-found", 0, path, `File not found: ${path}`))
      : ok(content);
  }

  subscribe(listener: WorkspaceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replace(tree: Omit<ProjectTree, "revision">): FileChangeSet {
    const files = new Map(tree.files);
    const directories = new Set(tree.directories);
    this.addParentDirectories(files.keys(), directories);
    const changes: FileChange[] = [];
    for (const path of this.files.keys()) {
      if (!files.has(path)) changes.push({ type: "deleted", path, kind: "file" });
    }
    for (const path of this.directories) {
      if (!directories.has(path)) changes.push({ type: "deleted", path, kind: "directory" });
    }
    for (const [path, content] of files) {
      const previous = this.files.get(path);
      if (previous === undefined) changes.push({ type: "created", path, kind: "file" });
      else if (previous !== content) changes.push({ type: "updated", path, kind: "file" });
    }
    for (const path of directories) {
      if (!this.directories.has(path)) changes.push({ type: "created", path, kind: "directory" });
    }
    if (changes.length === 0) {
      return {
        previousRevision: this.currentRevision,
        revision: this.currentRevision,
        changes: [],
      };
    }
    const changeSet: FileChangeSet = {
      previousRevision: this.currentRevision,
      revision: this.currentRevision + 1,
      changes,
    };
    this.files = files;
    this.directories = directories;
    this.currentRevision = changeSet.revision;
    for (const listener of this.listeners) listener(changeSet);
    return changeSet;
  }

  apply(operations: readonly FileOperation[]): Result<FileChangeSet, WorkspaceError> {
    const files = new Map(this.files);
    const directories = new Set(this.directories);
    const changes: FileChange[] = [];

    for (let index = 0; index < operations.length; index += 1) {
      const result = this.applyOne(operations[index], index, files, directories, changes);
      if (!result.ok) return result;
    }

    if (changes.length === 0) {
      return ok({
        previousRevision: this.currentRevision,
        revision: this.currentRevision,
        changes: [],
      });
    }

    const changeSet: FileChangeSet = {
      previousRevision: this.currentRevision,
      revision: this.currentRevision + 1,
      changes,
    };
    this.files = files;
    this.directories = directories;
    this.currentRevision = changeSet.revision;
    for (const listener of this.listeners) listener(changeSet);
    return ok(changeSet);
  }

  private applyOne(
    operation: FileOperation,
    index: number,
    files: Map<ProjectPath, string>,
    directories: Set<ProjectPath>,
    changes: FileChange[],
  ): Result<void, WorkspaceError> {
    switch (operation.type) {
      case "write-file":
        return this.writeFile(operation.path, operation.content, index, files, directories, changes);
      case "patch-file":
        return this.patchFile(operation.path, operation.patches, index, files, changes);
      case "create-directory":
        return this.createDirectory(operation.path, index, files, directories, changes);
      case "delete":
        return this.deletePath(operation.path, index, files, directories, changes);
      case "move":
        return this.movePath(operation.source, operation.destination, index, files, directories, changes);
    }
  }

  private writeFile(
    rawPath: string,
    content: string,
    index: number,
    files: Map<ProjectPath, string>,
    directories: Set<ProjectPath>,
    changes: FileChange[],
  ): Result<void, WorkspaceError> {
    const parsed = this.parse(rawPath, index);
    if (!parsed.ok) return parsed;
    const path = parsed.value;
    if (directories.has(path)) {
      return err(this.failure("already-exists", index, rawPath, `A directory already exists at ${rawPath}`));
    }
    const previous = files.get(path);
    if (previous === content) return ok(undefined);
    files.set(path, content);
    this.addParentDirectories([path], directories);
    changes.push({ type: previous === undefined ? "created" : "updated", path, kind: "file" });
    return ok(undefined);
  }

  private patchFile(
    rawPath: string,
    patches: readonly { search: string; replace: string }[],
    index: number,
    files: Map<ProjectPath, string>,
    changes: FileChange[],
  ): Result<void, WorkspaceError> {
    const parsed = this.parse(rawPath, index);
    if (!parsed.ok) return parsed;
    const path = parsed.value;
    const original = files.get(path);
    if (original === undefined) {
      return err(this.failure("not-found", index, rawPath, `File not found: ${rawPath}`));
    }
    if (patches.length === 0) {
      return err(this.failure("empty-patches", index, rawPath, "At least one patch is required"));
    }

    let content = original;
    for (let patchIndex = 0; patchIndex < patches.length; patchIndex += 1) {
      const patch = patches[patchIndex];
      const position = content.indexOf(patch.search);
      if (position < 0) {
        return err(
          this.failure(
            "patch-not-found",
            index,
            rawPath,
            `Patch ${patchIndex + 1} did not match ${rawPath}`,
          ),
        );
      }
      content = `${content.slice(0, position)}${patch.replace}${content.slice(position + patch.search.length)}`;
    }
    if (content === original) return ok(undefined);
    files.set(path, content);
    changes.push({ type: "updated", path, kind: "file" });
    return ok(undefined);
  }

  private createDirectory(
    rawPath: string,
    index: number,
    files: Map<ProjectPath, string>,
    directories: Set<ProjectPath>,
    changes: FileChange[],
  ): Result<void, WorkspaceError> {
    const parsed = this.parse(rawPath, index);
    if (!parsed.ok) return parsed;
    const path = parsed.value;
    if (files.has(path)) {
      return err(this.failure("already-exists", index, rawPath, `A file already exists at ${rawPath}`));
    }
    if (directories.has(path)) return ok(undefined);
    directories.add(path);
    this.addParentDirectories([path], directories);
    changes.push({ type: "created", path, kind: "directory" });
    return ok(undefined);
  }

  private deletePath(
    rawPath: string,
    index: number,
    files: Map<ProjectPath, string>,
    directories: Set<ProjectPath>,
    changes: FileChange[],
  ): Result<void, WorkspaceError> {
    const parsed = this.parse(rawPath, index);
    if (!parsed.ok) return parsed;
    const path = parsed.value;
    if (files.delete(path)) {
      changes.push({ type: "deleted", path, kind: "file" });
      return ok(undefined);
    }
    if (!directories.has(path)) {
      return err(this.failure("not-found", index, rawPath, `Path not found: ${rawPath}`));
    }
    for (const filePath of [...files.keys()]) {
      if (isDescendant(filePath, path)) {
        files.delete(filePath);
        changes.push({ type: "deleted", path: filePath, kind: "file" });
      }
    }
    for (const directoryPath of [...directories].sort((a, b) => b.length - a.length)) {
      if (directoryPath === path || isDescendant(directoryPath, path)) {
        directories.delete(directoryPath);
        changes.push({ type: "deleted", path: directoryPath, kind: "directory" });
      }
    }
    return ok(undefined);
  }

  private movePath(
    rawSource: string,
    rawDestination: string,
    index: number,
    files: Map<ProjectPath, string>,
    directories: Set<ProjectPath>,
    changes: FileChange[],
  ): Result<void, WorkspaceError> {
    const sourceResult = this.parse(rawSource, index);
    if (!sourceResult.ok) return sourceResult;
    const destinationResult = this.parse(rawDestination, index);
    if (!destinationResult.ok) return destinationResult;
    const source = sourceResult.value;
    const destination = destinationResult.value;
    if (source === destination) return ok(undefined);
    if (files.has(destination) || directories.has(destination)) {
      return err(this.failure("already-exists", index, rawDestination, `Destination already exists: ${rawDestination}`));
    }

    const fileContent = files.get(source);
    if (fileContent !== undefined) {
      files.delete(source);
      files.set(destination, fileContent);
      this.addParentDirectories([destination], directories);
      changes.push({ type: "moved", path: source, destination, kind: "file" });
      return ok(undefined);
    }
    if (!directories.has(source)) {
      return err(this.failure("not-found", index, rawSource, `Source not found: ${rawSource}`));
    }
    if (isDescendant(destination, source)) {
      return err(this.failure("recursive-move", index, rawSource, "A directory cannot be moved into itself"));
    }

    const movedFiles = [...files.entries()].filter(([path]) => isDescendant(path, source));
    const movedDirectories = [...directories].filter(
      (path) => path === source || isDescendant(path, source),
    );
    for (const [path] of movedFiles) files.delete(path);
    for (const path of movedDirectories) directories.delete(path);
    for (const directoryPath of movedDirectories) {
      directories.add(this.rebase(directoryPath, source, destination));
    }
    for (const [filePath, content] of movedFiles) {
      files.set(this.rebase(filePath, source, destination), content);
    }
    this.addParentDirectories([destination], directories);
    changes.push({ type: "moved", path: source, destination, kind: "directory" });
    return ok(undefined);
  }

  private rebase(path: ProjectPath, source: ProjectPath, destination: ProjectPath): ProjectPath {
    return `${destination}${path.slice(source.length)}` as ProjectPath;
  }

  private parse(path: string, index: number): Result<ProjectPath, WorkspaceError> {
    const parsed = parseProjectPath(path);
    return parsed.ok ? parsed : err(this.invalidPath(index, path, parsed.error.message));
  }

  private addParentDirectories(paths: Iterable<ProjectPath>, directories: Set<ProjectPath>): void {
    for (const path of paths) {
      let parent = parentPath(path);
      while (parent) {
        directories.add(parent);
        parent = parentPath(parent);
      }
    }
  }

  private invalidPath(index: number, path: string, message: string): WorkspaceError {
    return this.failure("invalid-path", index, path, message);
  }

  private failure(
    code: WorkspaceError["code"],
    operationIndex: number,
    path: string,
    message: string,
  ): WorkspaceError {
    return { code, operationIndex, path, message };
  }
}
