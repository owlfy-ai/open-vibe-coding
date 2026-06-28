import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src", "presentation");
const maxLines = 500;
const failures = [];

function visit(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      visit(path);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/).length;
    if (lines > maxLines) {
      failures.push(`${path.replace(process.cwd() + "/", "")}: ${lines} lines exceeds ${maxLines}`);
    }
  }
}

visit(root);

if (failures.length > 0) {
  console.error("Presentation complexity budget exceeded:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Presentation complexity budget passed.");
