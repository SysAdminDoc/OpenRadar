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
 * A group is an optional intensity, then two-letter codes run together:
 * `-RA`, `+SHRA`, `TSRA`, `BR`, `FG`, `SN`, `FZRA`. Four things in a report
 * look like present weather and are not, and all four were being read as it:
 *
 * - The station identifier. A special is often published with a `METAR` or
 *   `SPECI` word in front of it, so dropping the first token dropped the word
 *   and left the id, and stations called KRAL and KSNA reported rain and snow
 *   in clear air.
 * - Anything after `TEMPO`, `BECMG` or `NOSIG`. That is a forecast of what
 *   the weather is about to do, not what it is doing.
 * - A `RE` group. `RERA` means the rain ended within the hour.
 * - A `VC` group. That is weather in the vicinity rather than at the station,
 *   and `VCTS` is not a thunderstorm overhead.
 *
 * Order matters. A thunderstorm with rain in it is a thunderstorm, and a
 * report of both snow and rain is drawn as the colder of the two, because
 * that is the one somebody is dressing for.
 */
export function conditionFromMetar(raw: string): AmbientCondition | null {
  // Everything from the remarks on is prose. Split on the word rather than on
  // one space before it: a report wrapped onto a second line puts a newline
  // there, and the remarks of most automated stations carry `TSNO`, which
  // says the thunderstorm sensor is out of service.
  const body = raw.toUpperCase().split(/\s(?=RMK)/)[0];
  const groups = body.split(/\s+/);
  let found: AmbientCondition | null = null;
  for (const [at, group] of groups.entries()) {
    // The station identifier, with or without the word in front of it.
    if (at < 2 && /^(METAR|SPECI|COR|[A-Z]{4})$/.test(group)) continue;
    // A trend group, and everything after it, is a forecast.
    if (group === "TEMPO" || group === "BECMG" || group === "NOSIG") break;
    // A present-weather group is short and carries no digits. That one rule
    // keeps out the wind (`24015G25KT`), the visibility (`10SM`), the cloud
    // layers (`BKN035`), the temperature (`M02/M08`) and the altimeter.
    if (!/^[+-]?[A-Z]{2,8}$/.test(group)) continue;
    // Recent weather is over, and vicinity weather is somewhere else.
    if (group.startsWith("RE") || group.startsWith("VC")) continue;
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
