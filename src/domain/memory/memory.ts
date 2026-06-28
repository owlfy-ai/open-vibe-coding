import type { Clock } from "@/shared/clock";
import type { EntityId, IdGenerator } from "@/shared/id";
import { err, ok, type Result } from "@/shared/result";

export type MemoryId = EntityId<"memory">;
export type MemoryCategory = "preference" | "personal_info" | "instruction" | "fact" | "project";

export interface MemoryItem {
  readonly id: MemoryId;
  readonly content: string;
  readonly category: MemoryCategory;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type MemoryOperation =
  | { readonly type: "add"; readonly content: string; readonly category: MemoryCategory }
  | {
      readonly type: "update";
      readonly id: MemoryId;
      readonly content: string;
      readonly category?: MemoryCategory;
    }
  | { readonly type: "delete"; readonly id: MemoryId };

export interface MemoryError {
  readonly code:
    | "disabled"
    | "not-found"
    | "empty-content"
    | "content-too-long"
    | "sensitive-content"
    | "capacity-exceeded";
  readonly operationIndex: number;
  readonly message: string;
}

export interface MemoryPolicy {
  readonly maxItems: number;
  readonly maxContentLength: number;
  allows(content: string): boolean;
}

export class DefaultMemoryPolicy implements MemoryPolicy {
  readonly maxItems = 200;
  readonly maxContentLength = 1_000;

  allows(content: string): boolean {
    const sensitivePatterns = [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
      /\b(?:api[_ -]?key|password|secret|access[_ -]?token)\s*[:=]\s*\S+/i,
      /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
      /\bsk-[A-Za-z0-9_-]{12,}/,
    ];
    return sensitivePatterns.every((pattern) => !pattern.test(content));
  }
}

export class MemoryBook {
  private items: MemoryItem[];

  constructor(
    private enabled: boolean,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly policy: MemoryPolicy = new DefaultMemoryPolicy(),
    initialItems: readonly MemoryItem[] = [],
  ) {
    this.items = [...initialItems];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  list(): readonly MemoryItem[] {
    return [...this.items];
  }

  apply(operations: readonly MemoryOperation[]): Result<readonly MemoryItem[], MemoryError> {
    if (!this.enabled) {
      return err({ code: "disabled", operationIndex: 0, message: "Long-term memory is disabled" });
    }
    const draft = [...this.items];
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      if (operation.type === "delete") {
        const itemIndex = draft.findIndex((item) => item.id === operation.id);
        if (itemIndex < 0) return this.failure("not-found", index, `Memory not found: ${operation.id}`);
        draft.splice(itemIndex, 1);
        continue;
      }
      const content = operation.content.trim();
      const validation = this.validateContent(content, index);
      if (!validation.ok) return validation;
      if (operation.type === "add") {
        if (draft.length >= this.policy.maxItems) {
          return this.failure("capacity-exceeded", index, "Memory capacity has been reached");
        }
        const timestamp = this.clock.now();
        draft.push({
          id: this.ids.next("memory"),
          content,
          category: operation.category,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      } else {
        const itemIndex = draft.findIndex((item) => item.id === operation.id);
        if (itemIndex < 0) return this.failure("not-found", index, `Memory not found: ${operation.id}`);
        draft[itemIndex] = {
          ...draft[itemIndex],
          content,
          ...(operation.category ? { category: operation.category } : {}),
          updatedAt: this.clock.now(),
        };
      }
    }
    this.items = draft;
    return ok(this.list());
  }

  promptSection(): string {
    if (!this.enabled || this.items.length === 0) return "";
    return [
      "<memory>",
      "Known user preferences and long-term context:",
      ...this.items.map((item) => `- [${item.id}] [${item.category}] ${item.content}`),
      "</memory>",
    ].join("\n");
  }

  private validateContent(content: string, index: number): Result<void, MemoryError> {
    if (!content) return this.failure("empty-content", index, "Memory content must not be empty");
    if (content.length > this.policy.maxContentLength) {
      return this.failure("content-too-long", index, "Memory content exceeds the configured limit");
    }
    if (!this.policy.allows(content)) {
      return this.failure("sensitive-content", index, "Sensitive credentials must not be stored in memory");
    }
    return ok(undefined);
  }

  private failure(
    code: MemoryError["code"],
    operationIndex: number,
    message: string,
  ): Result<never, MemoryError> {
    return err({ code, operationIndex, message });
  }
}
