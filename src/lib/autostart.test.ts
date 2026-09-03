import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Starting with Windows, and reading back what actually happened.
 *
 * The Run entry is the whole feature: a switch that reports what it asked for
 * rather than what the machine did would tell a reader their places are
 * watched after a reboot when nothing is going to start the app.
 */
const isEnabled = vi.fn<() => Promise<boolean>>();
const enable = vi.fn<() => Promise<void>>();
const disable = vi.fn<() => Promise<void>>();

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: () => isEnabled(),
  enable: () => enable(),
  disable: () => disable(),
}));

const desktop = vi.fn<() => boolean>();

vi.mock("./settings", async () => {
  const real = await vi.importActual<typeof import("./settings")>("./settings");
  return { ...real, isDesktopRuntime: () => desktop() };
});

const { setStartWithMachine, startsWithMachine } = await import("./autostart");

beforeEach(() => {
  desktop.mockReturnValue(true);
  // A fake registry: the entry either exists or it does not, and the two
  // writes are the only things that change it.
  let registered = false;
  isEnabled.mockReset().mockImplementation(() => Promise.resolve(registered));
  enable.mockReset().mockImplementation(() => {
    registered = true;
    return Promise.resolve();
  });
  disable.mockReset().mockImplementation(() => {
    registered = false;
    return Promise.resolve();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the startup entry", () => {
  it("goes on, comes off, and reports the entry each time", async () => {
    expect(await startsWithMachine()).toBe(false);
    expect(await setStartWithMachine(true)).toBe(true);
    expect(await startsWithMachine()).toBe(true);
    expect(await setStartWithMachine(false)).toBe(false);
    expect(await startsWithMachine()).toBe(false);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it("asking for what is already true writes again and stays true", async () => {
    // The plugin's own enable is idempotent, and the switch does not track
    // what it last asked for, so a second press must not come back as off.
    await setStartWithMachine(true);
    expect(await setStartWithMachine(true)).toBe(true);
  });

  it("says off when the machine refuses the write", async () => {
    // A machine that will not take the registry write is a machine where
    // nothing will start the app, which is what the switch has to say.
    enable.mockRejectedValue(new Error("access is denied"));
    expect(await setStartWithMachine(true)).toBe(false);
  });

  it("says it does not know when the read back failed", async () => {
    // The entry may well be there. Nothing here can prove it, and a switch
    // that guesses either way is the failure this whole read-back exists to
    // avoid: reported as off it draws as a working control that does nothing,
    // and the copy written for exactly this case is never shown.
    isEnabled.mockRejectedValue(new Error("the registry could not be read"));
    expect(await setStartWithMachine(true)).toBeNull();
    expect(await startsWithMachine()).toBeNull();
  });

  it("says it does not know in a browser preview, without asking the plugin", async () => {
    desktop.mockReturnValue(false);
    expect(await startsWithMachine()).toBeNull();
    expect(await setStartWithMachine(true)).toBeNull();
    expect(isEnabled).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
  });

  it("tells a missing entry apart from a machine that would not say", async () => {
    // The whole reason for three answers. False is a fact about the registry;
    // null is a fact about this build, and only one of them means the switch
    // can be moved.
    expect(await startsWithMachine()).toBe(false);
    desktop.mockReturnValue(false);
    expect(await startsWithMachine()).toBeNull();
  });
});
