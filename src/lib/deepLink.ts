import {
  cameraFromSearch,
  normalizeSettings,
  type CameraState,
  type ProjectionMode,
} from "./settings";

export const DEEP_LINK_SCHEME = "openradar";
const VIEW_HOST = "view";

export interface SharedView {
  camera: CameraState;
  projection: ProjectionMode;
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

  const camera = cameraFromSearch(url.search, fallback);
  const projection: ProjectionMode =
    url.searchParams.get("projection") === "globe" ? "globe" : "mercator";
  if (camera === fallback && !url.searchParams.get("lon")) return null;

  return { camera: normalizeSettings({ camera }).camera, projection };
}
