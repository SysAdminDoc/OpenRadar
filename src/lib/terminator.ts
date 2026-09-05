/**
 * Where it is dark, worked out rather than fetched.
 *
 * A globe with no terminator on it gives a reader no sense of which half of a
 * line of storms is running through the night. The sun's position is an
 * astronomical calculation with no service behind it: the same equations the
 * NOAA solar calculator publishes, which are good to a fraction of a degree
 * for any date this app will ever draw, and which cost nothing to run every
 * minute.
 *
 * What comes out is one polygon covering the unlit half of the world, drawn as
 * a wash under every data layer. It is geography rather than weather: it must
 * never sit over a warning, and it must never be mistaken for one.
 */

/** How finely the edge is walked, in degrees of longitude. */
const STEP_DEGREES = 1;

/** Days from the J2000 epoch to a moment. */
function julianCenturies(at: number): number {
  // 2451545.0 is noon on 2000-01-01 TT; the epoch offset is in days.
  const days = at / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  return days / 36_525;
}

const RADIANS = Math.PI / 180;

/**
 * The sun's declination and the equation of time, in degrees and minutes.
 *
 * The NOAA calculator's own sequence: the geometric mean longitude and
 * anomaly, the equation of centre, the apparent longitude with the nutation
 * term, and the obliquity with its correction. Written out rather than
 * shortened, because every term here is worth a tenth of a degree or more at
 * the solstices and a shortened version reads as right all spring.
 */
export function solarPosition(at: number): {
  declination: number;
  equationOfTime: number;
} {
  const t = julianCenturies(at);

  const meanLongitude = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const centre =
    Math.sin(meanAnomaly * RADIANS) *
      (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RADIANS) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RADIANS) * 0.000289;

  const trueLongitude = meanLongitude + centre;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude =
    trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RADIANS);

  const meanObliquity =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RADIANS);

  const declination =
    Math.asin(
      Math.sin(obliquity * RADIANS) * Math.sin(apparentLongitude * RADIANS),
    ) / RADIANS;

  // The equation of time, in minutes: how far the real sun runs ahead of or
  // behind the mean one, which is what puts the terminator's kink where it is.
  const y = Math.tan((obliquity / 2) * RADIANS) ** 2;
  const equationOfTime =
    (4 *
      (y * Math.sin(2 * meanLongitude * RADIANS) -
        2 * eccentricity * Math.sin(meanAnomaly * RADIANS) +
        4 *
          eccentricity *
          y *
          Math.sin(meanAnomaly * RADIANS) *
          Math.cos(2 * meanLongitude * RADIANS) -
        0.5 * y * y * Math.sin(4 * meanLongitude * RADIANS) -
        1.25 *
          eccentricity *
          eccentricity *
          Math.sin(2 * meanAnomaly * RADIANS))) /
    RADIANS;

  return { declination, equationOfTime };
}

/**
 * The longitude the sun is directly over.
 *
 * Noon runs west at fifteen degrees an hour from the meridian, offset by the
 * equation of time. Wrapped into the usual half-open range, because a value of
 * 183 draws a polygon that crosses the antimeridian the long way round.
 */
export function subsolarLongitude(at: number): number {
  const { equationOfTime } = solarPosition(at);
  const utcMinutes = (at / 60_000) % 1440;
  const solarMinutes = utcMinutes + equationOfTime;
  const longitude = 180 - solarMinutes / 4;
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/**
 * How far above or below the horizon the sun is at a place, in degrees.
 *
 * Only ever asked about the middle of a screen, so no refraction correction:
 * the half-degree it is worth is smaller than the wash's own edge.
 */
export function solarElevation(
  at: number,
  latitude: number,
  longitude: number,
): number {
  const { declination } = solarPosition(at);
  const hourAngle = (longitude - subsolarLongitude(at)) * RADIANS;
  const sine =
    Math.sin(latitude * RADIANS) * Math.sin(declination * RADIANS) +
    Math.cos(latitude * RADIANS) *
      Math.cos(declination * RADIANS) *
      Math.cos(hourAngle);
  return Math.asin(Math.min(1, Math.max(-1, sine))) / RADIANS;
}

/**
 * The moment the wash belongs to, in milliseconds.
 *
 * The frame on screen, not the wall clock. A reader scrubbed to the start of a
 * two-hour loop is looking at ground the sun stood thirty degrees further east
 * over, and a replay of a 2011 afternoon drew tonight's night across it. What
 * the map shows and where the sun was have to be the same moment, and the
 * frame is the one that knows.
 *
 * Rounded down to the minute, which is the granularity the fallback below has:
 * the clock this stands in for ticks once a minute, and two frames a second
 * apart are not two positions of the sun. It does not make playback cheaper.
 * Frames are five or ten minutes apart, so every step of a loop is a new
 * moment and a new polygon, which is the feature working rather than a cost to
 * avoid: ten minutes is two and a half degrees of longitude and the edge
 * visibly moves.
 *
 * The clock is the fallback rather than the rule. With no frames yet there is
 * no moment to draw for, and the caller's own guard treats zero as "no wash",
 * so answering zero here would take the layer off an empty timeline.
 */
export function nightMoment(
  frameTimeSeconds: number | undefined,
  clock: number,
): number {
  if (frameTimeSeconds === undefined || !Number.isFinite(frameTimeSeconds)) {
    return clock;
  }
  return Math.floor(frameTimeSeconds / 60) * 60_000;
}

/**
 * The unlit half of the world as one polygon.
 *
 * The edge is the set of places where the sun is on the horizon, which for a
 * given declination is one latitude per longitude. The polygon then closes
 * over whichever pole is in darkness: in the northern winter that is the north
 * pole, and a polygon that closed over the south instead would shade the lit
 * half of the world.
 */
export function nightPolygon(at: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const { declination } = solarPosition(at);
  const noon = subsolarLongitude(at);
  const ring: Array<[number, number]> = [];

  for (let step = 0; step <= 360 / STEP_DEGREES; step += 1) {
    const longitude = -180 + step * STEP_DEGREES;
    const hourAngle = (longitude - noon) * RADIANS;
    // Where the sun sits exactly on the horizon: the latitude whose sine of
    // elevation is zero for this hour angle and declination.
    const latitude =
      Math.atan(-Math.cos(hourAngle) / Math.tan(declination * RADIANS)) /
      RADIANS;
    ring.push([longitude, latitude]);
  }

  // Whichever pole has no sun on it. `declination` is positive in the northern
  // summer, when the south pole is the dark one.
  const pole = declination > 0 ? -90 : 90;
  ring.push([180, pole], [-180, pole], [ring[0][0], ring[0][1]]);

  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { subsolarLongitude: noon, declination },
  };
}
