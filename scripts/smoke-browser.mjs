import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.SMOKE_PORT ?? 4173);
const chrome =
  process.env.CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = `http://127.0.0.1:${port}/?smoke=${Date.now()}`;

const preview = spawn(
  "pnpm",
  ["preview", "--host", "127.0.0.1", "--port", String(port)],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let previewOutput = "";
preview.stdout.on("data", (chunk) => {
  previewOutput += String(chunk);
});
preview.stderr.on("data", (chunk) => {
  previewOutput += String(chunk);
});

try {
  await waitForPreview(preview, url);
  const required = [
    ["Web Vibe Coding"],
    ["What little app should we create today?", "今天想创造什么小应用？"],
    ["Configure an AI provider to start creating", "配置 AI 服务后即可开始创作"],
    ["The creation appears here live", "作品会实时显示在这里"],
  ];
  const dom = await dumpDom(url, chrome);
  const missing = required
    .filter((alternatives) => alternatives.every((text) => !dom.includes(text)))
    .map((alternatives) => alternatives.join(" / "));
  if (missing.length > 0) {
    throw new Error(`Browser smoke missing UI text: ${missing.join(", ")}`);
  }
  console.log("Browser smoke passed.");
} finally {
  preview.kill("SIGTERM");
}

function waitForPreview(child, targetUrl) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(interval);
      fn(value);
    };
    const timeout = setTimeout(
      () => finish(reject, new Error(`Timed out waiting for Vite preview:\n${previewOutput}`)),
      10_000,
    );
    const interval = setInterval(() => {
      fetch(targetUrl, { cache: "no-store" }).then(
        (response) => {
          if (response.ok) finish(resolve);
        },
        () => undefined,
      );
    }, 250);
    child.on("exit", (code) => {
      finish(reject, new Error(`Vite preview exited early with code ${code}:\n${previewOutput}`));
    });
  });
}

function dumpDom(targetUrl, chromePath) {
  return new Promise((resolve, reject) => {
    let output = "";
    let error = "";
    let settled = false;
    const profile = mkdtempSync(join(tmpdir(), "web-vibe-coding-chrome-smoke-"));
    const child = spawn(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-cache",
      `--user-data-dir=${profile}`,
      "--virtual-time-budget=8000",
      "--dump-dom",
      targetUrl,
    ]);
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      done(reject, new Error(`Chrome timed out. stderr:\n${error}`));
    }, 20_000);
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      fn(value);
    };
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("</html>")) {
        done(resolve, output);
      }
    });
    child.stderr.on("data", (chunk) => {
      error += String(chunk);
    });
    child.on("error", (err) => done(reject, err));
    child.on("exit", (code) => {
      if (code === 0) done(resolve, output);
      else done(reject, new Error(`Chrome exited ${code}: ${error}`));
    });
  });
}
