import { describe, expect, it } from "vitest";
import { overlayLegends } from "./index";
import { DEFAULT_OVERLAY_CHOICES, EMPTY_OVERLAY } from "./registry";
import type { OverlayData, OverlayId } from "./registry";
import { OVERLAY_ADAPTERS } from "./index";
import { en } from "../../i18n/en";

/**
 * The key over the map, built from what is drawn rather than from a table.
 *
 * An outlook is a set of coloured areas and the map said nothing about what
 * any of them meant: the popup did, and only for the one under the pointer.
 * What matters here is that the key is a description of the picture. A layer
 * that is switched on but has nothing on screen has no key, a category that
 * is not drawn is not listed, and the order is the order of the risk scale
 * rather than the order the service happened to send the polygons in.
 */

function states(
  of: Partial<Record<OverlayId, OverlayData>>,
): Record<OverlayId, { data: OverlayData }> {
  const all = {} as Record<OverlayId, { data: OverlayData }>;
  for (const adapter of OVERLAY_ADAPTERS) {
    all[adapter.id] = { data: of[adapter.id] ?? EMPTY_OVERLAY };
  }
  return all;
}

/** One outlook polygon, the shape the parser hands them over in. */
function outlook(
  risk: string,
  fill: string,
  rank: number,
  times?: { valid: number; expire: number },
): OverlayData["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [] },
    properties: {
      risk,
      label: risk,
      fill,
      rank,
      valid: times?.valid,
      expire: times?.expire,
      day: 1,
    },
  };
}

function collection(features: OverlayData["features"]): OverlayData {
  return { type: "FeatureCollection", features };
}

describe("the key for the layers on the map", () => {
  it("says nothing about a map with no bands on it", () => {
    expect(overlayLegends(states({}), DEFAULT_OVERLAY_CHOICES)).toEqual([]);
  });

  it("lists each category once, however many polygons drew it", () => {
    const legends = overlayLegends(
      states({
        spcOutlooks: collection([
          outlook("Slight Risk", "#ffe066", 4),
          outlook("Slight Risk", "#ffe066", 4),
          outlook("Marginal Risk", "#66a366", 3),
        ]),
      }),
      DEFAULT_OVERLAY_CHOICES,
    );
    expect(legends).toHaveLength(1);
    expect(legends[0].bands).toEqual([
      { label: "Marginal Risk", color: "#66a366" },
      { label: "Slight Risk", color: "#ffe066" },
    ]);
  });

  it("orders the bands up the scale, whatever order they arrived in", () => {
    // The service sends whatever the query returned. A key that listed a
    // moderate risk above a slight one would be reading as a scale and not
    // being one.
    const legends = overlayLegends(
      states({
        spcOutlooks: collection([
          outlook("Moderate Risk", "#e06666", 6),
          outlook("Thunderstorms", "#c1e9c1", 2),
          outlook("Enhanced Risk", "#ffa366", 5),
        ]),
      }),
      DEFAULT_OVERLAY_CHOICES,
    );
    expect(legends[0].bands.map((band) => band.label)).toEqual([
      "Thunderstorms",
      "Enhanced Risk",
      "Moderate Risk",
    ]);
  });

  it("says what a forecast is valid for, and says nothing when it cannot", () => {
    const valid = Date.parse("2026-09-05T12:00:00Z");
    const expire = Date.parse("2026-09-06T12:00:00Z");
    const [withTimes] = overlayLegends(
      states({
        spcOutlooks: collection([
          outlook("Slight Risk", "#ffe066", 4, { valid, expire }),
        ]),
      }),
      DEFAULT_OVERLAY_CHOICES,
    );
    expect(withTimes.note).toBeTruthy();
    expect(withTimes.title).toBe(
      en["spc.outlookDay"].replace(
        "{day}",
        String(DEFAULT_OVERLAY_CHOICES.spcDay),
      ),
    );

    const [without] = overlayLegends(
      states({
        spcOutlooks: collection([outlook("Slight Risk", "#ffe066", 4)]),
      }),
      DEFAULT_OVERLAY_CHOICES,
    );
    // A window nobody knows is left unsaid rather than written as two
    // invalid dates, which is what an outlook read out of the archive can be.
    expect(without.note).toBeNull();
  });

  it("keeps one key per layer when several are on at once", () => {
    const legends = overlayLegends(
      states({
        spcOutlooks: collection([outlook("Slight Risk", "#ffe066", 4)]),
        wpcExcessiveRain: collection([
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [] },
            properties: {
              risk: "Moderate",
              fill: "#e06666",
              rank: 3,
              window: "16Z 09/03/26 - 12Z 09/04/26",
            },
          },
        ]),
      }),
      DEFAULT_OVERLAY_CHOICES,
    );
    expect(legends.map((legend) => legend.id)).toEqual([
      "spcOutlooks",
      "wpcExcessiveRain",
    ]);
    // The Center's own words for the window, which say plainly that it
    // crosses a midnight where two reformatted clock times would not.
    expect(legends[1].note).toContain("16Z 09/03/26 - 12Z 09/04/26");
  });

  it("leaves out a band the service sent with no colour or no name", () => {
    // The archive carries a threshold code and no fill, and a swatch of
    // nothing beside a name is a row that says the category has no colour.
    const [legend] = overlayLegends(
      states({
        spcOutlooks: collection([
          outlook("Slight Risk", "#ffe066", 4),
          outlook("Enhanced Risk", "", 5),
          outlook("", "#e06666", 6),
        ]),
      }),
      DEFAULT_OVERLAY_CHOICES,
    );
    expect(legend.bands).toEqual([{ label: "Slight Risk", color: "#ffe066" }]);
  });
});
