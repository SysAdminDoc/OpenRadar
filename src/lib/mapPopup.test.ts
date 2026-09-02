import { describe, expect, it } from "vitest";
import { popupFrom, safePopupUrl, type Hit } from "./mapPopup";
import {
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
