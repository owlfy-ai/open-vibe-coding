import type {
  LanguageModelPort,
  ModelRequest,
  ModelStreamEvent,
} from "./language-model";

export interface RetryScheduler {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export class TimerRetryScheduler implements RetryScheduler {
  async wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("The operation was aborted", "AbortError"));
        return;
      }
      const timer = setTimeout(resolve, milliseconds);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}

export interface ModelRetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly isRetryable?: (error: unknown) => boolean;
  readonly onRetry?: (event: {
    readonly attempt: number;
    readonly delayMs: number;
    readonly error: unknown;
  }) => void;
}

/**
 * Retries only before the first stream event. Once output is visible, replaying a
 * request could duplicate text or tool calls, so a later failure is propagated.
 */
export class RetryingLanguageModel implements LanguageModelPort {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly isRetryable: (error: unknown) => boolean;

  constructor(
    private readonly source: LanguageModelPort,
    private readonly scheduler: RetryScheduler,
    private readonly options: ModelRetryOptions = {},
  ) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
    this.maxDelayMs = Math.max(this.baseDelayMs, options.maxDelayMs ?? 30_000);
    this.isRetryable = options.isRetryable ?? defaultRetryableError;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let emitted = false;
      try {
        for await (const event of this.source.stream(request)) {
          emitted = true;
          yield event;
        }
        return;
      } catch (error) {
        if (
          emitted ||
          request.signal.aborted ||
          attempt >= this.maxAttempts ||
          !this.isRetryable(error)
        ) {
          throw error;
        }
        const delayMs = Math.min(
          this.maxDelayMs,
          this.baseDelayMs * 2 ** (attempt - 1),
        );
        this.options.onRetry?.({ attempt: attempt + 1, delayMs, error });
        await this.scheduler.wait(delayMs, request.signal);
      }
    }
  }
}

export function defaultRetryableError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : undefined;
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}
