import type { JsonValue } from "@/domain/conversation";
import {
  ProjectWorkspace,
  type FileChangeSet,
  type FileOperation,
  type ProjectTree,
  type WorkspaceError,
} from "@/domain/project";
import type { Result } from "@/shared/result";
import type { AgentTool, ToolExecutionResult } from "../ports/agent-tool";

type JsonObject = { readonly [key: string]: JsonValue };

export interface ProjectToolPort {
  snapshot(): Promise<ProjectTree>;
  readFiles(
    paths: readonly string[],
  ): Promise<Result<{ revision: number; files: Readonly<Record<string, string>> }, WorkspaceError>>;
  apply(operations: readonly FileOperation[]): Promise<Result<FileChangeSet, WorkspaceError>>;
}

export class WorkspaceProjectToolPort implements ProjectToolPort {
  constructor(private readonly workspace: ProjectWorkspace) {}

  async snapshot(): Promise<ProjectTree> {
    return this.workspace.snapshot();
  }

  async readFiles(
    paths: readonly string[],
  ): Promise<Result<{ revision: number; files: Readonly<Record<string, string>> }, WorkspaceError>> {
    const files: Record<string, string> = {};
    for (const path of paths) {
      const result = this.workspace.read(path);
      if (!result.ok) return result;
      files[path] = result.value;
    }
    return { ok: true, value: { revision: this.workspace.revision, files } };
  }

  async apply(operations: readonly FileOperation[]): Promise<Result<FileChangeSet, WorkspaceError>> {
    return this.workspace.apply(operations);
  }
}

export function createProjectTools(
  source: ProjectWorkspace | ProjectToolPort,
): readonly AgentTool[] {
  const workspace =
    source instanceof ProjectWorkspace ? new WorkspaceProjectToolPort(source) : source;
  return [
    listFilesTool(workspace),
    readFilesTool(workspace),
    writeFileTool(workspace),
    patchFileTool(workspace),
    searchFilesTool(workspace),
    manageDependenciesTool(workspace),
    deletePathTool(workspace),
  ];
}

function searchFilesTool(workspace: ProjectToolPort): AgentTool {
  return {
    definition: {
      name: "search_in_files",
      description: "Search a regular expression across all project files.",
      inputSchema: {
        type: "object",
        properties: { pattern: { type: "string" } },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const pattern = stringField(input, "pattern");
      if (!pattern.ok) return pattern;
      let expression: RegExp;
      try {
        expression = new RegExp(pattern.value, "g");
      } catch {
        return invalidInput("pattern must be a valid regular expression");
      }
      const tree = await workspace.snapshot();
      const matches: { path: string; line: number; text: string }[] = [];
      for (const [path, content] of tree.files) {
        const lines = content.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          expression.lastIndex = 0;
          if (expression.test(lines[index])) {
            matches.push({ path, line: index + 1, text: lines[index].trim() });
          }
        }
      }
      return success({ revision: tree.revision, matches });
    },
  };
}

