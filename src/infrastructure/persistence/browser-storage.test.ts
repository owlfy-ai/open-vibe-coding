import { describe, expect, it } from "vitest";
import { TimeoutStorageAdapter } from "./browser-storage";
import type { KeyValueStorage } from "./storage";

class NeverStorage implements KeyValueStorage {
  get(): Promise<string | null> {
    return new Promise(() => undefined);
  }
  set(): Promise<void> {
    return new Promise(() => undefined);
  }
  remove(): Promise<void> {
    return new Promise(() => undefined);
  }
}

describe("TimeoutStorageAdapter", () => {
  it("does not block reads forever when browser storage stalls", async () => {
    await expect(new TimeoutStorageAdapter(new NeverStorage(), 1).get("key")).resolves.toBeNull();
  });

  it("does not block writes forever when browser storage stalls", async () => {
    await expect(new TimeoutStorageAdapter(new NeverStorage(), 1).set("key", "value")).resolves.toBeUndefined();
    await expect(new TimeoutStorageAdapter(new NeverStorage(), 1).remove("key")).resolves.toBeUndefined();
  });
});
