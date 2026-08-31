import { createWmsProvider } from "./wms";

export const DWD_HOST = "maps.dwd.de";

/**
 * The German radar composite, from the DWD's own GeoServer.
 *
 * Europe had nothing. The NOAA mosaics stop at the American coast, GeoMet is
 * Canada, and everything past them fell through to a personal-use tier. The
 * DWD publishes a one kilometre composite of its seventeen radars every five
 * minutes, keyless, with a WMS view service, and keeps four days of it.
 *
 * The service is offered with no availability guarantee, which is why it sits
 * in the chain rather than replacing anything: if it does not answer, what was
 * there before is still there.
 */
export const dwdProvider = createWmsProvider({
  id: "dwd",
  label: "DWD Radarkomposit",
  attribution:
    '<a href="https://www.dwd.de/EN/service/copyright/copyright_node.html">Deutscher Wetterdienst</a>',
  attributionUrl:
    "https://www.dwd.de/EN/service/copyright/copyright_node.html",
  host: DWD_HOST,
  owsUrl: "https://maps.dwd.de/geoserver/dwd/ows",
  // The observation composite. There is a second layer carrying the same thing
  // with two hours of extrapolation on the end of it, which is a forecast and
  // does not belong on a timeline of what happened.
  layer: "Radar_wn-analysis_1x1km_ger",
  // Germany and the ground its radars see over the borders. Drawn tight,
  // because past the composite's own edge the layer answers with nothing at
  // all and the chain would stop at a provider with no picture.
  coverage: [{ west: 3.5, south: 45.5, east: 17.5, north: 56.0 }],
  tileBudgetLimit: 2000,
  discoveryBudgetLimit: 20,
  budgetWindowMs: 60_000,
  maxZoom: 11,
  // Two hours at five minutes. The service keeps four days, which is more
  // loop than anybody watches and a great many tiles.
  maxFrames: 24,
});

/**
 * The scale the DWD paints its composite with, read off the colour map the
 * service publishes at
 * `maps.dwd.de/geoserver/dwd/ows?request=GetLegendGraphic&layer=Radar_wn-analysis_1x1km_ger&format=application/json`.
 *
 * Sampled rather than invented, so the bar beside the map is the bar the map
 * was painted with. It is not the American ramp and should not be made to look
 * like one: past fifty decibels it turns blue and then magenta, which is the
 * German convention for hail, and a reader who has seen a German radar picture
 * before will be looking for exactly that.
 *
 * Resample it if the DWD restyles the layer.
 */
export const DWD_REFLECTIVITY_RAMP: Array<[number, string]> = [
  [7, "#99ffff"],
  [9.5, "#33ffff"],
  [12, "#00caca"],
  [14.5, "#009934"],
  [19, "#4dbf1a"],
  [23.5, "#99cc00"],
  [28, "#cce600"],
  [32.5, "#ffff00"],
  [37, "#ffc400"],
  [41.5, "#ff8900"],
  [46, "#ff0000"],
  [50.5, "#b40000"],
  [55, "#4848ff"],
  [60, "#0000ca"],
  [65, "#990099"],
  [75, "#ff33ff"],
];

/** Labelled where the eye needs it rather than at every one of sixteen steps. */
export const DWD_REFLECTIVITY_STOPS = [10, 25, 40, 55, 70];
