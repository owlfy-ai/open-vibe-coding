/**
 * Detects whether the project's `package.json` would crash Sandpack at render
 * time.
 *
 * Sandpack's `addPackageJSONIfNeeded` runs `JSON.parse(packageJsonFile.code)`
 * while `SandpackProvider` renders. A single syntax error there throws during
 * render and — without an error boundary — unmounts the whole app. We mirror
 * that parse up front so the workspace can show a clear, localized error
 * instead of ever mounting the crashing provider.
 *
 * @returns a human-readable error string (including the engine's line/column
 *          detail when available), or `null` when `package.json` is valid or
 *          absent (absent is fine — Sandpack derives one from the template).
 */
export function findPackageJsonError(
  files: Readonly<Record<string, string>>,
): string | null {
  const code = files["package.json"] ?? files["/package.json"];
  if (code === undefined) return null;
  try {
    JSON.parse(code);
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `package.json: ${detail}`;
  }
}
