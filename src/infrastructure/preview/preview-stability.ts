/** Tunables that keep Sandpack/Vite restarts rare and recoverable. */

export const PREVIEW_RECOMPILE_DELAY_MS = 1_200;
export const PREVIEW_FILE_SYNC_DELAY_MS = 500;
export const PREVIEW_RESTART_COALESCE_MS = 800;
export const PREVIEW_INFRA_MAX_RETRIES = 3;
export const PREVIEW_INFRA_RETRY_BACKOFF_MS = [700, 1_600, 3_200] as const;

export const PREVIEW_INFRASTRUCTURE_FAILURE_MESSAGE = [
  "Preview failed to start: the Sandpack/Vite worker lost communication",
  "(BroadcastChannel timeout or MessagePort transfer error).",
  "Automatic retries were exhausted; click the preview refresh button to try again.",
].join(" ");

export const PREVIEW_INFRASTRUCTURE_RETRYING_MESSAGE = [
  "Preview worker communication failed; retrying the Sandpack/Vite runtime…",
].join(" ");

/** Delay before the Nth infrastructure retry (0-based). Null when retries are exhausted. */
export function infraRetryDelayMs(attemptIndex: number): number | null {
  if (attemptIndex < 0 || attemptIndex >= PREVIEW_INFRA_RETRY_BACKOFF_MS.length) return null;
  return PREVIEW_INFRA_RETRY_BACKOFF_MS[attemptIndex] ?? null;
}

/** Sandpack is still booting Vite — avoid updateFile storms during this window. */
export function shouldDeferFileSync(status: string | undefined | null): boolean {
  return status === "running";
}

/** Cheap content fingerprint so identical file maps keep a stable runtime memo. */
export function fingerprintPreviewFiles(
  files: Readonly<Record<string, { readonly code: string }>>,
): string {
  return Object.keys(files)
    .sort()
    .map((path) => {
      const code = files[path]?.code ?? "";
      return `${path}:${code.length}:${fnv1a(code)}`;
    })
    .join("|");
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
