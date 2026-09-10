import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
  AIRNOW_MIN_ZOOM,
  AIRNOW_REFRESH_MS,
  AQI_BANDS,
  airnowOverlay,
  aqiColor,
  parseAirNow,
} from "./airnow";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/**
 * Rows off the live file for 2026-09-10, verbatim, plus two written to be
 * awkward.
 *
 * The file has no header at all and seventeen pipe separated columns. The
 * first two rows are yesterday's summary for the same area, which is the
 * shape that would put a stale index on the map; the third and fourth are the
 * hour just measured, and only one of them is the parameter the index is
 * being reported on.
 */
const FILE = `09/10/26|09/09/26||CDT|-1|Y|Y|Aberdeen|SD|45.4680|-98.4940|PM10|19|Good|No||South Dakota Department of Agriculture and Natural Resources
09/10/26|09/09/26||CDT|-1|Y|N|Aberdeen|SD|45.4680|-98.4940|PM2.5|8|Good|No||South Dakota Department of Agriculture and Natural Resources
09/10/26|09/10/26|4:00|CDT|0|O|Y|Aberdeen|SD|45.4680|-98.4940|PM2.5|41|Good|No||South Dakota Department of Agriculture and Natural Resources
09/10/26|09/10/26|4:00|CDT|0|O|N|Aberdeen|SD|45.4680|-98.4940|PM10|25|Good|No||South Dakota Department of Agriculture and Natural Resources
09/10/26|09/10/26|12:00|EAT|0|O|Y|Addis Ababa Central|  |9.0585|38.7616|PM2.5|84|Moderate|No||U.S. Department of State Ethiopia - Addis Ababa
09/10/26|09/10/26|6:00|PDT|0|O|Y|Chico|CA|39.7596|-121.8210|PM2.5|168|Unhealthy|Yes||Butte County AQMD
09/10/26|09/10/26|6:00|PDT|0|O|Y|Nowhere|CA|39.0000|-121.0000|PM2.5||Good|No||A monitor with nothing to say
`;

function areas(text = FILE) {
  return parseAirNow(text).features;
}

