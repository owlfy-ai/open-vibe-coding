import {
  appendMessages,
  type Conversation,
  type ConversationId,
  type ConversationMessage,
} from "@/domain/conversation";
import { MemoryBook, type MemoryOperation } from "@/domain/memory";
import {
  ProjectWorkspace,
  type FileChangeSet,
  type FileOperation,
  type ProjectPath,
  type WorkspaceError,
} from "@/domain/project";
import { normalizeSettings, type AppSettings } from "@/domain/settings";
import type { Clock } from "@/shared/clock";
import type { IdGenerator } from "@/shared/id";
import { err, ok, type Result } from "@/shared/result";
import type { AppDatabaseRepository } from "@/infrastructure/persistence/database-repository";
import type {
  AppDatabase,
  PersistedConversation,
} from "@/infrastructure/persistence/schema";

export interface ApplicationError {
  readonly code: "conversation-not-found" | "workspace-error" | "memory-error" | "persistence-error";
  readonly message: string;
  readonly workspace?: WorkspaceError;
}

export type ApplicationListener = (database: AppDatabase) => void;

export class ApplicationSession {
  private database: AppDatabase;
  private readonly workspaces = new Map<ConversationId, ProjectWorkspace>();
  private readonly listeners = new Set<ApplicationListener>();
  private queue: Promise<void> = Promise.resolve();
  private memoryBook: MemoryBook;

