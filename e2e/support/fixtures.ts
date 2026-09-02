import type { Page, Route } from "@playwright/test";

type Handler = (route: Route) => Promise<void>;

/**
 * The hosts a spec has stubbed, newest first, so the cached scheme can answer
 * for them without sending the browser anywhere.
 *
 * A spec that fakes the native side gets the cached scheme with it, because
 * the app routes its requests through Rust whenever Tauri is there. This used
 * to be answered with a redirect back to the address it named, and the
 * browser followed that redirect straight past every route to the live
 * service: a redirected request is not offered to the routes again. Every
 * desktop-faked spec was reading real alerts, real radar frames and real
 * model runs, and the one host with no CORS on the real server, the smoke
 * analysis, simply failed. So the cached scheme now answers from the same
 * handlers, given a stand-in route that names the inner address.
 */
const stubs = new WeakMap<
  Page,
  Array<{ matches: (url: string) => boolean; handler: Handler }>
>();

/** Playwright's URL globs, as a predicate: `**` crosses slashes, `*` does not. */
function globMatcher(pattern: string): (url: string) => boolean {
  let expression = "";
  for (let at = 0; at < pattern.length; at += 1) {
    const char = pattern[at];
    if (char === "*" && pattern[at + 1] === "*") {
      expression += ".*";
      at += 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else if (char === "?") {
      expression += ".";
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      expression += `\\${char}`;
    } else {
      expression += char;
    }
  }
  const compiled = new RegExp(`^${expression}$`);
  return (url) => compiled.test(url);
}

/**
 * Routes a host for the page, and remembers the handler so a request for the
 * same address through the cached scheme is answered by it too. Use this,
 * rather than `page.route`, for any host the app fetches through the cache.
 */
export async function stubHost(page: Page, pattern: string, handler: Handler) {
  const held = stubs.get(page) ?? [];
  held.unshift({ matches: globMatcher(pattern), handler });
  stubs.set(page, held);
  await page.route(pattern, handler);
}

/** The stubbed handler for an address, or null when nobody stubbed its host. */
function stubFor(page: Page, url: string): Handler | null {
  return stubs.get(page)?.find((entry) => entry.matches(url))?.handler ?? null;
}

/** A one pixel transparent PNG, which every tile route answers with. */
export const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const ridgeCapabilities = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability>
    <Layer>
      <Name>conus</Name>
      <Layer queryable="1">
        <Name>conus_bref_qcd</Name>
        <Title>Base Reflectivity</Title>
        <Dimension name="time" units="ISO8601" default="2026-08-30T05:40:00.000Z">2026-08-30T05:20:00.000Z,2026-08-30T05:30:00.000Z,2026-08-30T05:40:00.000Z</Dimension>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

export const geometCapabilities = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability>
    <Layer>
      <Layer queryable="1">
        <Name>RADAR_1KM_RRAI</Name>
        <Title>Radar precipitation rate for rain [mm/h]</Title>
        <Dimension name="time" units="ISO8601" default="2026-08-30T11:00:00Z">2026-08-30T10:42:00Z/2026-08-30T11:00:00Z/PT6M</Dimension>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

const emptyCollection = JSON.stringify({
  type: "FeatureCollection",
  features: [],
});

function collection(features: unknown[]): string {
  return JSON.stringify({ type: "FeatureCollection", features });
}

/** A day's smoke analysis with one heavy plume over the default view. */
export function smokeKml(day: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
    "<name>HMS Smoke Mapping-" + day + "</name>",
    "<Folder><name>Overlay</name>",
    "<ScreenOverlay><name>NOAA logo</name></ScreenOverlay>",
    "<Placemark>",
    "<description><![CDATA[<div>Density: Heavy<br>Satellite: GOES-EAST</div>]]></description>",
    "<styleUrl>#Smoke_Heavy_style</styleUrl>",
    "<Polygon><outerBoundaryIs><LinearRing><coordinates>",
    "-99,34,0 -95,34,0 -95,38,0 -99,38,0 -99,34,0",
    "</coordinates></LinearRing></outerBoundaryIs></Polygon>",
    "</Placemark>",
    "</Folder>",
    "</Document>",
    "</kml>",
  ].join("\n");
}

/**
 * Two surface observations near the default view: one with a strong wind and
 * an overcast sky, one calm with a missing temperature, which is what an
 * automated station with no sensor reports.
 */
