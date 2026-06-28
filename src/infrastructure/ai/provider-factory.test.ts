import { describe, expect, it } from "vitest";
import { resolveProviderBaseUrl } from "./provider-factory";

describe("provider URL resolution", () => {
  it.each([
    ["https://api.openai.com", "openai", "https://api.openai.com/v1"],
    ["https://api.anthropic.com/v1", "anthropic", "https://api.anthropic.com/v1"],
    ["https://example.test/v3", "openai-compatible", "https://example.test/v3"],
    ["https://generativelanguage.googleapis.com/", "google", "https://generativelanguage.googleapis.com/v1beta"],
  ] as const)("resolves %s for %s", (input, type, expected) => {
    expect(resolveProviderBaseUrl(input, type)).toBe(expected);
  });
});
