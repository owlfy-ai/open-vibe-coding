/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY: string;
  readonly VITE_OPENAI_API_URL: string;
  readonly VITE_OPENAI_MODEL: string;
  readonly VITE_OVC_BACKEND_URL?: string;
  readonly VITE_OVC_APP_NAME?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
