import { describe, expect, it } from "vitest";
import { PREVIEW_SOURCE_ATTR, instrumentPreviewSources } from "./source-instrumentation";

describe("instrumentPreviewSources", () => {
  it("does not treat JSX arrow functions as opening tag endings", () => {
    const code = [
      "export function App() {",
      "  return (",
      "    <button",
      "      className=\"nav-toggle\"",
      "      onClick={() => setMenuOpen(!menuOpen)}",
      "      aria-label=\"Toggle menu\"",
      "    >",
      "      Menu",
      "    </button>",
      "  );",
      "}",
    ].join("\n");

    const result = instrumentPreviewSources({ "/src/App.tsx": { code } });
    const instrumented = result.files["/src/App.tsx"].code;

    expect(instrumented).toContain("onClick={() => setMenuOpen(!menuOpen)}");
    expect(instrumented).toMatch(new RegExp(`${PREVIEW_SOURCE_ATTR}="kvc-[^"]+">`));
    expect(instrumented).not.toContain(`onClick={() = ${PREVIEW_SOURCE_ATTR}`);
  });

  it("does not treat TypeScript generic type arguments as JSX tags", () => {
    const code = [
      "type CarImage = { url: string };",
      "export default function CarSearch() {",
      "  const [activeCategory, setActiveCategory] = useState<string>('all');",
      "  const [images, setImages] = useState<CarImage[]>([]);",
      "  const [selectedImage, setSelectedImage] = useState<CarImage | null>(null);",
      "  return <div>{images.length}</div>;",
      "}",
    ].join("\n");

    const result = instrumentPreviewSources({ "/src/components/CarSearch.tsx": { code } });
    const instrumented = result.files["/src/components/CarSearch.tsx"].code;

    expect(instrumented).toContain("useState<string>('all')");
    expect(instrumented).toContain("useState<CarImage[]>([])");
    expect(instrumented).toContain("useState<CarImage | null>(null)");
    expect(instrumented).not.toContain(`string ${PREVIEW_SOURCE_ATTR}`);
    expect(instrumented).not.toContain(`CarImage[] ${PREVIEW_SOURCE_ATTR}`);
    expect(instrumented).not.toContain(`CarImage | null ${PREVIEW_SOURCE_ATTR}`);
    expect(instrumented).toMatch(new RegExp(`<div ${PREVIEW_SOURCE_ATTR}="kvc-[^"]+">`));
  });

  it("records source metadata for instrumented html tags", () => {
    const result = instrumentPreviewSources({
      "/index.html": { code: "<body><main><div class=\"card\">Hello</div></main></body>" },
    });

    const source = Object.values(result.sources).find((entry) => entry.tag === "div");
    expect(source).toMatchObject({
      file: "index.html",
      line: 1,
      tag: "div",
      openingTag: "<div class=\"card\">",
    });
  });
});
