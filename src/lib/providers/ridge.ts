import { createWmsProvider } from "./wms";

/**
 * NWS RIDGE II base reflectivity mosaic. Keyless, roughly two-minute cadence,
 * and published with no access constraints, which is why it leads the chain.
 */
export const ridgeProvider = createWmsProvider({
  id: "ridge",
  label: "NWS RIDGE II",
  detail: "CONUS base reflectivity, two-minute mosaic",
  attribution:
    '<a href="https://opengeo.ncep.noaa.gov/geoserver/web/">NOAA NWS RIDGE II</a>',
  attributionUrl: "https://opengeo.ncep.noaa.gov/geoserver/web/",
  host: "opengeo.ncep.noaa.gov",
  owsUrl: "https://opengeo.ncep.noaa.gov/geoserver/conus/ows",
  layer: "conus_bref_qcd",
  coverage: [{ west: -130, south: 20, east: -60, north: 55 }],
  budgetLimit: 600,
  budgetWindowMs: 60_000,
  maxZoom: 12,
  maxFrames: 60,
});
