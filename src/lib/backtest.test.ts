import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backtestWarnings } from "./backtest";
import type { OverlayData } from "./overlays";
import { DEFAULT_QUIET_HOURS, WATCH_POLL_MS, type WatchPlace } from "./watch";

const home: WatchPlace = {
  id: "home",
  name: "Home",
  named: false,
  enabled: true,
  center: [-96.8, 32.78],
  radiusMiles: 30,
  minSeverity: "moderate",
  sound: false,
};
const school: WatchPlace = {
  ...home,
  id: "school",
  name: "School",
  named: true,
  center: [-96.75, 32.8],
};

const over: Array<[number, number]> = [
  [-96.9, 32.7],
  [-96.7, 32.7],
  [-96.7, 32.9],
  [-96.9, 32.9],
  [-96.9, 32.7],
];
const far: Array<[number, number]> = [
  [-90, 30],
  [-89, 30],
  [-89, 31],
  [-90, 31],
  [-90, 30],
];

/** One polygon version of one warning, the way the archive layer holds it. */
function polygon(
  event: string,
  headline: string,
  severity: string,
  begin: number,
  end: number,
  extra: Record<string, unknown> = {},
): OverlayData["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [over] },
    properties: {
      headline,
      severity,
      kind: "tornado",
      impact: "",
      // Every version of a warning is its own product, which is why the
      // backtest has to know them by the event.
      capId: `${event}@${begin}`,
      event,
      issued: begin,
      expires: end,
      polygonBegin: begin,
      polygonEnd: end,
      historical: true,
      ...extra,
    },
  };
}

function archive(...features: OverlayData["features"]): OverlayData {
  return { type: "FeatureCollection", features };
}

/** The first moment the watch polls at or after `at`, stepping from `from`. */
function firstPoll(from: number, at: number): number {
  return from + Math.ceil((at - from) / WATCH_POLL_MS) * WATCH_POLL_MS;
}

// Local times, because quiet hours are the reader's own clock.
const day = (hour: number, minute = 0) =>
  new Date(2026, 4, 20, hour, minute).getTime();

