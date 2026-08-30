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
  await page.route("https://mapservices.weather.noaa.gov/**", async (route) => {
    const url = route.request().url();
    const body = url.includes("/tropical/")
      ? collection(
          url.includes("MapServer/5/")
            ? [tropicalPointFeature]
            : [tropicalFeature],
        )
      : collection([alertFeature]);
    await route.fulfill({ contentType: "application/json", body });
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
  await page.route("https://mesonet.agron.iastate.edu/**", async (route) => {
    // The same host serves the placefile-style products and the radar archive.
    if (route.request().url().includes("/tile.py/")) {
      await route.fulfill({ contentType: "image/png", body: transparentPng });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: emptyCollection,
    });
  });
  await page.route("**/hurdat.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(stormRecord),
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
