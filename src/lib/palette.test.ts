import { describe, expect, it } from "vitest";
import {
  paletteApplies,
  paletteColor,
  paletteForRenderer,
  paletteRange,
  parsePalette,
} from "./palette";

/** A cut-down version of the reflectivity palettes people actually pass round. */
const FILE = [
  "; a comment nobody has to read",
  "Product: BR",
  "Units: dBZ",
  "Step: 5",
  "",
  "Color: 5 4 233 231 1 159 244",
  "Color: 20 2 253 2 1 197 1",
  "Color: 50 253 0 0 212 0 0",
  "SolidColor: 75 253 253 253",
  "RF: 119 0 125",
].join("\n");

describe("reading a palette", () => {
  it("reads the header, the stops, and the range-folded colour", () => {
    const palette = parsePalette(FILE, "reflectivity.pal");
    expect(palette).not.toBeNull();
    if (!palette) return;

    expect(palette.name).toBe("reflectivity.pal");
    expect(palette.product).toBe("BR");
    expect(palette.units).toBe("dBZ");
    expect(palette.step).toBe(5);
    expect(palette.rangeFolded).toBe("#77007d");
    expect(palette.stops).toHaveLength(4);
    expect(palette.stops[0]).toEqual({
      value: 5,
      color: "#04e9e7",
      solid: false,
      toColor: "#019ff4",
    });
    // A solid stop has no colour to blend towards, and is marked so that
    // storing and reloading the table cannot turn a plain line into one.
    expect(palette.stops[3]).toEqual({
      value: 75,
      color: "#fdfdfd",
      solid: true,
      toColor: null,
    });
    expect(paletteRange(palette)).toEqual({ min: 5, max: 75 });
  });

  it("reads the stops low to high whatever order the file lists them in", () => {
    const palette = parsePalette(
      ["Color: 50 253 0 0", "Color: 5 4 233 231", "Color: 20 2 253 2"].join(
        "\n",
      ),
      "jumbled.pal",
    );
    expect(palette?.stops.map((stop) => stop.value)).toEqual([5, 20, 50]);
  });

  it("says which directives it read but did nothing with", () => {
    const palette = parsePalette(
      ["Color: 5 4 233 231", "Scale: 1.0", "Offset: 0", "Nonsense: 3"].join(
        "\n",
      ),
      "extras.pal",
    );
    expect(palette?.skipped).toEqual(["nonsense", "offset", "scale"]);
  });

  it("refuses a file with no colours rather than drawing nothing", () => {
    expect(parsePalette("Product: BR\nUnits: dBZ", "empty.pal")).toBeNull();
    expect(parsePalette("", "empty.pal")).toBeNull();
    expect(parsePalette("not a palette at all", "notes.txt")).toBeNull();
    // A colour line missing a channel is not a colour.
    expect(parsePalette("Color: 5 4 233", "short.pal")).toBeNull();
  });

  it("clamps a channel a file put outside the range", () => {
    const palette = parsePalette(
      ["Color: 5 300 -20 128"].join("\n"),
      "wild.pal",
    );
    expect(palette?.stops[0].color).toBe("#ff0080");
  });

  it("drops the alpha a Color4 line carries", () => {
    const palette = parsePalette(
      ["Color4: 5 4 233 231 255 1 159 244 128"].join("\n"),
      "alpha.pal",
    );
    expect(palette?.stops[0]).toEqual({
      value: 5,
      color: "#04e9e7",
      solid: false,
      toColor: "#019ff4",
    });
  });
});

describe("colouring a value", () => {
  const palette = parsePalette(FILE, "reflectivity.pal");

  it("gives a stop its own colour", () => {
    expect(paletteColor(palette!, 5)).toBe("#04e9e7");
    expect(paletteColor(palette!, 50)).toBe("#fd0000");
  });

  it("blends towards the second colour on the line", () => {
    // Halfway from 5 to 20, so halfway from 04e9e7 to 019ff4.
    expect(paletteColor(palette!, 12.5)).toBe("#03c4ee");
  });

  it("ramps out of a plain line with one colour", () => {
    // The other half of the same rule. A Color line with a single colour is
    // not solid: it ramps into the next stop. Holding it instead would flatten
    // most of the tables people pass round.
    const ramp = parsePalette(
      ["Color: 5 255 0 0", "Color: 25 0 0 255"].join(String.fromCharCode(10)),
      "ramp.pal",
    );
    expect(paletteColor(ramp!, 5)).toBe("#ff0000");
    expect(paletteColor(ramp!, 15)).toBe("#800080");
    expect(paletteColor(ramp!, 25)).toBe("#0000ff");
  });

  it("holds a solid stop rather than blending out of it", () => {
    const solid = parsePalette(
      ["Color: 5 4 233 231", "SolidColor: 20 253 0 0", "Color: 50 0 0 0"].join(
        "\n",
      ),
      "solid.pal",
    );
    // A file that says flat red from twenty to fifty is drawn flat red, not
    // as a red to black ramp.
    expect(paletteColor(solid!, 20)).toBe("#fd0000");
    expect(paletteColor(solid!, 30)).toBe("#fd0000");
    expect(paletteColor(solid!, 49)).toBe("#fd0000");
    expect(paletteColor(solid!, 50)).toBe("#000000");
  });

  it("holds the ends rather than running off either edge", () => {
    expect(paletteColor(palette!, -40)).toBe("#04e9e7");
    expect(paletteColor(palette!, 0)).toBe("#04e9e7");
    expect(paletteColor(palette!, 200)).toBe("#fdfdfd");
  });
});

describe("handing a palette to the renderer", () => {
  it("sends the stops in order as plain pairs", () => {
    const palette = parsePalette(FILE, "reflectivity.pal");
    // Whether a stop is solid travels with it: without that the native side
    // cannot tell a SolidColor line from a Color line with one colour, and
    // draws the second as though it were the first.
    expect(paletteForRenderer(palette!)).toEqual([
      [5, "#04e9e7", "#019ff4", false],
      [20, "#02fd02", "#01c501", false],
      [50, "#fd0000", "#d40000", false],
      [75, "#fdfdfd", null, true],
    ]);
  });

  it("only applies to a product measured in the same unit", () => {
    const palette = parsePalette(FILE, "reflectivity.pal");
    expect(paletteApplies(palette!, "dBZ")).toBe(true);
    expect(paletteApplies(palette!, "dbz")).toBe(true);
    expect(paletteApplies(palette!, "m/s")).toBe(false);

    // A file that does not say what it is for is a reflectivity table, which
    // is what the format is for. Taking it as meant for everything would put a
    // dBZ scale over hail and lightning and blank those layers.
    const unsaid = parsePalette("Color: 5 4 233 231", "any.pal");
    expect(paletteApplies(unsaid!, "dBZ")).toBe(true);
    expect(paletteApplies(unsaid!, "m/s")).toBe(false);
    expect(paletteApplies(unsaid!, "mm")).toBe(false);
  });
});
