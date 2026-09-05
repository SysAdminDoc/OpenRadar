import { describe, expect, it } from "vitest";
import type {
  IsothermLevel,
  LightningForecast,
  LightningJump,
  LightningWindow,
} from "../lib/lightningGrids";
import {
  ISOTHERM_LEVELS,
  LIGHTNING_FORECASTS,
  LIGHTNING_JUMPS,
  LIGHTNING_WINDOWS,
} from "../lib/lightningGrids";
import {
  MRMS_LAYERS,
  levelFor,
  productFor,
  type MrmsChoices,
  type MrmsLayer,
} from "./useMrmsOverlays";
import { GAUGE_QPE_PERIODS } from "../lib/gaugeQpe";
import {
  AZ_SHEAR_LEVELS,
  ROTATION_PERIODS,
  type AzShearLevel,
  type RotationPeriod,
} from "../lib/rotationTrack";
import { MRMS_PRODUCT_IDS } from "../lib/providers/mrms";
import {
  CAPPI_FIELDS,
  CUBE_LEVELS,
  DEFAULT_CUBE_LEVEL,
  cubeLevelKm,
} from "../lib/cappi";
import { tileUrl } from "../lib/providers/mrms";

/** Every combination of the eight choices behind a switch. */
const EVERY_CHOICE: MrmsChoices[] = GAUGE_QPE_PERIODS.flatMap(
  (gaugeQpePeriod) =>
    ROTATION_PERIODS.flatMap((rotationPeriod) =>
      AZ_SHEAR_LEVELS.flatMap((azShearLevel) =>
        LIGHTNING_WINDOWS.flatMap((lightningWindow) =>
          LIGHTNING_FORECASTS.flatMap((lightningForecastWindow) =>
            LIGHTNING_JUMPS.flatMap((lightningJumpWindow) =>
              ISOTHERM_LEVELS.flatMap((isothermLevel) =>
                CAPPI_FIELDS.map((cappiField) => ({
                  gaugeQpePeriod,
                  rotationPeriod,
                  azShearLevel,
                  lightningWindow,
                  lightningForecastWindow,
                  lightningJumpWindow,
                  isothermLevel,
                  cappiField,
                  // The height does not decide which grid a switch means, so
                  // it is not crossed here. What reads it is `levelFor`, and
                  // that is checked against every one of the thirty-three.
                  cappiLevel: DEFAULT_CUBE_LEVEL,
                })),
              ),
            ),
          ),
        ),
      ),
    ),
);

/** The eight switches that stand for more than one grid. */
const CHOOSING = new Set([
  "gaugeQpe",
  "rotationTracks",
  "azShear",
  "lightningDensity",
  "lightningForecast",
  "lightningJump",
  "isothermReflectivity",
  "cappi",
]);

describe("which height a grid is read at", () => {
  const at = (cappiLevel: (typeof CUBE_LEVELS)[number]): MrmsChoices => ({
    ...EVERY_CHOICE[0],
    cappiLevel,
  });

  it("answers for the three published at more than one, and nothing else", () => {
    // The height finishes a folder name, so handing one to a product
    // published at a single height asks the bucket for a folder that is not
    // there, and the layer draws nothing with a log line to say why.
    const families = new Set([
      "cappi-reflectivity",
      "cappi-rhohv",
      "cappi-zdr",
    ]);
    for (const product of MRMS_PRODUCT_IDS) {
      const answered = levelFor(product, at("06.00"));
      expect(answered, product).toBe(
        families.has(product) ? "06.00" : undefined,
      );
    }
  });

  it("passes every height the network publishes", () => {
    for (const level of CUBE_LEVELS) {
      expect(levelFor("cappi-zdr", at(level))).toBe(level);
    }
    expect(CUBE_LEVELS).toHaveLength(33);
  });

  it("is on the layer itself, not only inside its tile address", () => {
    // Everything else that asks for this grid has to ask for the same one.
    // Baked into the address alone, an export of the six kilometre picture
    // came back as the half kilometre one, written out under the name of the
    // height that was on screen and with no error anywhere.
    const drawn = MRMS_LAYERS.find(({ layer }) => layer === "cappi");
    expect(drawn, "the merged grid is in the layer table").toBeTruthy();
    const product = productFor("cappi", drawn!.product, at("06.00"));
    expect(levelFor(product, at("06.00"))).toBe("06.00");
    // The shape a drawn layer carries, which is what the export reads.
    const layer: Pick<MrmsLayer, "product" | "level"> = {
      product,
      level: levelFor(product, at("06.00")),
    };
    expect(layer.level).toBe("06.00");
  });

  it("puts the height in the tile address, and only for a family", () => {
    // A different height is a different picture, and the map caches tiles by
    // their address: without it there the second height a reader asks for is
    // served the first one's tiles.
    const low = tileUrl("x/", "cappi-zdr", 1, 0, null, "CONUS", false, "00.50");
    const high = tileUrl(
      "x/",
      "cappi-zdr",
      1,
      0,
      null,
      "CONUS",
      false,
      "19.00",
    );
    expect(low).toContain("&level=00.50");
    expect(high).toContain("&level=19.00");
    expect(low).not.toBe(high);
    // The composite is published at one height and its address says nothing
    // about one.
    expect(tileUrl("x/", "composite", 1)).not.toContain("level=");
  });

  it("names a height a reader can read", () => {
    // The folder suffix is the kilometres, zero padded, which is how the
    // bucket spells it and not something to show anybody.
    expect(cubeLevelKm("00.50")).toBe(0.5);
    expect(cubeLevelKm("03.00")).toBe(3);
    expect(cubeLevelKm("19.00")).toBe(19);
    expect(cubeLevelKm(DEFAULT_CUBE_LEVEL)).toBe(3);
  });
});

