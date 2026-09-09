/**
 * Where the settings live between runs, and what happens when the store
 * will not answer or answers with something that will not parse.
 */
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { isDesktopRuntime } from "../runtime";
import { DEFAULT_SETTINGS } from "./defaults";
import { normalizeSettings } from "./normalize";
import type { AppSettings } from "./types";

const STORAGE_KEY = "openradar.settings";

/**
 * The copy taken before each write, and where an unreadable one is kept.
 *
 * Only the browser preview uses these. The desktop build keeps its three
 * files in app data, where the native side can put one back before the store
 * has ever been asked for anything; here the store is one key in
 * `localStorage` and a second key beside it is all the same idea needs.
 */
const PREVIOUS_KEY = "openradar.settings.previous";
const KEPT_KEY = "openradar.settings.unreadable";

let storePromise: Promise<Store> | null = null;
let storeWriteQueue: Promise<void> = Promise.resolve();

/** A settings document that would not parse, and what was done about it. */
export interface SettingsRecovery {
  /** Where the unreadable document was kept, so a reader can go and look. */
  keptAt: string;
  /** Whether the last good copy went back in its place. */
  restored: boolean;
  /**
   * Whether the unreadable document is still where it was, because nothing
   * could move it. Every launch from here on ends the same way until the
   * reader closes whatever has it open.
   */
  stuck: boolean;
}

let recovery: SettingsRecovery | null = null;

/**
 * What the last load had to recover from, for the workspace to say out loud.
 *
 * Read after the settings are in hand, not before: on the desktop it is the
 * native side that answers, and the answer arrives with the load.
 */
export function settingsRecovery(): SettingsRecovery | null {
  return recovery;
}

/** Forgets the last recovery, so a test does not carry one between cases. */
export function resetSettingsRecovery(): void {
  recovery = null;
  plainFrom = null;
}

/**
 * What was stored, when this launch was made plain because the last two did
 * not finish. Null on every ordinary launch.
 */
let plainFrom: AppSettings | null = null;

/**
 * The arrangement this launch is not using, for the one press that puts it
 * back.
 *
 * Held rather than re-read, because reading it again would mean opening a file
 * that may be what wedged the window. Nothing is written on a plain start, but
 * the moment the reader changes any setting the plain switch positions go into
 * the file with it, which is what the press writes back.
 */
export function startedPlain(): AppSettings | null {
  return plainFrom;
}

/**
 * Says this window is running plain, for a test that has to drive the state
 * the load reaches only through the native side.
 */
export function standDownArrangement(stored: AppSettings): void {
  plainFrom = stored;
}

/**
 * The workspace saying it is up.
 *
 * What is being counted is a start that never reached a window, so this is
 * where a start stops counting. Not the exit: this app closes to the tray and
 * is meant to be left open for days, so it is normally still running when the
 * machine restarts, and counting on the exit would have stood the arrangement
 * down for a reader whose arrangement was never the problem.
 */
export async function noteWorkspaceDrawn(): Promise<void> {
  if (!isDesktopRuntime()) return;
  await invoke("workspace_drawn").catch(() => undefined);
}

/**
 * The one press that puts the arrangement back.
 *
 * Written and then reloaded, the same as the crash screen's Reset layout,
 * because a theme, a colour table and a saved view are all applied as the
 * window opens: putting them back into the settings this window is already
 * running on would leave the map where it is and the chrome as it was.
 *
 * The count goes first, or the window that comes back is stood down again.
 * The write is second and it is only about the switches: a plain session that
 * saved anything wrote its own positions over the reader's. The theme is
 * never in that write, because it is never taken out of the file.
 */
export async function restoreArrangement(): Promise<void> {
  const stored = plainFrom;
  if (stored) {
    // What the reader has done since is theirs. The switches are what a plain
    // start stood down and what a save during it wrote over; the theme was
    // never taken out of the file, and the camera and anything else they
    // changed in this window is where they left it.
    const now = await readSettings().catch(() => null);
    const written = await saveSettings(
      now
        ? { ...stored, workspaceTheme: now.workspaceTheme, camera: now.camera }
        : stored,
    ).then(
      () => true,
      () => false,
    );
    // Only then is the count cleared. Cleared first, a write that failed left
    // the reader in a window that looks ordinary, running on the plain
    // settings, with no toast and no way to ask again; leaving the count
    // means the next window opens plain and offers them the press again.
    if (!written) return;
  }
  if (isDesktopRuntime()) {
    await invoke("clear_unclean_starts").catch(() => undefined);
  }
  // `plainFrom` is left where it is. The page is going away, and nothing
  // reads it on the way out.
  window.location.reload();
}

async function getStore(): Promise<Store> {
  storePromise ??= Store.load("settings.json", {
    autoSave: false,
    defaults: { settings: DEFAULT_SETTINGS },
  });
  return storePromise;
}

