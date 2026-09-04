import type { OverlayData, OverlayFeature } from "./overlays";
import { isCachedHost } from "./tileCache";

export interface Placefile {
  title: string;
  /** Minutes the file asks to be refreshed at, when it says. */
  refreshMinutes: number | null;
  data: OverlayData;
  /** Directives that were recognised but carry nothing we can draw. */
  skipped: string[];
  /** True when the file ended inside a shape, which is a truncated download. */
  truncated: boolean;
}

const DEFAULT_COLOR = "#7dd3fc";

/**
 * The threshold the format calls "always", in nautical miles.
 *
 * 999 is the spec's default and what every published file writes when it means
 * the shape should be on screen at any range.
 */
export const ALWAYS_NM = 999;

/**
 * How far the map can see, in nautical miles, at zoom zero.
 *
 * The earth is 21,639 nautical miles round, one tile wide at zoom zero, and a
 * window two tiles across shows a radius of one circumference. Every zoom in
 * halves it, which is the whole of the conversion below.
 */
export const HORIZON_NM = 21639;

/** How many georeferenced pictures one file may carry. */
export const MAX_PLACEFILE_IMAGES = 4;

/**
 * The zoom a `Threshold` in nautical miles first shows something at.
 *
 * The format states visibility as the range the radar view is within; a map
 * states it as a zoom. Anything at or past the format's own "always" value is
 * zero, so the common case adds no property at all.
 */
export function thresholdZoom(nauticalMiles: number): number {
  if (!(nauticalMiles > 0) || nauticalMiles >= ALWAYS_NM) return 0;
  const zoom = Math.log2(HORIZON_NM / nauticalMiles);
  return Math.max(0, Math.round(zoom * 100) / 100);
}

function toHex(red: number, green: number, blue: number): string {
  const clamp = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(red)}${clamp(green)}${clamp(blue)}`;
}

function quoted(line: string): string {
  const match = /"([^"]*)"/.exec(line);
  return match ? match[1] : "";
}

function numbers(text: string): number[] {
  return (
    text
      .split(/[\s,]+/)
      // An untrimmed value starts with an empty token, and Number("") is zero.
      .filter((part) => part.length > 0)
      .map(Number)
      .filter((value) => Number.isFinite(value))
  );
}

/** The host of a URL, or null for anything that is not one. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The file a statement names, quoted or bare.
 *
 * `IconFile` and `Image` both end in a file name that published files quote
 * about half the time. Taking the last comma-separated token when there are no
 * quotes reads both without guessing.
 */
function fileName(value: string): string {
  const inQuotes = quoted(value);
  if (inQuotes) return inQuotes;
  const parts = value.split(",");
  return parts[parts.length - 1].trim();
}

/**
 * A `lat, lon` line inside a shape. Only a line that is nothing but numbers
 * counts: a directive such as `Color: 80, 40, 20` is legal inside a block and
 * would otherwise be read as a vertex somewhere in Kazakhstan.
 */
function coordinate(line: string): [number, number] | null {
  const body = line.split("//")[0].trim();
  if (!/^[-+0-9.,\s]+$/.test(body)) return null;
  const parts = numbers(body);
  if (parts.length < 2) return null;
  const [lat, lon] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

interface Sheet {
  url: string;
  iconWidth: number;
  iconHeight: number;
  hotX: number;
  hotY: number;
}

/**
 * One icon out of one sheet, written so the map can read it back.
 *
 * The map needs the sheet's address, how it is cut up and which cell to take,
 * and the feature is the only thing that survives being stored in the
 * workspace and merged with seven other files. So the whole description is the
 * property, with `|` between its parts.
 *
 * The address is percent-encoded rather than written in plainly. A URL may
 * hold a `|`: the WHATWG parser leaves one in a path untouched, so
 * `https://example.test/a|b.png` survives `new URL()` whole, and a sheet at
 * such an address produced an id with eight parts that read back as nothing
 * at all. The icon was then neither fetched nor drawn as a point.
 */
export function iconId(sheet: Sheet, index: number): string {
  return [
    "icon",
    encodeURIComponent(sheet.url),
    sheet.iconWidth,
    sheet.iconHeight,
    sheet.hotX,
    sheet.hotY,
    index,
  ].join("|");
}

