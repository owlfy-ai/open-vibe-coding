import { describe, expect, it, vi } from "vitest";
import { exportLegacyProjectFiles, importLegacyProjectFiles } from "./legacy";
import { ProjectWorkspace } from "./workspace";

describe("ProjectWorkspace", () => {
  it("treats an empty file as valid content", () => {
    const workspace = new ProjectWorkspace();
    expect(workspace.apply([{ type: "write-file", path: "src/empty.ts", content: "" }]).ok).toBe(true);
    expect(workspace.read("src/empty.ts")).toEqual({ ok: true, value: "" });
  });

  it("does not advance the revision for an identical write", () => {
    const workspace = new ProjectWorkspace();
    workspace.apply([{ type: "write-file", path: "src/App.tsx", content: "hello" }]);
    const listener = vi.fn();
    workspace.subscribe(listener);
    const result = workspace.apply([{ type: "write-file", path: "src/App.tsx", content: "hello" }]);
    expect(result).toEqual({
      ok: true,
      value: { previousRevision: 1, revision: 1, changes: [] },
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("rolls back the complete operation batch when a patch fails", () => {
    const workspace = new ProjectWorkspace();
    workspace.apply([{ type: "write-file", path: "src/App.tsx", content: "old" }]);
    const listener = vi.fn();
    workspace.subscribe(listener);

    const result = workspace.apply([
      { type: "write-file", path: "src/created.ts", content: "temporary" },
      {
        type: "patch-file",
        path: "src/App.tsx",
        patches: [{ search: "missing", replace: "new" }],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(workspace.revision).toBe(1);
    expect(workspace.read("src/created.ts").ok).toBe(false);
    expect(workspace.read("src/App.tsx")).toEqual({ ok: true, value: "old" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps empty directories as directories instead of fake files", () => {
    const imported = importLegacyProjectFiles({
      "src/components/": "",
      "src/App.tsx": "export default null",
    });
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.value.directories.has("src/components" as never)).toBe(true);
    expect(imported.value.files.has("src/components" as never)).toBe(false);
    expect(exportLegacyProjectFiles(imported.value)).toEqual({
      "src/App.tsx": "export default null",
    });
  });

  it("moves a directory and all descendants atomically", () => {
    const workspace = new ProjectWorkspace();
    workspace.apply([
      { type: "write-file", path: "src/components/Button.tsx", content: "button" },
      { type: "write-file", path: "src/components/forms/Input.tsx", content: "input" },
    ]);
    const result = workspace.apply([
      { type: "move", source: "src/components", destination: "src/ui" },
    ]);
    expect(result.ok).toBe(true);
    expect(workspace.read("src/ui/Button.tsx")).toEqual({ ok: true, value: "button" });
    expect(workspace.read("src/ui/forms/Input.tsx")).toEqual({ ok: true, value: "input" });
    expect(workspace.read("src/components/Button.tsx").ok).toBe(false);
  });

  it("rejects moving a directory into itself", () => {
    const workspace = new ProjectWorkspace();
    workspace.apply([{ type: "create-directory", path: "src/components" }]);
    const result = workspace.apply([
      { type: "move", source: "src/components", destination: "src/components/nested" },
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: "recursive-move" } });
  });
});
