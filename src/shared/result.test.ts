import { describe, expect, it } from "vitest";
import { err, mapResult, ok } from "./result";

describe("Result", () => {
  it("maps success values without changing failures", () => {
    expect(mapResult(ok(2), (value) => value * 2)).toEqual(ok(4));
    const failure = err("broken");
    expect(mapResult(failure, () => 4)).toBe(failure);
  });
});
