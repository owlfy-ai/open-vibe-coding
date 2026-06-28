import { describe, expect, it } from "vitest";
import { baseName, parentPath, parseProjectPath } from "./path";

describe("project paths", () => {
  it("normalizes separators and dot segments", () => {
    const result = parseProjectPath("src\\components/./Button.tsx");
    expect(result).toEqual({ ok: true, value: "src/components/Button.tsx" });
  });

  it.each(["", "/src/App.tsx", "../secret", "src/../../secret", "C:/secret"])(
    "rejects unsafe path %s",
    (path) => {
      expect(parseProjectPath(path).ok).toBe(false);
    },
  );

  it("derives parent and basename", () => {
    const parsed = parseProjectPath("src/components/Button.tsx");
    if (!parsed.ok) throw new Error("expected valid path");
    expect(parentPath(parsed.value)).toBe("src/components");
    expect(baseName(parsed.value)).toBe("Button.tsx");
  });
});
