import { describe, expect, it } from "vitest";
import {
  bulkShear,
  dewpointFromMixingRatio,
  dryAdiabat,
  freezingLevel,
  hodographPoints,
  liftParcel,
  liftingCondensationLevel,
  mixingRatio,
  moistAdiabat,
  potentialTemperature,
  precipitableWater,
  equivalentPotentialTemperature,
  saturationVapourPressure,
  windComponents,
  type SoundingLevel,
} from "./thermo";

function level(
  pressure: number,
  height: number,
  temperature: number,
  dewpoint: number,
  windKnots: number | null = null,
  windFrom: number | null = null,
): SoundingLevel {
  return { pressure, height, temperature, dewpoint, windKnots, windFrom };
}

describe("the formulas a sounding is read with", () => {
  it("puts saturation vapour pressure where the tables put it", () => {
    // Smithsonian tables, to the hundredth: 6.11 hPa at 0 °C, 12.27 at 10,
    // 23.37 at 20, 42.43 at 30.
    expect(saturationVapourPressure(0)).toBeCloseTo(6.11, 1);
    expect(saturationVapourPressure(10)).toBeCloseTo(12.27, 1);
    expect(saturationVapourPressure(20)).toBeCloseTo(23.37, 1);
    expect(saturationVapourPressure(30)).toBeCloseTo(42.43, 1);
  });

  it("agrees with itself about mixing ratio and dewpoint", () => {
    // A round trip is the honest check here: the two are the same relation
    // read in opposite directions, and a sign slip in either shows up.
    for (const [dewpoint, pressure] of [
      [20, 1000],
      [5, 850],
      [-15, 500],
      [-40, 300],
    ] as const) {
      const w = mixingRatio(dewpoint, pressure);
      expect(dewpointFromMixingRatio(w, pressure)).toBeCloseTo(dewpoint, 4);
    }
    // And the value itself against a published one: 20 °C at 1000 hPa is
    // about 14.9 g/kg.
    expect(mixingRatio(20, 1000)).toBeCloseTo(14.9, 1);
  });

  it("keeps a dry adiabat at one potential temperature", () => {
    const theta = potentialTemperature(20, 1000);
    // A parcel at 1000 hPa and 20 °C has a potential temperature of 20 °C.
    expect(theta - 273.15).toBeCloseTo(20, 6);
    // Lifted dry to 700 hPa, which is about three kilometres up, it has lost
    // roughly 9.8 K per kilometre and reads about -8.4 °C.
    expect(dryAdiabat(theta, 700)).toBeCloseTo(-8.4, 1);
    expect(potentialTemperature(dryAdiabat(theta, 500), 500)).toBeCloseTo(
      theta,
      6,
    );
  });

  it("finds the lifting condensation level where the textbook does", () => {
    // The classic worked example: 30 °C over a 20 °C dewpoint at 1000 hPa.
    // Espy's rule puts the cloud base at about 125 m per degree of spread,
    // so 1250 m, which is around 865 hPa; the dry lapse rate over that depth
    // leaves the parcel near 17.7 °C when it saturates.
    const lcl = liftingCondensationLevel(30, 20, 1000);
    expect(lcl.pressure).toBeCloseTo(865, -1);
    expect(lcl.temperature).toBeCloseTo(17.7, 0);
    // Saturated air condenses where it is.
    const already = liftingCondensationLevel(12, 12, 900);
    expect(already.pressure).toBeCloseTo(900, 0);
    expect(already.temperature).toBeCloseTo(12, 1);
  });

  it("cools a saturated parcel more slowly than a dry one", () => {
    // The whole point of the moist adiabat: a saturated parcel from 20 °C at
    // 1000 hPa arrives at 500 hPa far warmer than a dry one, because the
    // condensation on the way up gave its heat back.
    const moist = moistAdiabat(20, 1000, 500);
    const dry = dryAdiabat(potentialTemperature(20, 1000), 500);
    expect(moist).toBeGreaterThan(dry + 20);

    // And it is the right amount warmer, checked against the thing a moist
    // adiabat conserves rather than against a number remembered off a chart.
    // A saturated parcel keeps its equivalent potential temperature, so
    // lifting it and recomputing has to give the same answer back.
    const before = equivalentPotentialTemperature(20, 20, 1000);
    const after = equivalentPotentialTemperature(moist, moist, 500);
    expect(after).toBeCloseTo(before, -0.5);

    // The same at a colder, drier start, where there is little latent heat
    // left to release and the two rates come together.
    const cold = moistAdiabat(-40, 300, 250);
    expect(cold).toBeLessThan(-40);
    expect(equivalentPotentialTemperature(cold, cold, 250)).toBeCloseTo(
      equivalentPotentialTemperature(-40, -40, 300),
      -0.5,
    );
  });
});

/**
 * A sounding with real convective structure: a warm moist boundary layer, a
 * shallow cap, and a deep conditionally unstable layer above it.
 */
