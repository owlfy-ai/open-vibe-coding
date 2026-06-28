import { describe, expect, it } from "vitest";
import { findPackageJsonError } from "./findPackageJsonError";

describe("findPackageJsonError", () => {
  it("returns null when package.json is absent", () => {
    expect(findPackageJsonError({ "src/App.tsx": "export default () => null;" })).toBeNull();
  });

  it("returns null for valid JSON", () => {
    expect(
      findPackageJsonError({
        "package.json": JSON.stringify(
          { name: "demo", dependencies: { react: "19" } },
          null,
          2,
        ),
      }),
    ).toBeNull();
  });

  it("accepts the leading-slash variant too", () => {
    expect(findPackageJsonError({ "/package.json": '{"name":"demo"}' })).toBeNull();
  });

  it("prefers the non-slashed key when both are present", () => {
    expect(
      findPackageJsonError({
        "package.json": '{"name":"demo"}',
        "/package.json": "{ not valid",
      }),
    ).toBeNull();
  });

  it("returns a message that names the file and surfaces the engine detail for malformed JSON", () => {
    const message = findPackageJsonError({
      // Mirrors the user's scenario: a stray token breaks the structure.
      "package.json": [
        "{",
        '  "name": "demo",',
        '  "dependencies": { "react": "19" },,',
        "}",
      ].join("\n"),
    });
    expect(message).not.toBeNull();
    expect(message).toContain("package.json");
    // V8's message carries position/line/column info — keep it for the user.
    expect(message?.toLowerCase()).toMatch(/position|line|json|token|property/);
  });

  it("only checks syntax (matches Sandpack), so a valid JSON primitive is accepted", () => {
    expect(findPackageJsonError({ "package.json": "123" })).toBeNull();
  });
});
