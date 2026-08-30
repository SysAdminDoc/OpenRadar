import { createWmsProvider } from "./wms";

/**
 * NOAA nowCOAST national mosaic. Slower than RIDGE II at roughly four minutes,
 * but it covers Alaska, Hawaii, the Caribbean, and Guam as well as CONUS, so it
 * is both the failover and the source for the offshore regions.
 */
export const nowcoastProvider = createWmsProvider({
  id: "nowcoast",
  label: "NOAA nowCOAST",
  detail: "National base reflectivity mosaic",
  attribution: '<a href="https://nowcoast.noaa.gov/">NOAA nowCOAST</a>',
  attributionUrl: "https://nowcoast.noaa.gov/",
  host: "nowcoast.noaa.gov",
  owsUrl: "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows",
  layer: "base_reflectivity_mosaic",
  coverage: [
    { west: -130, south: 20, east: -60, north: 55 },
    { west: -180, south: 50, east: -125, north: 72 },
    { west: -165, south: 15, east: -150, north: 25 },
    { west: -70, south: 15, east: -60, north: 22 },
    { west: 140, south: 10, east: 150, north: 20 },
  ],
  tileBudgetLimit: 2400,
  discoveryBudgetLimit: 30,
  budgetWindowMs: 60_000,
  maxZoom: 11,
  maxFrames: 40,
});
