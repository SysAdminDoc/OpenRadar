/**
 * The thermodynamics a sounding is read with.
 *
 * Every formula here is one of the standard ones, written out rather than
 * pulled in, because the whole point of the panel above it is that a reader
 * can see where a number came from. Where a formula is an approximation with
 * a name, the name is in the comment beside it and so are its limits.
 *
 * Units, once, so nothing below has to say: pressure in hectopascals,
 * temperature and dewpoint in degrees Celsius, height in metres above sea
 * level, wind speed in knots and direction in degrees the wind comes from.
 */

/** Dry air gas constant over the specific heat at constant pressure. */
const KAPPA = 0.2854;
/** Latent heat of vaporisation at 0 °C, joules per kilogram. */
const LV0 = 2.501e6;
/** Specific heat of dry air at constant pressure, J/kg/K. */
const CP = 1005.7;
/** Gas constant for dry air, J/kg/K. */
const RD = 287.04;
/** Ratio of the gas constants for dry air and water vapour. */
const EPSILON = 0.622;
/** Standard reference pressure, hPa. */
const P0 = 1000;

export interface SoundingLevel {
  /** Hectopascals, descending through the profile. */
  pressure: number;
  /** Metres above sea level. */
  height: number;
  /** Degrees Celsius. */
  temperature: number;
  /** Degrees Celsius, never above the temperature. */
  dewpoint: number;
  /** Knots, or null where the level carries no wind. */
  windKnots: number | null;
  /** Degrees the wind comes from, or null. */
  windFrom: number | null;
}

export function celsiusToKelvin(celsius: number): number {
  return celsius + 273.15;
}

/**
 * Saturation vapour pressure over liquid water, in hectopascals.
 *
 * Bolton (1980) equation 10, which is within a tenth of a per cent of the
 * tables between -35 and 35 °C and is what almost every sounding program
 * uses.
 */
export function saturationVapourPressure(celsius: number): number {
  return 6.112 * Math.exp((17.67 * celsius) / (celsius + 243.5));
}

/** Mixing ratio in grams per kilogram, for a dewpoint at a pressure. */
export function mixingRatio(dewpointC: number, pressureHpa: number): number {
  const e = saturationVapourPressure(dewpointC);
  // Guard the pathological case where the vapour pressure meets the total.
  const denominator = Math.max(pressureHpa - e, 1e-6);
  return 1000 * ((EPSILON * e) / denominator);
}

/** The dewpoint a mixing ratio implies at a pressure, in degrees Celsius. */
export function dewpointFromMixingRatio(
  gramsPerKg: number,
  pressureHpa: number,
): number {
  const w = gramsPerKg / 1000;
  const e = (w * pressureHpa) / (EPSILON + w);
  const logged = Math.log(e / 6.112);
  return (243.5 * logged) / (17.67 - logged);
}

/**
 * Potential temperature in kelvin: what a parcel would be at 1000 hPa if it
 * were brought there dry.
 */
export function potentialTemperature(
  celsius: number,
  pressureHpa: number,
): number {
  return celsiusToKelvin(celsius) * (P0 / pressureHpa) ** KAPPA;
}

/** The temperature a dry adiabat through a point has at another pressure. */
export function dryAdiabat(thetaKelvin: number, pressureHpa: number): number {
  return thetaKelvin * (pressureHpa / P0) ** KAPPA - 273.15;
}

/**
 * The lifting condensation level for a surface parcel.
 *
 * Bolton (1980) equation 15 for the temperature, then Poisson for the
 * pressure it happens at. Returns the pressure in hectopascals and the
 * temperature in degrees Celsius.
 */
export function liftingCondensationLevel(
  temperatureC: number,
  dewpointC: number,
  pressureHpa: number,
): { pressure: number; temperature: number } {
  const t = celsiusToKelvin(temperatureC);
  const td = celsiusToKelvin(dewpointC);
  const tl = 1 / (1 / (td - 56) + Math.log(t / td) / 800) + 56;
  const pl = pressureHpa * (tl / t) ** (1 / KAPPA);
  return { pressure: pl, temperature: tl - 273.15 };
}

/**
 * One step up a moist adiabat, in kelvin.
 *
 * The saturated lapse rate with respect to pressure, integrated by steps
 * small enough that the difference from a finer step is under a hundredth of
 * a degree over the depth of a troposphere.
 */
function moistLapse(temperatureK: number, pressureHpa: number): number {
  const t = temperatureK;
  const es = saturationVapourPressure(t - 273.15);
  const ws = (EPSILON * es) / Math.max(pressureHpa - es, 1e-6);
  const numerator = (RD * t) / CP + (LV0 * ws) / CP;
  const denominator = 1 + (EPSILON * LV0 * LV0 * ws) / (CP * RD * t * t);
  return numerator / denominator / pressureHpa;
}

