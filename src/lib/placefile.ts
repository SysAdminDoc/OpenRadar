import type { OverlayData, OverlayFeature } from "./overlays";

export interface Placefile {
  title: string;
  /** Minutes the file asks to be refreshed at, when it says. */
  refreshMinutes: number | null;
  data: OverlayData;
  /** Directives that were recognised but carry no geometry we can draw. */
  skipped: string[];
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
  return text
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

/** A `lat, lon` line inside a Line, Polygon, or Object block. */
function coordinate(line: string): [number, number] | null {
  const parts = numbers(line.split("//")[0]);
  if (parts.length < 2) return null;
  const [lat, lon] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

/**
 * The GRLevelX placefile format, enough of it to draw one. Lines, polygons,
 * points, and text with their colours and hover text are read; icons need image
 * files the format points at by URL, and object blocks position their contents
 * in screen pixels, so both are reported as skipped rather than drawn wrong.
 */
export function parsePlacefile(text: string): Placefile {
  const features: OverlayFeature[] = [];
  const skipped = new Set<string>();
  let title = "";
  let refreshMinutes: number | null = null;
  let color = DEFAULT_COLOR;

  let shape: {
    kind: "line" | "polygon";
    width: number;
    hover: string;
    color: string;
    points: Array<[number, number]>;
  } | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;

    if (shape) {
      if (/^end:?$/i.test(line)) {
        if (shape.points.length >= 2) {
          const closed =
            shape.kind === "polygon"
              ? [...shape.points, shape.points[0]]
              : null;
          features.push({
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
          });
        }
        shape = null;
        continue;
      }
      const point = coordinate(line);
      if (point) shape.points.push(point);
      continue;
    }

    const [directive, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    switch (directive.trim().toLowerCase()) {
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
          kind:
            directive.trim().toLowerCase() === "polygon" ? "polygon" : "line",
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
          properties: {
            kind: "place",
            color,
            label: quoted(value),
          },
        });
        break;
      }
      case "icon":
      case "iconfile":
      case "object":
      case "font":
        skipped.add(directive.trim());
        break;
      default:
        break;
    }
  }

  return {
    title,
    refreshMinutes,
    data: { type: "FeatureCollection", features },
    skipped: [...skipped],
  };
}

export function looksLikePlacefile(text: string): boolean {
  return /^\s*(title|refresh|color|threshold|iconfile|line|place)\s*:/im.test(
    text,
  );
}
