import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/clock";
import { SequentialIdGenerator } from "@/shared/id";
import { MemoryBook } from "./memory";

describe("MemoryBook", () => {
  it("applies a batch atomically", () => {
    const book = new MemoryBook(
      true,
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    const result = book.apply([
      { type: "add", content: "The user prefers React", category: "preference" },
      { type: "delete", id: "missing" as never },
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: "not-found", operationIndex: 1 } });
    expect(book.list()).toEqual([]);
  });

  it("rejects credentials and private keys", () => {
    const book = new MemoryBook(
      true,
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    expect(
      book.apply([
        {
          type: "add",
          content: "api_key = sk-abcdefghijklmnop",
          category: "personal_info",
        },
      ]),
    ).toMatchObject({ ok: false, error: { code: "sensitive-content" } });
    expect(book.list()).toEqual([]);
  });

  it("honors the user-controlled memory switch", () => {
    const book = new MemoryBook(
      false,
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    expect(
      book.apply([{ type: "add", content: "Use Vue", category: "preference" }]),
    ).toMatchObject({ ok: false, error: { code: "disabled" } });
    expect(book.promptSection()).toBe("");
  });

  it("builds a visible prompt section from accepted memories", () => {
    const book = new MemoryBook(
      true,
      new SequentialIdGenerator(),
      new FixedClock(100),
    );
    book.apply([{ type: "add", content: "Use TypeScript", category: "instruction" }]);
    expect(book.promptSection()).toContain("[instruction] Use TypeScript");
  });
});
