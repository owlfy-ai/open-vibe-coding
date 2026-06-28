import type { Conversation, ConversationId, ConversationMessage } from "@/domain/conversation";
import type { ProjectPath } from "@/domain/project";
import type { ProjectSnapshot } from "@/domain/snapshot";
import type { MemoryItem } from "@/domain/memory";
import { DEFAULT_SETTINGS, type AppSettings } from "@/domain/settings";

export const CURRENT_DATABASE_VERSION = 1 as const;
export const DATABASE_STORAGE_KEY = "web-vibe-coding-database-v1";

export interface PersistedProject {
  readonly revision: number;
  readonly files: Readonly<Record<ProjectPath, string>>;
  readonly directories: readonly ProjectPath[];
  readonly initialized: boolean;
}

export interface PersistedConversation {
  readonly conversation: Conversation;
  readonly project: PersistedProject;
  readonly compressedContext?: {
    readonly summary: string;
    readonly fromIndex: number;
  };
}

export type PersistedMemory = MemoryItem;
export type PersistedSettings = AppSettings;

export interface AppDatabaseV1 {
  readonly schemaVersion: typeof CURRENT_DATABASE_VERSION;
  readonly migratedAt: number;
  readonly activeConversationId: ConversationId | null;
  readonly settings: PersistedSettings;
  readonly conversations: Readonly<Record<ConversationId, PersistedConversation>>;
  readonly snapshots: Readonly<Record<ConversationId, readonly ProjectSnapshot[]>>;
  readonly memories: readonly PersistedMemory[];
}

export type AppDatabase = AppDatabaseV1;

export function createEmptyDatabase(migratedAt: number): AppDatabase {
  return {
    schemaVersion: CURRENT_DATABASE_VERSION,
    migratedAt,
    activeConversationId: null,
    settings: DEFAULT_SETTINGS,
    conversations: {},
    snapshots: {},
    memories: [],
  };
}

// Compile-time assertions that persisted conversations retain the domain message shape.
type _PersistedMessage = ConversationMessage;
export type PersistedMessage = _PersistedMessage;
