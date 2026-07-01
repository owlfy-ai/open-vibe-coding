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
import type { ProjectArchivePort } from "@/application/project";
import { PreviewCoordinator } from "@/application/preview";
import { BackendClient, BackendLanguageModelAdapter } from "@/infrastructure/backend";
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
    const model = new RetryingLanguageModel(
      new BackendLanguageModelAdapter(new BackendClient(operations)),
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
