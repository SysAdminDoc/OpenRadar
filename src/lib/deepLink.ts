import {
  cameraFromSearch,
  normalizeSettings,
  type CameraState,
  type ProjectionMode,
} from "./settings";
import { isLevel2Product, type Level2ProductId } from "./level2";

export const DEEP_LINK_SCHEME = "openradar";
const VIEW_HOST = "view";

export interface SharedView {
  camera: CameraState;
  projection: ProjectionMode;
  /**
   * What the sender was actually looking at, when they were holding a site.
   *
   * The camera alone puts the receiver over the same ground with whatever
   * product their own workspace happened to be on, which is a different
   * picture of the same storm. Optional, because a link made over the
   * national mosaic has no site to name and the old camera-only form has to
   * keep opening.
   */
  radar?: SharedRadar;
}

/** The held site and what was drawn on it, as a link can carry them. */
export interface SharedRadar {
  station: string;
  product: Level2ProductId;
  tilt: number;
  /** In the product's own unit, or null where nothing was hidden. */
  threshold: number | null;
}

/**
 * The site as the feed spells it, or null.
 *
 * Four letters, which is what both networks use: `KDMX` and `TDAL`. A link
 * naming anything else is a link from a build that knows sites this one does
 * not, and the camera in it is still worth flying to.
 */
function stationFromLink(value: string | null): string | null {
  if (value === null) return null;
  const said = value.trim().toUpperCase();
  return /^[A-Z]{4}$/.test(said) ? said : null;
}

function viewQuery(view: SharedView): string {
  const query = new URLSearchParams({
    lon: view.camera.center[0].toFixed(5),
    lat: view.camera.center[1].toFixed(5),
    zoom: view.camera.zoom.toFixed(2),
    bearing: view.camera.bearing.toFixed(1),
    pitch: view.camera.pitch.toFixed(1),
    projection: view.projection,
  });
  // Only when a site was held. A link over the national mosaic that named a
  // product would put the receiver on a site the sender was not on.
  if (view.radar) {
    query.set("site", view.radar.station);
    query.set("product", view.radar.product);
    query.set("tilt", String(view.radar.tilt));
    if (view.radar.threshold !== null) {
      query.set("threshold", String(view.radar.threshold));
    }
  }
  return query.toString();
}

/** The link the desktop app hands out. Opening it focuses the running window. */
export function deepLinkUrl(view: SharedView): string {
  return `${DEEP_LINK_SCHEME}://${VIEW_HOST}?${viewQuery(view)}`;
}

/** The same view as a plain web address, for the browser preview. */
export function webLinkUrl(view: SharedView, href: string): string {
  const url = new URL(href);
  url.search = viewQuery(view);
  url.hash = "";
  return url.toString();
}

/**
 * Reads a view out of an `openradar://view?...` link. Anything else, including
 * another scheme or a link with no usable camera, is refused rather than
 * moving the map somewhere arbitrary.
 */
export function viewFromDeepLink(
  link: string,
  fallback: CameraState,
): SharedView | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  const host = url.host || url.pathname.replace(/^\/+/, "").replace(/\/$/, "");
  if (host !== VIEW_HOST) return null;

  // Every part has to be there and be a number. A half-written link would
  // otherwise fly nowhere and still knock the projection back to flat.
  const complete = ["lon", "lat", "zoom", "bearing", "pitch"].every((key) => {
    const value = url.searchParams.get(key);
    return (
      value !== null && value.trim() !== "" && Number.isFinite(Number(value))
    );
  });
  if (!complete) return null;

  const camera = cameraFromSearch(url.search, fallback);
  const projection: ProjectionMode =
    url.searchParams.get("projection") === "globe" ? "globe" : "mercator";

  // Each part is checked on its own and dropped on its own. A link whose
  // product this build does not know is still a link to a place, and
  // refusing the whole thing over one word would lose the camera too.
  const station = stationFromLink(url.searchParams.get("site"));
  const said = url.searchParams.get("product");
  const product = isLevel2Product(said) ? said : null;
  const tilt = Number(url.searchParams.get("tilt"));
  const threshold = url.searchParams.get("threshold");
  const hidden = threshold === null ? null : Number(threshold);
  const radar =
    station && product
      ? {
          station,
          product,
          tilt: Number.isInteger(tilt) && tilt >= 0 && tilt <= 20 ? tilt : 0,
          threshold: hidden !== null && Number.isFinite(hidden) ? hidden : null,
        }
      : undefined;

  return {
    camera: normalizeSettings({ camera }).camera,
    projection,
    ...(radar ? { radar } : null),
  };
}

/**
 * Whether a link named a site or a product this build could not use.
 *
 * Separate from the read so the workspace can say so: a link that opens the
 * right place with a different product than the sender saw is worth a word,
 * and silently flying somewhere is what it did before.
 */
export function linkNamedUnknownRadar(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  const site = url.searchParams.get("site");
  const product = url.searchParams.get("product");
  if (site === null && product === null) return false;
  return stationFromLink(site) === null || !isLevel2Product(product);
}
