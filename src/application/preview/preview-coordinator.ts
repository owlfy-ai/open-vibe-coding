import { err, ok, type Result } from "@/shared/result";

export type PreviewRestartReason = "template-changed" | "dependencies-changed" | "conversation-changed";
export type PreviewUpdateReason = PreviewRestartReason | "files-changed" | "manual-refresh";

export interface PreviewCommand {
  readonly conversationId?: string;
  readonly revision: number;
  readonly reason: PreviewUpdateReason;
  readonly restart: boolean;
}

export interface PreviewConsoleEntry {
  readonly id: string;
  readonly method: "log" | "info" | "warn" | "error" | "debug";
  readonly data: readonly unknown[];
  readonly timestamp?: number;
}

export type PreviewRevisionState =
  | { readonly status: "queued"; readonly conversationId?: string; readonly revision: number; readonly logs: readonly PreviewConsoleEntry[] }
  | { readonly status: "compiling"; readonly conversationId?: string; readonly revision: number; readonly logs: readonly PreviewConsoleEntry[] }
  | { readonly status: "ready"; readonly conversationId?: string; readonly revision: number; readonly logs: readonly PreviewConsoleEntry[] }
  | {
      readonly status: "failed";
      readonly conversationId?: string;
      readonly revision: number;
      readonly logs: readonly PreviewConsoleEntry[];
      readonly error: string;
    };

export interface PreviewError {
  readonly code: "unknown-revision" | "timeout" | "compile-failed" | "superseded" | "aborted";
  readonly revision: number;
  readonly message: string;
}

type CommandListener = (command: PreviewCommand) => void;
type StateListener = (state: PreviewRevisionState) => void;
export type PreviewTarget = number | { readonly conversationId?: string; readonly revision: number };

interface Waiter {
  readonly resolve: (result: Result<PreviewRevisionState, PreviewError>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly cleanup: () => void;
}

export class PreviewCoordinator {
  private readonly currentByScope = new Map<string, number>();
  private readonly states = new Map<string, PreviewRevisionState>();
  private readonly commandListeners = new Set<CommandListener>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly waiters = new Map<string, Set<Waiter>>();

  request(command: PreviewCommand): void {
    const scope = scopeOf(command);
    const key = keyOf(command);
    const currentRevision = this.currentByScope.get(scope) ?? -1;
    if (command.revision < currentRevision) return;
    if (command.revision > currentRevision) {
      for (const waiterKey of this.waiters.keys()) {
        const target = parseKey(waiterKey);
        if (target.scope === scope && target.revision < command.revision) {
          this.settleWaiters(
            waiterKey,
            err({
              code: "superseded",
              revision: target.revision,
              message: `Preview revision ${target.revision} was superseded by ${command.revision}`,
            }),
          );
        }
      }
      this.currentByScope.set(scope, command.revision);
    }
    this.setState({
      status: "queued",
      conversationId: command.conversationId,
      revision: command.revision,
      logs: this.states.get(key)?.logs ?? [],
    });
    for (const listener of this.commandListeners) listener(command);
  }

  markCompiling(target: PreviewTarget): void {
    if (!this.isCurrent(target)) return;
    const key = keyOf(target);
    const current = this.states.get(key);
    if (current?.status === "ready" || current?.status === "failed") return;
    this.setState({
      status: "compiling",
      conversationId: conversationOf(target),
      revision: revisionOf(target),
      logs: this.states.get(key)?.logs ?? [],
    });
  }

  markReady(target: PreviewTarget): void {
    if (!this.isCurrent(target)) return;
    const key = keyOf(target);
    const current = this.states.get(key);
    if (current?.status === "ready") return;
    if (current?.status === "failed") return;
    const state: PreviewRevisionState = {
      status: "ready",
      conversationId: conversationOf(target),
      revision: revisionOf(target),
      logs: this.states.get(key)?.logs ?? [],
    };
    this.setState(state);
    this.settleWaiters(key, ok(state));
  }

  markFailed(target: PreviewTarget, error: string): void {
    if (!this.isCurrent(target)) return;
    const key = keyOf(target);
    const current = this.states.get(key);
    if (current?.status === "failed" && current.error === error) return;
    const state: PreviewRevisionState = {
      status: "failed",
      conversationId: conversationOf(target),
      revision: revisionOf(target),
      logs: this.states.get(key)?.logs ?? [],
      error,
    };
    this.setState(state);
    this.settleWaiters(
      key,
      err({ code: "compile-failed", revision: revisionOf(target), message: error }),
    );
  }

