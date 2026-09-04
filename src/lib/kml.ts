import { translate } from "../i18n";
/**
 * KML, read into the GeoJSON the rest of the app draws.
 *
 * The NWS, the Hurricane Center and most of the fire services publish KML
 * beside their shapefiles, and the app already parsed a slice of it inline for
 * the smoke analysis. This is that parser, generalised and shared: Placemark,
 * Point, LineString, LinearRing, Polygon with its holes, MultiGeometry, and
 * the style colours a file carries for itself.
 *
 * What it will not do is follow a `NetworkLink`. A KML that names another
 * address is a KML that fetches, and a file a reader dropped on the window is
 * not a licence to reach the network on their behalf.
 */

/** A colour a KML style carried, as CSS. */
export interface KmlStyle {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number | null;
}

export interface KmlFeature {
  type: "Feature";
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
}

export interface KmlDocument {
  /** The document's own name, for the imported file's label. */
  name: string | null;
  features: KmlFeature[];
}

/** How many features one file may carry, so a huge one cannot take the map. */
export const MAX_KML_FEATURES = 4000;
/** How many positions one geometry may carry, for the same reason. */
export const MAX_KML_POSITIONS = 200_000;

/**
 * `aabbggrr` in hex, which is KML's own byte order and not anybody else's.
 *
 * Alpha first and the colour channels reversed. Read as `rrggbb` a red
 * polygon comes out blue, which looks like a working import of the wrong
 * file rather than a parsing mistake.
 */
