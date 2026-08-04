import { describe, expect, it } from "vitest";
import {
  classifyPreviewProject,
  enrichPreviewFilesForTemplate,
  needsVitePackageRepair,
  resolvePreviewTemplate,
} from "./detect-preview-template";

const knowledgeGraphFiles = {
  "/index.html": {
    code: `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><title>知识图谱</title></head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>`,
  },
  "/src/main.js": {
    code: "import './styles.css';\nimport { NODES } from './data.js';\n",
  },
  "/src/data.js": { code: "export const NODES = [];" },
  "/src/graph.js": { code: "export function createGraph(){}" },
  "/src/styles.css": { code: "body{margin:0}" },
  "/package.json": { code: "{\"dependencies\":{},\"main\":\"/index.js\"}" },
};

describe("resolvePreviewTemplate", () => {
  it("keeps vite-react-ts for normal React projects", () => {
    expect(
      resolvePreviewTemplate(
        {
          "/index.html": {
            code: "<div id=\"root\"></div><script type=\"module\" src=\"/src/index.tsx\"></script>",
          },
          "/src/index.tsx": { code: "import App from \"./App\";" },
          "/src/App.tsx": { code: "export default function App(){return null}" },
          "/package.json": {
            code: "{\"dependencies\":{\"react\":\"19.0.0\",\"react-dom\":\"19.0.0\"},\"devDependencies\":{\"vite\":\"6.0.0\"}}",
          },
        },
        "vite-react-ts",
      ),
    ).toBe("vite-react-ts");
  });

  it("uses static for self-contained HTML without module entry", () => {
    const files = {
      "/index.html": { code: "<!doctype html><h1>Hi</h1><script src=\"app.js\"></script>" },
      "/styles.css": { code: "body{margin:0}" },
      "/app.js": { code: "console.log('hi')" },
    };
    expect(classifyPreviewProject(files)).toBe("static");
    expect(resolvePreviewTemplate(files, "vite-react-ts")).toBe("static");
  });

  it("uses vite for plain JS module apps even with a stub package.json", () => {
    expect(classifyPreviewProject(knowledgeGraphFiles)).toBe("vite-vanilla");
    expect(resolvePreviewTemplate(knowledgeGraphFiles, "vite-react-ts")).toBe("vite");
    expect(resolvePreviewTemplate(knowledgeGraphFiles, "static")).toBe("vite");
    expect(needsVitePackageRepair(knowledgeGraphFiles)).toBe(true);
  });

  it("prefers index.html plain JS entry over leftover React debris in old sessions", () => {
    const files = {
      ...knowledgeGraphFiles,
      "/src/App.tsx": { code: "export default function App(){return <div/>}" },
      "/src/index.tsx": { code: "import React from \"react\"" },
      "/package.json": {
        code: "{\"dependencies\":{\"react\":\"19.0.0\"},\"main\":\"/index.js\"}",
      },
    };
    expect(classifyPreviewProject(files)).toBe("vite-vanilla");
    expect(resolvePreviewTemplate(files, "vite-react-ts")).toBe("vite");
    const enriched = enrichPreviewFilesForTemplate(files, "vite");
    const pkg = JSON.parse(enriched["/package.json"].code) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies.react).toBeUndefined();
    expect(pkg.devDependencies.vite).toBeTruthy();
  });

  it("enriches stub package.json and bridges /index.js to /src/main.js", () => {
    const enriched = enrichPreviewFilesForTemplate(knowledgeGraphFiles, "vite");
    const pkg = JSON.parse(enriched["/package.json"].code) as {
      main: string;
      scripts: { dev: string };
      devDependencies: { vite: string };
    };
    expect(pkg.scripts.dev).toBe("vite");
    expect(pkg.devDependencies.vite).toBeTruthy();
    expect(pkg.main).toBe("/index.html");
    expect(enriched["/index.js"].code).toContain("/src/main.js");
    expect(enriched["/index.html"].code).toContain("/src/main.js");
    expect(enriched["/index.html"].code).toContain("知识图谱");
  });
});