function manageDependenciesTool(workspace: ProjectToolPort): AgentTool {
  return {
    definition: {
      name: "manage_dependencies",
      description: "Replace package.json with a complete valid JSON document.",
      inputSchema: {
        type: "object",
        properties: { package_json: { type: "string" } },
        required: ["package_json"],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const packageJson = stringField(input, "package_json");
      if (!packageJson.ok) return packageJson;
      try {
        JSON.parse(packageJson.value);
      } catch {
        return invalidInput("package_json must contain valid JSON");
      }
      const result = await workspace.apply([
        { type: "write-file", path: "package.json", content: packageJson.value },
      ]);
      return result.ok
        ? success({ revision: result.value.revision, changes: result.value.changes })
        : workspaceFailure(result.error);
    },
  };
}

function listFilesTool(workspace: ProjectToolPort): AgentTool {
  return {
    definition: {
      name: "list_files",
      description: "List every file and explicit directory in the project.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute() {
      const tree = await workspace.snapshot();
      return success({
        revision: tree.revision,
        files: [...tree.files.keys()].sort(),
        directories: [...tree.directories].sort(),
      });
    },
  };
}

function readFilesTool(workspace: ProjectToolPort): AgentTool {
  return {
    definition: {
      name: "read_files",
      description: "Read one or more project files.",
      inputSchema: {
        type: "object",
        properties: { paths: { type: "array", items: { type: "string" }, minItems: 1 } },
        required: ["paths"],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const paths = stringArrayField(input, "paths");
      if (!paths.ok) return paths;
      const result = await workspace.readFiles(paths.value);
      return result.ok ? success(result.value) : workspaceFailure(result.error);
    },
  };
}

function writeFileTool(workspace: ProjectToolPort): AgentTool {
  return {
    definition: {
      name: "write_file",
      description: "Create or replace one project file. Empty content is valid.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const path = stringField(input, "path");
      if (!path.ok) return path;
      const content = stringField(input, "content");
      if (!content.ok) return content;
      const result = await workspace.apply([
        { type: "write-file", path: path.value, content: content.value },
      ]);
      return result.ok
        ? success({ revision: result.value.revision, changes: result.value.changes })
        : workspaceFailure(result.error);
    },
  };
}

function patchFileTool(workspace: ProjectToolPort): AgentTool {
  return {
    definition: {
      name: "patch_file",
      description: "Atomically apply ordered exact text replacements to a project file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          patches: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: { search: { type: "string" }, replace: { type: "string" } },
              required: ["search", "replace"],
              additionalProperties: false,
            },
          },
        },
        required: ["path", "patches"],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const path = stringField(input, "path");
      if (!path.ok) return path;
      const object = asObject(input);
      const rawPatches = object?.patches;
      if (!Array.isArray(rawPatches) || rawPatches.length === 0) {
        return invalidInput("patches must be a non-empty array");
      }
      const patches: { search: string; replace: string }[] = [];
      for (const rawPatch of rawPatches) {
        const search = stringField(rawPatch, "search");
        const replace = stringField(rawPatch, "replace");
        if (!search.ok) return search;
        if (!replace.ok) return replace;
        patches.push({ search: search.value, replace: replace.value });
      }
      const result = await workspace.apply([
        { type: "patch-file", path: path.value, patches },
      ]);
      return result.ok
        ? success({ revision: result.value.revision, changes: result.value.changes })
        : workspaceFailure(result.error);
    },
  };
}

function deletePathTool(workspace: ProjectToolPort): AgentTool {
  return {
    definition: {
      name: "delete_file",
      description: "Delete a project file or directory tree.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const path = stringField(input, "path");
      if (!path.ok) return path;
      const result = await workspace.apply([{ type: "delete", path: path.value }]);
      return result.ok
        ? success({ revision: result.value.revision, changes: result.value.changes })
        : workspaceFailure(result.error);
    },
  };
}

function asObject(input: JsonValue): JsonObject | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as JsonObject)
    : null;
}

function stringField(
  input: JsonValue,
  key: string,
): ToolExecutionResult & ({ ok: true; value: string } | { ok: false }) {
  const value = asObject(input)?.[key];
  return typeof value === "string"
    ? success(value)
    : invalidInput(`${key} must be a string`);
}

function stringArrayField(
  input: JsonValue,
  key: string,
): ToolExecutionResult & ({ ok: true; value: readonly string[] } | { ok: false }) {
  const value = asObject(input)?.[key];
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
    ? success(value as readonly string[])
    : invalidInput(`${key} must be a non-empty string array`);
}

function success<T extends JsonValue>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

function invalidInput(message: string): { readonly ok: false; readonly error: { code: string; message: string } } {
  return { ok: false, error: { code: "invalid-input", message } };
}

function workspaceFailure(error: WorkspaceError): ToolExecutionResult {
  return {
    ok: false,
    error: {
      code: `workspace.${error.code}`,
      message: error.message,
    },
  };
}
