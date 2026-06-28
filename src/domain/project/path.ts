import { err, ok, type Result } from "@/shared/result";

export type ProjectPath = string & { readonly __brand: "ProjectPath" };

export type PathErrorCode =
  | "empty"
  | "absolute"
  | "traversal"
  | "invalid-character";

export interface PathError {
  readonly code: PathErrorCode;
  readonly input: string;
  readonly message: string;
}

export function parseProjectPath(input: string): Result<ProjectPath, PathError> {
  const source = input.trim().replaceAll("\\", "/");
  if (!source) return pathError("empty", input, "Project path must not be empty");
  if (source.startsWith("/") || /^[A-Za-z]:\//.test(source)) {
    return pathError("absolute", input, "Project path must be relative");
  }
  if (source.includes("\0")) {
    return pathError("invalid-character", input, "Project path contains a null byte");
  }

  const segments: string[] = [];
  for (const segment of source.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      return pathError("traversal", input, "Project path must not traverse above the root");
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return pathError("empty", input, "Project path must not resolve to the root");
  }
  return ok(segments.join("/") as ProjectPath);
}

export function parentPath(path: ProjectPath): ProjectPath | null {
  const index = path.lastIndexOf("/");
  return index < 0 ? null : (path.slice(0, index) as ProjectPath);
}

export function baseName(path: ProjectPath): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function isDescendant(path: ProjectPath, directory: ProjectPath): boolean {
  return path.startsWith(`${directory}/`);
}

function pathError(
  code: PathErrorCode,
  input: string,
  message: string,
): Result<never, PathError> {
  return err({ code, input, message });
}
