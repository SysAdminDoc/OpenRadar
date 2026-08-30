import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "./settings";

const check = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));

afterEach(() => {
  check.mockReset();
  vi.resetModules();
});

async function offer() {
  const { checkForUpdate } = await import("./updates");
  return checkForUpdate();
}

describe("what counts as an update", () => {
  it("offers a build newer than this one", async () => {
    check.mockResolvedValue({
      version: "99.0.0",
      body: "everything is new",
      date: "2026-08-30",
    });
    await expect(offer()).resolves.toMatchObject({ version: "99.0.0" });
  });

  it("offers nothing when there is nothing", async () => {
    check.mockResolvedValue(null);
    await expect(offer()).resolves.toBeNull();
  });

  it("refuses a manifest naming this build or an older one", async () => {
    // Installing either one reinstalls what is already running, and the
    // manifest is a static file on a release page that anyone could get wrong.
    for (const version of [APP_VERSION, "0.0.1"]) {
      check.mockResolvedValue({ version, body: "", date: null });
      await expect(offer()).resolves.toBeNull();
    }
  });
});