  constructor(
    database: AppDatabase,
    private readonly repository: AppDatabaseRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {
    this.database = database;
    this.memoryBook = this.createMemoryBook(database);
  }

  snapshot(): AppDatabase {
    return this.database;
  }

  subscribe(listener: ApplicationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createConversation(template = "vite-react-ts"): Promise<Result<ConversationId, ApplicationError>> {
    return this.enqueue(async () => {
      const id = this.ids.next("conversation");
      const timestamp = this.clock.now();
      const conversation: Conversation = {
        id,
        title: null,
        messages: [],
        projectRevision: 0,
        template,
        pinned: false,
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const persisted: PersistedConversation = {
        conversation,
        project: {
          revision: 0,
          files: {},
          directories: [],
          initialized: false,
        },
      };
      const next: AppDatabase = {
        ...this.database,
        activeConversationId: id,
        conversations: { ...this.database.conversations, [id]: persisted },
        snapshots: { ...this.database.snapshots, [id]: [] },
      };
      const committed = await this.commit(next);
      return committed.ok ? ok(id) : committed;
    });
  }

  forkConversation(sourceId: ConversationId): Promise<Result<ConversationId, ApplicationError>> {
    return this.enqueue(async () => {
      const source = this.database.conversations[sourceId];
      if (!source) return this.notFound(sourceId);
      const id = this.ids.next("conversation");
      const timestamp = this.clock.now();
      const fork: PersistedConversation = {
        ...source,
        conversation: {
          ...source.conversation,
          id,
          pinned: false,
          archived: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        project: {
          ...source.project,
          files: { ...source.project.files },
          directories: [...source.project.directories],
        },
      };
      const committed = await this.commit({
        ...this.database,
        activeConversationId: id,
        conversations: { ...this.database.conversations, [id]: fork },
        snapshots: { ...this.database.snapshots, [id]: [] },
      });
      return committed.ok ? ok(id) : committed;
    });
  }

  switchConversation(id: ConversationId): Promise<Result<void, ApplicationError>> {
    return this.enqueue(async () => {
      if (!this.database.conversations[id]) return this.notFound(id);
      return this.commit({ ...this.database, activeConversationId: id });
    });
  }

  deleteConversation(id: ConversationId): Promise<Result<void, ApplicationError>> {
    return this.enqueue(async () => {
      if (!this.database.conversations[id]) return this.notFound(id);
      const { [id]: _removedConversation, ...conversations } = this.database.conversations;
      const { [id]: _removedSnapshots, ...snapshots } = this.database.snapshots;
      const nextActive =
        this.database.activeConversationId === id
          ? (Object.values(conversations).sort(
              (left, right) => right.conversation.updatedAt - left.conversation.updatedAt,
            )[0]?.conversation.id ?? null)
          : this.database.activeConversationId;
      const result = await this.commit({
        ...this.database,
        activeConversationId: nextActive,
        conversations,
        snapshots,
      });
      if (result.ok) this.workspaces.delete(id);
      return result;
    });
  }

  updateConversation(
    id: ConversationId,
    update: Partial<Pick<Conversation, "title" | "pinned" | "archived" | "template">>,
  ): Promise<Result<void, ApplicationError>> {
    return this.enqueue(async () => {
      const persisted = this.database.conversations[id];
      if (!persisted) return this.notFound(id);
      const conversation: Conversation = {
        ...persisted.conversation,
        ...update,
        pinned: update.archived === true ? false : (update.pinned ?? persisted.conversation.pinned),
        archived: update.pinned === true ? false : (update.archived ?? persisted.conversation.archived),
        updatedAt: this.clock.now(),
      };
      return this.commit({
        ...this.database,
        conversations: {
          ...this.database.conversations,
          [id]: { ...persisted, conversation },
        },
      });
    });
  }

  appendConversationMessages(
    id: ConversationId,
    messages: readonly ConversationMessage[],
  ): Promise<Result<void, ApplicationError>> {
    return this.enqueue(async () => {
      const persisted = this.database.conversations[id];
      if (!persisted) return this.notFound(id);
      const conversation = appendMessages(persisted.conversation, messages, this.clock.now());
      return this.commit({
        ...this.database,
        conversations: {
          ...this.database.conversations,
          [id]: { ...persisted, conversation },
        },
      });
    });
  }

  applyProjectOperations(
    id: ConversationId,
    operations: readonly FileOperation[],
  ): Promise<Result<FileChangeSet, ApplicationError>> {
    return this.enqueue(async () => {
      const persisted = this.database.conversations[id];
      if (!persisted) return this.notFound(id);
      const workspace = this.workspace(id, persisted);
      const before = workspace.snapshot();
      const applied = workspace.apply(operations);
      if (!applied.ok) {
        return err({
          code: "workspace-error",
          message: applied.error.message,
          workspace: applied.error,
        });
      }
      if (applied.value.changes.length === 0) return ok(applied.value);
      const tree = workspace.snapshot();
      const conversation: Conversation = {
        ...persisted.conversation,
        projectRevision: tree.revision,
        updatedAt: this.clock.now(),
      };
      const next: AppDatabase = {
        ...this.database,
        conversations: {
          ...this.database.conversations,
          [id]: {
            ...persisted,
            conversation,
            project: {
              ...persisted.project,
              revision: tree.revision,
              files: Object.fromEntries(tree.files) as Record<ProjectPath, string>,
              directories: [...tree.directories],
            },
          },
        },
      };
      const committed = await this.commit(next);
      if (!committed.ok) {
        this.workspaces.set(id, new ProjectWorkspace(before));
        return committed;
      }
      return ok(applied.value);
    });
  }

  replaceProject(
    id: ConversationId,
    tree: Omit<ReturnType<ProjectWorkspace["snapshot"]>, "revision">,
    template: string,
  ): Promise<Result<FileChangeSet, ApplicationError>> {
    return this.enqueue(async () => {
      const persisted = this.database.conversations[id];
      if (!persisted) return this.notFound(id);
      const workspace = this.workspace(id, persisted);
      const before = workspace.snapshot();
      const changed = workspace.replace(tree);
      if (changed.changes.length === 0 && persisted.conversation.template === template) {
        return ok(changed);
      }
      const snapshot = workspace.snapshot();
      const next: AppDatabase = {
        ...this.database,
        conversations: {
          ...this.database.conversations,
          [id]: {
            ...persisted,
            conversation: {
              ...persisted.conversation,
              template,
              projectRevision: snapshot.revision,
              updatedAt: this.clock.now(),
            },
            project: {
              revision: snapshot.revision,
              files: Object.fromEntries(snapshot.files) as Record<ProjectPath, string>,
              directories: [...snapshot.directories],
              initialized: true,
            },
          },
        },
      };
      const committed = await this.commit(next);
      if (!committed.ok) {
        this.workspaces.set(id, new ProjectWorkspace(before));
        return committed;
      }
      return ok(changed);
    });
  }

  projectSnapshot(id: ConversationId): Promise<Result<ReturnType<ProjectWorkspace["snapshot"]>, ApplicationError>> {
    return this.enqueue(async () => {
      const persisted = this.database.conversations[id];
      if (!persisted) return this.notFound(id);
      return ok(this.workspace(id, persisted).snapshot());
    });
  }

  readProjectFiles(
    id: ConversationId,
    paths: readonly string[],
  ): Promise<
    Result<{ revision: number; files: Readonly<Record<string, string>> }, ApplicationError>
  > {
    return this.enqueue(async () => {
      const persisted = this.database.conversations[id];
      if (!persisted) return this.notFound(id);
      const workspace = this.workspace(id, persisted);
      const files: Record<string, string> = {};
      for (const path of paths) {
        const result = workspace.read(path);
        if (!result.ok) {
          return err({
            code: "workspace-error",
            message: result.error.message,
            workspace: result.error,
          });
        }
        files[path] = result.value;
      }
      return ok({ revision: workspace.revision, files });
    });
  }

  updateSettings(settings: AppSettings): Promise<Result<void, ApplicationError>> {
    return this.enqueue(async () => {
      const normalized = normalizeSettings(settings);
      const result = await this.commit({ ...this.database, settings: normalized });
      if (result.ok) {
        this.memoryBook.setEnabled(normalized.privacy.memoryEnabled);
      }
      return result;
    });
  }

  setCompressedContext(
    id: ConversationId,
    context: PersistedConversation["compressedContext"],
  ): Promise<Result<void, ApplicationError>> {
    return this.enqueue(async () => {
      const persisted = this.database.conversations[id];
      if (!persisted) return this.notFound(id);
      const nextConversation: PersistedConversation = context
        ? { ...persisted, compressedContext: context }
        : (({ compressedContext: _removed, ...rest }) => rest)(persisted);
      return this.commit({
        ...this.database,
        conversations: {
          ...this.database.conversations,
          [id]: nextConversation,
        },
      });
    });
  }

  applyMemoryOperations(
    operations: readonly MemoryOperation[],
  ): Promise<Result<void, ApplicationError>> {
    return this.enqueue(async () => {
      const before = this.memoryBook.list();
      const applied = this.memoryBook.apply(operations);
      if (!applied.ok) return err({ code: "memory-error", message: applied.error.message });
      const next = { ...this.database, memories: applied.value };
      const committed = await this.commit(next);
      if (!committed.ok) this.memoryBook = this.createMemoryBook(this.database, before);
      return committed;
    });
  }

  memoryPrompt(): string {
    return this.memoryBook.promptSection();
  }

  private workspace(id: ConversationId, persisted: PersistedConversation): ProjectWorkspace {
    const existing = this.workspaces.get(id);
    if (existing) return existing;
    const workspace = new ProjectWorkspace({
      revision: persisted.project.revision,
      files: new Map(
        Object.entries(persisted.project.files) as [ProjectPath, string][],
      ),
      directories: new Set(persisted.project.directories),
    });
    this.workspaces.set(id, workspace);
    return workspace;
  }

  private async commit(next: AppDatabase): Promise<Result<void, ApplicationError>> {
    const saved = await this.repository.save(next);
    if (!saved.ok) {
      return err({ code: "persistence-error", message: saved.error.message });
    }
    this.database = next;
    for (const listener of this.listeners) listener(next);
    return ok(undefined);
  }

  private createMemoryBook(database: AppDatabase, items = database.memories): MemoryBook {
    return new MemoryBook(
      database.settings.privacy.memoryEnabled,
      this.ids,
      this.clock,
      undefined,
      items,
    );
  }

  private notFound<T>(id: ConversationId): Result<T, ApplicationError> {
    return err({ code: "conversation-not-found", message: `Conversation not found: ${id}` });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const running = this.queue.then(work, work);
    this.queue = running.then(
      () => undefined,
      () => undefined,
    );
    return running;
  }
}
