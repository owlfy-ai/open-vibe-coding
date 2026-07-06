export interface OperationsConfig {
  readonly backendUrl: string;
  readonly liteLlmBaseUrl: string;
  readonly liteLlmModel: string;
  readonly appName: string;
  readonly clerkPublishableKey: string;
}

export function getOperationsConfig(): OperationsConfig {
  const backendUrl = trimTrailingSlash(
    import.meta.env.VITE_OVC_BACKEND_URL || "https://api.owlfy.ai",
  );
  return {
    backendUrl,
    liteLlmBaseUrl: trimTrailingSlash(
      import.meta.env.VITE_OVC_LITELLM_BASE_URL || `${backendUrl}/litellm/v1`,
    ),
    liteLlmModel: import.meta.env.VITE_OVC_LITELLM_MODEL?.trim() || "Ultra",
    appName: import.meta.env.VITE_OVC_APP_NAME?.trim() || "Open Vibe Coding",
    clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
  };
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
