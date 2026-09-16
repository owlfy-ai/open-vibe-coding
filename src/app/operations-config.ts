export interface OperationsConfig {
  readonly appId: string;
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
    appId: import.meta.env.VITE_OVC_APP_ID?.trim() || "qidea.ai",
    backendUrl,
    liteLlmBaseUrl: trimTrailingSlash(
      import.meta.env.VITE_OVC_LITELLM_BASE_URL || `${backendUrl}/litellm/v1`,
    ),
    liteLlmModel: import.meta.env.VITE_OVC_LITELLM_MODEL?.trim() || "backup_glm5.3",
    appName: import.meta.env.VITE_OVC_APP_NAME?.trim() || "Open Vibe Coding",
    clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() || "pk_live_Y2xlcmsucWlkZWEuYWkk",
  };
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
