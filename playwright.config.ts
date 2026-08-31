import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    // Fixed so tests that reason about local clock times do not depend on the
    // machine they run on.
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /wide\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // The narrowest window the app allows, where the command bar collapses.
      name: "compact",
      testIgnore: /wide\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 720 },
      },
    },
    {
      // A real wide desktop. The rest of the suite runs at 1440, which is
      // narrow enough that the layout is still being pushed together; this is
      // the width the README screenshots are taken at and the one where dead
      // space and stranded controls would show up instead.
      name: "wide",
      testMatch: /wide\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
