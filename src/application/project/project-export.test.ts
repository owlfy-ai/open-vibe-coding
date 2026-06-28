import { describe, expect, it } from "vitest";
import { projectArchiveFilename } from "./project-export";

describe("projectArchiveFilename", () => {
  it("uses a safe default", () => {
    expect(projectArchiveFilename(null)).toBe("project.zip");
    expect(projectArchiveFilename("   ")).toBe("project.zip");
  });

  it("removes characters that are invalid in common filesystems", () => {
    expect(projectArchiveFilename('CRM: "Q4" / demo')).toBe("CRM- -Q4- - demo.zip");
  });

  it("limits very long titles", () => {
    expect(projectArchiveFilename("x".repeat(120))).toBe(`${"x".repeat(80)}.zip`);
  });
});
