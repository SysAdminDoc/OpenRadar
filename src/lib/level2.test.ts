import { readFile } from "node:fs/promises";
import { level2Source } from "../test/rustSource";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { ensureLanguage, setLanguage } from "../i18n";
import {
  SINGLE_SITE_MIN_ZOOM,
  beamHeightFeet,
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
  live: false,
  liveTilts: 0,
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
  image: "data:image/png;base64,AAAA",
  volume: "2026/08/30/KDMX/KDMX20260830_092159_V06",
  radar: "WSR-88D",
  rangeKm: 230,
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

  it("reads the site back off the extent its sweep was drawn to", () => {
    // The extent is the circle around the site, so its middle is the site,
    // which is the only place the range to a clicked point can be measured
    // from.
    expect(
      sweepSite({
        ...sweep,
        west: -96.5,
        east: -91.0,
        south: 39.6,
        north: 43.8,
      }),
    ).toEqual({ lon: -93.75, lat: 41.7 });
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
