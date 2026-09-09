import { readFile } from "node:fs/promises";
import { level2Source } from "../test/rustSource";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { ensureLanguage, setLanguage } from "../i18n";
import {
  SINGLE_SITE_MIN_ZOOM,
  SWEEP_RASTER_PX,
  beamHeightFeet,
  finestDetailSteps,
  sweepDetailBox,
  isLevel2Product,
  isSingleSiteViewport,
  liveAgeSeconds,
  sweepAgeMinutes,
  sweepCorners,
  sweepErrorText,
  sweepSite,
  stationSummary,
  STATION_QUIET_AFTER_MINUTES,
  type SweepImage,
} from "./level2";
import { setUnits } from "./units";

const sweep: SweepImage = {
  station: "KDMX",
  siteName: "Des Moines, IA",
  productId: "reflectivity",
  paletteApplied: false,
  highContrast: false,
  smoothed: false,
  dealiased: false,
  unplacedShare: 0,
  live: false,
  liveTilts: 0,
  liveFailed: null,
  nextChunkAt: null,
  volumeEndsAt: null,
  stormMotion: null,
  product: "Reflectivity",
  unit: "dBZ",
  elevationDegrees: 0.48,
  tilts: [0.48, 0.87, 1.31],
  tiltIndex: 0,
  collected: "2026-08-30T09:21:59+00:00",
  beneathCollected: null,
  west: -96.5,
  south: 39.6,
  east: -91.0,
  north: 43.8,
  siteLon: -93.75,
  siteLat: 41.7,
  image: "data:image/png;base64,AAAA",
  volume: "2026/08/30/KDMX/KDMX20260830_092159_V06",
  radar: "WSR-88D",
  rangeKm: 230,
  gateKm: 0.25,
  source: {
    kind: "recent",
    label: "NOAA NEXRAD Level II",
    url: "https://registry.opendata.aws/noaa-nexrad/",
  },
};

describe("single site handover", () => {
  it("takes over only once the view is close in", () => {
    expect(isSingleSiteViewport(SINGLE_SITE_MIN_ZOOM)).toBe(true);
    expect(isSingleSiteViewport(SINGLE_SITE_MIN_ZOOM + 2)).toBe(true);
    expect(isSingleSiteViewport(SINGLE_SITE_MIN_ZOOM - 0.01)).toBe(false);
    expect(isSingleSiteViewport(4.55)).toBe(false);
  });

  it("accepts only the products the native side decodes", () => {
    expect(isLevel2Product("reflectivity")).toBe(true);
    expect(isLevel2Product("velocity")).toBe(true);
    expect(isLevel2Product("composite")).toBe(false);
    expect(isLevel2Product(undefined)).toBe(false);
  });
});

describe("placing a sweep on the map", () => {
  it("gives the corners clockwise from the top left", () => {
    expect(sweepCorners(sweep)).toEqual([
      [-96.5, 43.8],
      [-91.0, 43.8],
      [-91.0, 39.6],
      [-96.5, 39.6],
    ]);
  });

  it("ages a sweep from when it was collected, not when it arrived", () => {
    const now = Date.parse("2026-08-30T09:28:59+00:00");
    expect(sweepAgeMinutes(sweep, now)).toBe(7);
    // A clock behind the volume must not report a negative age.
    expect(sweepAgeMinutes(sweep, Date.parse("2026-08-30T09:00:00Z"))).toBe(0);
    expect(sweepAgeMinutes({ ...sweep, collected: "nonsense" }, now)).toBe(0);
  });
});

