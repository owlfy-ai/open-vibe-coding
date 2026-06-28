import localforage from "localforage";
import type { LegacyStorageSources } from "./migration-service";
import type { KeyValueStorage } from "./storage";

interface AsyncStringStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<T>;
  removeItem(key: string): Promise<void>;
}

export class BrowserStorageAdapter implements KeyValueStorage {
  constructor(private readonly storage: Storage) {}

  async get(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.storage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    this.storage.removeItem(key);
  }
}

export class LocalForageStorageAdapter implements KeyValueStorage {
  constructor(private readonly storage: AsyncStringStorage) {}

  async get(key: string): Promise<string | null> {
    return this.storage.getItem<string>(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.storage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.storage.removeItem(key);
  }
}

export class TimeoutStorageAdapter implements KeyValueStorage {
  constructor(
    private readonly inner: KeyValueStorage,
    private readonly timeoutMs = 1_500,
  ) {}

  async get(key: string): Promise<string | null> {
    return withTimeout(this.inner.get(key), this.timeoutMs, null);
  }

  async set(key: string, value: string): Promise<void> {
    await withTimeout(this.inner.set(key, value), this.timeoutMs, undefined);
  }

  async remove(key: string): Promise<void> {
    await withTimeout(this.inner.remove(key), this.timeoutMs, undefined);
  }
}

export interface BrowserPersistenceStores {
  readonly target: KeyValueStorage;
  readonly legacy: LegacyStorageSources;
}

export function createBrowserPersistenceStores(): BrowserPersistenceStores {
  const legacySnapshots = localforage.createInstance({ name: "web-vibe-coding-snapshots" });
  const legacyMemories = localforage.createInstance({ name: "web-vibe-coding-memories" });
  return {
    target: new BrowserStorageAdapter(window.localStorage),
    legacy: {
      settings: new BrowserStorageAdapter(window.localStorage),
      conversations: new TimeoutStorageAdapter(new LocalForageStorageAdapter(localforage)),
      snapshots: new TimeoutStorageAdapter(new LocalForageStorageAdapter(legacySnapshots)),
      memories: new TimeoutStorageAdapter(new LocalForageStorageAdapter(legacyMemories)),
    },
  };
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => resolve(fallback), timeoutMs);
    operation.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