export interface IconRef extends Sheet {
  index: number;
}

/** Reads back what `iconId` wrote, or null for anything else. */
export function parseIconId(id: string): IconRef | null {
  const parts = id.split("|");
  if (parts.length !== 7 || parts[0] !== "icon") return null;
  const [iconWidth, iconHeight, hotX, hotY, index] = parts.slice(2).map(Number);
  if (![iconWidth, iconHeight, hotX, hotY, index].every(Number.isFinite)) {
    return null;
  }
  if (iconWidth <= 0 || iconHeight <= 0 || index < 1) return null;
  let url: string;
  try {
    url = decodeURIComponent(parts[1]);
  } catch {
    // A stored workspace can be edited by hand, and a stray percent sign is
    // not an address.
    return null;
  }
  return { url, iconWidth, iconHeight, hotX, hotY, index };
}

interface TimeWindow {
  from: number;
  to: number;
}

/**
 * A `TimeRange` pair.
 *
 * The format writes `YYYY-MM-DDThh:mm:ss` with no zone and means UTC by it.
 * Read as written, a browser would call that local time and a file would hide
 * itself five hours early in Iowa.
 */
export function timeWindow(value: string): TimeWindow | null {
  const stamps = value.trim().split(/\s+/);
  if (stamps.length < 2) return null;
  const read = stamps.slice(0, 2).map((stamp) => {
    const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(stamp)
      ? `${stamp}Z`
      : stamp;
    return Date.parse(utc);
  });
  if (!read.every(Number.isFinite)) return null;
  const [from, to] = read;
  return to > from ? { from, to } : null;
}

interface Gate {
  minZoom?: number;
  from?: number;
  to?: number;
}

function gateOf(threshold: number, window: TimeWindow | null): Gate {
  const gate: Gate = {};
  const minZoom = thresholdZoom(threshold);
  if (minZoom > 0) gate.minZoom = minZoom;
  if (window) {
    gate.from = window.from;
    gate.to = window.to;
  }
  return gate;
}

interface Shape {
  kind: "line" | "polygon";
  width: number;
  hover: string;
  color: string;
  points: Array<[number, number]>;
  gate: Gate;
}

function toFeature(shape: Shape): OverlayFeature | null {
  if (shape.points.length < 2) return null;
  const closed =
    shape.kind === "polygon" ? [...shape.points, shape.points[0]] : null;
  return {
    type: "Feature",
    geometry:
      shape.kind === "polygon"
        ? { type: "Polygon", coordinates: [closed] }
        : { type: "LineString", coordinates: shape.points },
    properties: {
      kind: shape.kind,
      color: shape.color,
      width: shape.width,
      label: shape.hover,
      ...shape.gate,
    },
  };
}

interface ImageBlock {
  url: string;
  gate: Gate;
  /** Every vertex the block listed, as `[lon, lat, u, v]`. */
  vertices: number[][];
}

/**
 * The four corners of a textured block, in the order a map source wants them.
 *
 * The format lists a triangle mesh: groups of three vertices, each carrying
 * where it sits on the ground and where it sits on the picture. A map draws a
 * picture as a quadrilateral and nothing else, so the corners are the four
 * vertices whose texture coordinates are the picture's own corners. A mesh
 * that is not a rectangle has no such four and is refused rather than drawn
 * as the rectangle it is not.
 */
export function imageCorners(vertices: number[][]): number[][] | null {
  const wanted: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const corners: number[][] = [];
  for (const [u, v] of wanted) {
    const found = vertices.find(
      (corner) =>
        Math.abs(corner[2] - u) < 0.001 && Math.abs(corner[3] - v) < 0.001,
    );
    if (!found) return null;
    corners.push([found[0], found[1]]);
  }
  return corners;
}

/**
 * The GRLevelX placefile format, as much of it as a map can honestly draw.
 *
 * Lines, polygons, points, text, icons and georeferenced pictures are read
 * with the colours, hover text, view thresholds and time ranges in force where
 * they appear. Two things are read but not drawn where they are written: a
 * statement inside an `Object` block is positioned in screen pixels from the
 * block's own anchor, and this map has no screen-space composite to put it in,
 * so an icon or a label inside one is drawn at the anchor and a line or a
 * polygon inside one is named as skipped. An icon sheet or a picture on a host
 * the app is not allowed to fetch is named as skipped with the host, because
 * "nothing appeared" and "we are not allowed to ask that server" are different
 * problems and only one of them is the reader's file.
 */
