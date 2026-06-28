import type { ThemePreference } from "@/domain/settings";

export type ResolvedTheme = "light" | "dark";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(DARK_MEDIA_QUERY).matches === true;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersDark() ? "dark" : "light";
}

export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

export function subscribeToSystemTheme(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(DARK_MEDIA_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