describe("which grid is behind a switch", () => {
  it("is the one the table names, for every ordinary layer", () => {
    for (const { layer, product } of MRMS_LAYERS) {
      if (CHOOSING.has(layer)) continue;
      for (const choices of EVERY_CHOICE) {
        expect(productFor(layer, product, choices)).toBe(product);
      }
    }
  });

  it("follows the period for the switch that covers three windows", () => {
    // Getting this wrong draws the right layer over the wrong number of
    // hours, which looks entirely normal: a day of rain labelled as an hour
    // of it is a flood that is not happening.
    const entry = MRMS_LAYERS.find(({ layer }) => layer === "gaugeQpe");
    expect(entry, "the gauge-corrected switch is in the table").toBeTruthy();
    const chosen = GAUGE_QPE_PERIODS.map((gaugeQpePeriod) =>
      productFor("gaugeQpe", entry!.product, {
        gaugeQpePeriod,
        rotationPeriod: "1h",
        azShearLevel: "low",
        lightningWindow: "5m",
        lightningForecastWindow: "30m",
        lightningJumpWindow: "max",
        isothermLevel: "minus10",
        cappiField: "reflectivity",
        cappiLevel: DEFAULT_CUBE_LEVEL,
      }),
    );
    expect(chosen).toEqual([
      "gauge-qpe-hour",
      "gauge-qpe-day",
      "gauge-qpe-three-day",
    ]);
    // Three windows, three grids, no repeats.
    expect(new Set(chosen).size).toBe(GAUGE_QPE_PERIODS.length);
  });

  it("follows the window for the rotation track, over all five", () => {
    // Same failure, worse: a day of accumulated shear read as the past half
    // hour puts a tornado where one passed this morning.
    const entry = MRMS_LAYERS.find(({ layer }) => layer === "rotationTracks");
    expect(entry, "the rotation switch is in the table").toBeTruthy();
    const chosen = ROTATION_PERIODS.map((rotationPeriod) =>
      productFor("rotationTracks", entry!.product, {
        gaugeQpePeriod: "24h",
        rotationPeriod,
        azShearLevel: "low",
        lightningWindow: "5m",
        lightningForecastWindow: "30m",
        lightningJumpWindow: "max",
        isothermLevel: "minus10",
        cappiField: "reflectivity",
        cappiLevel: DEFAULT_CUBE_LEVEL,
      }),
    );
    expect(chosen).toEqual([
      "rotation-30",
      "rotation",
      "rotation-120",
      "rotation-240",
      "rotation-1440",
    ]);
    expect(new Set(chosen).size).toBe(ROTATION_PERIODS.length);
  });

  it("follows the height for the merged shear", () => {
    const entry = MRMS_LAYERS.find(({ layer }) => layer === "azShear");
    expect(entry, "the shear switch is in the table").toBeTruthy();
    const chosen = AZ_SHEAR_LEVELS.map((azShearLevel) =>
      productFor("azShear", entry!.product, {
        gaugeQpePeriod: "24h",
        rotationPeriod: "1h",
        azShearLevel,
        lightningWindow: "5m",
        lightningForecastWindow: "30m",
        lightningJumpWindow: "max",
        isothermLevel: "minus10",
        cappiField: "reflectivity",
        cappiLevel: DEFAULT_CUBE_LEVEL,
      }),
    );
    expect(chosen).toEqual(["az-shear-low", "az-shear-mid"]);
    expect(new Set(chosen).size).toBe(AZ_SHEAR_LEVELS.length);
  });

  it("follows the window for the cloud-to-ground density, over all four", () => {
    // One unit across the four, so the failure is quiet: half an hour of
    // accumulated flashes read as the past minute says a storm is electrifying
    // far harder than it is.
    const entry = MRMS_LAYERS.find(({ layer }) => layer === "lightningDensity");
    expect(entry, "the density switch is in the table").toBeTruthy();
    const chosen = LIGHTNING_WINDOWS.map((lightningWindow) =>
      productFor("lightningDensity", entry!.product, {
        gaugeQpePeriod: "24h",
        rotationPeriod: "1h",
        azShearLevel: "low",
        lightningWindow,
        lightningForecastWindow: "30m",
        lightningJumpWindow: "max",
        isothermLevel: "minus10",
        cappiField: "reflectivity",
        cappiLevel: DEFAULT_CUBE_LEVEL,
      }),
    );
    expect(chosen).toEqual([
      "lightning-1min",
      "lightning",
      "lightning-15min",
      "lightning-30min",
    ]);
    expect(new Set(chosen).size).toBe(LIGHTNING_WINDOWS.length);
  });

  it("follows the window for the chance of lightning, and never leaves it", () => {
    // These two are forecasts. Falling back to an observation grid would put a
    // flash density behind a switch labelled as a chance.
    const entry = MRMS_LAYERS.find(
      ({ layer }) => layer === "lightningForecast",
    );
    expect(entry, "the forecast switch is in the table").toBeTruthy();
    const chosen = LIGHTNING_FORECASTS.map((lightningForecastWindow) =>
      productFor("lightningForecast", entry!.product, {
        gaugeQpePeriod: "24h",
        rotationPeriod: "1h",
        azShearLevel: "low",
        lightningWindow: "5m",
        lightningForecastWindow,
        lightningJumpWindow: "max",
        isothermLevel: "minus10",
        cappiField: "reflectivity",
        cappiLevel: DEFAULT_CUBE_LEVEL,
      }),
    );
    expect(chosen).toEqual([
      "lightning-probability-30min",
      "lightning-probability-60min",
    ]);
    expect(new Set(chosen).size).toBe(LIGHTNING_FORECASTS.length);
  });

  it("follows the window for the jump, and the temperature for the ice level", () => {
    const jump = MRMS_LAYERS.find(({ layer }) => layer === "lightningJump");
    expect(jump, "the jump switch is in the table").toBeTruthy();
    const jumps = LIGHTNING_JUMPS.map((lightningJumpWindow) =>
      productFor("lightningJump", jump!.product, {
        gaugeQpePeriod: "24h",
        rotationPeriod: "1h",
        azShearLevel: "low",
        lightningWindow: "5m",
        lightningForecastWindow: "30m",
        lightningJumpWindow,
        isothermLevel: "minus10",
        cappiField: "reflectivity",
        cappiLevel: DEFAULT_CUBE_LEVEL,
      }),
    );
    expect(jumps).toEqual(["lightning-jump", "lightning-jump-max"]);

    const ice = MRMS_LAYERS.find(
      ({ layer }) => layer === "isothermReflectivity",
    );
    expect(ice, "the ice level switch is in the table").toBeTruthy();
    const levels = ISOTHERM_LEVELS.map((isothermLevel) =>
      productFor("isothermReflectivity", ice!.product, {
        gaugeQpePeriod: "24h",
        rotationPeriod: "1h",
        azShearLevel: "low",
        lightningWindow: "5m",
        lightningForecastWindow: "30m",
        lightningJumpWindow: "max",
        isothermLevel,
        cappiField: "reflectivity",
        cappiLevel: DEFAULT_CUBE_LEVEL,
      }),
    );
    expect(levels).toEqual([
      "reflectivity-minus-10c",
      "reflectivity-minus-20c",
    ]);
  });

  it("lets each choice move its own switch and nobody else's", () => {
    // Three switches reading one shape. A branch that tested the wrong field
    // would draw the shear at the height the rotation window happened to be
    // set to, and both layers would look entirely reasonable.
    const base: MrmsChoices = {
      gaugeQpePeriod: "24h",
      rotationPeriod: "1h",
      azShearLevel: "low",
      lightningWindow: "5m",
      lightningForecastWindow: "30m",
      lightningJumpWindow: "max",
      isothermLevel: "minus10",
      cappiField: "reflectivity",
      cappiLevel: DEFAULT_CUBE_LEVEL,
    };
    const moved: Array<[Partial<MrmsChoices>, string]> = [
      [{ rotationPeriod: "24h" as RotationPeriod }, "rotationTracks"],
      [{ azShearLevel: "mid" as AzShearLevel }, "azShear"],
      [{ gaugeQpePeriod: "1h" }, "gaugeQpe"],
      [{ lightningWindow: "30m" as LightningWindow }, "lightningDensity"],
      [
        { lightningForecastWindow: "60m" as LightningForecast },
        "lightningForecast",
      ],
      [{ lightningJumpWindow: "now" as LightningJump }, "lightningJump"],
      [{ isothermLevel: "minus20" as IsothermLevel }, "isothermReflectivity"],
    ];
    for (const [change, moves] of moved) {
      const after = { ...base, ...change };
      for (const { layer, product } of MRMS_LAYERS) {
        const before = productFor(layer, product, base);
        const now = productFor(layer, product, after);
        if (layer === moves) expect(now).not.toBe(before);
        else expect(now).toBe(before);
      }
    }
  });

  it("names a grid the native side actually has, whichever way it is asked", () => {
    // The table and the choice maps are lists of ids typed against the same
    // union, and a made-up id here reports a made-up observation time rather
    // than failing.
    for (const { layer, product } of MRMS_LAYERS) {
      for (const choices of EVERY_CHOICE) {
        expect(MRMS_PRODUCT_IDS).toContain(productFor(layer, product, choices));
      }
    }
  });
});
