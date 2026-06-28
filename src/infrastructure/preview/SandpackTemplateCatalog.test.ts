import { describe, expect, it } from "vitest";
import { SandpackTemplateCatalog } from "./SandpackTemplateCatalog";

describe("SandpackTemplateCatalog", () => {
  it("normalizes vite react typescript templates to a single src entrypoint", () => {
    const template = new SandpackTemplateCatalog().load("vite-react-ts");

    expect(template.ok).toBe(true);
    if (!template.ok) return;
    const files = template.value.tree.files;
    expect(files.has("App.tsx" as never)).toBe(false);
    expect(files.has("index.tsx" as never)).toBe(false);
    expect(files.has("styles.css" as never)).toBe(false);
    expect(files.get("index.html" as never)).toContain('src="/src/index.tsx"');
    expect(files.get("src/index.tsx" as never)).toContain('import "./styles.css"');
    expect(files.get("src/index.tsx" as never)).toContain('import App from "./App"');
    expect(files.get("src/App.tsx" as never)).toContain("export default function App");
    expect(files.get("src/styles.css" as never)).toContain("body");
  });

  it("normalizes vite react javascript templates to a single src entrypoint", () => {
    const template = new SandpackTemplateCatalog().load("vite-react");

    expect(template.ok).toBe(true);
    if (!template.ok) return;
    const files = template.value.tree.files;
    expect(files.has("App.jsx" as never)).toBe(false);
    expect(files.has("index.jsx" as never)).toBe(false);
    expect(files.has("styles.css" as never)).toBe(false);
    expect(files.get("index.html" as never)).toContain('src="/src/index.jsx"');
    expect(files.get("src/index.jsx" as never)).toContain('import "./styles.css"');
    expect(files.get("src/index.jsx" as never)).toContain('import App from "./App"');
    expect(files.get("src/App.jsx" as never)).toContain("export default function App");
    expect(files.get("src/styles.css" as never)).toContain("body");
  });
});
