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

export class IndexedDbStorageAdapter implements KeyValueStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly databaseName: string,
    private readonly storeName: string,
  ) {}

  async get(key: string): Promise<string | null> {
    const database = await this.database();
    return new Promise<string | null>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readonly");
      const request = transaction.objectStore(this.storeName).get(key);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(indexedDbError(request.error, "read"));
      transaction.onabort = () => reject(indexedDbError(transaction.error, "read"));
    });
  }

  async set(key: string, value: string): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readwrite");
      transaction.objectStore(this.storeName).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(indexedDbError(transaction.error, "write"));
      transaction.onabort = () => reject(indexedDbError(transaction.error, "write"));
    });
  }

  async remove(key: string): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readwrite");
      transaction.objectStore(this.storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(indexedDbError(transaction.error, "delete"));
      transaction.onabort = () => reject(indexedDbError(transaction.error, "delete"));
    });
  }

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(indexedDbError(request.error, "open"));
      request.onblocked = () => reject(new Error("IndexedDB open was blocked by another tab"));
    });
    this.databasePromise = opening;
    void opening.catch(() => {
      if (this.databasePromise === opening) this.databasePromise = null;
    });
    return opening;
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
  const legacySnapshots = localforage.createInstance({ name: "open-vibe-coding-snapshots" });
  const legacyMemories = localforage.createInstance({ name: "open-vibe-coding-memories" });
  return {
    target: new IndexedDbStorageAdapter(
      window.indexedDB,
      "open-vibe-coding-database",
      "key_value",
    ),
    legacy: {
      currentDatabase: new BrowserStorageAdapter(window.localStorage),
      settings: new BrowserStorageAdapter(window.localStorage),
      conversations: new TimeoutStorageAdapter(new LocalForageStorageAdapter(localforage)),
      snapshots: new TimeoutStorageAdapter(new LocalForageStorageAdapter(legacySnapshots)),
      memories: new TimeoutStorageAdapter(new LocalForageStorageAdapter(legacyMemories)),
    },
  };
}

function indexedDbError(error: DOMException | null, operation: string): Error {
  return error ?? new Error(`IndexedDB ${operation} failed`);
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
