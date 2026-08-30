import type { OverlayData, OverlayFeature } from "./overlays";

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

interface Shape {
  kind: "line" | "polygon";
  width: number;
  hover: string;
  color: string;
  points: Array<[number, number]>;
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
    },
  };
}

/**
 * The GRLevelX placefile format, enough of it to draw one. Lines, polygons,
 * points, and text with their colours and hover text are read. Icons need image
 * files the format points at by URL, and an object block positions its contents
 * in screen pixels rather than on the ground, so both are named as skipped and
 * their contents are stepped over rather than drawn in the wrong place.
 */
export function parsePlacefile(text: string): Placefile {
  const features: OverlayFeature[] = [];
  const skipped = new Set<string>();
  let title = "";
  let refreshMinutes: number | null = null;
  let color = DEFAULT_COLOR;
  let shape: Shape | null = null;
  /** How many `End:` lines belong to an object block we are stepping over. */
  let insideObject = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;

    const directive = line.split(":")[0].trim().toLowerCase();

    if (insideObject) {
      if (/^end:?$/i.test(line)) insideObject -= 1;
      else if (directive === "line" || directive === "polygon") {
        insideObject += 1;
      }
      continue;
    }

    if (shape) {
      if (/^end:?$/i.test(line)) {
        const feature = toFeature(shape);
        if (feature) features.push(feature);
        shape = null;
        continue;
      }
      // A colour set inside a block applies from there on.
      if (directive === "color") {
        const [red, green, blue] = numbers(line.split(":").slice(1).join(":"));
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

    const value = line.split(":").slice(1).join(":").trim();
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
      case "line":
      case "polygon": {
        const width = numbers(value)[0];
        shape = {
          kind: directive === "polygon" ? "polygon" : "line",
          width: Number.isFinite(width) && width > 0 ? width : 2,
          hover: quoted(value),
          color,
          points: [],
        };
        break;
      }
      case "place":
      case "text": {
        const parts = numbers(value.split('"')[0]);
        const [lat, lon] = parts;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) break;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { kind: "place", color, label: quoted(value) },
        });
        break;
      }
      case "object":
        skipped.add("Object");
        insideObject = 1;
        break;
      case "icon":
      case "iconfile":
      case "font":
        skipped.add(directive === "font" ? "Font" : "Icon");
        break;
      default:
        break;
    }
  }

  // A file that ends mid-shape is truncated; draw what it managed to say.
  const truncated = shape !== null;
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

export function looksLikePlacefile(text: string): boolean {
  return /^\s*(title|refresh|color|threshold|iconfile|line|place)\s*:/im.test(
    text,
  );
}
