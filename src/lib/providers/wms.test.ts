import { describe, expect, it } from "vitest";
import { formatWmsTime, wmsTileUrl } from "./wms";

describe("writing an instant back to a server", () => {
  it("hands GeoServer exactly what it published", () => {
    expect(formatWmsTime("2026-08-30T10:54:00.000Z", "iso")).toBe(
      "2026-08-30T10:54:00.000Z",
    );
  });

  it("drops the milliseconds a strict server refuses", () => {
    // GeoMet answers a request carrying milliseconds with a service exception
    // rather than a tile, and the exception arrives with a 200, so the map
    // draws nothing and says nothing about why.
    expect(formatWmsTime("2026-08-30T10:54:00.000Z", "seconds")).toBe(
      "2026-08-30T10:54:00Z",
    );
    expect(formatWmsTime("2026-08-30T10:54:00.5Z", "seconds")).toBe(
      "2026-08-30T10:54:00Z",
    );
    // One already written that way is left alone.
    expect(formatWmsTime("2026-08-30T10:54:00Z", "seconds")).toBe(
      "2026-08-30T10:54:00Z",
    );
  });

  it("puts the whole address together the way the server reads it", () => {
    const url = wmsTileUrl(
      "https://geo.weather.gc.ca/geomet",
      "RADAR_1KM_RRAI",
      "2026-08-30T10:54:00Z",
    );
    expect(url).toContain("layers=RADAR_1KM_RRAI");
    expect(url).toContain("time=2026-08-30T10%3A54%3A00Z");
    expect(url).not.toContain(".000Z");
    // MapLibre substitutes these, so they have to survive the encoding.
    expect(url).toContain("bbox={bbox-epsg-3857}");
  });
});
