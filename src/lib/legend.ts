import { paletteRange, type Palette } from "./palette";
import { RAIN_RATE_RAMP, RAIN_RATE_STOPS } from "./providers/geomet";

/** Labelled stops on the NWS reflectivity ramp the mosaics are drawn with. */
const DBZ_MIN = 5;
const DBZ_MAX = 75;
const DBZ_STOPS = [5, 20, 35, 50, 65];
/** The velocity ramp runs either side of still air rather than up from a floor. */
const VELOCITY_MIN = -35;
const VELOCITY_MAX = 35;
const VELOCITY_STOPS = [-30, -15, 0, 15, 30];

export interface LegendScale {
  min: number;
  max: number;
  stops: number[];
  unit: string;
  /** The class the gradient is drawn from, which has to match these numbers. */
  ramp: string;
  /** A gradient built at runtime, for a table the stylesheet cannot know. */
  gradient?: string;
  logarithmic?: boolean;
}

export type LegendScaleId = "reflectivity" | "velocity" | "rain-rate" | "none";

export const REFLECTIVITY_SCALE: LegendScale = {
  min: DBZ_MIN,
  max: DBZ_MAX,
  stops: DBZ_STOPS,
  unit: "dBZ",
  ramp: "legend-ramp",
};

export const VELOCITY_SCALE: LegendScale = {
  min: VELOCITY_MIN,
  max: VELOCITY_MAX,
  stops: VELOCITY_STOPS,
  unit: "m/s",
  ramp: "legend-ramp legend-ramp--velocity",
};

/**
 * Rain rate runs over three orders of magnitude, so the scale is drawn and
 * labelled on a log axis. A linear one puts every useful value in the first
 * tenth of the bar.
 */
export const RAIN_RATE_SCALE: LegendScale = {
  min: RAIN_RATE_RAMP[0][0],
  max: RAIN_RATE_RAMP[RAIN_RATE_RAMP.length - 1][0],
  stops: RAIN_RATE_STOPS,
  unit: "mm/h",
  ramp: "legend-ramp legend-ramp--rain-rate",
  logarithmic: true,
};

/**
 * The scale a loaded colour table draws, built from the table's own stops so
 * the bar beside the map is the bar the map was painted with. Labelled at up
 * to five stops, because a table can have forty and a legend cannot.
 */
export function paletteLegend(palette: Palette, unit: string): LegendScale {
  const { min, max } = paletteRange(palette);
  const span = max - min;
  const at = (value: number) => (span > 0 ? ((value - min) / span) * 100 : 0);

  // The bar has to be the ramp the map is painted with, which means the second
  // colour on a line and a solid stop holding its colour to the next one. A
  // gradient of first colours alone describes a different picture.
  const parts: string[] = [];
  for (const [index, stop] of palette.stops.entries()) {
    const next = palette.stops[index + 1];
    parts.push(`${stop.color} ${at(stop.value)}%`);
    if (!next) continue;
    if (stop.toColor) {
      parts.push(`${stop.toColor} ${at(next.value)}%`);
    } else {
      // Solid to the next stop, so the colour is repeated at its far edge.
      parts.push(`${stop.color} ${at(next.value)}%`);
    }
  }
  // A single stop is one colour everywhere, and one colour is not a gradient.
  if (parts.length < 2) parts.push(`${palette.stops[0].color} 100%`);

  // Up to five labels, always including the last, because the top of the scale
  // is the part anyone reads first.
  const step = Math.max(1, Math.ceil((palette.stops.length - 1) / 4));
  const labels = palette.stops
    .filter((_, index) => index % step === 0)
    .map((stop) => stop.value);
  if (labels.at(-1) !== max) labels.push(max);

  return {
    min,
    // A table whose stops are all one value would divide by nothing.
    max: span > 0 ? max : min + 1,
    stops: labels,
    unit: palette.units ?? unit,
    ramp: "legend-ramp",
    gradient: `linear-gradient(90deg, ${parts.join(", ")})`,
  };
}

export function legendScale(id: LegendScaleId): LegendScale | null {
  switch (id) {
    case "reflectivity":
      return REFLECTIVITY_SCALE;
    case "velocity":
      return VELOCITY_SCALE;
    case "rain-rate":
      return RAIN_RATE_SCALE;
    default:
      return null;
  }
}

/** Where along the bar a labelled value sits, as a percentage. */
export function stopPosition(scale: LegendScale, value: number): number {
  if (!scale.logarithmic) {
    return ((value - scale.min) / (scale.max - scale.min)) * 100;
  }
  const low = Math.log10(scale.min);
  const high = Math.log10(scale.max);
  return ((Math.log10(value) - low) / (high - low)) * 100;
}
