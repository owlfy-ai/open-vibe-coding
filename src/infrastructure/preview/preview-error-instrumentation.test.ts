import { describe, expect, it } from "vitest";
import {
  PREVIEW_ERROR_BOUNDARY_MARKER,
  PREVIEW_ERROR_BOUNDARY_PATH,
  buildPreviewErrorCaptureScript,
  injectReactErrorBoundary,
  wrapRenderWithErrorBoundary,
} from "./preview-error-instrumentation";

describe("preview error instrumentation", () => {
  it("captures console.error and does not swallow native error events", () => {
    const script = buildPreviewErrorCaptureScript();
    expect(script).toContain("console.error");
    expect(script).toContain("shouldReportConsoleError");
    expect(script).toContain("occurred in the <");
    expect(script).toContain("postMessage");
    expect(script).not.toContain("window.onerror");
    expect(script).not.toContain("preventDefault");
  });

  it("wraps createRoot render trees with the preview error boundary", () => {
    const input = `createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);`;
    const wrapped = wrapRenderWithErrorBoundary(input);
    expect(wrapped).toContain(`<${PREVIEW_ERROR_BOUNDARY_MARKER}>`);
    expect(wrapped).toContain(`</${PREVIEW_ERROR_BOUNDARY_MARKER}>`);
    expect(wrapped).toContain("<App />");
  });

  it("injects a runtime-only boundary file and import into the entry module", () => {
    const result = injectReactErrorBoundary({
      "/src/index.tsx": {
        code: `import App from "./App";
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(<App />);
`,
      },
      "/src/App.tsx": { code: "export default function App(){ return null }" },
    });

    expect(result[PREVIEW_ERROR_BOUNDARY_PATH]?.code).toContain(PREVIEW_ERROR_BOUNDARY_MARKER);
    expect(result["/src/index.tsx"].code).toContain(`import { ${PREVIEW_ERROR_BOUNDARY_MARKER} }`);
    expect(result["/src/index.tsx"].code).toContain(`<${PREVIEW_ERROR_BOUNDARY_MARKER}>`);
    expect(result["/src/App.tsx"].code).toBe("export default function App(){ return null }");
  });

  it("is idempotent when the boundary is already present", () => {
    const once = injectReactErrorBoundary({
      "/src/main.jsx": {
        code: `import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")).render(<App />);
`,
      },
    });
    const twice = injectReactErrorBoundary(once);
    expect(twice["/src/main.jsx"].code).toBe(once["/src/main.jsx"].code);
    expect(twice[PREVIEW_ERROR_BOUNDARY_PATH]?.code).toBe(once[PREVIEW_ERROR_BOUNDARY_PATH]?.code);
  });
});
