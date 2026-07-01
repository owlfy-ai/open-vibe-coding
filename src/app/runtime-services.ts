import { CodingAgentService } from "@/application/agent";
import { ConversationIntelligenceService } from "@/application/conversation";
import {
  RetryingLanguageModel,
  TimerRetryScheduler,
} from "@/application/ports/retrying-language-model";
import {
  createImageSearchTool,
  createPackageResearchTools,
  createWebResearchTools,
} from "@/application/research";
import { validateAiSettings } from "@/domain/settings";
import type { ProjectArchivePort } from "@/application/project";
import { PreviewCoordinator } from "@/application/preview";
import { BackendClient, BackendLanguageModelAdapter } from "@/infrastructure/backend";
import {
  AiSdkLanguageModelAdapter,
  createAiProviderRuntime,
} from "@/infrastructure/ai";
import { FetchHttpClient, type HttpClient } from "@/infrastructure/http";
import {
  ImageResearchAdapter,
  PackageResearchAdapter,
  WebResearchAdapter,
} from "@/infrastructure/research";
import { BrowserProjectArchive } from "@/infrastructure/project";
import { SandpackTemplateCatalog } from "@/infrastructure/preview";
import { err, ok, type Result } from "@/shared/result";
import type { ApplicationRuntime } from "./bootstrap";
import { getOperationsConfig } from "./operations-config";

export interface RuntimeServices {
  readonly agent: CodingAgentService;
  readonly conversations: ConversationIntelligenceService;
  readonly preview: PreviewCoordinator;
  readonly projectArchive: ProjectArchivePort;
}

export interface RuntimeServiceError {
  readonly code: "invalid-settings" | "provider-error";
  readonly message: string;
}

export interface RuntimeServiceDependencies {
  readonly http?: HttpClient;
  readonly preview?: PreviewCoordinator;
}

export function createRuntimeServices(
  runtime: ApplicationRuntime,
  dependencies: RuntimeServiceDependencies = {},
): Result<RuntimeServices, RuntimeServiceError> {
  const operations = getOperationsConfig();
  try {
    const settings = runtime.session.snapshot().settings;
    const modelResult = createLanguageModel(settings, operations);
    if (!modelResult.ok) return modelResult;
    const model = new RetryingLanguageModel(
      modelResult.value,
      new TimerRetryScheduler(),
    );
    const http = dependencies.http ?? new FetchHttpClient();
    const preview = dependencies.preview ?? new PreviewCoordinator();
    const web = new WebResearchAdapter(http);
    const image = new ImageResearchAdapter(http);
    const packages = new PackageResearchAdapter(http, runtime.clock);
    const settingsProvider = () => runtime.session.snapshot().settings;
    const imageTool = createImageSearchTool(image, settingsProvider);
    const researchTools = [
      ...createWebResearchTools(web, settingsProvider),
      ...(imageTool ? [imageTool] : []),
      ...createPackageResearchTools(packages),
    ];
    return ok({
      agent: new CodingAgentService(
        runtime.session,
        model,
        preview,
        runtime.ids,
        runtime.clock,
        new SandpackTemplateCatalog(),
        researchTools,
      ),
      conversations: new ConversationIntelligenceService(
        runtime.session,
        model,
        runtime.ids,
        runtime.clock,
      ),
      preview,
      projectArchive: new BrowserProjectArchive(),
    });
  } catch (error) {
    return err({
      code: "provider-error",
      message: error instanceof Error ? error.message : "Failed to create AI provider",
    });
  }
}

function createLanguageModel(
  settings: ReturnType<ApplicationRuntime["session"]["snapshot"]>["settings"],
  operations: ReturnType<typeof getOperationsConfig>,
): Result<BackendLanguageModelAdapter | AiSdkLanguageModelAdapter, RuntimeServiceError> {
  const normalized = validateAiSettings(settings);
  if (!normalized.ok) {
    return err({
      code: "invalid-settings",
      message: normalized.error.map((issue) => issue.message).join("; "),
    });
  }
  if (normalized.value.ai.apiType === "official") {
    return ok(new BackendLanguageModelAdapter(
      new BackendClient(operations),
      officialModelName(normalized.value.ai.model, operations.liteLlmModel),
    ));
  }
  const provider = createAiProviderRuntime({
    type: normalized.value.ai.apiType,
    apiKey: normalized.value.ai.apiKey,
    baseUrl: normalized.value.ai.apiBaseUrl,
    model: normalized.value.ai.model,
  });
  return ok(new AiSdkLanguageModelAdapter({
    model: provider.model,
    providerType: normalized.value.ai.apiType,
    providerOptions: provider.providerOptions,
    providerTools: provider.providerTools,
    providerManagedToolNames: provider.providerManagedToolNames,
  }));
}

function officialModelName(model: string, fallback: string): string {
  if (model === "Ultra") return "Ultra";
  if (model === "Standard") return "Standard";
  return fallback || "Standard";
}
