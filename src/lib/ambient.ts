/**
 * What the weather is doing where the reader watches, in four words.
 *
 * This is the only input to the ambient treatment on the workspace chrome,
 * and it is deliberately the smallest honest one: an observation from a named
 * station, with the time it was taken, reduced to rain, snow, fog or thunder.
 *
 * It is read out of a raw METAR rather than a model. A model's idea of the
 * present is a guess, and an app that draws rain down the edge of a panel
 * while the sun is out is a toy. A station report says what an instrument and
 * an observer at an airport wrote down, which is a claim somebody stands
 * behind, and it comes with the time and the place that make it checkable.
 *
 * It goes stale rather than persisting. A METAR is issued hourly, with
 * specials in between when the weather changes, so an hour and a half of
 * silence means the station has stopped reporting rather than that it is
 * still raining. The effect stops; it does not carry on drawing the last
 * thing it knew.
 */

/** The four things the chrome can show, and nothing else. */
export type AmbientCondition = "rain" | "snow" | "fog" | "thunder";

export interface AmbientObservation {
  condition: AmbientCondition;
  /** The station that reported it, which is named where the effect is turned on. */
  station: string;
  /** When the observation was taken, in milliseconds. */
  observed: number;
}

/**
 * How old a report may be before the effect stops.
 *
 * A routine METAR is hourly and a special is issued when the weather changes,
 * so ninety minutes is comfortably past a missed hour and well short of
 * pretending a morning's rain is still falling in the afternoon.
 */
export const AMBIENT_STALE_MS = 90 * 60_000;

/**
 * The present-weather groups of a raw METAR, as the code writes them.
 *
 * A group is an optional intensity or proximity, then two-letter codes run
 * together: `-RA`, `+SHRA`, `TSRA`, `VCSH`, `BR`, `FG`, `SN`, `FZRA`. They sit
 * between the visibility and the cloud groups, and the two things this has to
 * avoid reading as weather are the station identifier at the front and the
 * temperature and pressure groups at the back.
 *
 * Order matters. A thunderstorm with rain in it is a thunderstorm, and a
 * report of both snow and rain is drawn as the colder of the two, because
 * that is the one somebody is dressing for.
 */
export function conditionFromMetar(raw: string): AmbientCondition | null {
  // Everything after the report's own remarks section is prose, not code.
  const body = raw.split(" RMK")[0].toUpperCase();
  const groups = body.split(/\s+/).slice(1);
  let found: AmbientCondition | null = null;
  for (const group of groups) {
    // A present-weather group is short and carries no digits. That one rule
    // keeps out the wind (`24015G25KT`), the visibility (`10SM`), the cloud
    // layers (`BKN035`), the temperature (`M02/M08`) and the altimeter.
    if (!/^[+-]?[A-Z]{2,8}$/.test(group)) continue;
    if (group.includes("TS")) return "thunder";
    if (/SN|SG|IC|PL|GS|GR/.test(group)) found = "snow";
    else if (/RA|DZ|UP/.test(group) && found !== "snow") found = "rain";
    else if (/FG|BR|HZ|FU/.test(group) && !found) found = "fog";
  }
  return found;
}

/**
 * One observation, or nothing.
 *
 * Nothing when the report says no weather, when it is too old to speak for
 * the present, or when it carries no time at all: an observation with no time
 * on it cannot be checked for staleness, and an effect that cannot go stale
 * is an effect that lies eventually.
 */
export function ambientObservation(
  raw: string,
  observedMs: number | null,
  station: string,
  nowMs: number,
): AmbientObservation | null {
  if (!raw || observedMs === null || !Number.isFinite(observedMs)) return null;
  if (nowMs - observedMs > AMBIENT_STALE_MS) return null;
  // A report stamped in the future is a clock somebody has set wrong, on this
  // machine or at the station. Neither is a reason to draw rain.
  if (observedMs - nowMs > 15 * 60_000) return null;
  const condition = conditionFromMetar(raw);
  if (!condition) return null;
  return { condition, station: station || "", observed: observedMs };
}