  recordConsole(target: PreviewTarget, logs: readonly PreviewConsoleEntry[]): void {
    const key = keyOf(target);
    const current = this.states.get(key);
    if (!current || !this.isCurrent(target)) return;
    const merged = new Map(current.logs.map((entry) => [entry.id, entry]));
    for (const entry of logs) merged.set(entry.id, entry);
    this.setState({ ...current, logs: [...merged.values()] });
  }

  state(target?: PreviewTarget): PreviewRevisionState | null {
    if (target !== undefined) return this.states.get(keyOf(target)) ?? null;
    const globalRevision = this.currentByScope.get(GLOBAL_SCOPE);
    return globalRevision === undefined ? null : (this.states.get(keyFor(GLOBAL_SCOPE, globalRevision)) ?? null);
  }

  subscribeCommands(listener: CommandListener): () => void {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  async waitUntilSettled(
    target: PreviewTarget,
    timeoutMs = 15_000,
    signal?: AbortSignal,
  ): Promise<Result<PreviewRevisionState, PreviewError>> {
    const key = keyOf(target);
    const revision = revisionOf(target);
    const state = this.states.get(key);
    if (!state) {
      return err({
        code: "unknown-revision",
        revision,
        message: `Preview revision is unknown: ${revision}`,
      });
    }
    if (state.status === "ready") return ok(state);
    if (state.status === "failed") {
      return err({ code: "compile-failed", revision, message: state.error });
    }
    if (signal?.aborted) {
      return err({ code: "aborted", revision, message: "Preview wait was aborted" });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeWaiter(key, waiter);
        resolve(
          err({
            code: "timeout",
            revision,
            message: `Preview revision ${revision} did not settle within ${timeoutMs}ms`,
          }),
        );
      }, timeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        this.removeWaiter(key, waiter);
        resolve(err({ code: "aborted", revision, message: "Preview wait was aborted" }));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const waiter: Waiter = {
        resolve,
        timer,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      };
      const revisionWaiters = this.waiters.get(key) ?? new Set<Waiter>();
      revisionWaiters.add(waiter);
      this.waiters.set(key, revisionWaiters);
    });
  }

  private isCurrent(target: PreviewTarget): boolean {
    return revisionOf(target) === this.currentByScope.get(scopeOf(target));
  }

  private setState(state: PreviewRevisionState): void {
    this.states.set(keyOf(state), state);
    for (const listener of this.stateListeners) listener(state);
  }

  private settleWaiters(
    key: string,
    result: Result<PreviewRevisionState, PreviewError>,
  ): void {
    const waiters = this.waiters.get(key);
    if (!waiters) return;
    this.waiters.delete(key);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.cleanup();
      waiter.resolve(result);
    }
  }

  private removeWaiter(key: string, waiter: Waiter): void {
    const waiters = this.waiters.get(key);
    if (!waiters) return;
    waiters.delete(waiter);
    waiter.cleanup();
    if (waiters.size === 0) this.waiters.delete(key);
  }
}

const GLOBAL_SCOPE = "__global__";

function scopeOf(target: PreviewTarget | PreviewCommand | PreviewRevisionState): string {
  if (typeof target === "number") return GLOBAL_SCOPE;
  return target.conversationId ?? GLOBAL_SCOPE;
}

function revisionOf(target: PreviewTarget | PreviewCommand | PreviewRevisionState): number {
  return typeof target === "number" ? target : target.revision;
}

function conversationOf(target: PreviewTarget | PreviewCommand | PreviewRevisionState): string | undefined {
  return typeof target === "number" ? undefined : target.conversationId;
}

function keyOf(target: PreviewTarget | PreviewCommand | PreviewRevisionState): string {
  return keyFor(scopeOf(target), revisionOf(target));
}

function keyFor(scope: string, revision: number): string {
  return `${scope}:${revision}`;
}

function parseKey(key: string): { readonly scope: string; readonly revision: number } {
  const separator = key.lastIndexOf(":");
  return {
    scope: key.slice(0, separator),
    revision: Number(key.slice(separator + 1)),
  };
}
