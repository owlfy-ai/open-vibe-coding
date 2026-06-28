import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
const assets = join(dist, "assets");
const html = readFileSync(join(dist, "index.html"), "utf8");
const referencedAssets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => value.startsWith("/assets/"))
  .map((value) => value.replace(/^\//, ""));

const failures = [];
for (const asset of referencedAssets) {
  const path = join(dist, asset);
  try {
    if (!statSync(path).isFile()) failures.push(`${asset} is not a file`);
  } catch {
    failures.push(`${asset} is missing`);
  }
}

const assetFiles = readdirSync(assets);
if (!assetFiles.some((file) => file.startsWith("vendor-") && file.endsWith(".js"))) {
  failures.push("vendor chunk is missing");
}
if (!assetFiles.some((file) => file.startsWith("sandpack-") && file.endsWith(".js"))) {
  failures.push("sandpack chunk is missing");
}
if (!assetFiles.some((file) => file.startsWith("ai-sdk-") && file.endsWith(".js"))) {
  failures.push("ai-sdk chunk is missing");
}

if (!html.includes('<div id="root"></div>')) {
  failures.push("root mount node is missing");
}

if (failures.length > 0) {
  console.error("Dist smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dist smoke passed.");
