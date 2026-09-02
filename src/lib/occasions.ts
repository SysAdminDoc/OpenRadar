/**
 * The workspace looking like the time of year it is.
 *
 * An app that is a little warmer in late October than it is in March is an
 * app people notice they live with. It is also the easiest thing in this
 * project to do badly, so the constraints matter more than the packs do:
 *
 * - Chrome only. A pack is a `WorkspaceTheme` and goes through the same
 *   parser a theme file does, so it can reach the tokens in `THEME_TOKENS`
 *   and nothing else. A reflectivity ramp, a warning outline and a hazard
 *   colour are readings and no date changes them.
 * - Local. The window is worked out from this machine's own clock and the
 *   latitude of the place the reader watches. Nothing is fetched, and there
 *   is no calendar service anywhere in this file.
 * - Declinable. Each one can be sent away for the year or switched off for
 *   good, and the master switch gives back the plain workspace at once.
 * - Quiet during danger. Whether a pack applies at all is decided by the
 *   caller, which stands it down while a warning is in force at a watched
 *   place. A map with a warning on it is a serious instrument.
 *
 * The seasons are the northern ones by name and the southern ones by date: a
 * reader whose watched place is south of the equator gets the pack six months
 * along, so October is autumn in Ontario and spring in Canterbury.
 */
import { parseTheme, themeText, type WorkspaceTheme } from "./theme";
import type { ThemeMode } from "./settings";

export type OccasionId = "spring" | "summer" | "autumn" | "midwinter";

interface Occasion {
  id: OccasionId;
  /** Inclusive, as [month, day] with January as 1, in the northern calendar. */
  from: [number, number];
  to: [number, number];
  /** What the pack sets, per built-in look. Directive names from THEME_TOKENS. */
  dark: Record<string, string>;
  light: Record<string, string>;
}

/**
 * Four windows, none of them touching, with most of the year left plain.
 *
 * Deliberately not every day of the year in a pack. The point is that some
 * weeks look different from the others, which needs weeks that do not.
 */
const OCCASIONS: Occasion[] = [
  {
    id: "spring",
    from: [3, 15],
    to: [4, 30],
    dark: {
      Accent: "#6ee7a8",
      AccentStrong: "#34d399",
      AccentSoft: "rgba(52, 211, 153, 0.16)",
    },
    light: {
      Accent: "#0f7a52",
      AccentStrong: "#0b6544",
      AccentSoft: "rgba(15, 122, 82, 0.12)",
    },
  },
  {
    id: "summer",
    from: [6, 15],
    to: [8, 31],
    dark: {
      Accent: "#ffd166",
      AccentStrong: "#f4b942",
      AccentSoft: "rgba(244, 185, 66, 0.16)",
    },
    light: {
      Accent: "#9a6500",
      AccentStrong: "#7d5200",
      AccentSoft: "rgba(154, 101, 0, 0.12)",
    },
  },
  {
    id: "autumn",
    from: [10, 1],
    to: [11, 15],
    dark: {
      Accent: "#ff9f68",
      AccentStrong: "#f97316",
      AccentSoft: "rgba(249, 115, 22, 0.16)",
    },
    light: {
      Accent: "#a2480a",
      AccentStrong: "#873c08",
      AccentSoft: "rgba(162, 72, 10, 0.12)",
    },
  },
  {
    id: "midwinter",
    // The one window that crosses the year, which is why the year an occasion
    // belongs to is worked out rather than read off the date.
    from: [12, 10],
    to: [1, 5],
    dark: {
      Accent: "#a5c8ff",
      AccentStrong: "#7aa7f0",
      AccentSoft: "rgba(122, 167, 240, 0.16)",
    },
    light: {
      Accent: "#2a5ea8",
      AccentStrong: "#1e4a89",
      AccentSoft: "rgba(42, 94, 168, 0.12)",
    },
  },
];

/** How many days into the year a month and day is, ignoring leap years. */
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function dayOfYear(month: number, day: number): number {
  return MONTH_STARTS[month - 1] + day;
}

/**
 * The same window half a year along, for a reader south of the equator.
 *
 * Worked in whole months rather than days, so a window that starts on the
 * fifteenth still starts on the fifteenth. A month with fewer days than the
 * one it came from is not a problem here because no window starts after the
 * twenty-eighth.
 */
function shifted(edge: [number, number]): [number, number] {
  return [((edge[0] + 5) % 12) + 1, edge[1]];
}

function within(
  month: number,
  day: number,
  from: [number, number],
  to: [number, number],
): boolean {
  const at = dayOfYear(month, day);
  const start = dayOfYear(from[0], from[1]);
  const end = dayOfYear(to[0], to[1]);
  // A window that ends before it starts is one that crosses the new year.
  return start <= end ? at >= start && at <= end : at >= start || at <= end;
}

/**
 * Which occasion is in its window on this machine, right now.
 *
 * The date is read in local time. A reader whose data is stamped in UTC still
 * gets the pack for the day it is where they are, because a season is a thing
 * about where somebody lives rather than about where the file was written.
 */
export function occasionOn(at: Date, latitude = 45): OccasionId | null {
  const south = latitude < 0;
  const month = at.getMonth() + 1;
  const day = at.getDate();
  for (const occasion of OCCASIONS) {
    const from = south ? shifted(occasion.from) : occasion.from;
    const to = south ? shifted(occasion.to) : occasion.to;
    if (within(month, day, from, to)) return occasion.id;
  }
  return null;
}

/**
 * The year an occasion's current window began.
 *
 * What "declined for this year" means, and the reason it is not simply the
 * calendar year: midwinter runs from December into January, and somebody who
 * sends it away on the twentieth of December should not have it back on the
 * first.
 */
export function occasionYear(at: Date, id: OccasionId, latitude = 45): number {
  const occasion = OCCASIONS.find((one) => one.id === id);
  if (!occasion) return at.getFullYear();
  const from = latitude < 0 ? shifted(occasion.from) : occasion.from;
  const to = latitude < 0 ? shifted(occasion.to) : occasion.to;
  const wraps = dayOfYear(from[0], from[1]) > dayOfYear(to[0], to[1]);
  const before =
    dayOfYear(at.getMonth() + 1, at.getDate()) < dayOfYear(from[0], from[1]);
  return wraps && before ? at.getFullYear() - 1 : at.getFullYear();
}

/**
 * An occasion as a theme, read through the same parser a file goes through.
 *
 * Not a shortcut: a pack that could set a token a file cannot would be a
 * second way into the stylesheet with its own rules, and the whole point of
 * the boundary is that there is one.
 */
export function occasionTheme(
  id: OccasionId,
  base: ThemeMode,
  name: string,
): WorkspaceTheme | null {
  const occasion = OCCASIONS.find((one) => one.id === id);
  if (!occasion) return null;
  const text = themeText({
    name,
    base,
    tokens: base === "light" ? occasion.light : occasion.dark,
  });
  return parseTheme(text, name)?.theme ?? null;
}

/** Every occasion, for a test that has to cover each window's edges. */
export function occasionWindows(): ReadonlyArray<{
  id: OccasionId;
  from: [number, number];
  to: [number, number];
}> {
  return OCCASIONS.map(({ id, from, to }) => ({ id, from, to }));
}
