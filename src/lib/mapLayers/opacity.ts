/**
 * Which paint properties a reader's opacity slider multiplies.
 *
 * A slider does not replace the opacity a layer was designed with, it scales
 * it, so the values here are the ones to remember before anything is scaled.
 * Several of them are expressions rather than numbers, because the alert fill
 * is fainter than its outline and a faded lightning flash is fainter than a
 * fresh one; flattening those to one value would throw the design away and
 * leave the layer readable only at full.
 *
 * A symbol layer has two, the icon and the text, and they fade separately.
 * That is the whole reason this is a list: remembering one of the pair left
 * the station plots with a slider that stored a value and changed nothing.
 */
export function baseOpacity(layer: {
  id: string;
  type: string;
  paint?: Record<string, unknown>;
}): Array<[string, unknown]> {
  const properties =
    layer.type === "fill"
      ? ["fill-opacity"]
      : layer.type === "line"
        ? ["line-opacity"]
        : layer.type === "circle"
          ? ["circle-opacity"]
          : layer.type === "symbol"
            ? ["icon-opacity", "text-opacity"]
            : [];
  const paint = layer.paint ?? {};
  // A layer that never said gets MapLibre's own default of one.
  return properties.map((property) => [property, paint[property] ?? 1]);
}
