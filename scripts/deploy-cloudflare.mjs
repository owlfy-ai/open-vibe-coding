import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const configPath = resolve(root, "wrangler.jsonc");

run("pnpm", ["build"]);

if (!existsSync(resolve(root, "dist", "index.html"))) {
  fail("Build completed, but dist/index.html was not found.");
}

if (!existsSync(configPath)) {
  fail("wrangler.jsonc was not found.");
}

run("pnpm", ["exec", "wrangler", "deploy", "--config", configPath]);

function run(command, args) {
  const printable = [command, ...args].join(" ");
  console.log(`\n$ ${printable}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
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
