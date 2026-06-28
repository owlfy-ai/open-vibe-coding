import type { ProjectPath } from "./path";

export interface ProjectFile {
  readonly path: ProjectPath;
  readonly content: string;
}

export interface ProjectTree {
  readonly revision: number;
  readonly files: ReadonlyMap<ProjectPath, string>;
  readonly directories: ReadonlySet<ProjectPath>;
}

export interface TextPatch {
  readonly search: string;
  readonly replace: string;
}

export type FileOperation =
  | { readonly type: "write-file"; readonly path: string; readonly content: string }
  | { readonly type: "patch-file"; readonly path: string; readonly patches: readonly TextPatch[] }
  | { readonly type: "delete"; readonly path: string }
  | { readonly type: "move"; readonly source: string; readonly destination: string }
  | { readonly type: "create-directory"; readonly path: string };

export type FileChange =
  | { readonly type: "created"; readonly path: ProjectPath; readonly kind: "file" | "directory" }
  | { readonly type: "updated"; readonly path: ProjectPath; readonly kind: "file" }
  | { readonly type: "deleted"; readonly path: ProjectPath; readonly kind: "file" | "directory" }
  | {
      readonly type: "moved";
      readonly path: ProjectPath;
      readonly destination: ProjectPath;
      readonly kind: "file" | "directory";
    };

export interface FileChangeSet {
  readonly previousRevision: number;
  readonly revision: number;
  readonly changes: readonly FileChange[];
}

export type WorkspaceErrorCode =
  | "invalid-path"
  | "not-found"
  | "already-exists"
  | "not-a-file"
  | "empty-patches"
  | "patch-not-found"
  | "recursive-move";

export interface WorkspaceError {
  readonly code: WorkspaceErrorCode;
  readonly operationIndex: number;
  readonly path: string;
  readonly message: string;
}