export const metarRows = [
  {
    icaoId: "KTST",
    obsTime: 1788276900,
    temp: 21.7,
    dewp: 15.2,
    wdir: 230,
    wspd: 27,
    wgst: 38,
    rawOb: "METAR KTST 011535Z 23027G38KT 10SM OVC020 22/15 A2992",
    lat: 26.5,
    lon: -82.5,
    name: "Testville Rgnl, FL, US",
    cover: "OVC",
    fltCat: "MVFR",
  },
  {
    icaoId: "KQUI",
    obsTime: 1788276600,
    temp: null,
    dewp: null,
    wdir: 0,
    wspd: 0,
    rawOb: "METAR KQUI 011530Z AUTO 00000KT 10SM CLR A2995",
    lat: 26.9,
    lon: -82.1,
    name: "Quiet Field, FL, US",
    cover: "CLR",
    fltCat: "VFR",
  },
];

export const alertFeature = {
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-86, 26],
        [-85, 26],
        [-85, 27],
        [-86, 27],
        [-86, 26],
      ],
    ],
  },
  properties: {
    prod_type: "Tornado Warning",
    sig: "W",
    wfo: "MFL",
    // The identifier the polygon service and the alert feed both spell the
    // same way, which is what joins the office's own words to the shape.
    cap_id: "urn:oid:2.49.0.1.840.0.test.001.1",
  },
};

/**
 * The alert feed, which carries what the office actually wrote.
 *
 * The polygon service has a product type and some times; the description,
 * the instruction and the counties are only here. The app reads this feed
 * once a minute for the damage tags whether or not anything is stubbed, so
 * leaving it unanswered meant every browser test ran with the office's words
 * missing and nothing noticed when they started being drawn.
 */
export const alertFeedFeature = {
  properties: {
    id: "urn:oid:2.49.0.1.840.0.test.001.1",
    event: "Tornado Warning",
    areaDesc: "Collier, FL; Hendry, FL",
    description:
      "At 402 PM EDT, a confirmed tornado was located near Immokalee,\nmoving northeast at 30 mph.",
    instruction:
      "TAKE COVER NOW! Move to a basement or an interior room on the\nlowest floor of a sturdy building.",
    parameters: { AWIPSidentifier: ["TORMFL"] },
  },
};

export const earthquakeFeature = {
  geometry: { type: "Point", coordinates: [-95, 35, 8] },
  properties: { mag: 4.4, place: "Test County", time: 1788068400000 },
};

export const wildfireFeature = {
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-96, 34],
        [-95, 34],
        [-95, 35],
        [-96, 35],
        [-96, 34],
      ],
    ],
  },
  properties: { poly_IncidentName: "Test Fire", poly_GISAcres: 4200 },
};

export const tropicalPointFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-79, 25] },
  properties: {
    stormname: "Hurricane Test",
    stormtype: "HU",
    maxwind: 85,
    mslp: 970,
    advisnum: "7",
    advdate: "500 PM EDT Sat Aug 29 2026",
    tau: 0,
    binnumber: "AT1",
  },
};

export const tropicalFeature = {
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-80, 24],
        [-78, 24],
        [-78, 26],
        [-80, 26],
        [-80, 24],
      ],
    ],
  },
  properties: { stormname: "Test Storm", advisnum: "5", basin: "AL" },
};

/**
 * A stand-in for the bundled HURDAT2 record. The real one is 2.5 MB, and a
 * test that loads it is measuring the network rather than the panel.
 */
/** A Day 1 categorical risk area, in the shape and colours the service uses. */
export const outlookFeature = {
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-100, 18],
        [-78, 18],
        [-78, 36],
        [-100, 36],
        [-100, 18],
      ],
    ],
  },
  properties: {
    dn: 4,
    label: "SLGT",
    label2: "Slight Risk",
    valid: "202608301630",
    expire: "202608311200",
    issue: "202608301629",
    fill: "#FFE066",
    stroke: "#DDAA00",
  },
};

/** One live mesoscale discussion. */
export const discussionFeature = {
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-92, 22],
        [-82, 22],
        [-82, 30],
        [-92, 30],
        [-92, 22],
      ],
    ],
  },
  properties: {
    name: "MD 1783",
    popupinfo: "Severe thunderstorms are expected to develop this afternoon.",
    idp_filedate: 1788095861000,
  },
};

/** One local storm report, in the shape the Mesonet feed answers with. */
export const stormReportFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-85.4, 26.2] },
  properties: {
    wfo: "MFL",
    type: "H",
    magf: 1.75,
    typetext: "HAIL",
    city: "3 NE Testville",
    state: "FL",
    st: "FL",
    source: "Trained Spotter",
    unit: "Inch",
    remark: "Golf ball sized hail covering the ground.",
    valid: "2026-08-30T11:40:00Z",
  },
};