describe("how high the beam is", () => {
  it("climbs the way the four-thirds earth model says", () => {
    // The published figure for the lowest tilt: about a mile and a half up at
    // a hundred kilometres out. It is why the same couplet at the same tilt
    // means something different at the edge of the range than near the site.
    expect(beamHeightFeet(100, 0.5)).toBeCloseTo(1.461 * 3280.84, 0);
    // At the radar it is on the ground, whatever the tilt.
    expect(beamHeightFeet(0, 0.5)).toBeCloseTo(0, 6);
    // Higher tilt, higher beam, at the same distance.
    expect(beamHeightFeet(100, 3.5)).toBeGreaterThan(beamHeightFeet(100, 0.5));
    // And further out is higher still, even at the same tilt, because the
    // earth curves away underneath it.
    expect(beamHeightFeet(200, 0.5)).toBeGreaterThan(
      2 * beamHeightFeet(100, 0.5),
    );
    // Nonsense in, nothing out.
    expect(beamHeightFeet(Number.NaN, 0.5)).toBe(0);
    expect(beamHeightFeet(-10, 0.5)).toBe(0);
  });

  it("reads the site off the sweep rather than off the middle of the box", () => {
    // This asserted the middle of the extent, and it was right while the
    // extent was always the circle around the site. It is not any more: a
    // reader zoomed in past about zoom ten gets the same pixels over less
    // ground, and that box is wherever they are looking. The site is carried
    // now, and this is what says so.
    const closer = {
      ...sweep,
      // Deliberately not centred on the site: that is the whole difference.
      west: -94.2,
      east: -93.0,
      south: 41.2,
      north: 42.4,
    };
    expect(sweepSite(closer)).toEqual({ lon: -93.75, lat: 41.7 });
    // Not the middle of that box, which is where the old reading would land
    // and where the beam height would then be measured from.
    expect(sweepSite(closer)).not.toEqual({
      lon: (closer.west + closer.east) / 2,
      lat: (closer.south + closer.north) / 2,
    });
  });
});