describe("what the monitors say the air is like", () => {
  it("draws the hour just measured, one point per area", () => {
    const drawn = areas();
    // Yesterday's two rows are gone, the second parameter for the same hour
    // is gone, and so is the blank index. Three areas remain.
    expect(drawn).toHaveLength(3);
    const [aberdeen] = drawn;
    expect(aberdeen.geometry.coordinates).toEqual([-98.494, 45.468]);
    expect(aberdeen.properties.area).toBe("Aberdeen");
    expect(aberdeen.properties.state).toBe("SD");
    expect(aberdeen.properties.aqi).toBe(41);
    expect(aberdeen.properties.parameter).toBe("PM2.5");
    // The agency's own name for the band, which is what every sign and
    // forecast in the country repeats.
    expect(aberdeen.properties.category).toBe("Good");
    // The observer's local clock and the zone it is in, as the file writes
    // them: there is no offset and no date on the hour, so an instant here
    // would mean guessing the zone from an abbreviation.
    expect(aberdeen.properties.hour).toBe("4:00");
    expect(aberdeen.properties.zone).toBe("CDT");
  });

  it("does not read a blank index as clean air", () => {
    // `Number("")` is 0 and zero is finite, so a blank left to the parser
    // reads as an index of zero, which is the very top of the good band: a
    // monitor with nothing to say drawn as the cleanest air on the map.
    const drawn = areas();
    expect(drawn.some((one) => one.properties.area === "Nowhere")).toBe(false);
  });

  it("keeps the worst pollutant rather than every one", () => {
    // An area's index is the worst of what it measures, which is what the
    // agency reports and what a reader means by "the AQI here". Drawing every
    // parameter puts several dots on one town saying different numbers, with
    // the worst one underneath.
    const aberdeen = areas().filter(
      (one) => one.properties.area === "Aberdeen",
    );
    expect(aberdeen).toHaveLength(1);
    expect(aberdeen[0].properties.aqi).toBe(41);
  });

  it("carries an area outside the American network", () => {
    // The file is the whole reporting network rather than one country's: the
    // Canadian agencies and the State Department's embassy monitors are in
    // it, and a layer that read a state code as required would drop them.
    const addis = areas().find(
      (one) => one.properties.area === "Addis Ababa Central",
    );
    expect(addis?.properties.aqi).toBe(84);
    expect(addis?.properties.category).toBe("Moderate");
    // The state column is two spaces there, which is not a state.
    expect(addis?.properties.state).toBeNull();
  });

  it("colours an index by the agency's own scale", () => {
    // The boundaries the agency defines, and the reading either side of each.
    expect(aqiColor(0)).toBe("#00e400");
    expect(aqiColor(50)).toBe("#00e400");
    expect(aqiColor(51)).toBe("#ffff00");
    expect(aqiColor(100)).toBe("#ffff00");
    expect(aqiColor(101)).toBe("#ff7e00");
    expect(aqiColor(151)).toBe("#ff0000");
    expect(aqiColor(201)).toBe("#8f3f97");
    expect(aqiColor(301)).toBe("#7e0023");
    expect(aqiColor(900)).toBe("#7e0023");
  });

  it("paints the bands the scale names", () => {
    // The map's own type wants the step expression as a tuple, so the bands
    // are written out twice. This is what stops the two from drifting into
    // disagreeing about what colour a reading is.
    const [layer] = airnowOverlay.layers("test");
    const paint = layer.paint as Record<string, unknown>;
    const step = paint["circle-color"] as unknown[];
    expect(step[0]).toBe("step");
    expect(step[1]).toEqual(["get", "aqi"]);
    const written: Array<{ at: number; color: string }> = [
      { at: 0, color: step[2] as string },
    ];
    for (let at = 3; at < step.length; at += 2) {
      written.push({ at: step[at] as number, color: step[at + 1] as string });
    }
    expect(written).toEqual([...AQI_BANDS]);
  });

  it("says the index, the pollutant and the hour, in the agency's words", () => {
    const chico = areas().find((one) => one.properties.area === "Chico");
    expect(chico).toBeTruthy();
    const said = airnowOverlay.describe(chico!.properties);
    expect(said.title).toBe("Chico, CA");
    const lines = said.lines.join(" ");
    expect(lines).toContain("168");
    expect(lines).toContain("Unhealthy");
    expect(lines).toContain("PM2.5");
    expect(lines).toContain("6:00");
    expect(lines).toContain("PDT");
    // The flag the agency raises when it is asking people to change what
    // they do, which is the one line on this popup that is a request.
    expect(lines).toMatch(/action day/i);
    // The agency that runs the monitor, because a reader checking a reading
    // wants to know whose it is.
    expect(lines).toContain("Butte County AQMD");
  });

  it("asks once an hour for the whole network", () => {
    expect(airnowOverlay.global).toBe(true);
    expect(airnowOverlay.refreshMs).toBe(AIRNOW_REFRESH_MS);
    // The item's own ceiling is at most hourly, and this is exactly that.
    expect(AIRNOW_REFRESH_MS).toBe(60 * 60_000);
    expect(airnowOverlay.minZoom).toBe(AIRNOW_MIN_ZOOM);
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("still publishes the file this reads, in the columns it reads", async () => {
    const data = await airnowOverlay.fetchData(
      { west: -180, south: -90, east: 180, north: 90 },
      undefined,
      DEFAULT_OVERLAY_CHOICES,
    );
    // Every monitor on the continent reports every hour, so this can insist
    // on an answer rather than on a shape.
    expect(data.features.length).toBeGreaterThan(100);
    const categories = new Set<string>();
    for (const feature of data.features) {
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      const where = `${String(feature.properties.area)} at ${lat}, ${lon}`;
      expect(Number.isFinite(lat) && Number.isFinite(lon), where).toBe(true);
      expect(lat, where).toBeGreaterThanOrEqual(-90);
      expect(lat, where).toBeLessThanOrEqual(90);
      // An index is a number on a scale that runs from zero, and one above
      // five hundred has never been published: a column read off by one
      // would land here rather than on the map.
      const aqi = feature.properties.aqi;
      expect(typeof aqi, where).toBe("number");
      expect(aqi as number, where).toBeGreaterThanOrEqual(0);
      expect(aqi as number, where).toBeLessThanOrEqual(1000);
      if (typeof feature.properties.category === "string") {
        categories.add(feature.properties.category);
      }
    }
    // The words the popup shows are the agency's own, so a column that moved
    // would show up as categories that are not categories.
    const known = new Set([
      "Good",
      "Moderate",
      "Unhealthy for Sensitive Groups",
      "Unhealthy",
      "Very Unhealthy",
      "Hazardous",
    ]);
    for (const category of categories) {
      expect(known.has(category), `${category} is not a category`).toBe(true);
    }
    expect(categories.size).toBeGreaterThan(0);
  }, 60_000);
});
