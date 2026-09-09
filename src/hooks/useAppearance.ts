import { useEffect, useMemo } from "react";
import { applyTheme, type WorkspaceTheme } from "../lib/theme";
import { drawnOverLight } from "../lib/mapStyles";
import { startedPlain } from "../lib/settings";
import {
  occasionOn,
  occasionTheme,
  occasionYear,
  type OccasionId,
} from "../lib/occasions";
import { translate, type StringKey } from "../i18n";
import type { AppSettings } from "../lib/settings";

/** What the browser paints around the window before the app has drawn. */
const CHROME_COLOR: Record<AppSettings["theme"], string> = {
  dark: "#090b10",
  light: "#eef2f6",
};

export interface Appearance {
  /** The occasion whose window this machine's clock is inside, or null. */
  occasion: OccasionId | null;
  /** The year that occasion's window began, for declining it once. */
  year: number;
  /** True when the occasion is what is on screen right now. */
  showing: boolean;
}

/**
 * What the window looks like: the built-in look, the reader's own, and the
 * season.
 *
 * One effect owns all of it. Two effects writing the same style element is a
 * frame of the plain workspace on every change, and there are four inputs
 * that can move: the dark and light choice, a theme the reader loaded, the
 * date, and whether a warning is in force somewhere they watch.
 *
 * The order is deliberate. A theme the reader chose beats a pack that arrived
 * on its own, because they asked for one and not the other. A warning at a
 * watched place beats both: while one stands, the workspace is a serious
 * instrument and nothing decorative is on it.
 */
export function useAppearance(
  settings: AppSettings,
  /** Milliseconds. Ticking once a minute is plenty for a calendar. */
  clock: number,
  /** True while a warning is in force at a place the reader watches. */
  alertActive: boolean,
): Appearance {
  // The season is about where the reader is, so a place south of the equator
  // gets the pack six months along rather than the one for the wrong half of
  // the year. The watched place when there is one, and where the map is
  // looking when there is not: the watch's default centre is a place in Texas
  // nobody chose, and a reader in Canterbury would get the northern calendar
  // for it.
  const latitude = settings.watch.enabled
    ? settings.watch.center[1]
    : settings.camera.center[1];
  const occasion = useMemo(
    () => occasionOn(new Date(clock), latitude),
    [clock, latitude],
  );
  const year = useMemo(
    () => (occasion ? occasionYear(new Date(clock), occasion, latitude) : 0),
    [clock, latitude, occasion],
  );

  // The one year that matters, rather than the record holding it. Every
  // settings read rebuilds that record, and a camera move is a settings read,
  // so depending on the object rewrote the theme element twice a second
  // through a pan.
  const declined = occasion ? settings.occasions.declined[occasion] : undefined;
  const wanted = useMemo<WorkspaceTheme | null>(() => {
    // Stood down for a window that opened plain after two starts that never
    // reached one. The theme stays in the settings file: it is a document the
    // reader imported, and taking it out of the file to switch it off would
    // mean the first thing they changed wrote it away for good.
    if (settings.workspaceTheme && !startedPlain()) {
      return settings.workspaceTheme;
    }
    if (alertActive || !occasion || !settings.occasions.enabled) return null;
    if (declined === year) return null;
    return occasionTheme(
      occasion,
      settings.theme,
      translate(`occasion.${occasion}` as StringKey),
    );
  }, [
    alertActive,
    declined,
    occasion,
    settings.occasions.enabled,
    settings.theme,
    settings.workspaceTheme,
    year,
  ]);

  useEffect(() => {
    applyTheme(wanted);
    document.documentElement.dataset.theme = settings.theme;
    // One attribute, so the stylesheet decides what goes quiet rather than
    // twenty components each deciding for themselves. What it may reach is
    // held by `theme.test.ts`: chrome, never a reading.
    if (settings.calm) document.documentElement.dataset.calm = "1";
    else delete document.documentElement.dataset.calm;
    // Whether the ground under the map is a light one, which is a different
    // question from which theme the workspace wears. A reader on the dark
    // theme who picks Roads or Topography gets dark chrome over a pale street
    // map, and anything sitting straight on that map has to flip its ink for
    // the map rather than for the theme. It was set on the ambient readout
    // alone, which is how the OpenStreetMap credit came to be 72 per cent
    // pale grey on pale water: readable in neither screenshot anybody took,
    // because the dark theme's looked right and the light theme's was right.
    //
    // Asked of what is drawn rather than of what was picked. It used to read
    // the chosen style, and an incident pack replaces the basemap outright, so
    // a reader with a pack open got the chrome dressed for the style they had
    // picked before rather than for the tiles under it.
    if (
      drawnOverLight(
        settings.mapStyle,
        settings.theme,
        settings.incidentPacks.selectedId !== null,
      )
    ) {
      document.documentElement.dataset.overLight = "1";
    } else {
      delete document.documentElement.dataset.overLight;
    }
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    meta?.setAttribute("content", CHROME_COLOR[settings.theme]);
    // Mirrored where the boot script in `index.html` can read it before first
    // paint. The settings themselves are behind an async store on the
    // desktop, so nothing synchronous can reach them; this key is the only
    // thing standing between a light-theme reader and a dark flash on every
    // cold start. Best effort: a window with no storage keeps the default.
    try {
      window.localStorage.setItem("openradar.theme", settings.theme);
    } catch {
      // Nothing to do about it, and nothing depends on it having worked.
    }
  }, [
    settings.calm,
    settings.incidentPacks.selectedId,
    settings.mapStyle,
    settings.theme,
    wanted,
  ]);

  return {
    occasion,
    year,
    showing: Boolean(occasion) && wanted !== settings.workspaceTheme,
  };
}
