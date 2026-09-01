import type { Page } from "@playwright/test";

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
function smokeKml(day: string): string {
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
  properties: { prod_type: "Tornado Warning", sig: "W", wfo: "MFL" },
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
 * Every network route the workspace touches, answered locally. A test that
 * needs different data re-routes the host it cares about and reloads.
 */
export async function routeWorkspace(page: Page) {
  // A spec that fakes the native side gets the cached scheme with it, because
  // the app routes its requests through Rust whenever Tauri is there. Nothing
  // is listening on that host in a browser, so the request is sent back to the
  // address it names, which is where the rest of these routes are waiting.
  await page.route("http://cached.localhost/**", async (route) => {
    const inner = new URL(route.request().url()).searchParams.get("u");
    if (!inner) {
      await route.fulfill({ status: 400, body: "no address" });
      return;
    }
    await route.fulfill({ status: 302, headers: { location: inner } });
  });
  await page.route("https://mapservices.weather.noaa.gov/**", async (route) => {
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
  await page.route("https://earthquake.usgs.gov/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: collection([earthquakeFeature]),
    });
  });
  await page.route("https://services3.arcgis.com/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: collection([wildfireFeature]),
    });
  });
  // NOAA HMS publishes one file a day. The stub answers today's 404 and
  // yesterday's with a plume, which is the day-boundary case the layer has to
  // survive every morning before the analysis lands.
  await page.route("https://satepsanone.nesdis.noaa.gov/**", async (route) => {
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
  await page.route("https://mesonet.agron.iastate.edu/**", async (route) => {
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
      const box = (west: number) => ({
        type: "Polygon",
        coordinates: [
          [
            [west, 26],
            [west + 1, 26],
            [west + 1, 27],
            [west, 27],
            [west, 26],
          ],
        ],
      });
      const version = (
        begin: string,
        end: string,
        west: number,
        status: string,
        id: string,
      ) => ({
        type: "Feature",
        geometry: box(west),
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
              -83,
              "NEW",
              "issued",
            ),
            version(
              "2022-09-28T19:00:00Z",
              "2022-09-28T20:00:00Z",
              -82,
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
  await page.route("**/hurdat/*.json", async (route) => {
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
  await page.route("https://geo.weather.gc.ca/**", async (route) => {
    if (route.request().url().includes("GetCapabilities")) {
      await route.fulfill({
        contentType: "application/xml",
        body: geometCapabilities,
      });
      return;
    }
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  await page.route("https://opengeo.ncep.noaa.gov/**", async (route) => {
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