describe("replaying a window through the warning watch", () => {
  it("says a warning once, at the poll it first stands over a place", () => {
    const from = day(13, 30);
    const found = backtestWarnings(
      archive(
        polygon(
          "OUN|2026|TO|W|1",
          "Tornado Warning",
          "extreme",
          day(14),
          day(14, 20),
        ),
        // The office trims the polygon: a new product, the same warning.
        polygon(
          "OUN|2026|TO|W|1",
          "Tornado Warning",
          "extreme",
          day(14, 20),
          day(15),
        ),
      ),
      [home],
      {},
      from,
      day(16),
    );
    expect(found).toHaveLength(1);
    expect(found[0].placeId).toBe("home");
    expect(found[0].lines).toHaveLength(1);
    expect(found[0].lines[0].said).toBe(firstPoll(from, day(14)));
    expect(found[0].lines[0].heldFrom).toBeNull();
    expect(found[0].lines[0].alert.headline).toBe("Tornado Warning");
  });

  it("holds an ordinary warning through quiet hours and says it when they end", () => {
    const from = day(2);
    const quiet: WatchPlace = {
      ...home,
      quietHours: { ...DEFAULT_QUIET_HOURS, enabled: true },
    };
    const [place] = backtestWarnings(
      archive(
        polygon(
          "FWD|2026|FF|W|3",
          "Flash Flood Warning",
          "severe",
          day(3),
          day(9),
          { kind: "flood" },
        ),
      ),
      [quiet],
      {},
      from,
      day(10),
    );
    expect(place.lines).toHaveLength(1);
    expect(place.lines[0].heldFrom).toBe(firstPoll(from, day(3)));
    expect(place.lines[0].said).toBe(firstPoll(from, day(7)));
  });

  it("says when quiet hours held a warning until it was over", () => {
    const from = day(2);
    const [place] = backtestWarnings(
      archive(
        polygon(
          "FWD|2026|SV|W|4",
          "Severe Thunderstorm Warning",
          "severe",
          day(3),
          day(4),
          { kind: "thunderstorm" },
        ),
      ),
      [{ ...home, quietHours: { ...DEFAULT_QUIET_HOURS, enabled: true } }],
      {},
      from,
      day(10),
    );
    expect(place.lines).toHaveLength(1);
    expect(place.lines[0].said).toBeNull();
    expect(place.lines[0].heldFrom).toBe(firstPoll(from, day(3)));
  });

  it("lets the worst warnings through quiet hours at once", () => {
    const from = day(2);
    const [place] = backtestWarnings(
      archive(
        polygon(
          "FWD|2026|TO|W|5",
          "Tornado Warning",
          "extreme",
          day(3),
          day(4),
        ),
      ),
      [{ ...home, quietHours: { ...DEFAULT_QUIET_HOURS, enabled: true } }],
      {},
      from,
      day(10),
    );
    expect(place.lines[0].said).toBe(firstPoll(from, day(3)));
    expect(place.lines[0].heldFrom).toBeNull();
  });

  it("says a warning again when its damage threat goes up, and not when it comes down", () => {
    const from = day(13);
    const [place] = backtestWarnings(
      archive(
        polygon(
          "OUN|2026|TO|W|6",
          "Tornado Warning",
          "extreme",
          day(14),
          day(14, 10),
        ),
        polygon(
          "OUN|2026|TO|W|6",
          "Tornado Warning",
          "extreme",
          day(14, 10),
          day(14, 30),
          { impact: "considerable" },
        ),
        polygon(
          "OUN|2026|TO|W|6",
          "Tornado Warning",
          "extreme",
          day(14, 30),
          day(15),
        ),
      ),
      [home],
      {},
      from,
      day(16),
    );
    expect(place.lines.map((line) => line.alert.reason.upgradedFrom)).toEqual([
      null,
      0,
    ]);
    expect(place.lines[1].said).toBe(firstPoll(from, day(14, 10)));
  });

  it("lists a warning over two places under each of them", () => {
    const [atHome, atSchool] = backtestWarnings(
      archive(
        polygon(
          "OUN|2026|TO|W|7",
          "Tornado Warning",
          "extreme",
          day(14),
          day(15),
        ),
      ),
      [home, school],
      {},
      day(13),
      day(16),
    );
    expect(atHome.lines).toHaveLength(1);
    expect(atSchool.lines).toHaveLength(1);
    expect(atSchool.lines[0].alert.places?.map((place) => place.id)).toEqual([
      "home",
      "school",
    ]);
  });

  it("says nothing about a kind switched off, a place switched off, or a storm out of reach", () => {
    const tornado = polygon(
      "OUN|2026|TO|W|8",
      "Tornado Warning",
      "extreme",
      day(14),
      day(15),
    );
    expect(
      backtestWarnings(
        archive(tornado),
        [home],
        { tornado: false },
        day(13),
        day(16),
      )[0].lines,
    ).toEqual([]);
    expect(
      backtestWarnings(
        archive(tornado),
        [{ ...home, enabled: false }],
        {},
        day(13),
        day(16),
      ),
    ).toEqual([]);
    const away = {
      ...tornado,
      geometry: { type: "Polygon", coordinates: [far] },
    };
    expect(
      backtestWarnings(archive(away), [home], {}, day(13), day(16))[0].lines,
    ).toEqual([]);
  });

  it("cannot reach anything that notifies, sounds, speaks or writes the record", () => {
    // What makes "nothing was notified" true rather than hoped for: nothing
    // the module imports, or anything they import in turn, can do it.
    const reached = new Set<string>();
    const walk = (file: string) => {
      if (reached.has(file)) return;
      reached.add(file);
      const source = readFileSync(file, "utf8");
      for (const [, path] of source.matchAll(/from "(\.[^"]+)"/g)) {
        const base = join(file, "..", path);
        for (const candidate of [
          `${base}.ts`,
          `${base}.tsx`,
          join(base, "index.ts"),
        ]) {
          try {
            readFileSync(candidate);
          } catch {
            continue;
          }
          walk(candidate);
          break;
        }
      }
    };
    walk(join(process.cwd(), "src", "lib", "backtest.ts"));
    // The walk has to reach the rules, or it passes by reading nothing.
    expect(
      [...reached].some((file) => file.endsWith(join("lib", "watch.ts"))),
    ).toBe(true);
    const names = [...reached].map((file) => file.split(/[\\/]/).at(-1));
    for (const module of ["notify.ts", "sound.ts", "journal.ts", "speech.ts"]) {
      expect(names).not.toContain(module);
    }
  });
});
