import { err, ok, type Result } from "@/shared/result";
import { parseProjectPath, type ProjectPath } from "./path";
import type { ProjectTree, WorkspaceError } from "./types";

/** Convert the legacy Record<path, content> format without preserving fake directory files. */
export function importLegacyProjectFiles(
  input: Readonly<Record<string, string>>,
): Result<ProjectTree, WorkspaceError> {
  const files = new Map<ProjectPath, string>();
  const directories = new Set<ProjectPath>();

  for (const [rawPath, content] of Object.entries(input)) {
    const isDirectory = rawPath.endsWith("/");
    const parsed = parseProjectPath(rawPath);
    if (!parsed.ok) {
      return err({
        code: "invalid-path",
        operationIndex: -1,
        path: rawPath,
        message: parsed.error.message,
      });
    }
    if (isDirectory) directories.add(parsed.value);
    else files.set(parsed.value, content);
  }
  return ok({ revision: 0, files, directories });
}

export function exportLegacyProjectFiles(tree: ProjectTree): Record<string, string> {
  return Object.fromEntries(tree.files);
}
