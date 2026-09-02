import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // MapLibre 6's ESM worker intentionally ships modern syntax. Tauri 2 uses
    // current WebView runtimes, so preserving ES2022 avoids a broken worker
    // downlevel pass while still covering supported desktop engines.
    target: "es2022",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    rollupOptions: {
      // Two pages, not one. The glance window is its own entry so that it
      // carries its own two hundred kilobytes rather than the workspace's
      // two megabytes: a window whose job is one picture and four lines has
      // no business loading MapLibre.
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        glance: fileURLToPath(new URL("glance.html", import.meta.url)),
      },
    },
  },
});
