import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The desktop's own load, which nothing else in the suite drives.
 *
 * Every other settings case runs as the browser preview, where the store is a
 * localStorage key and none of the native answers exist. The rules this file
 * is about are all on the other side of that line: what the count of
 * unfinished starts does to the workspace, and what a save writes while the
 * arrangement is stood down. Its own file because the mocks are module-wide.
 */
const answers: Record<string, unknown> = {
  unclean_starts: 2,
  settings_recovered: null,
  settings_keep_previous: true,
  clear_unclean_starts: null,
  workspace_drawn: null,
};
const asked: string[] = [];
const held: { settings: Record<string, unknown> | null } = { settings: null };
const written: Array<Record<string, unknown>> = [];

vi.mock("./runtime", () => ({
  isDesktopRuntime: () => true,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string) => {
    asked.push(command);
    if (command in answers) return Promise.resolve(answers[command]);
    return Promise.reject(new Error(`no answer for ${command}`));
  },
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: () => {
      asked.push("store opened");
      return Promise.resolve({
        get: () => Promise.resolve(held.settings),
        set: (_key: string, value: Record<string, unknown>) => {
          written.push(value);
          return Promise.resolve();
        },
        save: () => Promise.resolve(),
      });
    },
  },
}));

const {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  restoreArrangement,
  saveSettings,
  startedPlain,
} = await import("./settings");

/** A workspace with the things a plain start stands down switched on. */
function arranged() {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    camera: { center: [-93.6, 41.6], zoom: 9, bearing: 30, pitch: 45 },
    workspaceTheme: {
      name: "mine",
      base: "dark",
      tokens: { Accent: "#00ff00" },
    },
    occasions: { enabled: true, declined: {}, seen: {} },
    ambient: true,
    unitsChosen: true,
  }) as unknown as Record<string, unknown>;
}

describe("a desktop launch after two starts that did not reach a window", () => {
  beforeEach(() => {
    asked.length = 0;
    written.length = 0;
    answers.unclean_starts = 2;
    held.settings = arranged();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { search: "", reload: vi.fn() },
    });
  });

  it("asks what it will find before it opens the store", async () => {
    // First in the file on purpose: the store is opened once for the life of
    // the module, so a later case would see nothing and pass on an empty
    // list. Asking is what runs the recovery, and this order is the whole of
    // what keeps it ahead of the store's own read. Left to the setup hook it
    // was ahead only because the frontend's first message happens to arrive
    // on a later turn of the event loop.
    await loadSettings();
    expect(asked.slice(0, 2)).toEqual(["settings_recovered", "store opened"]);
  });

  it("opens plain without writing anything", async () => {
    const opened = await loadSettings();
    expect(opened.occasions.enabled).toBe(false);
    expect(opened.ambient).toBe(false);
    expect(opened.workspaceTheme).toBeNull();
    expect(opened.camera).toEqual(DEFAULT_SETTINGS.camera);
    expect(written, "a plain start wrote itself to the file").toEqual([]);
    expect(startedPlain()).not.toBeNull();
  });

  it("keeps the reader's arrangement in the file when they change something", async () => {
    // The moment they touch anything, the plain version would go into the
    // file. A theme is not a switch: it is the whole document they imported,
    // and one pan of the map would have written it away for good, with the
    // toast that offers to put it back already gone.
    const opened = await loadSettings();
    await saveSettings({ ...opened, clock: "utc" });

    expect(written).toHaveLength(1);
    const document = written[0] as unknown as typeof opened;
    // What they changed is written.
    expect(document.clock).toBe("utc");
    // What they never asked to change is theirs.
    expect(document.workspaceTheme).not.toBeNull();
    expect(document.workspaceTheme?.tokens).toEqual({ Accent: "#00ff00" });
    expect(document.occasions.enabled).toBe(true);
    expect(document.ambient).toBe(true);
  });

  it("puts it back by opening the window again on the file, and writes nothing", async () => {
    // The file still holds the arrangement, so opening on it is the whole of
    // putting it back. Writing it first discarded the state needed to try
    // again if the write failed, which is exactly the case the settings copy
    // beside it exists for.
    await loadSettings();
    await restoreArrangement();

    expect(asked).toContain("clear_unclean_starts");
    expect(written, "the restore wrote the file it was reading").toEqual([]);
    expect(window.location.reload).toHaveBeenCalled();
    expect(startedPlain()).toBeNull();
  });

  it("leaves a workspace alone after one start that did not reach a window", async () => {
    // The positive control, and the reason the threshold is two.
    answers.unclean_starts = 1;
    const opened = await loadSettings();
    expect(opened.occasions.enabled).toBe(true);
    expect(opened.workspaceTheme).not.toBeNull();
    expect(startedPlain()).toBeNull();
  });
});
