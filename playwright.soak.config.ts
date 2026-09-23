import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The long-session soak, and nothing else.
 *
 * Its own build, in the system's temporary directory, served by `vite
 * preview` on a port of its own. The suite runs against the dev server, which
 * reloads the page whenever a file changes; hours of measurement cannot be
 * thrown away by somebody saving a file, and the suite on 1420 must stay free
 * to run beside it.
 */
const BUILT = join(tmpdir(), "openradar-soak-dist");
const PORT = 4174;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /soak\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/New_York",
    serviceWorkers: "block",
  },
  webServer: {
    command: `npx vite build --outDir "${BUILT}" --emptyOutDir && npx vite preview --outDir "${BUILT}" --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
