import { formatNumber, translate } from "../i18n";
import { formatClock, temperatureFromCelsius } from "./units";
import { conditionFromMetar } from "./ambient";

/**
 * What the weather is actually doing near the opening view, in one line.
 *
 * The reason to open a weather app on a calm day. A first launch is otherwise
 * a map and a hint about where the buttons are, which tells somebody how to
 * use the thing and nothing about the sky.
 *
 * It is one station's own report, named and dated. Three rules, and they are
 * the whole design:
 *
 * - It never invents a hazard. A warning is a warning and belongs in the
 *   warning surfaces; this says what an instrument at an airport measured.
 * - It never softens one either. There is no wording here that could stand
 *   between a reader and something serious, because there is no hazard
 *   wording here at all.
 * - It says plainly when it has nothing to report, rather than reaching for
 *   something to fill the line with.
 */
export interface OpeningReading {
  /** The station's identifier, which is the source the line names. */
  station: string;
  /** The raw report, which is where the present weather is read from. */
  raw: string;
  /** Celsius, as every METAR carries it, or null when the report has none. */
  temperatureC: number | null;
  /** When the observation was taken, in milliseconds. */
  observed: number;
}

/**
 * How old a report may be and still open the app.
 *
 * Longer than the ambient effect's ninety minutes: this is one sentence read
 * once, at a moment when the alternative is nothing at all, and a three-hour
 * old observation with its time printed beside it is still a true statement
 * about a real reading.
 */
export const OPENING_STALE_MS = 3 * 60 * 60_000;

export function openingLine(
  reading: OpeningReading | null,
  nowMs: number,
): string | null {
  if (!reading) return null;
  if (!Number.isFinite(reading.observed)) return null;
  if (nowMs - reading.observed > OPENING_STALE_MS) return null;
  // A report from the future is a clock somebody has set wrong, here or at
  // the station, and neither is worth opening the app with.
  if (reading.observed - nowMs > 15 * 60_000) return null;

  const when = formatClock(reading.observed);
  const condition = conditionFromMetar(reading.raw);
  const temperature =
    reading.temperatureC === null
      ? null
      : formatNumber(Math.round(temperatureFromCelsius(reading.temperatureC)));

  if (condition) {
    const falling = translate(`opening.${condition}` as never);
    return temperature === null
      ? translate("opening.weather", {
          station: reading.station,
          weather: falling,
          when,
        })
      : translate("opening.weatherAndAir", {
          station: reading.station,
          weather: falling,
          degrees: temperature,
          when,
        });
  }
  // Nothing falling is worth saying as nothing falling. A station reporting a
  // clear afternoon is a fact about the sky, and reaching past it for
  // something more interesting is how a line stops being trustworthy.
  return temperature === null
    ? translate("opening.quiet", { station: reading.station, when })
    : translate("opening.quietAndAir", {
        station: reading.station,
        degrees: temperature,
        when,
      });
}