export const stormRecord = {
  generated: "2026-08-30",
  statuses: ["TD", "TS", "HU", "EX", "SD", "SS", "LO"],
  // Points are [time, lat, lon, wind, status, landfall], the same shape the
  // shipped record has. Ian's figures are the published ones: the 140 kt peak
  // at noon out in the Gulf, the 130 kt landfall at Cayo Costa seven hours
  // later, and an energy of 17.47 rather than the 17.96 an earlier off-hour
  // counting bug produced.
  storms: [
    {
      i: "AL092022",
      n: "IAN",
      y: 2022,
      b: "AL",
      a: 17.47,
      p: [
        [Date.parse("2022-09-26T00:00:00Z") / 1000, 20.0, -80.0, 45, 1, 0],
        [Date.parse("2022-09-27T08:00:00Z") / 1000, 22.4, -83.6, 110, 2, 1],
        [Date.parse("2022-09-28T12:00:00Z") / 1000, 26.0, -82.7, 140, 2, 0],
        [Date.parse("2022-09-28T19:05:00Z") / 1000, 26.7, -82.2, 130, 2, 1],
        [Date.parse("2022-09-30T00:00:00Z") / 1000, 32.8, -79.0, 70, 2, 0],
      ],
    },
    {
      i: "AL041992",
      n: "ANDREW",
      y: 1992,
      b: "AL",
      a: 9.1,
      p: [
        [Date.parse("1992-08-23T12:00:00Z") / 1000, 25.4, -74.2, 130, 2, 0],
        [Date.parse("1992-08-24T09:00:00Z") / 1000, 25.5, -80.3, 145, 2, 1],
      ],
    },
    {
      // Never came within reach of the national mosaic, so it is listed but
      // cannot be replayed.
      i: "EP152023",
      n: "HILARY",
      y: 2023,
      b: "EP",
      a: 8.4,
      p: [
        [Date.parse("2023-08-18T18:00:00Z") / 1000, 19.4, -110.2, 125, 2, 0],
        [Date.parse("2023-08-19T18:00:00Z") / 1000, 22.0, -112.0, 110, 2, 0],
      ],
    },
  ],
};

/**
 * What the workspace asks the native side for on any launch, whatever the
 * spec is about.
 *
 * A spec that fakes `__TAURI_INTERNALS__` has to answer EVERY command the
 * workspace sends, not the ones its own feature needs. Five specs each grew
 * their own switch and diverged, and the ones that ended in `return null`
 * answered `incident_pack_set_limit` with null: `setLibrary(null)` ran and
 * the whole workspace fell to the error boundary reading `library.packs`,
 * which reads as a crash in a panel nowhere near the change. It cost most of
 * an afternoon once already.
 */
export interface DesktopStub {
  /** The stored settings, or null for a workspace opening on its defaults. */
  settings?: Record<string, unknown> | null;
  /**
   * Read the stored settings out of `window.__settings` instead.
   *
   * For a spec whose settings carry a clock: they have to be built in the
   * page, where `Date.now()` is the page's own, rather than handed in from
   * here.
   */
  settingsFromPage?: boolean;
  /** The record's rows. */
  journalRows?: unknown[];
  /** What the offline map packs answer with. */
  packs?: Record<string, unknown>;
}

/**
 * Fake the desktop for a spec, and fail loudly on anything unlisted.
 *
 * A spec with commands of its own registers them BEFORE calling this, by
 * setting `window.__answer`: a function taking the command and its arguments
 * and returning `[value]` when it handles one, or `undefined` when it does
 * not. The wrapper is what separates "here is your answer, which is null"
 * from "not mine", which a bare null cannot say.
 *
 * Anything nothing answers throws, naming the command. A test that fails
 * with `the workspace invoked incident_pack_estimate` names its own gap in
 * seconds; the same test with a null fallback fails somewhere else entirely,
 * later, in a component.
 */
