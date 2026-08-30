import { createWmsProvider } from "./wms";

/**
 * NWS RIDGE II base reflectivity mosaic. Keyless, roughly two-minute cadence,
 * and published with no access constraints, which is why it leads the chain.
 */
export const ridgeProvider = createWmsProvider({
  id: "ridge",
  label: "NWS RIDGE II",
  attribution:
    '<a href="https://opengeo.ncep.noaa.gov/geoserver/web/">NOAA NWS RIDGE II</a>',
  attributionUrl: "https://opengeo.ncep.noaa.gov/geoserver/web/",
  host: "opengeo.ncep.noaa.gov",
  owsUrl: "https://opengeo.ncep.noaa.gov/geoserver/conus/ows",
  layer: "conus_bref_qcd",
  // The mosaic itself is the CONUS land extent. A wider box would claim the
  // Gulf, Cuba, and the Bahamas, where it has nothing to draw.
  coverage: [{ west: -125, south: 24.4, east: -66.9, north: 49.4 }],
  tileBudgetLimit: 3000,
  discoveryBudgetLimit: 30,
  budgetWindowMs: 60_000,
  maxZoom: 12,
  maxFrames: 60,
});
