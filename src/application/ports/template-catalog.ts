import type { ProjectTree } from "@/domain/project";
import type { Result } from "@/shared/result";

export interface TemplateCatalogError {
  readonly code: "unknown-template" | "invalid-template";
  readonly message: string;
}

export interface ProjectTemplate {
  readonly name: string;
  readonly tree: Omit<ProjectTree, "revision">;
}

export interface TemplateCatalog {
  list(): readonly string[];
  load(name: string): Result<ProjectTemplate, TemplateCatalogError>;
}