export async function fakeDesktop(page: Page, stub: DesktopStub = {}) {
  await page.addInitScript(
    (held: {
      settings: Record<string, unknown> | null;
      fromPage: boolean;
      journalRows: unknown[];
      packs: Record<string, unknown>;
    }) => {
      const settings = held.fromPage
        ? ((window as unknown as { __settings?: Record<string, unknown> })
            .__settings ?? null)
        : held.settings;
      const own = (
        window as unknown as {
          __answer?: (
            command: string,
            args: Record<string, unknown>,
          ) => [unknown] | undefined;
        }
      ).__answer;
      (
        window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
      ).__TAURI_INTERNALS__ = {
        // Windows spells a custom scheme as a host on http, which is the
        // platform this is built for.
        convertFileSrc: (path: string, scheme: string) =>
          `http://${scheme}.localhost/${path}`,
        transformCallback: (callback: unknown) => callback,
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          const mine = own?.(command, args);
          if (mine) return mine[0];

          // The store, which is where the settings live once the app believes
          // it is on the desktop. The plugin unpacks a pair of the value and
          // whether the key was there at all: answering with the value alone
          // reads as "not found" and the workspace opens on defaults.
          if (command === "plugin:store|load") return 1;
          if (command === "plugin:store|get") {
            return args.key === "settings" && settings
              ? [settings, true]
              : [null, false];
          }
          if (command === "plugin:store|set") return null;
          if (command === "plugin:store|save") return null;
          if (command === "plugin:store|close") return null;
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return null;

          if (command === "journal_rows") return held.journalRows;
          if (command === "journal_path") return "C:/test/journal.jsonl";
          if (command === "journal_write") return null;
          if (command === "journal_append") return null;

          // The radar the workspace asks for on any launch, answered with
          // nothing to draw. A spec about the radar answers these itself; a
          // spec about the record or the wallpaper wants an empty timeline,
          // and saying so here is different from a null fallback saying it by
          // accident for every command in the app.
          if (command === "mrms_products") return [];
          if (command === "mrms_frames") return [];
          if (command === "set_palettes") return 0;
          if (command === "set_palette") return 0;

          // Read on every launch by the settings panel. Answering null here
          // is what took the workspace down.
          if (
            command === "incident_pack_list" ||
            command === "incident_pack_set_limit"
          ) {
            return held.packs;
          }

          throw new Error(
            `the workspace invoked ${command}, which no stub in this spec answers`,
          );
        },
      };
    },
    {
      settings: stub.settings ?? null,
      fromPage: stub.settingsFromPage ?? false,
      journalRows: stub.journalRows ?? [],
      packs: stub.packs ?? {
        packs: [],
        usedBytes: 0,
        diskLimitBytes: 8_589_934_592,
      },
    },
  );
}

/**
 * Every network route the workspace touches, answered locally. A test that
 * needs different data re-routes the host it cares about and reloads.
 */
