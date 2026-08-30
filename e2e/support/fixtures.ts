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
    await route.fulfill({
      contentType: "application/json",
      body: emptyCollection,
    });
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
