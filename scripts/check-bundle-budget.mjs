import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const assetsDir = join(process.cwd(), "dist", "assets");
const budgets = {
  ".js": 430 * 1024,
  ".css": 20 * 1024,
};

const failures = [];
for (const file of readdirSync(assetsDir)) {
  const ext = file.endsWith(".js") ? ".js" : file.endsWith(".css") ? ".css" : null;
  if (!ext) continue;
  const path = join(assetsDir, file);
  if (!statSync(path).isFile()) continue;
  const gzipBytes = gzipSync(readFileSync(path)).byteLength;
  if (gzipBytes > budgets[ext]) {
    failures.push(
      `${file}: ${(gzipBytes / 1024).toFixed(1)} KiB gzip exceeds ${(budgets[ext] / 1024).toFixed(1)} KiB`,
    );
  }
}

if (failures.length > 0) {
  console.error("Bundle budget exceeded:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Bundle budget passed.");
