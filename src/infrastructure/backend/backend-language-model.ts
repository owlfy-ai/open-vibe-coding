import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelPort, ModelRequest, ModelStreamEvent } from "@/application/ports/language-model";
import { AiSdkLanguageModelAdapter } from "@/infrastructure/ai/ai-sdk-language-model";
import type { BackendClient } from "./backend-client";
import { BackendAuthRequiredError } from "./backend-client";

export class BackendLanguageModelAdapter implements LanguageModelPort {
  constructor(
    private readonly backend: BackendClient,
    private readonly model = "Standard",
  ) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const session = this.backend.current();
    if (!session?.liteLlmKey) {
      throw new BackendAuthRequiredError("Sign in to use the official model service");
    }
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
    if (this.model === "Ultra" && (session.vipLevel ?? 0) <= 0) return "Standard";
    return this.model || this.backend.liteLlmModel();
  }
}
