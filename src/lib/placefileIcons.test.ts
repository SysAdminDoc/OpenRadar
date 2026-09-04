import { describe, expect, it } from "vitest";
import { parseIconId, placefilePictures } from "./placefile";
import {
  fallbackDot,
  hasAlpha,
  hotspotBox,
  iconCell,
  iconsWanted,
  sliceIcon,
  type Pixels,
} from "./placefileIcons";

/** A sheet of solid cells, so a slice can be checked by the colour it took. */
function sheet(
  columns: number,
  rows: number,
  cell: number,
  opaque = true,
): Pixels {
  const width = columns * cell;
  const height = rows * cell;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      // The cell number, so a slice says which cell it came out of.
      data[at] = Math.floor(y / cell) * columns + Math.floor(x / cell) + 1;
      data[at + 1] = 0;
      data[at + 2] = 0;
      data[at + 3] = opaque ? 255 : 128;
    }
  }
  return { width, height, data };
}

const ref = (index: number, over: Partial<Record<string, number>> = {}) => ({
  url: "https://example.test/icons.png",
  iconWidth: 4,
  iconHeight: 4,
  hotX: 2,
  hotY: 2,
  index,
  ...over,
});

describe("finding an icon in its sheet", () => {
  it("counts left to right and then top to bottom, from one", () => {
    const grid = { width: 12, height: 8 };
    expect(iconCell(grid, ref(1))).toEqual({ x: 0, y: 0 });
    expect(iconCell(grid, ref(3))).toEqual({ x: 8, y: 0 });
    expect(iconCell(grid, ref(4))).toEqual({ x: 0, y: 4 });
    expect(iconCell(grid, ref(6))).toEqual({ x: 8, y: 4 });
  });

  it("answers for a cell the sheet does not hold", () => {
    const grid = { width: 12, height: 8 };
    expect(iconCell(grid, ref(7))).toBeNull();
    expect(iconCell(grid, ref(0))).toBeNull();
    // A sheet narrower than one icon has no columns at all.
    expect(iconCell({ width: 3, height: 8 }, ref(1))).toBeNull();
  });
});

describe("centring an icon on its hotspot", () => {
  it("leaves a centred hotspot where it is", () => {
    // Nine pixels wide with the hotspot in the middle already: nothing to pad.
    const box = hotspotBox(
      ref(1, { iconWidth: 9, iconHeight: 9, hotX: 4, hotY: 4 }),
    );
    expect(box).toEqual({ width: 9, height: 9, dx: 0, dy: 0 });
  });

  it("pads the other side when the hotspot is at the foot of a pin", () => {
    // A pin whose point is the bottom edge. Anchored at its own centre the
    // icon would float half its height above the place it marks.
    const box = hotspotBox(
      ref(1, { iconWidth: 15, iconHeight: 25, hotX: 7, hotY: 24 }),
    );
    expect(box.height).toBe(49);
    expect(box.dy).toBe(0);
    // Which puts the hotspot exactly in the middle of the padded box.
    expect(box.dy + 24).toBe((box.height - 1) / 2);
    expect(box.width).toBe(15);
    expect(box.dx).toBe(0);
  });

  it("clamps a hotspot the file put outside the icon", () => {
    const box = hotspotBox(ref(1, { hotX: 99, hotY: -5 }));
    expect(box.dx).toBe(0);
    expect(box.dy).toBe(box.height - ref(1).iconHeight);
  });
});

