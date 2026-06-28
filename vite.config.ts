import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => {
  return {
    base: process.env.VITE_BASE_PATH ?? "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("@codesandbox/sandpack")) return "sandpack";
            if (id.includes("@ai-sdk") || id.includes("/ai/")) return "ai-sdk";
            if (id.includes("jszip") || id.includes("file-saver")) return "archive";
            if (id.includes("@tauri-apps")) return "tauri";
            // CodeMirror is only used by the broken-state fallback editor (lazy
            // loaded). Let it ride in that dynamic chunk instead of the upfront
            // vendor chunk, so normal loads don't pay for it.
            if (id.includes("@codemirror") || id.includes("@lezer")) return undefined;
            return "vendor";
          },
        },
      },
    },
    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 5174,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 5174,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
  };
});