export function parsePlacefile(text: string): Placefile {
  const features: OverlayFeature[] = [];
  const skipped = new Set<string>();
  const sheets = new Map<number, Sheet>();
  let title = "";
  let refreshMinutes: number | null = null;
  let color = DEFAULT_COLOR;
  let threshold = ALWAYS_NM;
  let window: TimeWindow | null = null;
  let images = 0;

  let shape: Shape | null = null;
  let image: ImageBlock | null = null;
  /** Where an open `Object` block puts everything inside it. */
  let anchor: [number, number] | null = null;
  /** How many `End:` lines belong to a block we are stepping over. */
  let stepping = 0;

  const isEnd = (line: string) => /^end:?$/i.test(line);

  const place = (
    at: [number, number],
    properties: Record<string, unknown>,
  ): void => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: at },
      properties: { color, ...gateOf(threshold, window), ...properties },
    });
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;

    const directive = line.split(":")[0].trim().toLowerCase();
    const value = line.split(":").slice(1).join(":").trim();

    if (stepping) {
      if (isEnd(line)) stepping -= 1;
      else if (BLOCKS.has(directive)) stepping += 1;
      continue;
    }

    if (image) {
      if (isEnd(line)) {
        const corners = imageCorners(image.vertices);
        if (corners) {
          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[...corners, corners[0]]],
            },
            properties: { kind: "image", image: image.url, ...image.gate },
          });
        } else {
          skipped.add("Image");
        }
        image = null;
        continue;
      }
      const parts = numbers(line.split("//")[0]);
      if (parts.length >= 4 && Math.abs(parts[0]) <= 90) {
        image.vertices.push([parts[1], parts[0], parts[2], parts[3]]);
      }
      continue;
    }

    if (shape) {
      if (isEnd(line)) {
        const feature = toFeature(shape);
        if (feature) features.push(feature);
        shape = null;
        continue;
      }
      // A colour set inside a block applies from there on.
      if (directive === "color") {
        const [red, green, blue] = numbers(value);
        if ([red, green, blue].every((part) => Number.isFinite(part))) {
          color = toHex(red, green, blue);
          shape.color = color;
        }
        continue;
      }
      const point = coordinate(line);
      if (point) shape.points.push(point);
      continue;
    }

    switch (directive) {
      case "title":
        title = value;
        break;
      case "refresh": {
        const minutes = Number(numbers(value)[0]);
        refreshMinutes =
          Number.isFinite(minutes) && minutes > 0 ? minutes : null;
        break;
      }
      case "color": {
        const [red, green, blue] = numbers(value);
        if ([red, green, blue].every((part) => Number.isFinite(part))) {
          color = toHex(red, green, blue);
        }
        break;
      }
      case "threshold": {
        const nm = Number(numbers(value)[0]);
        threshold = Number.isFinite(nm) && nm > 0 ? nm : ALWAYS_NM;
        break;
      }
      case "timerange":
        window = timeWindow(value);
        break;
      case "iconfile": {
        const [file, iconWidth, iconHeight, hotX, hotY] = numbers(
          value.split('"')[0],
        );
        const url = fileName(value);
        const host = hostOf(url);
        if (!Number.isFinite(file) || !(iconWidth > 0) || !(iconHeight > 0)) {
          skipped.add("IconFile");
          break;
        }
        if (!host) {
          // A sheet named as a file beside the placefile. The reader dropped
          // one file on the window, so there is no beside to look in.
          skipped.add("Icon images beside the file");
          break;
        }
        if (!isCachedHost(url)) {
          skipped.add(`Icon images from ${host}`);
          break;
        }
        sheets.set(file, {
          url,
          iconWidth,
          iconHeight,
          hotX: Number.isFinite(hotX) ? hotX : Math.floor(iconWidth / 2),
          hotY: Number.isFinite(hotY) ? hotY : Math.floor(iconHeight / 2),
        });
        break;
      }
      case "icon": {
        const parts = numbers(value.split('"')[0]);
        const [first, second, angle, file, index] = parts;
        const at = anchor ?? ([second, first] as [number, number]);
        if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) break;
        const sheet = sheets.get(file);
        // Without a sheet we can reach, the position and the hover text are
        // still worth drawing: a spotter network file is two hundred people
        // and their reports, and losing all of them because an image server
        // is not on the allowlist would be the wrong trade.
        place(at, {
          kind: sheet && index >= 1 ? "icon" : "place",
          label: quoted(value),
          ...(sheet && index >= 1
            ? {
                icon: iconId(sheet, index),
                angle: Number.isFinite(angle) ? angle : 0,
              }
            : {}),
        });
        break;
      }
      case "image": {
        const url = fileName(value);
        const host = hostOf(url);
        if (!host) {
          skipped.add("Pictures beside the file");
          stepping = 1;
          break;
        }
        if (!isCachedHost(url)) {
          skipped.add(`Pictures from ${host}`);
          stepping = 1;
          break;
        }
        if (images >= MAX_PLACEFILE_IMAGES) {
          skipped.add("Image");
          stepping = 1;
          break;
        }
        images += 1;
        image = { url, gate: gateOf(threshold, window), vertices: [] };
        break;
      }
      case "object": {
        const [lat, lon] = numbers(value);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          anchor = [lon, lat];
        } else {
          skipped.add("Object");
          stepping = 1;
        }
        break;
      }
      case "end":
        anchor = null;
        break;
      case "line":
      case "polygon": {
        // Inside an object these are pixel offsets from the anchor, which is
        // a screen-space composite this map cannot draw on the ground.
        if (anchor) {
          skipped.add("Object shapes");
          stepping = 1;
          break;
        }
        const width = numbers(value)[0];
        shape = {
          kind: directive === "polygon" ? "polygon" : "line",
          width: Number.isFinite(width) && width > 0 ? width : 2,
          hover: quoted(value),
          color,
          points: [],
          gate: gateOf(threshold, window),
        };
        break;
      }
      case "triangles":
        skipped.add("Triangles");
        stepping = 1;
        break;
      case "place":
      case "text": {
        const parts = numbers(value.split('"')[0]);
        const at = anchor ?? ([parts[1], parts[0]] as [number, number]);
        if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) break;
        place(at, { kind: "place", label: quoted(value) });
        break;
      }
      case "font":
        skipped.add("Font");
        break;
      default:
        break;
    }
  }

  // A file that ends mid-shape is truncated; draw what it managed to say.
  const truncated = shape !== null || image !== null;
  if (shape) {
    const feature = toFeature(shape);
    if (feature) features.push(feature);
  }

  return {
    title,
    refreshMinutes,
    data: { type: "FeatureCollection", features },
    skipped: [...skipped],
    truncated,
  };
}