/**
 * A saturated parcel lifted from one pressure to another.
 *
 * Steps of one hectopascal, which is finer than any sounding's own spacing
 * and cheap enough to run for every level of a profile.
 */
export function moistAdiabat(
  temperatureC: number,
  fromHpa: number,
  toHpa: number,
): number {
  let t = celsiusToKelvin(temperatureC);
  const step = fromHpa > toHpa ? -1 : 1;
  let p = fromHpa;
  while ((step < 0 && p > toHpa) || (step > 0 && p < toHpa)) {
    const next =
      step < 0 ? Math.max(p + step, toHpa) : Math.min(p + step, toHpa);
    const dp = next - p;
    // Midpoint, which halves the error of a plain Euler step for free.
    const half = t + moistLapse(t, p) * (dp / 2);
    t += moistLapse(half, p + dp / 2) * dp;
    p = next;
  }
  return t - 273.15;
}

/**
 * Equivalent potential temperature in kelvin.
 *
 * Bolton (1980) equation 43, the one everybody uses. It is what a moist
 * adiabat conserves, which makes it the honest check on the integration
 * above: lift a parcel and this should come back the same.
 */
export function equivalentPotentialTemperature(
  temperatureC: number,
  dewpointC: number,
  pressureHpa: number,
): number {
  const t = celsiusToKelvin(temperatureC);
  const w = mixingRatio(dewpointC, pressureHpa) / 1000;
  const e = saturationVapourPressure(dewpointC);
  // Bolton equation 21 for the temperature at the lifting condensation level.
  const tl =
    2840 / (3.5 * Math.log(t) - Math.log(Math.max(e, 1e-9)) - 4.805) + 55;
  return (
    t *
    (P0 / pressureHpa) ** (0.2854 * (1 - 0.28 * w)) *
    Math.exp((3.376 / tl - 0.00254) * 1000 * w * (1 + 0.81 * w))
  );
}

/** Where a parcel is on its way up, and what the air around it is doing. */
export interface ParcelLevel {
  pressure: number;
  height: number;
  /** The parcel's own temperature at that pressure, in degrees Celsius. */
  parcel: number;
  /** The sounding's temperature there, for the area between them. */
  environment: number;
}

export interface ParcelProfile {
  /** Which parcel this is, said plainly wherever a number from it is shown. */
  kind: "surface" | "mixed-layer" | "most-unstable";
  levels: ParcelLevel[];
  lcl: { pressure: number; temperature: number };
  /** Level of free convection, or null when the parcel never gets there. */
  lfc: number | null;
  /** Equilibrium level, or null. */
  el: number | null;
  /** Joules per kilogram, positive area only. */
  cape: number;
  /** Joules per kilogram, negative and reported as a negative number. */
  cin: number;
}

function interpolate(
  levels: SoundingLevel[],
  pressure: number,
  read: (level: SoundingLevel) => number,
): number {
  for (let at = 1; at < levels.length; at += 1) {
    const above = levels[at];
    const below = levels[at - 1];
    if (pressure <= below.pressure && pressure >= above.pressure) {
      const span = below.pressure - above.pressure;
      if (span <= 0) return read(below);
      const share = (below.pressure - pressure) / span;
      return read(below) + (read(above) - read(below)) * share;
    }
  }
  return read(levels[levels.length - 1]);
}

/**
 * A parcel lifted through the sounding, with the areas that come out of it.
 *
 * Dry to the lifting condensation level and saturated above it, which is the
 * ordinary pseudo-adiabatic assumption. The virtual temperature correction is
 * deliberately not applied, and the panel says so: it changes CAPE by a few
 * per cent and quoting a number without saying which convention it follows is
 * the thing that makes two programs disagree for no visible reason.
 */
