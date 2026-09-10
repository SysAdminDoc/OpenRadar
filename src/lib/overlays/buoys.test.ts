import { describe, expect, it } from "vitest";
import { formatNumber } from "../../i18n";
import { BUOY_REFRESH_MS, buoysOverlay, parseBuoys } from "./buoys";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/**
 * The head of the file the service actually publishes, copied from
 * `https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt` on 2026-09-10.
 *
 * Two comment lines, then one station per line, twenty-two whitespace
 * separated columns with `MM` wherever an instrument had nothing to say. Kept
 * verbatim rather than tidied: the alignment shifts from row to row as the
 * numbers change width, which is the whole reason this is split on runs of
 * whitespace rather than read as fixed columns.
 */
const FILE = `#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
15009     0.000   -3.051 2026 09 10 06 00 198   6.8    MM   MM  MM   MM  MM 1014.8    MM  24.9  26.0    MM   MM     MM
22101    37.24   126.02  2026 09 10 06 00  90   4.0    MM  0.0   0   MM  MM     MM    MM  21.4  25.1    MM   MM     MM
41008    31.400  -80.868 2026 09 10 06 50 210   5.0   6.0  1.2   6  4.5 200 1016.3  +0.4  26.7  28.1  24.4  MM     MM
`;

describe("what the buoys are reporting", () => {
  it("reads a station's wind, waves and pressure off its own line", () => {
    const { features } = parseBuoys(FILE);
    expect(features).toHaveLength(3);
    const [, , georgia] = features;
    expect(georgia.properties.station).toBe("41008");
    expect(georgia.geometry).toEqual({
      type: "Point",
      coordinates: [-80.868, 31.4],
    });
    expect(georgia.properties.windFrom).toBe(210);
    expect(georgia.properties.windMs).toBe(5);
    expect(georgia.properties.gustMs).toBe(6);
    expect(georgia.properties.waveM).toBe(1.2);
    expect(georgia.properties.dominantPeriod).toBe(6);
    expect(georgia.properties.pressureHpa).toBe(1016.3);
    expect(georgia.properties.waterC).toBe(28.1);
    expect(georgia.properties.airC).toBe(26.7);
    expect(georgia.properties.observedAt).toBe(Date.UTC(2026, 8, 10, 6, 50));
  });

  it("keeps a missing reading missing rather than reading it as zero", () => {
    const { features } = parseBuoys(FILE);
    const [gulf] = features;
    // This station reports wind and pressure and no waves at all. A wave
    // height of zero is a flat calm, which is a measurement; `MM` is the
    // instrument having nothing to say, which is not.
    expect(gulf.properties.windMs).toBe(6.8);
    expect(gulf.properties.pressureHpa).toBe(1014.8);
    expect(gulf.properties.waveM).toBeNull();
    expect(gulf.properties.gustMs).toBeNull();
    expect(gulf.properties.visibilityNmi).toBeNull();

    // And the one that does report a flat calm keeps the zero.
    const [, korea] = features;
    expect(korea.properties.waveM).toBe(0);
  });

  it("drops a line it does not understand rather than the whole file", () => {
    const withRubbish = FILE.replace(
      "22101    37.24   126.02  2026 09 10 06 00  90   4.0    MM  0.0   0   MM  MM     MM    MM  21.4  25.1    MM   MM     MM",
      "22101 this line is not twenty-two columns",
    );
    const { features } = parseBuoys(withRubbish);
    // One malformed station is not a reason to draw none of them.
    expect(features).toHaveLength(2);
    expect(features.map((one) => one.properties.station)).toEqual([
      "15009",
      "41008",
    ]);
  });

  it("leaves out a station with no position rather than placing it at zero", () => {
    const nowhere = `${FILE}41009      MM       MM 2026 09 10 06 50 210   5.0   6.0  1.2   6  4.5 200 1016.3  +0.4  26.7  28.1  24.4  MM     MM\n`;
    const { features } = parseBuoys(nowhere);
    expect(features).toHaveLength(3);
    expect(features.every((one) => one.properties.station !== "41009")).toBe(
      true,
    );
  });

  it("asks for the whole world once and lets a pan change nothing", () => {
    // The acceptance this layer was written to: one national file per ten
    // minutes however far the reader moves. `global` is what says the
    // viewport it is handed is not a question about what to fetch.
    expect(buoysOverlay.global).toBe(true);
    expect(buoysOverlay.refreshMs).toBe(BUOY_REFRESH_MS);
    expect(BUOY_REFRESH_MS).toBe(10 * 60_000);
  });

  it("names the station it came from and links to its own page", () => {
    const { features } = parseBuoys(FILE);
    const said = buoysOverlay.describe(features[2].properties);
    expect(said.title).toContain("41008");
    expect(said.url).toBe(
      "https://www.ndbc.noaa.gov/station_page.php?station=41008",
    );
    const lines = said.lines.join(" | ");
    // The pressure the fixture row carried, written the way the rest of the
    // app writes a pressure: through the formatter, so a Spanish reader gets
    // their own separators rather than this file's.
    expect(lines).toContain(`${formatNumber(1016.3, 1)} hPa`);
    // Wind, waves and pressure are the three the item asks for by name.
    expect(said.lines.length).toBeGreaterThanOrEqual(3);
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("still publishes one file of stations with the columns this reads", async () => {
    const data = await buoysOverlay.fetchData(
      { west: -180, south: -90, east: 180, north: 90 },
      undefined,
      DEFAULT_OVERLAY_CHOICES,
    );
    // Nine hundred hulls in the water reporting all day, so an empty answer
    // means the file moved or its shape changed rather than the sea being
    // quiet.
    expect(data.features.length).toBeGreaterThan(200);

    for (const feature of data.features) {
      expect(feature.geometry.type).toBe("Point");
      const [lon, lat] = feature.geometry.coordinates as number[];
      expect(Number.isFinite(lon)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
    }
    // The three the item names have to be there on a fair share of them, or
    // the columns have moved under this.
    const carrying = (key: string) =>
      data.features.filter((one) => typeof one.properties[key] === "number");
    expect(carrying("windMs").length).toBeGreaterThan(data.features.length / 4);
    expect(carrying("pressureHpa").length).toBeGreaterThan(
      data.features.length / 4,
    );
    expect(carrying("waveM").length).toBeGreaterThan(20);
  });
});
