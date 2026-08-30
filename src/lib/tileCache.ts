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
  "api.weather.gov",
  "api.tidesandcurrents.noaa.gov",
  "api.open-meteo.com",
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
 *
 * Read straight off the object Tauri puts on the window rather than through a
 * dynamic import, because the answer is needed before the first tile is asked
 * for and an import that has not settled means the first screenful goes out
 * unrouted. The import is still tried as a fallback for a build that does not
 * expose it.
 */
function resolveBase(): string | null {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (path: string, scheme: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;
  const convert = internals?.convertFileSrc;
  if (typeof convert !== "function") return null;
  try {
    const sample = convert("openradar", "cached");
    const at = sample.lastIndexOf("openradar");
    return at < 0 ? null : sample.slice(0, at);
  } catch {
    return null;
  }
}

export function primeTileCache(): Promise<void> {
  if (!isDesktopRuntime()) return Promise.resolve();
  base = resolveBase();
  if (base) return Promise.resolve();
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
  resetCacheReports();
}

function isCachedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    // Credentials and a port change who answers and what is sent, and the
    // native side refuses both, so nothing is gained by routing them.
    if (parsed.username || parsed.password || parsed.port) return false;
    // Exactly these hosts, not their subdomains: the native side matches
    // exactly, and routing a subdomain here would send it somewhere that
    // refuses it and quietly lose the layer.
    return CACHED_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The header the native side puts on a response it served from disk, holding
 * how many seconds old the bytes are. Zero means it was just fetched.
 */
const AGE_HEADER = "X-OpenRadar-Age";

let servedFromCacheAt = 0;
let servedAgeSeconds = 0;

/**
 * Notes whether a reply came off the disk rather than off the network.
 *
 * Every fetch this app makes through the cached scheme passes its response
 * here, so the timeline can say what it is showing rather than guessing from
 * whether the machine believes it has a network. A captive portal, a dead
 * resolver, and a service that is simply down all look online from the page's
 * side, and in all three the native side quietly answers from disk.
 */
export function noteCachedResponse(response: Response) {
  const raw = response.headers.get(AGE_HEADER);
  if (raw === null) return;
  const age = Number(raw);
  // Zero is a live fetch. Anything above it came out of the cache.
  if (!Number.isFinite(age) || age <= 0) return;
  servedFromCacheAt = Date.now();
  servedAgeSeconds = age;
}

/**
 * How old the bytes were, if anything since this moment was served from disk.
 */
export function cachedSince(at: number): number | null {
  return servedFromCacheAt >= at ? servedAgeSeconds : null;
}

/** Only for tests, which need each case to start from nothing. */
export function resetCacheReports() {
  servedFromCacheAt = 0;
  servedAgeSeconds = 0;
}

/**
 * The address the map should actually request. Unchanged in a browser, and
 * unchanged for anything not worth keeping.
 */
export function cachedUrl(url: string): string {
  if (!base || !isCachedHost(url)) return url;
  return `${base}?u=${encodeURIComponent(url)}`;
}
