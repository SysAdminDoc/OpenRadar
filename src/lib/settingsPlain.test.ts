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
  resetSettingsRecovery,
  restoreArrangement,
  saveSettings,
  startedPlain,
} = await import("./settings");

/** A workspace with the things a plain start stands down switched on. */
function arranged() {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    camera: { center: [-93.6, 41.6], zoom: 9, bearing: 30, pitch: 45 },
    // Keyed by the directive a theme file writes, which is how the parser
    // takes it.
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
    // The restore deliberately leaves the flag alone, since the page is going
    // away in the app. Nothing goes away between cases here.
    resetSettingsRecovery();
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
    expect(opened.camera).toEqual(DEFAULT_SETTINGS.camera);
    expect(written, "a plain start wrote itself to the file").toEqual([]);
    expect(startedPlain()).not.toBeNull();
    // The theme is NOT taken out. It is the whole document the reader
    // imported, and this value is what goes into the file the moment they
    // change anything at all; it is stood down for the session by the one
    // place that applies it instead. Asserted the other way round for a day,
    // which is the defect: a reader who panned the map lost the file.
    expect(opened.workspaceTheme?.tokens).toEqual({ Accent: "#00ff00" });
  });

  it("keeps the reader's imported theme in the file whatever they change", async () => {
    // The one thing in the arrangement that cannot be set up again from
    // inside the app. The switch positions go into the file with whatever
    // else the reader changes, and the press puts those back; a document they
    // imported has to survive without being asked for.
    const opened = await loadSettings();
    await saveSettings({ ...opened, clock: "utc" });

    expect(written).toHaveLength(1);
    const document = written[0] as unknown as typeof opened;
    expect(document.clock).toBe("utc");
    expect(document.workspaceTheme?.tokens).toEqual({ Accent: "#00ff00" });
  });

  it("puts the arrangement back, then opens the window again on it", async () => {
    // The count first, or the window that comes back is stood down all over
    // again. Then the arrangement, because a plain session that saved
    // anything wrote its own switch positions over the reader's.
    const opened = await loadSettings();
    await saveSettings({ ...opened, clock: "utc" });
    written.length = 0;
    await restoreArrangement();

    expect(asked.indexOf("clear_unclean_starts")).toBeGreaterThan(-1);
    expect(written).toHaveLength(1);
    const document = written[0] as unknown as typeof opened;
    expect(document.occasions.enabled).toBe(true);
    expect(document.ambient).toBe(true);
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("leaves a workspace alone after one start that did not reach a window", async () => {
    // The positive control, and the reason the threshold is two.
    answers.unclean_starts = 1;
    const opened = await loadSettings();
    expect(opened.occasions.enabled).toBe(true);
    expect(opened.camera.zoom).toBe(9);
    expect(startedPlain()).toBeNull();
  });
});