describe("cutting one icon out", () => {
  it("takes the cell it was asked for", () => {
    const cut = sliceIcon(sheet(3, 2, 4), ref(5), false);
    expect(cut).not.toBeNull();
    // Cell 5 painted itself 5 in the red channel.
    expect(cut?.data[0]).toBe(5);
    expect(cut?.width).toBe(5);
  });

  it("leaves the padding transparent rather than black", () => {
    const cut = sliceIcon(sheet(2, 1, 4), ref(1, { hotX: 0, hotY: 0 }), false);
    // Seven across: three pixels of padding, then the four of the icon.
    expect(cut?.width).toBe(7);
    const last = (cut as Pixels).data;
    expect(last[3]).toBe(0);
    // And the icon itself is where the hotspot puts it, still opaque.
    const at = ((cut as Pixels).width * 3 + 3) * 4;
    expect(last[at + 3]).toBe(255);
  });

  it("draws black as transparent only when the sheet has no alpha of its own", () => {
    const opaque = sheet(1, 1, 2);
    // Paint the whole cell black, which the format says means transparent
    // when the sheet carries no transparency itself.
    opaque.data.fill(0);
    for (let at = 3; at < opaque.data.length; at += 4) opaque.data[at] = 255;
    expect(hasAlpha(opaque)).toBe(false);

    const keyed = sliceIcon(
      opaque,
      ref(1, { iconWidth: 2, iconHeight: 2 }),
      true,
    );
    expect(keyed?.data[3]).toBe(0);
    const kept = sliceIcon(
      opaque,
      ref(1, { iconWidth: 2, iconHeight: 2 }),
      false,
    );
    expect(kept?.data[3]).toBe(255);
  });

  it("sees a sheet that does carry transparency", () => {
    expect(hasAlpha(sheet(1, 1, 2, false))).toBe(true);
  });
});

describe("what a drawn collection asks the map for", () => {
  const collection = (features: unknown[]) => ({
    type: "FeatureCollection",
    features,
  });

  it("names each icon once however many features want it", () => {
    const id = "icon|https://example.test/a.png|15|25|7|24|3";
    expect(
      iconsWanted(
        collection([
          { properties: { icon: id } },
          { properties: { icon: id } },
          { properties: { label: "no icon" } },
        ]),
      ),
    ).toEqual([id]);
    expect(parseIconId(id)).not.toBeNull();
    expect(iconsWanted(null)).toEqual([]);
  });

  it("takes the pictures in order and stops at the map's ceiling", () => {
    const picture = (url: string) => ({
      properties: { kind: "image", image: url, fileOpacity: 0.5 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-95, 41],
            [-93, 41],
            [-93, 40],
            [-95, 40],
            [-95, 41],
          ],
        ],
      },
    });
    const many = ["a", "b", "c", "d", "e"].map((name) =>
      picture(`https://example.test/${name}.png`),
    );
    const read = placefilePictures(collection(many));
    expect(read).toHaveLength(4);
    expect(read[0].url).toBe("https://example.test/a.png");
    expect(read[0].opacity).toBe(0.5);
    expect(read[0].corners).toEqual([
      [-95, 41],
      [-93, 41],
      [-93, 40],
      [-95, 40],
    ]);
  });

  it("ignores a shape that is not a picture", () => {
    expect(
      placefilePictures(collection([{ properties: { kind: "place" } }])),
    ).toEqual([]);
  });
});

describe("the dot an icon falls back to", () => {
  it("is a disc with a rim, and nothing outside it", () => {
    // A sheet on an allowed host can still 404 or time out, and a symbol
    // naming an image MapLibre does not hold draws nothing at all.
    const dot = fallbackDot(12);
    expect(dot.width).toBe(12);
    expect(dot.height).toBe(12);
    // The corner is outside the circle, so it stays transparent.
    expect(dot.data[3]).toBe(0);
    // The middle is filled and opaque.
    const middle = (6 * 12 + 6) * 4;
    expect(dot.data[middle + 3]).toBe(255);
    // And the rim is a lighter colour than the fill, so it reads on a dark
    // basemap and a light one alike.
    // Just inside the edge, where the rim is drawn.
    const rim = (6 * 12 + 10) * 4;
    expect(dot.data[rim + 3]).toBe(255);
    expect(dot.data[rim]).toBeGreaterThan(dot.data[middle]);
  });
});
