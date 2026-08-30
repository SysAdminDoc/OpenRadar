/**
 * Sends the map's own requests through the native side, which keeps what comes
 * back.
 *
 * The webview forgets every tile the moment the machine goes offline, so a
 * launch with no network opens on an empty map. Rust keeps the bytes on disk
 * and hands them back when a fetch fails, which turns that into the last view
 * the user actually saw.
 *
 * Only the hosts listed here are routed. Anything else the map asks for goes
 * straight out as it always did, so a style that reaches somewhere unexpected
 * cannot be broken by this.
 */
import { isDesktopRuntime } from "./settings";

/**
 * Hosts worth keeping a copy of: the radar services, the base maps under them,
 * and the small documents the overlays are drawn from.
 */
export const CACHED_HOSTS = [
  "opengeo.ncep.noaa.gov",
  "nowcoast.noaa.gov",
  "mapservices.weather.noaa.gov",
  "tilecache.rainviewer.com",
  "api.rainviewer.com",
  "geo.weather.gc.ca",
  "mesonet.agron.iastate.edu",
  "gibs.earthdata.nasa.gov",
  "tiles.openfreemap.org",
  "basemap.nationalmap.gov",
  "tile.opentopomap.org",
  "earthquake.usgs.gov",
  "services3.arcgis.com",
];

let base: string | null = null;
let priming: Promise<void> | null = null;

/**
 * Works out how this platform spells the scheme. It is `cached://localhost/`
 * on macOS and Linux and `http://cached.localhost/` on Windows, and only Tauri
 * knows which.
 */
export function primeTileCache(): Promise<void> {
  if (!isDesktopRuntime()) return Promise.resolve();
  if (priming) return priming;
  priming = (async () => {
    try {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const sample = convertFileSrc("openradar", "cached");
      base = sample.slice(0, sample.lastIndexOf("openradar"));
    } catch {
      // No native side to route through, so the map fetches for itself.
      base = null;
    }
  })();
  return priming;
}

export function resetTileCache() {
  base = null;
  priming = null;
}

function isCachedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return CACHED_HOSTS.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    );
  } catch {
    return false;
  }
}

/**
 * The address the map should actually request. Unchanged in a browser, and
 * unchanged for anything not worth keeping.
 */
export function cachedUrl(url: string): string {
  if (!base || !isCachedHost(url)) return url;
  return `${base}?u=${encodeURIComponent(url)}`;
}
