import { SANDBOX_TEMPLATES } from "@codesandbox/sandpack-react";
import type {
  ProjectTemplate,
  TemplateCatalog,
  TemplateCatalogError,
} from "@/application/ports/template-catalog";
import { importLegacyProjectFiles } from "@/domain/project";
import { err, ok, type Result } from "@/shared/result";

export class SandpackTemplateCatalog implements TemplateCatalog {
  list(): readonly string[] {
    return Object.keys(SANDBOX_TEMPLATES).sort();
  }

  load(name: string): Result<ProjectTemplate, TemplateCatalogError> {
    const template = SANDBOX_TEMPLATES[name as keyof typeof SANDBOX_TEMPLATES];
    if (!template) {
      return err({ code: "unknown-template", message: `Unknown Sandpack template: ${name}` });
    }
    const rawFiles = Object.fromEntries(
      Object.entries(template.files).map(([path, file]) => [
        path.startsWith("/") ? path.slice(1) : path,
        typeof file === "string" ? file : file.code,
      ]),
    );
    const imported = importLegacyProjectFiles(normalizeTemplateFiles(name, rawFiles));
    if (!imported.ok) {
      return err({ code: "invalid-template", message: imported.error.message });
    }
    return ok({
      name,
      tree: {
        files: imported.value.files,
        directories: imported.value.directories,
      },
    });
  }
}

function normalizeTemplateFiles(
  template: string,
  files: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (template === "vite-react-ts") {
    return moveViteReactEntrypoint(files, {
      app: "App.tsx",
      index: "index.tsx",
      styles: "styles.css",
      viteEnv: "vite-env.d.ts",
    });
  }
  if (template === "vite-react") {
    return moveViteReactEntrypoint(files, {
      app: "App.jsx",
      index: "index.jsx",
      styles: "styles.css",
    });
  }
  return files;
}

function moveViteReactEntrypoint(
  files: Readonly<Record<string, string>>,
  names: {
    readonly app: string;
    readonly index: string;
    readonly styles: string;
    readonly viteEnv?: string;
  },
): Readonly<Record<string, string>> {
  const next: Record<string, string> = { ...files };
  moveFile(next, names.app, `src/${names.app}`);
  moveFile(next, names.index, `src/${names.index}`);
  moveFile(next, names.styles, `src/${names.styles}`);
  if (names.viteEnv) moveFile(next, names.viteEnv, `src/${names.viteEnv}`);
  if (next["index.html"]) {
    next["index.html"] = next["index.html"].replace(
      new RegExp(`src="/?${escapeRegExp(names.index)}"`),
      `src="/src/${names.index}"`,
    );
  }
  return next;
}

function moveFile(files: Record<string, string>, from: string, to: string): void {
  if (files[from] === undefined || files[to] !== undefined) return;
  files[to] = files[from];
  delete files[from];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
