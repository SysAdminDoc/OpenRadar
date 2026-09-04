import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureLanguage,
  formatMeasure,
  formatNumber,
  setLanguage,
} from "./index";

const ROOT = join(import.meta.dirname, "..");

afterEach(() => setLanguage("en"));

/**
 * The `toFixed` calls that are allowed to remain, and how many each file has.
 *
 * Every one of these produces a machine value rather than something a person
 * reads: a URL parameter, a cache key, a data attribute, an SVG path, the
 * numbers written into `settings.json`, or the diagnostics report, which the
 * project deliberately keeps in English along with the log lines.
 *
 * The counts are pinned rather than the files, so adding a `toFixed` anywhere
 * fails this and somebody has to decide which kind it is. That is the point:
 * a reader-facing number written with `toFixed` comes out in English notation
 * in every language, which is exactly the bug this file exists to stop coming
 * back.
 */
const MACHINE_VALUES: Record<string, number> = {
  // The mosaic opacity, written onto the container for the tests to read.
  "components/MapViewport.tsx": 1,
  // Cache and change-detection keys.
  "hooks/useAlertWatch.ts": 2,
  "hooks/useOverlays.ts": 1,
  "hooks/useSingleSiteRadar.ts": 2,
  // The openradar:// link's own parameters.
  "lib/deepLink.ts": 5,
  // Developer-facing, and rounded to about a kilometre on purpose.
  "lib/diagnostics.ts": 3,
  // Query parameters on a service request.
  "lib/guidance.ts": 2,
  // The alpha in a CSS colour, which the browser reads and nobody else.
  "lib/kml.ts": 1,
  // The bounding box on a request to a service.
  "lib/overlays/ecccAlerts.ts": 1,
  "lib/overlays/metar.ts": 1,
  "lib/overlays/registry.ts": 1,
  // A longitude, a latitude and a radius, all going into a query string
  // rather than onto a screen.
  "lib/overlays/reports.ts": 3,
  "lib/overlays/rivers.ts": 4,
  "lib/route.ts": 6,
  "lib/sounding.ts": 2,
  "lib/weather.ts": 2,
  // What gets written to settings.json and compared on the way back.
  "lib/settings.ts": 5,
  "lib/watch.ts": 1,
  // Coordinates in an SVG path.
  "lib/skewt.ts": 2,
  // A CSS length: how much of a slider's track sits behind its handle.
  "lib/rangeFill.ts": 1,
  // data-* attributes the browser tests read.
  "panels/GuidancePanel.tsx": 1,
  "panels/HistoryPanel.tsx": 1,
};

function sourceFiles(from: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(from)) {
    const path = join(from, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

describe("numbers a reader reads", () => {
  it("writes the decimal separator of the language it is read in", async () => {
    expect(formatNumber(3.42, 2)).toBe("3.42");

    await ensureLanguage("es");
    setLanguage("es");
    expect(formatNumber(3.42, 2)).toBe("3,42");

    await ensureLanguage("fr");
    setLanguage("fr");
    expect(formatNumber(3.42, 2)).toBe("3,42");
    // Canadian French, not European: the thousands are separated by a
    // space rather than by the point a reader in France would expect.
    // Which space is the platform's business and has changed between
    // them, so the shape is asserted rather than one invisible character.
    expect(formatNumber(1234.5, 1)).toMatch(/^1\s234,5$/u);
  });

  it("says the same thing as toFixed did, in English", () => {
    // The point of the change is that other languages stop reading like
    // English. English itself must not move, or every screenshot, every
    // browser test and every reader's memory of the app is wrong. Below a
    // thousand, which is every number that reaches this, the two agree
    // exactly; above it English gains the grouping the next test pins.
    const values = [0, 0.5, -0.04, 3.42, 55.5, 0.049, 998.994, -180];
    for (const value of values) {
      for (const digits of [0, 1, 2, 3, 4]) {
        expect(formatNumber(value, digits), `${value} to ${digits}`).toBe(
          value.toFixed(digits),
        );
      }
    }
  });

  it("groups thousands the way each language groups them", () => {
    // Grouping is the one place English does move, and only above a
    // thousand. Almost nothing here reaches that: a tilt, a coordinate, a
    // magnitude and a depth are all smaller. Two callers do, and they were
    // meant to: an export over a gigabyte reads 1,536.0 MB rather than
    // 1536.0 MB, and a pack ceiling reads 4,096 MB. A number that reaches a
    // thousand should be grouped in the reader's own notation rather than
    // run together, which is what the other half of this asked for.
    expect(formatNumber(1234.5, 1)).toBe("1,234.5");
    expect(formatNumber(999.9, 1)).toBe("999.9");
  });

  it("keeps the digit count the caller asked for", () => {
    // The count is a statement about the instrument, not about the language:
    // a radar tilt is read to a hundredth of a degree whoever is looking.
    expect(formatNumber(0.5, 2)).toBe("0.50");
    expect(formatNumber(12, 0)).toBe("12");
  });

  it("keeps a measured number's own precision by default", async () => {
    // A legend stop is whatever the colour table said it was. Capping the
    // decimals turned a stop at 0.0125 into 0.01 and one at 0.001 into 0, so
    // the bar beside the map stopped saying what the map was painted with.
    for (const value of [0, 5, 0.5, 0.001, 0.0125, 12.75, -2, 1.5]) {
      expect(formatMeasure(value), String(value)).toBe(String(value));
    }
    // And a caller that does want a cap still gets one.
    expect(formatMeasure(0.0125, 2)).toBe("0.01");

    await ensureLanguage("fr");
    setLanguage("fr");
    expect(formatMeasure(0.0125)).toBe("0,0125");
  });

  it("marks a UTC hour in one place", () => {
    // Three legends built "12Z" by hand while the clock beside them said
    // "18 h 05 UTC", so a French window contradicted itself. The marker is a
    // catalogue string and `utcHourLabel` is the only thing that appends it.
    const offenders: string[] = [];
    for (const path of sourceFiles(ROOT)) {
      if (path.endsWith(join("lib", "units.ts"))) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/padStart\(2, "0"\)\}Z/g)) {
        offenders.push(`${path.slice(ROOT.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves toFixed only where nobody reads the result", () => {
    const found: Record<string, number> = {};
    for (const path of sourceFiles(ROOT)) {
      const count = (readFileSync(path, "utf8").match(/\.toFixed\(/g) ?? [])
        .length;
      if (!count) continue;
      found[path.slice(ROOT.length + 1).replace(/\\/g, "/")] = count;
    }
    expect(found).toEqual(MACHINE_VALUES);
  });

  it("never formats a number in the machine's locale instead of the reader's", () => {
    // `toLocaleString()` with nothing in the brackets formats in whatever
    // locale the operating system is in, which is not the language the reader
    // chose: a French reader on an English Windows got English numbers and an
    // English reader on a French one got French. Every call has to name the
    // locale, and `locale()` is the only thing that knows it.
    const offenders: string[] = [];
    for (const path of sourceFiles(ROOT)) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/\.toLocaleString\(\s*\)/g)) {
        offenders.push(`${path.slice(ROOT.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never puts a formatted number back into a control", () => {
    // A comma is not a decimal point to Number(), so a control whose value
    // came out of formatNumber would read back as NaN in Spanish and French.
    // Every number input in the app is handed a real number instead.
    const offenders: string[] = [];
    for (const path of sourceFiles(join(ROOT, "panels")).concat(
      sourceFiles(join(ROOT, "components")),
    )) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/\bvalue=\{[^}]*\bformatNumber\(/g)) {
        offenders.push(`${path.slice(ROOT.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