export function kmlColor(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{8}$/.test(text)) return null;
  const alpha = Number.parseInt(text.slice(0, 2), 16) / 255;
  const blue = text.slice(2, 4);
  const green = text.slice(4, 6);
  const red = text.slice(6, 8);
  if (alpha >= 1) return `#${red}${green}${blue}`.toLowerCase();
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${Number(alpha.toFixed(3))})`;
}

function text(node: Element | null | undefined, tag: string): string | null {
  const found = node?.getElementsByTagName(tag)[0]?.textContent;
  return found === undefined || found === null ? null : found.trim();
}

/**
 * A coordinate list, as `lon,lat` pairs.
 *
 * Whitespace separated `lon,lat,alt` triples, which is the format's own
 * layout. The altitude is read and dropped: nothing here draws in three
 * dimensions, and carrying it would put a third number into GeoJSON
 * positions that every consumer downstream would have to ignore.
 */
export function coordinates(value: string | null): Array<[number, number]> {
  if (!value) return [];
  const points: Array<[number, number]> = [];
  for (const token of value.trim().split(/\s+/)) {
    if (points.length >= MAX_KML_POSITIONS) break;
    const parts = token.split(",");
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    points.push([lon, lat]);
  }
  return points;
}

/** A ring, closed the way GeoJSON needs and KML does not. */
function closedRing(value: string | null): Array<[number, number]> {
  const points = coordinates(value);
  // Fewer than three distinct corners is not an area. Distinct rather than
  // counted, because a ring that already closes itself carries its first
  // corner twice and three positions would then be a line written as a
  // polygon.
  const corners = new Set(points.map(([lon, lat]) => `${lon},${lat}`));
  if (corners.size < 3) return [];
  const [firstLon, firstLat] = points[0];
  const [lastLon, lastLat] = points[points.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    points.push([firstLon, firstLat]);
  }
  return points;
}

/**
 * Every geometry under a node, MultiGeometry flattened.
 *
 * Exported because the smoke analysis reads its own KML and needs exactly
 * this and nothing else: the density it wants is in a style name and is not
 * general KML, but the rings, the holes and the coordinate parsing are, and
 * one copy of those is the point of this file.
 */
export function geometriesIn(node: Element): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];

  for (const point of Array.from(node.getElementsByTagName("Point"))) {
    const at = coordinates(text(point, "coordinates"));
    if (at.length) found.push({ type: "Point", coordinates: at[0] });
  }
  for (const line of Array.from(node.getElementsByTagName("LineString"))) {
    const along = coordinates(text(line, "coordinates"));
    if (along.length >= 2) {
      found.push({ type: "LineString", coordinates: along });
    }
  }
  for (const polygon of Array.from(node.getElementsByTagName("Polygon"))) {
    const outer = closedRing(
      text(polygon.getElementsByTagName("outerBoundaryIs")[0], "coordinates"),
    );
    if (!outer.length) continue;
    const rings = [outer];
    // The holes, which the smoke parser never looked for. A burn scar with an
    // unburnt island in it is drawn solid without them.
    for (const inner of Array.from(
      polygon.getElementsByTagName("innerBoundaryIs"),
    )) {
      const hole = closedRing(text(inner, "coordinates"));
      if (hole.length) rings.push(hole);
    }
    found.push({ type: "Polygon", coordinates: rings });
  }
  // A bare LinearRing outside a Polygon is a line as far as anything here is
  // concerned, and is only picked up when it is not already inside one.
  for (const ring of Array.from(node.getElementsByTagName("LinearRing"))) {
    if (ring.closest("Polygon")) continue;
    const along = coordinates(text(ring, "coordinates"));
    if (along.length >= 2) {
      found.push({ type: "LineString", coordinates: along });
    }
  }
  return found;
}

/** One `<Style>` element read into the colours it names. */
function styleOf(style: Element): KmlStyle {
  return {
    fill: kmlColor(text(style.getElementsByTagName("PolyStyle")[0], "color")),
    stroke: kmlColor(text(style.getElementsByTagName("LineStyle")[0], "color")),
    strokeWidth:
      Number(text(style.getElementsByTagName("LineStyle")[0], "width") ?? "") ||
      null,
  };
}

/**
 * A `<Style>` written straight inside a placemark, with no id on it.
 *
 * This is what Google Earth writes for a placemark somebody recoloured by
 * hand, and what several generators write for every placemark in the file.
 * Read only as a direct child: a `getElementsByTagName` from the placemark
 * would also find the style of a nested feature, and there is no nesting
 * here worth guessing at.
 */
function inlineStyle(placemark: Element): KmlStyle | null {
  for (const child of Array.from(placemark.children)) {
    if (child.localName === "Style") return styleOf(child);
  }
  return null;
}

/** The styles a document declares, by id. */
function stylesOf(document: Document): Map<string, KmlStyle> {
  const styles = new Map<string, KmlStyle>();
  for (const style of Array.from(document.getElementsByTagName("Style"))) {
    const id = style.getAttribute("id");
    if (!id) continue;
    styles.set(id, styleOf(style));
  }
  // A StyleMap points at one of two styles by state. The normal one is what
  // a map draws; the highlighted one is for a cursor this app does not have.
  for (const map of Array.from(document.getElementsByTagName("StyleMap"))) {
    const id = map.getAttribute("id");
    if (!id) continue;
    for (const pair of Array.from(map.getElementsByTagName("Pair"))) {
      if (text(pair, "key") !== "normal") continue;
      const points = (text(pair, "styleUrl") ?? "").replace(/^#/, "");
      const held = styles.get(points);
      if (held) styles.set(id, held);
    }
  }
  return styles;
}

/**
 * Whether a file the reader chose is KML.
 *
 * The name first, because that is what a reader chose it by, and the content
 * second, because a `.txt` holding KML is a file somebody exported from
 * something that got it wrong and is still a KML.
 */
export function looksLikeKml(name: string, text: string): boolean {
  if (/\.kml$/i.test(name)) return true;
  const head = text.slice(0, 2000);
  return /<kml[\s>]/i.test(head);
}

/**
 * Reads a KML document.
 *
 * Throws for something that is not KML at all, because a file a reader chose
 * that silently adds nothing is worse than one that says what was wrong with
 * it. A KML with no placemarks in it is not that: plenty of real files are
 * empty, and an empty answer is an answer.
 */
export function parseKml(xml: string): KmlDocument {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error(translate("kml.notXml"));
  }
  if (document.getElementsByTagName("kml").length === 0) {
    throw new Error(translate("kml.notKml"));
  }
  const styles = stylesOf(document);
  const features: KmlFeature[] = [];

  for (const placemark of Array.from(
    document.getElementsByTagName("Placemark"),
  )) {
    if (features.length >= MAX_KML_FEATURES) break;
    const styleId = (text(placemark, "styleUrl") ?? "").replace(/^#/, "");
    // A style written inside the placemark wins over one it points at, which
    // is the format's own precedence and the shape a hand-recoloured
    // placemark arrives in.
    const style = inlineStyle(placemark) ?? styles.get(styleId) ?? null;
    const name = text(placemark, "name");
    const description = text(placemark, "description");
    // The file's own extended data, which is where a published KML puts the
    // fields somebody actually wants in a popup.
    const extended: Record<string, string> = {};
    for (const data of Array.from(placemark.getElementsByTagName("Data"))) {
      const key = data.getAttribute("name");
      const value = text(data, "value");
      if (key && value !== null) extended[key] = value;
    }
    for (const geometry of geometriesIn(placemark)) {
      if (features.length >= MAX_KML_FEATURES) break;
      features.push({
        type: "Feature",
        geometry,
        properties: {
          ...extended,
          ...(name === null ? {} : { name }),
          ...(description === null ? {} : { description }),
          ...(style?.fill ? { fill: style.fill } : {}),
          ...(style?.stroke ? { stroke: style.stroke } : {}),
          ...(style?.strokeWidth ? { strokeWidth: style.strokeWidth } : {}),
        },
      });
    }
  }

  // The document's name, not the first folder's: a file whose one folder is
  // called "Layer 1" would otherwise import under that.
  const documentNode = document.getElementsByTagName("Document")[0];
  const name =
    (documentNode ? text(documentNode, "name") : null) ??
    text(document.documentElement, "name");

  return { name, features };
}