export function liftParcel(
  levels: SoundingLevel[],
  kind: ParcelProfile["kind"] = "surface",
): ParcelProfile | null {
  const usable = levels.filter(
    (level) =>
      Number.isFinite(level.pressure) &&
      Number.isFinite(level.temperature) &&
      Number.isFinite(level.dewpoint),
  );
  if (usable.length < 3) return null;

  const start = usable[0];
  const lcl = liftingCondensationLevel(
    start.temperature,
    start.dewpoint,
    start.pressure,
  );
  const theta = potentialTemperature(start.temperature, start.pressure);

  const profile: ParcelLevel[] = [];
  for (const level of usable) {
    if (level.pressure > lcl.pressure) {
      profile.push({
        pressure: level.pressure,
        height: level.height,
        parcel: dryAdiabat(theta, level.pressure),
        environment: level.temperature,
      });
      continue;
    }
    profile.push({
      pressure: level.pressure,
      height: level.height,
      parcel: moistAdiabat(lcl.temperature, lcl.pressure, level.pressure),
      environment: level.temperature,
    });
  }

  // The area between the two curves, in the coordinates the integral is
  // defined in: R_d times the temperature difference against log pressure.
  let cape = 0;
  let cin = 0;
  let lfc: number | null = null;
  let el: number | null = null;
  for (let at = 1; at < profile.length; at += 1) {
    const below = profile[at - 1];
    const above = profile[at];
    const dLnP = Math.log(below.pressure / above.pressure);
    if (!Number.isFinite(dLnP) || dLnP <= 0) continue;
    const lower = below.parcel - below.environment;
    const upper = above.parcel - above.environment;
    const area = RD * ((lower + upper) / 2) * dLnP;
    if (lower <= 0 && upper > 0) lfc = above.pressure;
    if (lower > 0 && upper <= 0 && lfc !== null && el === null) {
      el = above.pressure;
    }
    // Below the level of free convection the negative area is what holds a
    // storm down, and above the equilibrium level nothing counts either way.
    if (area > 0) {
      if (lfc !== null && el === null) cape += area;
    } else if (lfc === null) {
      cin += area;
    }
  }

  return {
    kind,
    levels: profile,
    lcl,
    lfc,
    el,
    cape: Math.max(0, cape),
    cin: Math.min(0, cin),
  };
}

/** A wind as its components, in knots, east and north positive. */
export function windComponents(
  speedKnots: number,
  fromDegrees: number,
): { u: number; v: number } {
  const radians = ((fromDegrees + 180) * Math.PI) / 180;
  return {
    u: speedKnots * Math.sin(radians),
    v: speedKnots * Math.cos(radians),
  };
}

/**
 * The difference between the wind at the surface and the wind at a height,
 * in knots.
 *
 * The number every convective forecast starts with. Heights are metres above
 * ground, which is what a reader means by "zero to six".
 */
export function bulkShear(
  levels: SoundingLevel[],
  metresAboveGround: number,
): number | null {
  const winds = levels.filter(
    (level) => level.windKnots !== null && level.windFrom !== null,
  );
  if (winds.length < 2) return null;
  const ground = winds[0].height;
  const top = ground + metresAboveGround;
  let above: SoundingLevel | null = null;
  for (const level of winds) {
    if (level.height >= top) {
      above = level;
      break;
    }
  }
  if (!above) return null;
  const low = windComponents(winds[0].windKnots ?? 0, winds[0].windFrom ?? 0);
  const high = windComponents(above.windKnots ?? 0, above.windFrom ?? 0);
  return Math.hypot(high.u - low.u, high.v - low.v);
}

/** Every level's wind as components, for the hodograph to draw. */
export function hodographPoints(
  levels: SoundingLevel[],
  metresAboveGround = 12_000,
): Array<{ u: number; v: number; height: number }> {
  const winds = levels.filter(
    (level) => level.windKnots !== null && level.windFrom !== null,
  );
  if (!winds.length) return [];
  const ground = winds[0].height;
  return winds
    .filter((level) => level.height - ground <= metresAboveGround)
    .map((level) => ({
      ...windComponents(level.windKnots ?? 0, level.windFrom ?? 0),
      height: level.height - ground,
    }));
}

/** The temperature at a height above ground, for the freezing level. */
export function freezingLevel(levels: SoundingLevel[]): number | null {
  for (let at = 1; at < levels.length; at += 1) {
    const below = levels[at - 1];
    const above = levels[at];
    if (below.temperature >= 0 && above.temperature < 0) {
      const span = below.temperature - above.temperature;
      const share = span === 0 ? 0 : below.temperature / span;
      return below.height + (above.height - below.height) * share;
    }
  }
  return null;
}

/** Precipitable water in millimetres, which is the column's own answer. */
export function precipitableWater(levels: SoundingLevel[]): number {
  let total = 0;
  for (let at = 1; at < levels.length; at += 1) {
    const below = levels[at - 1];
    const above = levels[at];
    const dp = below.pressure - above.pressure;
    if (!(dp > 0)) continue;
    const wBelow = mixingRatio(below.dewpoint, below.pressure) / 1000;
    const wAbove = mixingRatio(above.dewpoint, above.pressure) / 1000;
    // Hectopascals to pascals, and kilograms per square metre to millimetres.
    total += (((wBelow + wAbove) / 2) * dp * 100) / 9.80665;
  }
  return total;
}

/** The temperature of the sounding at a pressure, for a caller drawing one. */
export function temperatureAt(
  levels: SoundingLevel[],
  pressure: number,
): number {
  return interpolate(levels, pressure, (level) => level.temperature);
}
