import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "vite";

const root = resolve(import.meta.dirname, "..");
const configPath = resolve(root, "wrangler.jsonc");
const buildEnv = {
  ...process.env,
  ...loadEnv("production", root, "VITE_"),
};

if (!buildEnv.VITE_CLERK_PUBLISHABLE_KEY?.trim()) {
  fail("VITE_CLERK_PUBLISHABLE_KEY is required for the production build.");
}

run("pnpm", ["build"], buildEnv);

if (!existsSync(resolve(root, "dist", "index.html"))) {
  fail("Build completed, but dist/index.html was not found.");
}

if (!existsSync(configPath)) {
  fail("wrangler.jsonc was not found.");
}

run("pnpm", ["exec", "wrangler", "deploy", "--config", configPath]);

function run(command, args, env = process.env) {
  const printable = [command, ...args].join(" ");
  console.log(`\n$ ${printable}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`${printable} failed with exit code ${result.status ?? "unknown"}.`);
}

function fail(message) {
  console.error(`\nCloudflare deploy failed: ${message}`);
  process.exit(1);
}
