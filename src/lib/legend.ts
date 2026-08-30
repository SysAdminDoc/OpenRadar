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
