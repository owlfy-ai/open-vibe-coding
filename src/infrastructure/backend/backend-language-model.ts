import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelPort, ModelRequest, ModelStreamEvent } from "@/application/ports/language-model";
import { AiSdkLanguageModelAdapter } from "@/infrastructure/ai/ai-sdk-language-model";
import type { BackendClient } from "./backend-client";
import { BackendAuthRequiredError } from "./backend-client";

export class BackendModelAccessError extends Error {
  readonly status = 403;
  readonly code = "backend-model-unavailable";

  constructor() {
    super("Your account is signed in, but the official model service is not enabled. Please contact the administrator.");
    this.name = "BackendModelAccessError";
  }
}

export class BackendLanguageModelAdapter implements LanguageModelPort {
  constructor(
    private readonly backend: BackendClient,
    private readonly model = "backup_qidea",
  ) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    let session = this.backend.current();
    if (!session?.accessToken) {
      throw new BackendAuthRequiredError("Sign in to use the official model service");
    }
    // An older saved login can predate model provisioning on the backend.
    if (!session.liteLlmKey) session = await this.backend.refresh();
    if (!session?.accessToken) {
      throw new BackendAuthRequiredError("Your session has expired. Please sign in again.");
    }
    if (!session.liteLlmKey) throw new BackendModelAccessError();
    const provider = createOpenAICompatible({
      name: "owlfy",
      baseURL: this.backend.liteLlmBaseUrl(),
      apiKey: session.liteLlmKey,
    });
    const adapter = new AiSdkLanguageModelAdapter({
      model: provider(this.selectedModel(session)),
      providerType: "openai-compatible",
      providerOptions: {},
      providerTools: {},
      providerManagedToolNames: new Set(),
    });
    yield* adapter.stream(request);
  }

  private selectedModel(session: NonNullable<ReturnType<BackendClient["current"]>>): string {
    void session;
    return this.model || this.backend.liteLlmModel();
  }
}