/**
 * Whether a stored document can be read as settings at all.
 *
 * Deliberately weaker than `looksLikeSettings`, which answers a different
 * question: that one decides whether a file somebody dropped on the window is
 * a settings export, and it wants a schema version to tell it apart from
 * GeoJSON. Nothing in the load reads a schema version, so a stored document
 * without one loads perfectly, and treating it as damaged filed a reader's
 * whole workspace away as unreadable and opened on the defaults.
 *
 * An array or a number parses and is not settings: either one loads into a
 * workspace with nothing in it, which is the loss this exists to stop. The
 * native side answers the same question the same way.
 */
function readableSettings(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    // And it has to hold something a settings file holds. An object on its
    // own is too weak: `{}` and a GeoJSON collection both pass that, both
    // load as a workspace with nothing in it, and the next save would copy
    // either of them forward as the last good one, destroying the real copy.
    return SETTINGS_KEYS.some((key) => key in parsed);
  } catch {
    return false;
  }
}

/**
 * Keys that say a document is a settings file rather than something else.
 *
 * Any one of them is enough. A file from an older build has fewer of these
 * than a file from this one, and refusing it for a key it never carried would
 * be the same loss by a different name.
 */
const SETTINGS_KEYS = [
  "schemaVersion",
  "layers",
  "radar",
  "camera",
  "watch",
  "watchPlaces",
  "theme",
  "language",
] as const;

/**
 * Whether a dropped file is a settings export rather than something to draw.
 *
 * A GeoJSON document never carries a schema version, and a settings file
 * always does, so the two cannot be confused for one another.
 */
export function looksLikeSettings(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return false;
    const record = parsed as Record<string, unknown>;
    return (
      typeof record.schemaVersion === "number" &&
      record.type !== "FeatureCollection" &&
      record.type !== "Feature"
    );
  } catch {
    return false;
  }
}

/**
 * The workspace put back the way it opens, and nothing else touched.
 *
 * For a reader whose window will not draw. What can wedge it is the
 * arrangement: a camera somewhere the projection cannot show, a text scale
 * nothing fits at, a colour a theme was given by hand, an overlay order left
 * over from a file that is no longer loaded. What must survive is everything
 * they would have to set up again: the places they watch, the colour tables
 * they loaded, the offline packs they downloaded, the layers they chose.
 *
 * Named fields rather than a spread of the defaults, so a setting added later
 * is kept by default. Losing somebody's watched place because a new field was
 * not thought about is the failure this is guarding against.
 */
/**
 * How many starts in a row must fail before the workspace opens plain.
 *
 * One is a power cut, a killed process, or somebody closing the laptop lid on
 * a machine that then hibernated badly. Standing the workspace down for that
 * would be its own annoyance, and it would happen to readers whose
 * arrangement is perfectly fine.
 */
export const PLAIN_AFTER_UNCLEAN_STARTS = 2;

/**
 * The workspace opened plain, for a window that will not draw twice running.
 *
 * `resetLayout` is the arrangement, which is most of what can wedge a window,
 * and this is that plus the three things a reader imported that reach the
 * chrome and the colours. Switches only: the theme file, the colour tables
 * and the packs are all still in the settings, so this costs one press to
 * undo and nothing at all to keep.
 */
export function plainStart(settings: AppSettings): AppSettings {
  return {
    ...resetLayout(settings),
    // The theme goes back in. `resetLayout` drops it, and a theme is not a
    // switch: it is the whole document the reader imported, and this value is
    // what the workspace writes to the file the moment anything else is
    // saved. It is stood down for the session instead, by the one place that
    // applies it, which leaves nothing to put back and nothing to lose.
    workspaceTheme: settings.workspaceTheme,
    // The look, which is where a file the reader was given reaches the chrome.
    occasions: { ...settings.occasions, enabled: false },
    ambient: false,
    // An imported colour table applied to a product. The tables themselves
    // stay: this is which product each is drawn with.
    paletteAssignments: {},
  };
}

export function resetLayout(settings: AppSettings): AppSettings {
  return {
    ...settings,
    camera: DEFAULT_SETTINGS.camera,
    projection: DEFAULT_SETTINGS.projection,
    mapStyle: DEFAULT_SETTINGS.mapStyle,
    textScale: DEFAULT_SETTINGS.textScale,
    workspaceTheme: DEFAULT_SETTINGS.workspaceTheme,
    overlayOrder: DEFAULT_SETTINGS.overlayOrder,
    overlayOpacity: DEFAULT_SETTINGS.overlayOpacity,
  };
}

