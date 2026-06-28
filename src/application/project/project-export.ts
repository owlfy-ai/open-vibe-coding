import type { ProjectPath } from "@/domain/project";

export interface ProjectExportRequest {
  readonly title: string | null;
  readonly files: Readonly<Record<ProjectPath, string>>;
}

export interface ProjectArchivePort {
  download(request: ProjectExportRequest): Promise<void>;
}

export function projectArchiveFilename(title: string | null): string {
  const base = (title?.trim() || "project")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return `${base || "project"}.zip`;
}