function unstableSounding(): SoundingLevel[] {
  return [
    level(1000, 100, 30, 22, 10, 180),
    level(925, 780, 24, 20, 20, 200),
    level(850, 1500, 20, 17, 25, 220),
    level(800, 2000, 17, 12, 30, 230),
    level(700, 3100, 9, 2, 35, 240),
    level(600, 4400, 1, -8, 40, 250),
    level(500, 5800, -8, -20, 50, 255),
    level(400, 7500, -20, -32, 60, 260),
    level(300, 9600, -38, -50, 70, 265),
    level(250, 10_900, -49, -60, 75, 270),
    level(200, 12_400, -55, -68, 80, 270),
    // The cold top a parcel finally runs out of buoyancy against. Without
    // one the profile has no equilibrium level, which is a fact about the
    // fixture rather than about the weather.
    level(150, 14_200, -62, -75, 85, 275),
    level(100, 16_600, -70, -82, 90, 280),
  ];
}

describe("a parcel lifted through a sounding", () => {
  it("finds the levels a forecaster would read off it", () => {
    const parcel = liftParcel(unstableSounding());
    expect(parcel).not.toBeNull();
    if (!parcel) return;
    expect(parcel.kind).toBe("surface");
    // 30 over 22 at 1000 hPa condenses around 900 hPa.
    expect(parcel.lcl.pressure).toBeGreaterThan(880);
    expect(parcel.lcl.pressure).toBeLessThan(920);
    // It breaks the cap and it has a top, in that order.
    expect(parcel.lfc).not.toBeNull();
    expect(parcel.el).not.toBeNull();
    expect(parcel.el ?? 0).toBeLessThan(parcel.lfc ?? 0);
    // A boundary layer like that gives a few thousand joules.
    expect(parcel.cape).toBeGreaterThan(1000);
    expect(parcel.cape).toBeLessThan(6000);
    // The cap is real but small, and CIN is reported negative.
    expect(parcel.cin).toBeLessThanOrEqual(0);
    expect(parcel.cin).toBeGreaterThan(-300);
  });

  it("gives a capped or stable profile no positive area", () => {
    // An inversion with dry air above it: nothing rises through this.
    const stable = [
      level(1000, 100, 10, 2),
      level(925, 780, 14, 0),
      level(850, 1500, 12, -5),
      level(700, 3100, 4, -20),
      level(500, 5800, -12, -35),
      level(300, 9600, -42, -60),
    ];
    const parcel = liftParcel(stable);
    expect(parcel?.cape).toBe(0);
    // No level of free convection, so nothing to be held down from either.
    expect(parcel?.lfc).toBeNull();
  });

  it("refuses a profile too thin to lift anything through", () => {
    expect(liftParcel([level(1000, 100, 20, 15)])).toBeNull();
    expect(liftParcel([])).toBeNull();
  });
});

describe("what the wind says", () => {
  it("turns a wind into components the way a hodograph needs", () => {
    // A wind from the south blows towards the north: positive v, no u.
    const south = windComponents(20, 180);
    expect(south.u).toBeCloseTo(0, 6);
    expect(south.v).toBeCloseTo(20, 6);
    // From the west: positive u.
    const west = windComponents(20, 270);
    expect(west.u).toBeCloseTo(20, 6);
    expect(west.v).toBeCloseTo(0, 6);
  });

  it("measures the shear between the ground and a height", () => {
    const shear = bulkShear(unstableSounding(), 6000);
    expect(shear).not.toBeNull();
    // Ten knots from 180 at the ground against fifty from 255 near six
    // kilometres: a substantial difference, and a supercell's worth of it.
    expect(shear ?? 0).toBeGreaterThan(30);
    expect(shear ?? 0).toBeLessThan(70);
    // Nothing to measure without winds.
    expect(bulkShear([level(1000, 100, 20, 15)], 6000)).toBeNull();
  });

  it("draws the hodograph in height above the ground", () => {
    const points = hodographPoints(unstableSounding(), 6000);
    expect(points.length).toBeGreaterThan(3);
    expect(points[0].height).toBe(0);
    expect(points.every((point) => point.height <= 6000)).toBe(true);
  });
});

describe("the numbers a column carries", () => {
  it("finds the freezing level between two levels", () => {
    const at = freezingLevel(unstableSounding());
    // Between 600 hPa at 1 °C and 500 hPa at -8 °C, so a little above 4.4 km.
    expect(at).not.toBeNull();
    expect(at ?? 0).toBeGreaterThan(4400);
    expect(at ?? 0).toBeLessThan(5800);
    // A column that never freezes has no freezing level rather than a zero.
    expect(
      freezingLevel([level(1000, 100, 20, 15), level(900, 900, 15, 10)]),
    ).toBeNull();
  });

  it("measures precipitable water in millimetres", () => {
    // A moist warm column of this depth carries a few centimetres.
    const pw = precipitableWater(unstableSounding());
    expect(pw).toBeGreaterThan(20);
    expect(pw).toBeLessThan(70);
    // A dry column carries almost nothing.
    const dry = precipitableWater([
      level(1000, 100, 20, -30),
      level(500, 5800, -10, -50),
    ]);
    expect(dry).toBeLessThan(5);
  });
});