export async function loadSettings(): Promise<AppSettings> {
  let settings: AppSettings;
  try {
    settings = await readSettings();
  } catch {
    settings = normalizeSettings(undefined);
  }
  if (isDesktopRuntime()) {
    // Something the reader imported can take the window down before there is
    // a window, and the crash screen's Reset layout is reachable only once
    // the page has drawn. Two starts that did not reach a window is the app
    // deciding for itself that it cannot be the one to ask.
    //
    const unclean = await invoke<number>("unclean_starts").catch(() => 0);
    if (unclean >= PLAIN_AFTER_UNCLEAN_STARTS) {
      plainFrom = settings;
      return plainStart(settings);
    }
  }
  return settings;
}

/**
 * The settings as stored, with a read failure raised rather than swallowed.
 *
 * `loadSettings` answers with the defaults when it cannot read, which is what
 * a starting workspace wants: something to draw. A caller that is about to
 * WRITE what it read wants the opposite. The crash screen's Reset layout does
 * exactly that, and a read failure paired with a working write would have
 * replaced the reader's watched places, colour tables, packs and presets with
 * the defaults, which is the inverse of what the button promises.
 */
export async function readSettings(): Promise<AppSettings> {
  // Nothing stored at all is a first run, and a first run is the one case
  // where nobody has picked units yet. That is not the same as a file with no
  // `unitsChosen` in it, which is a reader from an older build whose choice
  // cannot be known and is left alone. Handing the defaults in rather than
  // `undefined` is what tells the two apart: without it every real first
  // launch was marked as already picked, and choosing a language never set
  // the units it is read in for anybody.
  if (isDesktopRuntime()) {
    // Asked before the store is opened, and this is the whole of what keeps
    // the recovery ahead of the store's own read: asking is what runs it.
    // Ordered here, in one place, rather than left to the order two things
    // happen to start in.
    recovery = await invoke<SettingsRecovery | null>("settings_recovered")
      .then((answer) => answer ?? null)
      .catch(() => null);
    const value = await (await getStore()).get<unknown>("settings");
    const read = normalizeSettings(value ?? DEFAULT_SETTINGS);
    // The store falls back to its own defaults when the file has been taken
    // away, and those defaults are the first-run marker. Without this a reader
    // whose file rotted with no copy behind it was asked to pick their units
    // again, and picking a language would then have moved them. Here rather
    // than in `loadSettings`, because the crash screen reads through this one
    // and writes back what it read.
    return recovery && !recovery.restored
      ? normalizeSettings({ ...read, unitsChosen: true })
      : read;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return normalizeSettings(DEFAULT_SETTINGS);
  if (readableSettings(raw)) return normalizeSettings(JSON.parse(raw));
  const put = recoverStored(raw);
  // Not the defaults, which say first run and would ask a reader who has been
  // here for a year to pick their units again. Their choice cannot be known
  // from a document that will not parse, and that is the case the load
  // already has a rule for: leave it alone.
  return normalizeSettings(put === null ? undefined : JSON.parse(put));
}

/**
 * Puts the last good copy back when the live document will not parse.
 *
 * Answers with what to read instead, or `null` when there was no copy to go
 * back to. The unreadable document is kept rather than dropped: somebody who
 * hand-edited it wants to see what they wrote.
 */
function recoverStored(raw: string): string | null {
  const previous = window.localStorage.getItem(PREVIOUS_KEY);
  const restored = previous !== null && readableSettings(previous);
  // Kept if there is room for it. A document too big to copy is still a
  // document that will not parse, and refusing the whole recovery because the
  // copy would not fit leaves the reader on the defaults every launch.
  try {
    window.localStorage.setItem(KEPT_KEY, raw);
  } catch {
    window.localStorage.removeItem(KEPT_KEY);
  }
  if (restored) window.localStorage.setItem(STORAGE_KEY, previous);
  // Removed rather than left, or every load from here on reads the same
  // unreadable document and the reader is stuck on the defaults for good.
  else window.localStorage.removeItem(STORAGE_KEY);
  // Nothing holds a key open in a browser, so a stored document is never the
  // stuck case; that one belongs to the desktop's file.
  recovery = { keptAt: KEPT_KEY, restored, stuck: false };
  return restored ? previous : null;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  if (isDesktopRuntime()) {
    const write = storeWriteQueue
      .catch(() => {})
      .then(async () => {
        const store = await getStore();
        // Before the write, not after: what is worth keeping is the state the
        // reader had before whatever goes wrong next, and a write that tears
        // halfway through is one of the things that goes wrong. A failure
        // here is not a reason to refuse the save.
        await invoke("settings_keep_previous").catch(() => false);
        await store.set("settings", normalized);
        await store.save();
      });
    storeWriteQueue = write;
    return write;
  }
  const live = window.localStorage.getItem(STORAGE_KEY);
  if (live !== null && readableSettings(live)) {
    window.localStorage.setItem(PREVIOUS_KEY, live);
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized, null, 2));
}
