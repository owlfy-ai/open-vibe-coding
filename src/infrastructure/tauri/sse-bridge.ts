import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface ConnectedEvent {
  readonly type: "Connected";
  readonly status: number;
  readonly headers: Record<string, string>;
}

interface ChunkEvent {
  readonly type: "Chunk";
  readonly bytes: readonly number[];
}

interface DoneEvent {
  readonly type: "Done";
}

interface ErrorEvent {
  readonly type: "Error";
  readonly message: string;
}

type SsePayload = ConnectedEvent | ChunkEvent | DoneEvent | ErrorEvent;

export interface TauriSseRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export function createTauriSseResponse(request: TauriSseRequest): Promise<Response> {
  const id = crypto.randomUUID();
  return new Promise<Response>((resolve, reject) => {
    let unlisten: UnlistenFn | null = null;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let connected = false;

    const cleanup = () => {
      unlisten?.();
      unlisten = null;
      request.signal?.removeEventListener("abort", abort);
    };

    const fail = (error: Error) => {
      if (connected) {
        try {
          controller?.error(error);
        } catch {
          // The stream may already be closed or cancelled.
        }
      } else {
        reject(error);
      }
      cleanup();
    };

    const disconnect = () => {
      void invoke("sse_disconnect", { id });
    };

    const abort = () => {
      disconnect();
      fail(new DOMException("The operation was aborted.", "AbortError"));
    };

    if (request.signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    request.signal?.addEventListener("abort", abort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        disconnect();
        cleanup();
      },
    });

    listen<SsePayload>(`sse://${id}`, (event) => {
      const payload = event.payload;
      if (payload.type === "Connected") {
        connected = true;
        resolve(new Response(stream, { status: payload.status, headers: new Headers(payload.headers) }));
        return;
      }
      if (payload.type === "Chunk") {
        try {
          controller?.enqueue(new Uint8Array(payload.bytes));
        } catch {
          // Ignore chunks after cancellation.
        }
        return;
      }
      if (payload.type === "Done") {
        try {
          controller?.close();
        } catch {
          // The stream may already be closed or cancelled.
        }
        cleanup();
        return;
      }
      fail(new Error(payload.message));
    }).then(
      (dispose) => {
        unlisten = dispose;
        void invoke("sse_connect", {
          id,
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: request.body ?? null,
        }).catch((error: unknown) => fail(new Error(`SSE connect failed: ${String(error)}`)));
      },
      (error: unknown) => fail(new Error(`SSE listener failed: ${String(error)}`)),
    );
  });
}
