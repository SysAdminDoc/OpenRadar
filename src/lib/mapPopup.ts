import { translate } from "../i18n";
import {
  CUSTOM_LAYER_IDS,
  OVERLAY_SOURCE_PREFIX,
  PROBSEVERE_FILL_LAYER_ID,
  topmost,
  type Placed,
} from "./layerStack";
import { OVERLAY_ADAPTERS } from "./overlays/index";

/** What a popup says. */
export interface PopupContent {
  title: string;
  lines: string[];
  url?: string;
}

/** A hit test result, cut down to what deciding the popup needs. */
export interface Hit extends Placed {
  properties: Record<string, unknown> | null;
}

/** Only trusted web links leave a popup. Provider data is remote input. */
export function safePopupUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * What a click on these features should open, or nothing.
 *
 * Which one answers is decided by the same order the map draws in, and by
 * nothing else. Asking one layer first and the rest afterwards is that order
 * written out twice, and the two drifted: the model's severe probability is
 * drawn under the warnings on purpose, because guidance belongs under a
 * decision somebody has taken responsibility for, and it was asked first
 * anyway. A tornado warning could not be clicked anywhere the model had drawn
 * a polygon over the same storm, which is every storm that carries one.
 *
 * Kept out of the map component so it can be driven without standing a map up.
 */
export function popupFrom(
  hits: readonly Hit[],
  order: readonly string[],
): PopupContent | null {
  const hit = topmost(hits, order);
  if (!hit) return null;
  const properties = hit.properties ?? {};

  if (hit.layer.id === PROBSEVERE_FILL_LAYER_ID) {
    const detail = String(properties.detail ?? "");
    return {
      title: translate("probSevere.title"),
      lines: [
        translate("probSevere.headline", {
          percent: String(properties.severe ?? 0),
        }),
        translate("probSevere.kinds", {
          hail: String(properties.hail ?? 0),
          wind: String(properties.wind ?? 0),
          tornado: String(properties.tornado ?? 0),
        }),
        ...(detail ? [detail] : []),
        translate("probSevere.note"),
      ],
    };
  }

  if (CUSTOM_LAYER_IDS.includes(hit.layer.id)) {
    return importedShape(properties);
  }

  const adapter = OVERLAY_ADAPTERS.find((candidate) =>
    hit.layer.id.startsWith(`${OVERLAY_SOURCE_PREFIX}${candidate.id}`),
  );
  if (!adapter) return null;
  return adapter.describe(properties);
}

/**
 * The properties an imported shape is DRAWN with rather than described by.
 *
 * Everything else a file carried is the reader's own data and belongs in the
 * popup, because there is no adapter here that knows what any of it means:
 * a placefile's hover text, a placemark's name, and whatever fields the
 * publisher put in its extended data are the only account of the shape there
 * is.
 */
const DRAWN_WITH = new Set([
  "kind",
  "color",
  "fill",
  "stroke",
  "icon",
  "image",
  "fileName",
  "fileOpacity",
  "label",
  "name",
  "description",
]);

/**
 * Drawing instructions that are numbers, and are only those when they are.
 *
 * `width` is a placefile's stroke width and it is also what a tornado damage
 * survey calls the width of the path, which arrives as "400 yd". Suppressing
 * the name outright threw the reader's own field away; suppressing it only
 * where the value is the number the renderer would have used keeps both.
 */
const DRAWN_WITH_NUMBER = new Set([
  "width",
  "strokeWidth",
  "angle",
  "minZoom",
  "from",
  "to",
]);

/**
 * How many of a shape's own fields are worth a popup.
 *
 * A published KML can carry dozens per placemark, and a popup taller than the
 * window is a worse answer than a popup that stops.
 */
const MAX_IMPORTED_LINES = 8;

/**
 * What a shape somebody imported has to say about itself.
 *
 * Titled by the file it came from, because with eight of them on the map at
 * once "which of my files is this" is the question a reader has, and the
 * shape's own words are the first line under it. Every value goes out as text:
 * a KML description is untrusted input and the popup writes it with
 * `textContent`, so it is read rather than rendered.
 */
function importedShape(
  properties: Record<string, unknown>,
): PopupContent | null {
  const said = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  const lines: string[] = [];
  const named = said(properties.label) ?? said(properties.name);
  if (named) lines.push(named);
  const description = said(properties.description);
  if (description) lines.push(description);
  for (const [key, value] of Object.entries(properties)) {
    if (lines.length >= MAX_IMPORTED_LINES) break;
    if (DRAWN_WITH.has(key)) continue;
    if (DRAWN_WITH_NUMBER.has(key) && typeof value === "number") continue;
    const text = said(value);
    if (text) lines.push(`${key}: ${text}`);
  }
  if (!lines.length) return null;
  return {
    title: said(properties.fileName) ?? translate("popup.importedShape"),
    lines: lines.slice(0, MAX_IMPORTED_LINES),
  };
}
