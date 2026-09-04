import { describe, expect, it } from "vitest";
import { popupFrom, safePopupUrl, type Hit } from "./mapPopup";
import {
  CUSTOM_LAYER_IDS,
  layerStackOrder,
  OVERLAY_SOURCE_PREFIX,
  PROBSEVERE_FILL_LAYER_ID,
} from "./layerStack";
import { OVERLAY_ADAPTERS } from "./overlays/index";

/** The real overlay layer ids, in the order the map draws them. */
const ORDER = layerStackOrder(
  OVERLAY_ADAPTERS.flatMap((adapter) =>
    adapter
      .layers(`${OVERLAY_SOURCE_PREFIX}${adapter.id}`)
      .map((layer) => layer.id),
  ),
);

const ALERT_LAYER = ORDER.find((id) => id.includes("overlay-alerts")) as string;

function alert(event: string, extra: Record<string, unknown> = {}): Hit {
  return {
    layer: { id: ALERT_LAYER },
    properties: {
      headline: event,
      event,
      severity: "extreme",
      office: "OUN",
      ...extra,
    },
  };
}

const guess: Hit = {
  layer: { id: PROBSEVERE_FILL_LAYER_ID },
  properties: { severe: 88, hail: 60, wind: 30, tornado: 12, detail: "" },
};

describe("what a click opens", () => {
  it("allows only credential-free HTTPS links from provider data", () => {
    expect(safePopupUrl("https://api.weather.gov/alerts/123")).toBe(
      "https://api.weather.gov/alerts/123",
    );
    expect(safePopupUrl("javascript:alert(1)")).toBeNull();
    expect(safePopupUrl("http://example.test/product")).toBeNull();
    expect(safePopupUrl("https://user:secret@example.test/product")).toBeNull();
    expect(safePopupUrl("not a URL")).toBeNull();
  });

  it("opens the warning when a model polygon is drawn under it", () => {
    // The map draws guidance under the warnings on purpose, and the click used
    // to ask the guidance layer first and return on a hit. A tornado warning
    // was unreachable anywhere the model had drawn over the same storm, which
    // is every storm that carries a warning.
    const warning = alert("Tornado Warning");
    expect(popupFrom([guess, warning], ORDER)?.title).toContain("Tornado");
    expect(popupFrom([warning, guess], ORDER)?.title).toContain("Tornado");
  });

  it("opens the model's reading when that is all there is", () => {
    const content = popupFrom([guess], ORDER);
    // Title case, like every other layer name: this one and the river gauges
    // were the two that were not.
    expect(content?.title).toBe("Severe Probability");
    expect(content?.lines.join(" ")).toContain("88");
  });

  it("opens the first of two features drawn by the same layer", () => {
    // Every alert in the country is one fill layer, so a tornado warning
    // inside a flood watch is two hits at the same height. A hit test hands
    // its results back nearest the viewer first, so the first is the one on
    // top; taking the later of them opened the watch instead.
    const warning = alert("Tornado Warning");
    const watch = alert("Flood Watch", { severity: "moderate" });
    expect(popupFrom([warning, watch], ORDER)?.title).toContain("Tornado");
    expect(popupFrom([watch, warning], ORDER)?.title).toContain("Flood");
  });

  it("has nothing to open where nothing was clicked", () => {
    expect(popupFrom([], ORDER)).toBeNull();
  });

  it("says nothing about a layer no overlay claims", () => {
    expect(
      popupFrom(
        [{ layer: { id: "openradar-radar-layer" }, properties: {} }],
        ORDER,
      ),
    ).toBeNull();
  });

  it("opens a storm report over the pictures it was found in", () => {
    const report = ORDER.find((id) => id.includes("overlay-reports"));
    if (!report) return;
    const hit: Hit = {
      layer: { id: report },
      properties: { type: "Hail", magnitude: "1.75", city: "Norman" },
    };
    expect(popupFrom([guess, hit], ORDER)?.title).not.toBe(
      "Severe probability",
    );
  });
});

describe("a shape somebody imported", () => {
  const CUSTOM_POINTS = CUSTOM_LAYER_IDS.find((id) =>
    id.includes("custom-points"),
  ) as string;

  const imported = (properties: Record<string, unknown>): Hit => ({
    layer: { id: CUSTOM_POINTS },
    properties,
  });

  it("says the placefile's own hover text, under the file it came from", () => {
    // Nothing else in the app knows what is in a reader's file, so this is
    // the only account of the shape there is. A spotter network file is two
    // hundred people, and without this not one of them can be identified.
    const content = popupFrom(
      [
        imported({
          kind: "place",
          color: "#ffc800",
          fileName: "spotters.txt",
          label: "Hail 2.0 in",
        }),
      ],
      ORDER,
    );
    expect(content?.title).toBe("spotters.txt");
    expect(content?.lines).toEqual(["Hail 2.0 in"]);
  });

  it("carries a placemark's name, its description and its own fields", () => {
    const content = popupFrom(
      [
        imported({
          fileName: "survey.kml",
          name: "EF3",
          description: "Damage survey leg 4",
          width: "400 yd",
          date: "2026-04-27",
          stroke: "#ff0000",
          strokeWidth: 3,
        }),
      ],
      ORDER,
    );
    expect(content?.title).toBe("survey.kml");
    expect(content?.lines).toEqual([
      "EF3",
      "Damage survey leg 4",
      "width: 400 yd",
      "date: 2026-04-27",
    ]);
    // The colours are how it is drawn, not what it says.
    expect(content?.lines.join(" ")).not.toContain("#ff0000");
  });

  it("hands markup over as text rather than as a link or a document", () => {
    // A KML description is untrusted input. The popup writes every line with
    // textContent, and nothing here may put a url on it: `url` is the field
    // that becomes an anchor.
    const content = popupFrom(
      [
        imported({
          fileName: "hostile.kml",
          name: "<img src=x onerror=alert(1)>",
          description: "<script>alert(1)</script>",
          link: "javascript:alert(1)",
        }),
      ],
      ORDER,
    );
    expect(content?.lines[0]).toBe("<img src=x onerror=alert(1)>");
    expect(content?.lines[1]).toBe("<script>alert(1)</script>");
    expect(content?.url).toBeUndefined();
    expect(safePopupUrl("javascript:alert(1)")).toBeNull();
  });

  it("stops rather than filling the window with a file's own fields", () => {
    const many: Record<string, unknown> = { fileName: "wide.kml", name: "One" };
    for (let at = 0; at < 30; at += 1) many[`field${at}`] = `value ${at}`;
    const content = popupFrom([imported(many)], ORDER);
    expect(content?.lines).toHaveLength(8);
  });

  it("answers nothing for a shape that carried nothing to say", () => {
    // A plain GeoJSON polygon with no properties. A popup naming only the
    // file it came from is a popup that says nothing.
    expect(popupFrom([imported({ kind: "polygon" })], ORDER)).toBeNull();
  });
});