export async function routeWorkspace(page: Page) {
  const stub = (pattern: string, handler: Handler) =>
    stubHost(page, pattern, handler);
  // The cached scheme, answered from the stubbed hosts. See `stubs` above for
  // why this is not a redirect. A host nobody stubbed is still sent back to
  // its own address, which is the live service, so a spec that reaches one
  // is at least reaching it on purpose.
  await page.route("http://cached.localhost/**", async (route) => {
    const inner = new URL(route.request().url()).searchParams.get("u");
    if (!inner) {
      await route.fulfill({ status: 400, body: "no address" });
      return;
    }
    const handler = stubFor(page, inner);
    if (!handler) {
      await route.fulfill({ status: 302, headers: { location: inner } });
      return;
    }
    // The handler reads the address and fulfils; everything else on a route
    // it never touches. The fulfilment lands on the cached-scheme request,
    // which is the one the page is waiting on.
    const standIn = {
      request: () => ({ url: () => inner }),
      fulfill: (options?: Parameters<Route["fulfill"]>[0]) =>
        route.fulfill(options),
    } as unknown as Route;
    await handler(standIn);
  });
  await stub("https://mapservices.weather.noaa.gov/**", async (route) => {
    const url = route.request().url();
    let features: unknown[] = [alertFeature];
    if (url.includes("/tropical/")) {
      features = url.includes("MapServer/5/")
        ? [tropicalPointFeature]
        : [tropicalFeature];
    } else if (url.includes("SPC_wx_outlks")) {
      features = [outlookFeature];
    } else if (url.includes("spc_mesoscale_discussion")) {
      features = [discussionFeature];
    }
    await route.fulfill({
      contentType: "application/json",
      body: collection(features),
    });
  });
  await stub("https://api.weather.gov/alerts/**", async (route) => {
    await route.fulfill({
      contentType: "application/geo+json",
      body: collection([alertFeedFeature]),
    });
  });
  await stub("https://earthquake.usgs.gov/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: collection([earthquakeFeature]),
    });
  });
  await stub("https://services3.arcgis.com/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: collection([wildfireFeature]),
    });
  });
  await stub("https://aviationweather.gov/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(metarRows),
    });
  });
  // NOAA HMS publishes one file a day. The stub answers today's 404 and
  // yesterday's with a plume, which is the day-boundary case the layer has to
  // survive every morning before the analysis lands.
  await stub("https://satepsanone.nesdis.noaa.gov/**", async (route) => {
    const url = route.request().url();
    const today = new Date();
    const stamp = (at: Date) =>
      `${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, "0")}${String(
        at.getUTCDate(),
      ).padStart(2, "0")}`;
    if (url.includes(`hms_smoke${stamp(today)}`)) {
      await route.fulfill({ status: 404, body: "not yet" });
      return;
    }
    const yesterday = new Date(today.getTime() - 86_400_000);
    await route.fulfill({
      contentType: "application/vnd.google-earth.kml+xml",
      body: smokeKml(stamp(yesterday)),
    });
  });
  await stub("https://mesonet.agron.iastate.edu/**", async (route) => {
    // The same host serves the placefile-style products, the radar archive,
    // and the storm reports.
    const url = route.request().url();
    if (url.includes("/tile.py/")) {
      await route.fulfill({ contentType: "image/png", body: transparentPng });
      return;
    }
    if (url.includes("/vtec/sbw_interval")) {
      // The interval service answers with one row per polygon a warning held,
      // so the same warning is here twice: the shape it opened with and the
      // shape the office shrank it to. Only one belongs on any given frame.
      // Wide enough to hold the camera wherever the replay flies it, because
      // one of the things being tested is a readout about the map centre.
      // The office shrinks it from the east, so both versions still differ
      // and both still cover the place the reader is asking about.
      const box = (east: number) => ({
        type: "Polygon",
        coordinates: [
          [
            [-90, 22],
            [east, 22],
            [east, 32],
            [-90, 32],
            [-90, 22],
          ],
        ],
      });
      const version = (
        begin: string,
        end: string,
        east: number,
        status: string,
        id: string,
      ) => ({
        type: "Feature",
        geometry: box(east),
        properties: {
          event_label: "Tornado Warning",
          ph_sig: "TO.W",
          phenomena: "TO",
          significance: "W",
          wfo: "TBW",
          year: 2022,
          eventid: 12,
          status,
          utc_issue: "2022-09-28T18:00:00Z",
          utc_expire: "2022-09-28T20:00:00Z",
          utc_polygon_begin: begin,
          utc_polygon_end: end,
          product_id: id,
        },
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: [
            version(
              "2022-09-28T18:00:00Z",
              "2022-09-28T19:00:00Z",
              -71,
              "NEW",
              "issued",
            ),
            version(
              "2022-09-28T19:00:00Z",
              "2022-09-28T20:00:00Z",
              -75,
              "CON",
              "shrunk",
            ),
          ],
        }),
      });
      return;
    }
    if (url.includes("/geojson/sbw.py")) {
      // The tag feed, which knows what the office tagged and nothing about
      // the revisions. Joined on the event, not on the polygon.
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-82.5, 26.5] },
              properties: {
                wfo: "TBW",
                year: 2022,
                phenomena: "TO",
                significance: "W",
                eventid: 12,
                damagetag: "CONSIDERABLE",
                hailtag: null,
                is_emergency: false,
                floodtag_damage: null,
              },
            },
          ],
        }),
      });
      return;
    }
    if (url.includes("/lsr.geojson")) {
      await route.fulfill({
        contentType: "application/json",
        body: collection([stormReportFeature]),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: emptyCollection,
    });
  });
  // The shipped record is an index with no positions in it and one file of
  // tracks per decade. One handler answers both, because a later route wins
  // over an earlier one and two globs here would shadow each other.
  await stub("**/hurdat/*.json", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    if (file === "index.json") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          generated: stormRecord.generated,
          statuses: stormRecord.statuses,
          storms: stormRecord.storms.map((storm) => [
            storm.i,
            storm.n,
            storm.a,
            Math.max(...storm.p.map((point) => point[3])),
            storm.p[0][0],
            storm.p[storm.p.length - 1][0],
            storm.p.length,
          ]),
        }),
      });
      return;
    }
    const decade = Number(file.replace(".json", ""));
    const tracks: Record<string, unknown> = {};
    for (const storm of stormRecord.storms) {
      if (Math.floor(storm.y / 10) * 10 === decade) tracks[storm.i] = storm.p;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(tracks),
    });
  });
  await stub("https://geo.weather.gc.ca/**", async (route) => {
    if (route.request().url().includes("GetCapabilities")) {
      await route.fulfill({
        contentType: "application/xml",
        body: geometCapabilities,
      });
      return;
    }
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  await stub("https://opengeo.ncep.noaa.gov/**", async (route) => {
    if (route.request().url().includes("GetCapabilities")) {
      await route.fulfill({
        contentType: "application/xml",
        body: ridgeCapabilities,
      });
      return;
    }
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
}