/** Directives that open a block and therefore need their own `End:`. */
const BLOCKS = new Set(["line", "polygon", "triangles", "image", "object"]);

export interface PlacefilePicture {
  url: string;
  /** Top left, top right, bottom right, bottom left. */
  corners: number[][];
  opacity: number;
}

/**
 * The pictures a drawn collection asks for, in the order it lists them.
 *
 * A picture is a source of its own on the map rather than a shape in the
 * shared one, so the map has to be told about each separately. The ceiling is
 * the map's, not the format's: every one of these is a whole image held in
 * memory, and eight files with four pictures each is not a map any more.
 */
export const MAX_DRAWN_PICTURES = 4;

export function placefilePictures(data: unknown): PlacefilePicture[] {
  const features = (data as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const pictures: PlacefilePicture[] = [];
  for (const feature of features) {
    const shape = feature as {
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown };
    };
    if (shape.properties?.kind !== "image") continue;
    if (typeof shape.properties.image !== "string") continue;
    const ring = (shape.geometry?.coordinates as number[][][] | undefined)?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const opacity = shape.properties.fileOpacity;
    pictures.push({
      url: shape.properties.image,
      corners: ring.slice(0, 4),
      opacity: typeof opacity === "number" ? opacity : 1,
    });
    if (pictures.length >= MAX_DRAWN_PICTURES) break;
  }
  return pictures;
}

export function looksLikePlacefile(text: string): boolean {
  return /^\s*(title|refresh|color|threshold|iconfile|line|place)\s*:/im.test(
    text,
  );
}
