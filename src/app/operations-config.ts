export interface OperationsConfig {
  readonly backendUrl: string;
  readonly appName: string;
  readonly clerkPublishableKey: string;
}

export function getOperationsConfig(): OperationsConfig {
  const backendUrl = trimTrailingSlash(
    import.meta.env.VITE_OVC_BACKEND_URL || "https://api.owlfy.ai",
  );
  return {
    backendUrl,
    appName: import.meta.env.VITE_OVC_APP_NAME?.trim() || "Open Vibe Coding",
    clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
  };
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
