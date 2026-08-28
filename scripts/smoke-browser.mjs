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
    ["Open Vibe Coding", "AI数学思维素养课"],
    ["What little app should we create today?", "今天想创造什么小应用？"],
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
    let error = "";
    let settled = false;
    let inspectionStarted = false;
    const profile = mkdtempSync(join(tmpdir(), "open-vibe-coding-chrome-smoke-"));
    const child = spawn(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-cache",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
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
    child.stderr.on("data", (chunk) => {
      error += String(chunk);
      if (inspectionStarted) return;
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(error);
      if (!match) return;
      inspectionStarted = true;
      setTimeout(() => {
        inspectPageDom(match[1], targetUrl).then(
          (dom) => done(resolve, dom),
          (failure) => done(reject, failure),
        );
      }, 8_000);
    });
    child.on("error", (err) => done(reject, err));
    child.on("exit", (code) => {
      if (!settled) done(reject, new Error(`Chrome exited ${code}: ${error}`));
    });
  });
}

async function inspectPageDom(browserWebSocketUrl, targetUrl) {
  const endpoint = new URL(browserWebSocketUrl);
  const targets = await fetch(`http://${endpoint.host}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page" && target.url.startsWith(targetUrl));
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`Chrome page target not found for ${targetUrl}`);
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out reading browser DOM"));
    }, 5_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const chat = document.querySelector(".ob-chat");
            const header = document.querySelector(".ob-chat-header");
            const title = document.querySelector(".ob-chat-header strong");
            if (chat && header && title) {
              title.textContent = "html <!DOCTYPE html> <html lang=zh-CN> <head>".repeat(40);
              const chatRect = chat.getBoundingClientRect();
              const headerRect = header.getBoundingClientRect();
              const titleRect = title.getBoundingClientRect();
              if (headerRect.width > chatRect.width + 1 || titleRect.right > chatRect.right + 1) {
                throw new Error("Long conversation title overflowed the chat column");
              }
            }
            return document.documentElement.outerHTML;
          })()`,
          returnByValue: true,
        },
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      const value = message.result?.result?.value;
      if (typeof value === "string") resolve(value);
      else reject(new Error(`Failed reading browser DOM: ${JSON.stringify(message)}`));
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Chrome DevTools WebSocket failed"));
    });
  });
}