describe("what the native side said went wrong", () => {
  afterEach(() => setLanguage("en"));

  it("writes the failure in the language the workspace is in", async () => {
    // The command rejects with a code and its parts. Rendering the sentence
    // the native side wrote put an English line in a Spanish panel.
    const failure = {
      code: "noStormMotion",
      args: ["KDMX"],
      text: "the wind at KDMX could not be read, so nothing can be taken out of it",
    };
    expect(sweepErrorText(failure)).toContain("KDMX");
    expect(sweepErrorText(failure)).not.toBe(failure.text);

    await ensureLanguage("es");
    setLanguage("es");
    const spanish = sweepErrorText(failure);
    expect(spanish).toContain("KDMX");
    expect(spanish).toContain("viento");
  });

  it("fills in every part of a message that has more than one", () => {
    expect(
      sweepErrorText({
        code: "noSweep",
        args: ["KTLX", "Velocity"],
        text: "KTLX has no Velocity sweep at that tilt",
      }),
    ).toBe("KTLX has no Velocity sweep at that tilt.");
  });

  it("has wording for every failure the native side can send", async () => {
    // The commonest failure of all, a network one, had no key and fell back
    // to the English sentence in a workspace that is otherwise translated.
    // Reading the codes out of the Rust file is the only way to know the two
    // lists still agree; a key added on one side and not the other is exactly
    // how this went wrong.
    // Both files, because the network codes moved out of the first one. A
    // `Self::Http(error) => error.parts()` arm matches no code at all, so
    // reading `level2.rs` alone stopped seeing every HTTP failure the moment
    // they were classified rather than stringified, and a fifth variant
    // added later would have gone straight back to showing the reader a URL.
    const source = [
      level2Source(),
      await readFile(resolve(process.cwd(), "src-tauri/src/http.rs"), "utf8"),
    ].join("\n");
    // Anchored on the match arm rather than on any tuple that happens to hold
    // a string and a vector. Without the arrow this also read the labels in
    // the decoder's own tests, so adding a corrupt-input case called "zeros"
    // failed this test asking for wording for an error code that does not
    // exist.
    const codes = [
      ...source.matchAll(/=>\s*\("([a-zA-Z]+)", (?:vec!|Vec::new)/g),
    ].map((found) => found[1]);
    expect(codes.length).toBeGreaterThan(9);
    for (const code of codes) {
      expect(en[`radar.error.${code}` as keyof typeof en], code).toBeTruthy();
      expect(es[`radar.error.${code}` as keyof typeof es], code).toBeTruthy();
    }
  });

  it("does not diagnose something specific when it recognises nothing", () => {
    // The fallback used to report every unrecognised rejection as "The volume
    // listing could not be read", which is a specific claim about something
    // that may not have happened.
    expect(sweepErrorText({ nothing: true })).toBe(en["radar.error.unknown"]);
    expect(sweepErrorText(undefined)).toBe(en["radar.error.unknown"]);
  });

  it("falls back to what the native side said rather than showing a code", () => {
    // A failure this build has no wording for still has to read as something.
    expect(
      sweepErrorText({
        code: "somethingAddedLater",
        args: [],
        text: "the thing went wrong",
      }),
    ).toBe("the thing went wrong");
  });

  it("takes a plain string and an Error, which is what a browser rejects with", () => {
    expect(sweepErrorText("no native side here")).toBe("no native side here");
    expect(sweepErrorText(new Error("boom"))).toBe("boom");
  });
});

describe("how old the live part of a sweep is", () => {
  const at = Date.parse("2026-08-30T09:21:59+00:00");

  it("says nothing about a sweep the archive answered", () => {
    // A finished volume is minutes behind and the legend already says when it
    // was collected. Calling that "live, N s old" would be a lie about which
    // bucket the picture came from, not a rounding difference.
    expect(liveAgeSeconds({ ...sweep, live: false }, at + 12_000)).toBeNull();
  });

  it("counts from when the radar collected the cut", () => {
    // Not from when it was fetched: a slow download has to show as what it is.
    expect(liveAgeSeconds({ ...sweep, live: true }, at + 12_000)).toBe(12);
    expect(liveAgeSeconds({ ...sweep, live: true }, at + 89_400)).toBe(89);
  });

  it("never counts backwards from a clock behind the radar's", () => {
    // The radar stamps in its own time and this machine's may be a second or
    // two behind it, which would otherwise read as a sweep from the future.
    expect(liveAgeSeconds({ ...sweep, live: true }, at - 4000)).toBe(0);
  });

  it("gives up on a stamp it cannot read rather than guessing", () => {
    expect(
      liveAgeSeconds({ ...sweep, live: true, collected: "soon" }, at),
    ).toBeNull();
  });
});

describe("a station the reader is holding", () => {
  const home = { center: [-96.8, 32.78] as [number, number] };
  const collected = Date.parse(sweep.collected);

  afterEach(() => {
    setUnits("imperial");
    setLanguage("en");
  });

  it("says its call sign, how far it is, and that it is still sending", () => {
    const said = stationSummary(sweep, { ...home, name: "Casa" }, collected);
    expect(said).toContain("KDMX");
    expect(said).toContain("Casa");
    // Des Moines to Dallas, which is a long way and has to read like one.
    expect(said).toMatch(/\d+ mi/);
    expect(said).toContain("publishing");
  });

  it("measures from the radar, not from the middle of what was drawn", () => {
    // The distance used to be worked out from the midpoint of the sweep's own
    // extent, which was the radar for as long as every picture covered the
    // whole disc. A zoomed-in reader now gets a box, and the midpoint of that
    // is the snapped map centre: the line reported the distance from home to
    // wherever the reader was looking, labelled as the station's.
    const boxed = {
      ...sweep,
      west: sweep.siteLon + 1.5,
      east: sweep.siteLon + 2.1,
      south: sweep.siteLat + 1.2,
      north: sweep.siteLat + 1.7,
    };
    expect(stationSummary(boxed, home, collected)).toBe(
      stationSummary(sweep, home, collected),
    );
    // And the box really is somewhere else, so the equality above is the
    // sweep carrying its radar rather than two boxes that happen to agree.
    expect((boxed.west + boxed.east) / 2).not.toBeCloseTo(boxed.siteLon, 1);
  });

  it("falls back to the built-in word when home has no name", () => {
    expect(stationSummary(sweep, home, collected)).toContain("Home");
  });

  it("says how long it has been quiet once the site stops", () => {
    const quiet = collected + STATION_QUIET_AFTER_MINUTES * 60_000;
    const said = stationSummary(sweep, home, quiet);
    expect(said).not.toContain("publishing");
    // The number, in a sentence a person would write. Reusing the age label
    // here produced "Nothing new for 25 min old."
    expect(said).toContain(
      `Nothing new for ${STATION_QUIET_AFTER_MINUTES} min.`,
    );
    expect(said).not.toContain("min old");
    // A minute earlier it is a slow scan rather than an outage.
    expect(stationSummary(sweep, home, quiet - 60_000)).toContain("publishing");
  });

  it("never calls an archive volume a site that is sending", () => {
    // The archive answers instantly and the volume is years old; saying it is
    // publishing would be a claim about a radar nobody asked about.
    const archived: SweepImage = {
      ...sweep,
      source: { ...sweep.source, kind: "archive" },
    };
    expect(stationSummary(archived, home, collected)).not.toContain(
      "publishing",
    );
  });

  it("measures the distance in whatever the reader reads in", () => {
    setUnits("metric");
    expect(stationSummary(sweep, home, collected)).toMatch(/\d+ km/);
  });
});

describe("how much ground the sweep is drawn over", () => {
  // A real disc: KDMX reaches 230 km, which is 2.77 degrees of longitude
  // either side at 41.7 north and 2.07 of latitude, so 5.54 by 4.14.
  //
  // The longitude was 4.56 wide here until 2026-09-08, under a comment
  // claiming 4.1, and neither was the disc the app draws. It is the four
  // cardinal points at 230 km, which is what `sweep_extent` returns: due
  // east of 41.7 north the great circle lands 2.7696 degrees along. A
  // fixture narrower than the real disc makes the coverage case below
  // stricter than the app has to be.
  // A WSR-88D's own numbers beside its corners: 230 kilometres of reach in
  // quarter kilometre gates, which is what says how far the box may narrow.
  const disc = {
    west: -96.55,
    south: 39.63,
    east: -91.01,
    north: 43.77,
    rangeKm: 230,
    gateKm: 0.25,
  };
  const centre: [number, number] = [-93.78, 41.7];
  const wide = disc.east - disc.west;
  // The widest window the browser suite runs at. Whether a box covers what a
  // reader can see depends on this as much as on the zoom, so every case here
  // names it rather than leaving it to whatever the harness happens to be.
  const windowPx = 1920;

  it("draws the whole disc while a screen pixel is coarser than the raster", () => {
    // 1,024 pixels over 460 kilometres is 449 metres a pixel. Below about
    // zoom 10 a screen pixel covers more ground than that, so narrowing the
    // box buys a reader nothing and costs a render. Zooms 8 and 9 are inside
    // the single-site view and still get the whole disc, because a box that
    // reached them would be narrower than the window: see the threshold's
    // own docstring, and `AUD-453`.
    for (const zoom of [4, 7, 8, 9, 9.9]) {
      expect(
        sweepDetailBox(disc, centre, zoom, windowPx),
        String(zoom),
      ).toBeNull();
    }
  });

  it("covers the window it is drawn in, at every zoom it narrows at", () => {
    // The other half of the trade, and the half nothing asserted until
    // 2026-09-08. Outside the box there is nothing at all: `MapViewport`
    // drives the mosaic to zero opacity the moment a single-site sweep is
    // set, so ground the box does not reach is bare basemap. The centre also
    // snaps to a grid of half the box's width, so what a reader is
    // guaranteed either side of where they are looking is a quarter of the
    // box, not a half.
    //
    // MapLibre's world is 512 times two to the zoom over 360 degrees, and
    // longitude is linear in x, so a window's half width in degrees is the
    // same at every latitude. 1,920 is the widest the browser suite runs at,
    // and this disc covers about 2,016. Without this case a change that
    // narrowed the box to about 504 pixels of coverage passed every gate in
    // the repository and shipped.
    //
    // Measured by walking the reader across a whole cell of the snap grid
    // rather than by dividing the box by four. The quarter is the conclusion
    // this is supposed to be testing, so asserting it asserts the arithmetic
    // against itself: widening the snap grid to the box's full width halves
    // what every reader is guaranteed and left the divided version green.
    // It is also wrong rather than merely loose once a box is clipped to the
    // disc, where a quarter of the width bears no relation to the ground
    // either side of the reader. The nearest edge is the thing itself.
    for (const zoom of [10, 11, 12, 13, 14, 18]) {
      const first = sweepDetailBox(disc, centre, zoom, windowPx);
      expect(first, String(zoom)).not.toBeNull();
      // The grid is half the box, so a reader anywhere within a quarter of a
      // box either side of a grid point gets that point's box. Walking that
      // span is what puts the snap between the reader and their box, which is
      // the whole reason the guarantee is a quarter and not a half.
      //
      // Positions whose box the disc clips are skipped and counted, the same
      // way the browser spec does it: there the radar's own reach has run out
      // and less ground is the honest answer rather than a narrower box.
      const reach = (first![2] - first![0]) / 4;
      let worst = Infinity;
      let worstAt = centre[0];
      let measured = 0;
      for (let step = -12; step <= 12; step += 1) {
        const lon = centre[0] + (reach * step) / 12;
        const box = sweepDetailBox(disc, [lon, centre[1]], zoom, windowPx);
        expect(box, `${zoom} at ${lon}`).not.toBeNull();
        if (box![0] <= disc.west + 1e-9 || box![2] >= disc.east - 1e-9)
          continue;
        measured += 1;
        const nearest = Math.min(lon - box![0], box![2] - lon);
        if (nearest < worst) {
          worst = nearest;
          worstAt = lon;
        }
      }
      expect(
        measured,
        `every box at zoom ${zoom} was clipped, so nothing was measured`,
      ).toBeGreaterThan(0);
      const halfWindow = (windowPx / 2) * (360 / (512 * 2 ** zoom));
      expect(
        worst,
        `zoom ${zoom} at ${worstAt.toFixed(4)} leaves ${Math.round(
          (halfWindow - worst) * 2 * ((512 * 2 ** zoom) / 360),
        )}px of the window uncovered`,
      ).toBeGreaterThanOrEqual(halfWindow);
    }
  });

  it("covers the window on every disc the network has, not just a wide one", () => {
    // The case above pins one disc. This is the reason a single zoom
    // threshold could never be the whole rule: substituting the progression
    // into the bound cancels the zoom, so whether a box covers the window
    // depends on the disc's width in degrees alone, and a 460 kilometre disc
    // is 5.54 degrees at Des Moines and 4.59 at Miami because the width goes
    // as one over the cosine of the latitude.
    //
    // Measured on 2026-09-08 against the 159-site table: with a threshold of
    // ten and no rule beside it, 85 of them drew bare basemap at a 1,920
    // pixel window and 152 at 2,560. A terminal radar reaches 89 kilometres
    // rather than 230 and was uncovered at every common window size.
    const widths = [
      // A WSR-88D at the top of the country, in the middle, and at Key West,
      // and a terminal radar's 89 kilometres, which is the narrowest disc the
      // app ever draws.
      {
        name: "KMBX at 48.4 N",
        wide: 4.136 / Math.cos((48.4 * Math.PI) / 180),
      },
      {
        name: "KDMX at 41.7 N",
        wide: 4.136 / Math.cos((41.7 * Math.PI) / 180),
      },
      {
        name: "KAMX at 25.6 N",
        wide: 4.136 / Math.cos((25.6 * Math.PI) / 180),
      },
      {
        name: "KBYX at 24.6 N",
        wide: 4.136 / Math.cos((24.6 * Math.PI) / 180),
      },
      {
        name: "a terminal radar",
        wide: 1.598 / Math.cos((41.7 * Math.PI) / 180),
      },
    ];
    // Including a portrait window, whose height is the binding side. The
    // longitude test alone left one bare above and below: at a Key West disc,
    // zoom 10 and 1080 by 1920, the width cleared exactly and 265 pixels of
    // the height did not. Passing the longer side is what reduces the two
    // axes to this one test.
    for (const window of [1024, 1440, 1920, 2560, 3840]) {
      for (const { name, wide } of widths) {
        const site = {
          west: -93.75 - wide / 2,
          south: 39.6,
          east: -93.75 + wide / 2,
          north: 43.8,
          rangeKm: 230,
          gateKm: 0.25,
        };
        for (const zoom of [10, 11, 12, 13, 14, 18]) {
          const box = sweepDetailBox(site, [-93.75, 41.7], zoom, window);
          // No box at all is a fine answer: the whole disc is drawn, which
          // covers everything the radar has.
          if (box === null) continue;
          const reach = (box[2] - box[0]) / 4;
          let worst = Infinity;
          for (let step = -8; step <= 8; step += 1) {
            const lon = -93.75 + (reach * step) / 8;
            const at = sweepDetailBox(site, [lon, 41.7], zoom, window);
            expect(at, `${name} at ${zoom}`).not.toBeNull();
            if (at![0] <= site.west + 1e-9 || at![2] >= site.east - 1e-9) {
              continue;
            }
            worst = Math.min(worst, lon - at![0], at![2] - lon);
          }
          if (!Number.isFinite(worst)) continue;
          const halfWindow = (window / 2) * (360 / (512 * 2 ** zoom));
          expect(
            worst,
            `${name} at zoom ${zoom} in a ${window}px window leaves ${Math.round(
              (halfWindow - worst) * 2 * ((512 * 2 ** zoom) / 360),
            )}px bare`,
          ).toBeGreaterThanOrEqual(halfWindow);
        }
      }
    }
  });

  it("covers a portrait window top to bottom as well as side to side", () => {
    // The other axis. A disc is `tall / cos(latitude)` wide, and a degree of
    // latitude is `cos(latitude)` of a degree of longitude on screen, so the
    // cosine cancels and the latitude condition is the longitude one with the
    // window's height put in. Checking the width alone therefore passed a
    // portrait window while leaving it bare above and below: at a Key West
    // disc, zoom 10 and 1080 by 1920, the width cleared exactly and 265 of
    // the 1920 pixels of height did not.
    //
    // Passing the longer side is what reduces the two to one test, and this
    // asserts both of them rather than trusting that reduction.
    const at = 24.6;
    const lat = (at * Math.PI) / 180;
    const tall = 4.136;
    const wide = tall / Math.cos(lat);
    const site = {
      west: -81.8 - wide / 2,
      south: at - tall / 2,
      east: -81.8 + wide / 2,
      north: at + tall / 2,
      rangeKm: 230,
      gateKm: 0.25,
    };
    for (const [across, down] of [
      [1080, 1920],
      [1920, 1080],
      [1440, 2560],
    ]) {
      const span = Math.max(across, down);
      for (const zoom of [10, 11, 12, 13]) {
        const box = sweepDetailBox(site, [-81.8, at], zoom, span);
        // The whole disc covers everything the radar has, so no box is fine.
        if (box === null) continue;
        const perPixel = 360 / (512 * 2 ** zoom);
        // A quarter of the box either side, in each axis, against half the
        // window in that axis. Latitude degrees are shorter on screen than
        // longitude ones by the cosine, which is why the height carries it.
        expect(
          (box[2] - box[0]) / 4,
          `${across} by ${down} at zoom ${zoom} is bare at the sides`,
        ).toBeGreaterThanOrEqual((across / 2) * perPixel);
        expect(
          (box[3] - box[1]) / 4,
          `${across} by ${down} at zoom ${zoom} is bare above and below`,
        ).toBeGreaterThanOrEqual((down / 2) * perPixel * Math.cos(lat));
      }
    }
  });

  it("halves the ground again for every whole zoom past that", () => {
    // The whole point: the same 1,024 pixels over less ground is more metres
    // of radar per metre of screen. Pinned as the halving rather than as "it
    // got smaller", which any monotone shrink would satisfy.
    const spans = [10, 11, 12, 13].map((zoom) => {
      const box = sweepDetailBox(disc, centre, zoom, windowPx);
      expect(box, String(zoom)).not.toBeNull();
      return box![2] - box![0];
    });
    expect(spans[0]).toBeCloseTo(wide / 2, 9);
    for (const [at, span] of spans.entries()) {
      if (at > 0)
        expect(span, `zoom ${10 + at}`).toBeCloseTo(spans[at - 1] / 2, 9);
    }
    // And a floor, because 28 metres a pixel is already six times finer than
    // a gate and there is nothing left to resolve. A sixteenth exactly, named
    // rather than compared to whatever the last span happened to be: the
    // ceiling is the promise, and the level it is first reached at moves if
    // the exponent ever does.
    //
    // A sixteenth for this radar, which is the point of the case below: the
    // number here is what 230 kilometres of reach in quarter kilometre gates
    // comes to, not a constant every radar shares.
    expect(spans.at(-1)!).toBeCloseTo(wide / 16, 9);
    const deepest = sweepDetailBox(disc, centre, 18, windowPx);
    expect(deepest![2] - deepest![0]).toBeCloseTo(wide / 16, 9);
  });

  it("stops where the sweep runs out of gate, not where the disc does", () => {
    // The ceiling used to be a sixteenth of whatever disc was underneath,
    // and its reasoning was written against one radar. A share knows nothing
    // about what is in the data: the same sixteenth is nine pixels a gate on
    // a WSR-88D and thirteen a bin on a terminal radar's base products, where
    // the last halvings each bought a fetch, a decode and a 1,024 square
    // render to interpolate between bins that were already resolved. At the
    // other end it was too shallow, because the long range product reaches
    // 417 kilometres in 300 metre bins and still had detail past a sixteenth.
    //
    // These three are the rule. They are also what holds the one number in it
    // that is a choice: six pixels a gate is the only whole number that gives
    // all three of these answers, so moving it either way reddens one of
    // them. Five would take the long range product back to a sixteenth and
    // seven would give the terminal base product back the halving it has no
    // bins for.
    expect(finestDetailSteps(230, 0.25), "WSR-88D").toBe(16);
    expect(finestDetailSteps(88.8, 0.15), "TDWR base products").toBe(8);
    expect(finestDetailSteps(417, 0.3), "TDWR long range").toBe(32);

    // A legacy volume in kilometre gates is a quarter of the picture and
    // says so. Nothing about the disc changed; what changed is what is in it.
    expect(finestDetailSteps(230, 1), "a legacy 1 km volume").toBe(4);

    // A sweep that did not say gets the ceiling the old constant was. The
    // wrong answer in the other direction is a reader's picture taken away
    // over a field that failed to arrive.
    for (const missing of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(finestDetailSteps(230, missing), String(missing)).toBe(16);
      expect(finestDetailSteps(missing, 0.25), String(missing)).toBe(16);
    }

    // And the box really follows it rather than the two agreeing on paper: a
    // terminal radar's base disc stops at an eighth where the WSR-88D above
    // stops at a sixteenth, at the same zoom and the same window.
    const terminal = {
      west: -85.2202,
      south: 32.8492,
      east: -83.3037,
      north: 34.4446,
      rangeKm: 88.8,
      gateKm: 0.15,
    };
    const across = terminal.east - terminal.west;
    const deepest = sweepDetailBox(terminal, [-84.26, 33.65], 18, 1024);
    expect(deepest![2] - deepest![0]).toBeCloseTo(across / 8, 9);
  });

  it("draws its pixels over the box the native side really rasters", () => {
    // The whole rule is metres a pixel, and the pixels are the native side's.
    // A raster that changed size there would move every answer above without
    // touching a line of this file.
    //
    // Comments out first, and every match rather than the first. The pattern
    // was non-global over every `.rs` file in the directory joined in name
    // order, and `draw.rs` sorts before `mod.rs`: a comment in `draw.rs`
    // holding the old number answered for a `mod.rs` that really said
    // something else, which is the same defect this suite fixed in the
    // ambient screen's stylesheet patterns two commits earlier.
    const rust = level2Source()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");
    const said = [...rust.matchAll(/const IMAGE_SIZE: usize = (\d+);/g)].map(
      (found) => found[1],
    );
    expect(said).toEqual([String(SWEEP_RASTER_PX)]);
  });

  it("gives the same box for every camera inside one zoom level", () => {
    // The map's zoom is continuous and reaches this unrounded, through eased
    // fly-tos and a wheel that moves in fractions. Unfloored, every hundredth
    // of a level was its own box, so a held loop frame was orphaned by any
    // zoom change and the next scrub re-fetched the volume behind it.
    const level = sweepDetailBox(disc, centre, 12, windowPx)!;
    for (const zoom of [12, 12.0000001, 12.05, 12.5, 12.9999]) {
      expect(
        sweepDetailBox(disc, centre, zoom, windowPx),
        String(zoom),
      ).toEqual(level);
    }
    // And the next level really is a different box, so this is quantising
    // rather than ignoring the zoom.
    expect(sweepDetailBox(disc, centre, 13, windowPx)).not.toEqual(level);
  });

  it("holds one box across a whole grid cell, wherever the reader started", () => {
    // The honest version of "a small pan costs nothing". Snapping the centre
    // to a grid means the box moves whenever a pan crosses a grid line, so no
    // pan of any size is free. What is true is that every camera inside one
    // cell shares a box, and that is what a held loop frame depends on. An
    // earlier version of this nudged one hand-picked centre by an eighth of
    // the box and passed on the centre it chose.
    const held = sweepDetailBox(disc, centre, 12, windowPx)!;
    // The grid is half the box's own width, and the two axes are not the same
    // size: a disc is wider in longitude than it is tall in latitude.
    const acrossCell = (held[2] - held[0]) / 2;
    const upCell = (held[3] - held[1]) / 2;
    const settled = sweepDetailBox(
      disc,
      [held[0] + acrossCell, held[1] + upCell],
      12,
      windowPx,
    )!;
    for (const away of [-0.49, -0.25, 0, 0.25, 0.49]) {
      const inside: [number, number] = [
        settled[0] + acrossCell * (1 + away),
        settled[1] + upCell * (1 + away),
      ];
      expect(sweepDetailBox(disc, inside, 12, windowPx), String(away)).toEqual(
        settled,
      );
    }
    // A whole cell over is a different box, which is what makes the cell a
    // cell rather than the box never moving.
    expect(
      sweepDetailBox(
        disc,
        [settled[0] + 2 * acrossCell, settled[1] + upCell],
        12,
        windowPx,
      ),
    ).not.toEqual(settled);
  });

  it("moves it for a pan that would leave the picture", () => {
    const held = sweepDetailBox(disc, centre, 12, windowPx)!;
    const span = held[2] - held[0];
    const moved = sweepDetailBox(
      disc,
      [centre[0] + span, centre[1]],
      12,
      windowPx,
    )!;
    expect(moved[0]).toBeGreaterThan(held[0]);
  });

  it("keeps the box inside the disc and never asks for most of it", () => {
    // A box is at most a quarter of the disc before clipping, because `steps`
    // is never below two. There used to be a guard here against a clipped box
    // that came out as most of the disc again, and a test that claimed to
    // exercise it; over five million (centre, zoom) pairs the largest box is
    // exactly a quarter and the guard never fired once.
    const area = (wide * (disc.north - disc.south)) / 4;
    for (const zoom of [10, 11, 12, 15]) {
      for (const at of [
        [disc.west, disc.south],
        [disc.east, disc.north],
        [disc.west, disc.north],
        centre,
      ] as [number, number][]) {
        const box = sweepDetailBox(disc, at, zoom, windowPx);
        expect(box, `${at} at ${zoom}`).not.toBeNull();
        expect(box![0]).toBeGreaterThanOrEqual(disc.west);
        expect(box![1]).toBeGreaterThanOrEqual(disc.south);
        expect(box![2]).toBeLessThanOrEqual(disc.east);
        expect(box![3]).toBeLessThanOrEqual(disc.north);
        expect((box![2] - box![0]) * (box![3] - box![1])).toBeLessThanOrEqual(
          area + 1e-9,
        );
      }
    }
    // A disc with no size at all is not a box to draw over.
    expect(
      sweepDetailBox(
        { west: 1, south: 1, east: 1, north: 1, rangeKm: 230, gateKm: 0.25 },
        centre,
        12,
        windowPx,
      ),
    ).toBeNull();
    expect(sweepDetailBox(disc, centre, Number.NaN, windowPx)).toBeNull();
  });
});
