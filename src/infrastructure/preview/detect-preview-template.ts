import type { SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";

type PreviewFileMap = Readonly<Record<string, { readonly code: string } | string>>;
type MutablePreviewFiles = Record<string, { code: string }>;

const BUNDLER_CONFIG_RE = /(^|\/)vite\.config\.(js|ts|mjs|cjs)$|(^|\/)webpack\.config\.(js|ts)$|(^|\/)parcel\.config/i;
const REACT_ENTRY_RE =
  /(^|\/)src\/(index|main)\.(tsx|jsx)$|(^|\/)src\/App\.(tsx|jsx)$|(^|\/)App\.(tsx|jsx)$|(^|\/)(index|main)\.(tsx|jsx)$/;
const VANILLA_ENTRY_RE =
  /(^|\/)src\/(index|main)\.(js|ts|mjs)$|(^|\/)(index|main)\.(js|ts|mjs)$/;
const FRAMEWORK_DEP_RE = /^(react|react-dom|vue|svelte|solid-js|preact|next|@angular\/core)$/;
const HTML_REACT_MODULE_RE =
  /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["'][^"']*\.(tsx|jsx)["'][^>]*>/i;
const HTML_REACT_MODULE_RE_ALT =
  /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\.(tsx|jsx)["'][^>]*\btype\s*=\s*["']module["'][^>]*>/i;
const HTML_JS_MODULE_RE =
  /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+\.(?:js|ts|mjs))["'][^>]*>/i;
const HTML_JS_MODULE_RE_ALT =
  /<script\b[^>]*\bsrc\s*=\s*["']([^"']+\.(?:js|ts|mjs))["'][^>]*\btype\s*=\s*["']module["'][^>]*>/i;

export type PreviewProjectKind = "static" | "vite-vanilla" | "framework";

/**
 * Pick the Sandpack template that can actually render the current files.
 *
 * Historical sessions often keep a wrong persisted template (static / vite-react-ts)
 * plus leftover React starter files, even after the agent rewrote index.html to a
 * plain JS entry. index.html's module entry is the source of truth.
 */
export function resolvePreviewTemplate(
  files: PreviewFileMap,
  preferred: string,
): SandpackPredefinedTemplate {
  const kind = classifyPreviewProject(files);

  if (kind === "static") return "static";

  if (kind === "vite-vanilla") {
    if (preferred === "vanilla" || preferred === "vanilla-ts") return preferred;
    return "vite";
  }

  if (isKnownTemplate(preferred)) return preferred;
  return "vite-react-ts";
}

export function classifyPreviewProject(files: PreviewFileMap): PreviewProjectKind {
  const html = readFile(files, "index.html");
  const paths = Object.keys(files).map(normalizePath);
  const moduleEntry = html ? readHtmlModuleEntry(html) : null;

  // What index.html actually boots wins over leftover React debris / sticky templates.
  if (moduleEntry && isPlainJsModuleEntry(moduleEntry)) {
    return "vite-vanilla";
  }
  if (html && (HTML_REACT_MODULE_RE.test(html) || HTML_REACT_MODULE_RE_ALT.test(html))) {
    return "framework";
  }

  const pkg = readPackageJson(files);
  const deps = packageDeps(pkg);
  if (Object.keys(deps).some((name) => FRAMEWORK_DEP_RE.test(name))) return "framework";
  if (paths.some((path) => REACT_ENTRY_RE.test(path))) return "framework";

  const hasVanillaEntry =
    Boolean(moduleEntry) ||
    paths.some((path) => VANILLA_ENTRY_RE.test(path));

  if (hasVanillaEntry) return "vite-vanilla";

  if (html && indexHtmlIsSelfContainedStatic(html)) {
    if (paths.some((path) => BUNDLER_CONFIG_RE.test(path))) return "vite-vanilla";
    return "static";
  }

  if (html) return "vite-vanilla";
  return "framework";
}

export function looksLikeStaticHtmlProject(files: PreviewFileMap): boolean {
  return classifyPreviewProject(files) === "static";
}

/** True when index.html is a plain document (no JS/TS module entry). */
export function indexHtmlIsSelfContainedStatic(html: string): boolean {
  if (readHtmlModuleEntry(html)) return false;
  if (HTML_REACT_MODULE_RE.test(html) || HTML_REACT_MODULE_RE_ALT.test(html)) return false;
  if (/\bcreateRoot\b|\bReactDOM\b|\bfrom\s+["']react["']/.test(html)) return false;
  return true;
}

/**
 * True when the saved package.json cannot boot the Sandpack vite template
 * (typical agent stub: `{"dependencies":{},"main":"/index.js"}`).
 */
export function needsVitePackageRepair(files: PreviewFileMap): boolean {
  const pkg = readPackageJson(files);
  if (!pkg) return true;
  const deps = packageDeps(pkg);
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  const hasVite = deps.vite !== undefined;
  const hasDevScript = typeof scripts.dev === "string" && scripts.dev.trim().length > 0;
  const main = typeof pkg.main === "string" ? pkg.main : "";
  const stubMain = main === "/index.js" || main === "index.js";
  return !hasVite || !hasDevScript || stubMain;
}

/**
 * Agents often leave a stub package.json (`{dependencies:{}, main:"/index.js"}`)
 * that overlays the Sandpack template and strips Vite. The Sandpack `vite`
 * template also ships a default `/index.js` that renders "Hello world" and keeps
 * `main: "/index.js"` even when the project entry is `/src/main.js`.
 *
 * Re-inject Vite tooling and bridge `/index.js` → the real app entry so preview
 * cannot fall back to the template Hello world demo.
 */
export function enrichPreviewFilesForTemplate(
  files: Readonly<Record<string, { readonly code: string }>>,
  template: SandpackPredefinedTemplate,
): Record<string, { code: string }> {
  // This repair rewrites package.json for a framework-free Vite project. It
  // must not run for vite-react / vite-vue / other framework templates because
  // their Vite configs require the framework plugins that the repair removes.
  if (template !== "vite") {
    return normalizeFileMap(files);
  }

  const next = normalizeFileMap(files);
  const appEntry = resolveViteAppEntry(next);

  if (appEntry && appEntry !== "/index.js") {
    // Sandpack vite template always treats `/index.js` as main. Point it at the
    // real entry so a missed index.html override still boots the user app.
    next["/index.js"] = { code: `import ${JSON.stringify(`.${appEntry}`)};\n` };
  }

  // Always re-assert the HTML entry for vite-vanilla so template defaults cannot win.
  if (appEntry && isPlainJsModuleEntry(appEntry)) {
    const existingHtml = next["/index.html"]?.code;
    if (!existingHtml || !existingHtml.includes(appEntry)) {
      next["/index.html"] = {
        code: existingHtml && existingHtml.includes("id=\"app\"")
          ? ensureHtmlModuleScript(existingHtml, appEntry)
          : buildIndexHtml(appEntry),
      };
    } else {
      next["/index.html"] = { code: ensureHtmlModuleScript(existingHtml, appEntry) };
    }
  } else if (!next["/index.html"] && appEntry) {
    next["/index.html"] = { code: buildIndexHtml(appEntry) };
  }

  // Drop root template CSS when the app uses src/styles.css — avoids dual styles.
  if (next["/src/styles.css"] && !filesHavePath(files, "styles.css")) {
    delete next["/styles.css"];
  }

  next["/package.json"] = { code: buildVitePackageJson(readPackageJson(next)) };
  return next;
}

/** Package.json text that can boot a plain Vite preview. */
export function buildVitePackageJson(existing: Record<string, unknown> | null): string {
  const base = existing ?? {};
  const dependencies = isRecord(base.dependencies) ? { ...base.dependencies } : {};
  const devDependencies = isRecord(base.devDependencies) ? { ...base.devDependencies } : {};
  const scripts = isRecord(base.scripts) ? { ...base.scripts } : {};

  // Historical rewrite projects often keep react in package.json while index.html
  // already boots plain JS. Those deps force the wrong Sandpack template path.
  for (const name of Object.keys(dependencies)) {
    if (FRAMEWORK_DEP_RE.test(name)) delete dependencies[name];
  }
  for (const name of Object.keys(devDependencies)) {
    if (FRAMEWORK_DEP_RE.test(name) || name.startsWith("@types/react") || name === "@vitejs/plugin-react") {
      delete devDependencies[name];
    }
  }

  if (typeof scripts.dev !== "string" || !scripts.dev.trim()) scripts.dev = "vite";
  if (typeof scripts.build !== "string") scripts.build = "vite build";
  if (typeof scripts.preview !== "string") scripts.preview = "vite preview";
  if (dependencies.vite === undefined && devDependencies.vite === undefined) {
    devDependencies.vite = "4.2.0";
  }
  if (devDependencies["esbuild-wasm"] === undefined && dependencies["esbuild-wasm"] === undefined) {
    devDependencies["esbuild-wasm"] = "0.17.12";
  }

  const main = typeof base.main === "string" ? base.main : undefined;
  const nextMain = !main || main === "/index.js" || main === "index.js"
    ? "/index.html"
    : main;

  return `${JSON.stringify(
    {
      ...base,
      main: nextMain,
      scripts,
      dependencies,
      devDependencies,
    },
    null,
    2,
  )}\n`;
}

/** Real app module for vite-vanilla projects (e.g. /src/main.js). */
export function resolveViteAppEntry(
  files: PreviewFileMap,
): string | null {
  const html = readFile(files, "index.html");
  const fromHtml = html ? readHtmlModuleEntry(html) : null;
  if (fromHtml) {
    return fromHtml.startsWith("/") ? fromHtml : `/${fromHtml}`;
  }
  for (const candidate of ["/src/main.js", "/src/main.ts", "/src/index.js", "/src/index.ts", "/main.js"]) {
    if (readFile(files, candidate.slice(1)) !== null) return candidate;
  }
  if (readFile(files, "index.js") !== null) return "/index.js";
  return null;
}

function buildIndexHtml(appEntry: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "  <title>Preview</title>",
    "</head>",
    "<body>",
    '  <div id="app"></div>',
    `  <script type="module" src="${appEntry}"></script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function ensureHtmlModuleScript(html: string, appEntry: string): string {
  if (html.includes(`src="${appEntry}"`) || html.includes(`src='${appEntry}'`)) return html;
  if (/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/i.test(html)) {
    return html
      .replace(HTML_JS_MODULE_RE, `<script type="module" src="${appEntry}">`)
      .replace(HTML_JS_MODULE_RE_ALT, `<script type="module" src="${appEntry}">`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `  <script type="module" src="${appEntry}"></script>\n</body>`);
  }
  return `${html}\n<script type="module" src="${appEntry}"></script>\n`;
}

function isPlainJsModuleEntry(entry: string): boolean {
  return /\.(js|ts|mjs)$/i.test(entry) && !/\.(tsx|jsx)$/i.test(entry);
}

function normalizeFileMap(
  files: Readonly<Record<string, { readonly code: string }>>,
): MutablePreviewFiles {
  return Object.fromEntries(
    Object.entries(files).map(([path, file]) => [
      path.startsWith("/") ? path : `/${path}`,
      { code: file.code },
    ]),
  );
}

function filesHavePath(files: PreviewFileMap, path: string): boolean {
  return readFile(files, path) !== null;
}

function readHtmlModuleEntry(html: string): string | null {
  const match = html.match(HTML_JS_MODULE_RE) ?? html.match(HTML_JS_MODULE_RE_ALT);
  return match?.[1] ?? null;
}

function packageDeps(pkg: Record<string, unknown> | null): Record<string, unknown> {
  if (!pkg) return {};
  return {
    ...(isRecord(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isRecord(pkg.devDependencies) ? pkg.devDependencies : {}),
  };
}

function readFile(files: PreviewFileMap, path: string): string | null {
  const raw = files[path] ?? files[`/${path}`];
  if (raw === undefined) return null;
  return typeof raw === "string" ? raw : raw.code;
}

function readPackageJson(files: PreviewFileMap): Record<string, unknown> | null {
  const code = readFile(files, "package.json");
  if (code === null) return null;
  try {
    const parsed: unknown = JSON.parse(code);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const KNOWN_TEMPLATES = new Set<string>([
  "static",
  "angular",
  "react",
  "react-ts",
  "solid",
  "svelte",
  "test-ts",
  "vanilla",
  "vanilla-ts",
  "vue",
  "vue-ts",
  "node",
  "nextjs",
  "vite",
  "vite-react",
  "vite-react-ts",
  "vite-preact",
  "vite-preact-ts",
  "vite-vue",
  "vite-vue-ts",
  "vite-svelte",
  "vite-svelte-ts",
  "astro",
]);

function isKnownTemplate(name: string): name is SandpackPredefinedTemplate {
  return KNOWN_TEMPLATES.has(name);
}
