import { describe, expect, it } from "vitest";
import { ProjectWorkspace } from "@/domain/project";
import { ToolRegistry } from "../ports/agent-tool";
import { createProjectTools } from "./project-tools";

describe("project agent tools", () => {
  it("use the injected workspace without a global store", async () => {
    const workspace = new ProjectWorkspace();
    const registry = new ToolRegistry(createProjectTools(workspace));
    const signal = new AbortController().signal;

    const write = await registry.execute(
      "write_file",
      { path: "src/App.tsx", content: "first" },
      { signal },
    );
    expect(write).toMatchObject({ ok: true, value: { revision: 1 } });

    const read = await registry.execute("read_files", { paths: ["src/App.tsx"] }, { signal });
    expect(read).toEqual({
      ok: true,
      value: { revision: 1, files: { "src/App.tsx": "first" } },
    });
  });

  it("returns structured patch errors without changing revision", async () => {
    const workspace = new ProjectWorkspace();
    const registry = new ToolRegistry(createProjectTools(workspace));
    const signal = new AbortController().signal;
    await registry.execute(
      "write_file",
      { path: "src/App.tsx", content: "first" },
      { signal },
    );

    const result = await registry.execute(
      "patch_file",
      {
        path: "src/App.tsx",
        patches: [{ search: "missing", replace: "second" }],
      },
      { signal },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "workspace.patch-not-found",
        message: "Patch 1 did not match src/App.tsx",
      },
    });
    expect(workspace.revision).toBe(1);
    expect(workspace.read("src/App.tsx")).toEqual({ ok: true, value: "first" });
  });

  it("accepts an empty file and reports invalid input separately", async () => {
    const workspace = new ProjectWorkspace();
    const registry = new ToolRegistry(createProjectTools(workspace));
    const signal = new AbortController().signal;
    expect(
      await registry.execute(
        "write_file",
        { path: "src/empty.ts", content: "" },
        { signal },
      ),
    ).toMatchObject({ ok: true });
    expect(workspace.read("src/empty.ts")).toEqual({ ok: true, value: "" });
    expect(await registry.execute("write_file", { path: 42 }, { signal })).toEqual({
      ok: false,
      error: { code: "invalid-input", message: "path must be a string" },
    });
  });

  it("searches files and validates dependency JSON", async () => {
    const workspace = new ProjectWorkspace();
    const registry = new ToolRegistry(createProjectTools(workspace));
    const signal = new AbortController().signal;
    await registry.execute(
      "write_file",
      { path: "src/App.tsx", content: "const answer = 42;\nexport default answer;" },
      { signal },
    );
    const search = await registry.execute(
      "search_in_files",
      { pattern: "answer" },
      { signal },
    );
    expect(search).toMatchObject({ ok: true });
    if (!search.ok || !isSearchResult(search.value)) throw new Error("invalid search result");
    expect(search.value.matches).toHaveLength(2);
    expect(search.value.matches[0]).toMatchObject({ path: "src/App.tsx", line: 1 });
    expect(
      await registry.execute("manage_dependencies", { package_json: "{bad" }, { signal }),
    ).toEqual({
      ok: false,
      error: { code: "invalid-input", message: "package_json must contain valid JSON" },
    });
  });
});

function isSearchResult(
  value: unknown,
): value is { matches: { path: string; line: number }[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "matches" in value &&
    Array.isArray((value as { matches: unknown }).matches)
  );
}
