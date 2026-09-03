import type { LayerSettings } from "./settings";
import type { Provenance, ProvenanceKind } from "./provenance";

/**
 * Where each switchable layer comes from, and what kind of statement it makes.
 *
 * The provenance contract arrived with producers for radar frames and for the
 * seven overlay adapters, which is seven of the twenty-three switches a reader
 * can actually throw. Everything else, including every MRMS product and both
 * lightning layers, had nothing to say about itself.
 *
 * This is the missing half, and it is a table rather than a function per layer
 * because the interesting property is that it is complete. `layerProvenance`
 * in the tests holds it to the switch list itself, so a layer added later
 * cannot quietly arrive without a source, a credit, or an answer to whether it
 * is something measured or something a model expects.
 */
export interface LayerSource {
  sourceId: string;
  label: string;
  attribution: string;
  attributionUrl?: string;
  kind: ProvenanceKind;
  /**
   * How long the layer stays fresh, in milliseconds, or null where the source
   * publishes when something happens rather than on a cadence.
   */
  freshForMs: number | null;
  /** What was done to the source readings, for the derived ones. */
  derivedFrom?: string;
}

const NWS = "NOAA National Weather Service";
const ECCC = "Environment and Climate Change Canada";
const MRMS = "NOAA MRMS";
/** MRMS grids are published every two minutes. */
const MRMS_REFRESH = 120_000;

export const LAYER_SOURCES: Record<keyof LayerSettings, LayerSource> = {
  weatherAlerts: {
    sourceId: "alerts",
    label: "Watches and warnings",
    // Two offices on one layer. A Canadian warning is drawn beside an
    // American one and treated the same way by the watch and the filters, so
    // the credit has to name both: the reader is looking at one switch, and
    // whose warning it is depends on where they are looking.
    attribution: `${NWS} and ${ECCC}`,
    attributionUrl: "https://www.weather.gov/",
    kind: "observation",
    freshForMs: 60_000,
  },
  spcOutlooks: {
    sourceId: "spcOutlooks",
    label: "SPC convective outlooks",
    attribution: "NOAA Storm Prediction Center",
    kind: "forecast",
    freshForMs: 900_000,
  },
  spcDiscussions: {
    sourceId: "spcDiscussions",
    label: "SPC mesoscale discussions",
    attribution: "NOAA Storm Prediction Center",
    kind: "forecast",
    freshForMs: 300_000,
  },
  stormReports: {
    sourceId: "stormReports",
    label: "Local storm reports",
    attribution: "NOAA, via Iowa State Mesonet",
    kind: "observation",
    freshForMs: 300_000,
  },
  classification: {
    sourceId: "classification",
    label: "Hydrometeor classification",
    attribution: `${NWS} Level III`,
    // The radar's own algorithm reading its own volume and naming what it
    // thinks is falling. That is not an observation of the ground.
    kind: "derived",
    derivedFrom:
      "the site's own dual-polarisation classification, from Level III",
    freshForMs: 300_000,
  },
  stormCells: {
    sourceId: "stormCells",
    label: "Storm cell tracking",
    attribution: `${NWS} Level III`,
    // The radar's own algorithm reading its own volume, which is not the
    // volume and is not a forecast either.
    kind: "derived",
    derivedFrom: "the site's own storm tracking algorithm, from Level III",
    freshForMs: 300_000,
  },
  probSevere: {
    sourceId: "probSevere",
    label: "NSSL ProbSevere",
    attribution: "NOAA National Severe Storms Laboratory",
    kind: "forecast",
    freshForMs: 120_000,
  },
  earthquakes: {
    sourceId: "earthquakes",
    label: "Earthquakes",
    attribution: "United States Geological Survey",
    kind: "observation",
    freshForMs: 300_000,
  },
  wildfires: {
    sourceId: "wildfires",
    label: "Wildfire perimeters",
    attribution: "National Interagency Fire Center",
    kind: "observation",
    freshForMs: 900_000,
  },
  metar: {
    sourceId: "metar",
    label: "Surface observations",
    attribution: "NOAA Aviation Weather Center",
    kind: "observation",
    freshForMs: 90 * 60_000,
  },
  riverGauges: {
    sourceId: "riverGauges",
    label: "River gauges",
    attribution: "NOAA National Water Prediction Service",
    // The dot carries both a reading and a forecast, and the reading is what
    // places it. What the office expects is in the panel, said as a forecast.
    kind: "observation",
    freshForMs: 20 * 60_000,
  },
  smoke: {
    sourceId: "smoke",
    label: "Smoke analysis",
    attribution: "NOAA Hazard Mapping System",
    // An analyst drew it off satellite imagery. That is a reading of an
    // observation rather than an observation, and it is one a day.
    kind: "derived",
    derivedFrom: "an analyst reading satellite imagery, once a day",
    freshForMs: 24 * 3_600_000,
  },
  forecastSmoke: {
    sourceId: "forecastSmoke",
    label: "HRRR forecast smoke",
    attribution: "NOAA High-Resolution Rapid Refresh",
    // A model's expectation of the hours ahead. A cycle every hour, and the
    // field for an hour is only worth having until the next cycle has it.
    kind: "forecast",
    freshForMs: 3_600_000,
  },
  tropical: {
    sourceId: "tropical",
    label: "Tropical cyclones",
    attribution: "NOAA National Hurricane Center",
    kind: "forecast",
    freshForMs: 900_000,
  },
  satellite: {
    sourceId: "satellite",
    // Whichever of the two views is drawn. The record names the service and
    // the instrument rather than the product, because the product is a
    // setting and this table is not read per render.
    label: "GOES-East ABI",
    attribution: "NASA GIBS and NOAA NESDIS",
    kind: "observation",
    freshForMs: 600_000,
  },
  customOverlay: {
    sourceId: "customOverlay",
    label: "Imported shapes",
    // The reader's own file. Crediting anybody else for it would be wrong,
    // and it has no cadence because nothing refetches a local file.
    attribution: "Imported from this machine",
    kind: "observation",
    freshForMs: null,
  },
  rotationTracks: {
    sourceId: "rotation",
    label: "Rotation tracks",
    attribution: MRMS,
    kind: "derived",
    derivedFrom: "azimuthal shear accumulated over the past hour",
    freshForMs: MRMS_REFRESH,
  },
  hail: {
    sourceId: "mesh",
    label: "Maximum estimated hail size",
    attribution: MRMS,
    kind: "derived",
    derivedFrom: "hail size estimated from the reflectivity column",
    freshForMs: MRMS_REFRESH,
  },
  hailSwath: {
    sourceId: "hail-swath",
    label: "Hail swath",
    attribution: MRMS,
    kind: "derived",
    derivedFrom: "estimated hail size accumulated along the storm's path",
    freshForMs: MRMS_REFRESH,
  },
  echoTops: {
    sourceId: "echo-tops",
    label: "Echo tops",
    attribution: MRMS,
    kind: "observation",
    freshForMs: MRMS_REFRESH,
  },
  vil: {
    sourceId: "vil",
    label: "Liquid held aloft",
    attribution: MRMS,
    kind: "derived",
    derivedFrom: "liquid water integrated through the column",
    freshForMs: MRMS_REFRESH,
  },
  precipRate: {
    sourceId: "precip-rate",
    label: "Precipitation rate",
    attribution: MRMS,
    kind: "derived",
    derivedFrom: "rain rate estimated from reflectivity",
    freshForMs: MRMS_REFRESH,
  },
  qpeHour: {
    sourceId: "qpe-hour",
    label: "Rain in the past hour",
    attribution: MRMS,
    kind: "derived",
    derivedFrom: "estimated rain accumulated over one hour",
    freshForMs: MRMS_REFRESH,
  },
  qpeDay: {
    sourceId: "qpe-day",
    label: "Rain in the past day",
    attribution: MRMS,
    kind: "derived",
    derivedFrom: "estimated rain accumulated over twenty-four hours",
    freshForMs: MRMS_REFRESH,
  },
  gaugeQpe: {
    sourceId: "gauge-qpe",
    label: "Rain, gauge corrected",
    attribution: MRMS,
    // Still derived. Correcting a radar estimate against the gauges that did
    // measure the rain makes it a better estimate, not a measurement: the
    // number over any given square is what the correction implies there, and
    // no gauge stood in most of them.
    kind: "derived",
    derivedFrom:
      "estimated rain corrected against reporting gauges, accumulated over the chosen window",
    freshForMs: MRMS_REFRESH,
  },
  ffgHour: {
    sourceId: "ffg-hour",
    label: "Rain against flash flood guidance, past hour",
    attribution: MRMS,
    // Derived, not observed, and the distinction is the whole point of this
    // table. One half is rain estimated from reflectivity; the other is a
    // depth a forecaster set for how much the ground there can take. Neither
    // was measured, and their ratio least of all.
    kind: "derived",
    derivedFrom:
      "estimated hourly rain against the office's flash flood guidance",
    freshForMs: MRMS_REFRESH,
  },
  ffgThreeHour: {
    sourceId: "ffg-three-hour",
    label: "Rain against flash flood guidance, past three hours",
    attribution: MRMS,
    kind: "derived",
    derivedFrom:
      "estimated three-hour rain against the office's flash flood guidance",
    freshForMs: MRMS_REFRESH,
  },
  unitStreamflow: {
    sourceId: "unit-streamflow",
    label: "Modelled runoff",
    attribution: MRMS,
    // A model of the ground rather than a reading of the sky.
    kind: "derived",
    derivedFrom:
      "estimated rain run through the FLASH hydrological model as runoff per square kilometre",
    freshForMs: MRMS_REFRESH,
  },
  precipType: {
    sourceId: "precip-type",
    label: "Precipitation type",
    attribution: MRMS,
    // What the network's algorithm decided is falling, from the radar and the
    // model's own temperature profile together. Not somebody looking out of a
    // window, and the panel says so.
    kind: "derived",
    derivedFrom:
      "radar and model temperature, classified by the MRMS PrecipFlag algorithm",
    freshForMs: MRMS_REFRESH,
  },
  lightningDensity: {
    sourceId: "lightning",
    label: "Cloud-to-ground flash density",
    attribution: MRMS,
    kind: "observation",
    freshForMs: MRMS_REFRESH,
  },
  lightningFlashes: {
    sourceId: "lightningFlashes",
    label: "GOES total lightning",
    attribution: "NOAA GOES-19 Geostationary Lightning Mapper",
    kind: "observation",
    freshForMs: 300_000,
  },
  wind: {
    sourceId: "wind",
    label: "GFS wind",
    attribution: "NOAA Global Forecast System",
    kind: "forecast",
    // A run every six hours, and the layer is left alone until the next one.
    freshForMs: 6 * 3_600_000,
  },
  surge: {
    sourceId: "surge",
    label: "Storm surge risk",
    attribution: "NOAA National Hurricane Center",
    kind: "forecast",
    freshForMs: null,
  },
};

/**
 * One layer's record, from its source and whatever the app knows about when.
 *
 * A forecast needs a run behind it, and the layers here that are forecasts do
 * not all publish one the app reads. Where a run is not known the caller says
 * so and the record is made as an observation of when the statement was
 * fetched, which is true and says less, rather than inventing an
 * initialisation time that would read as though a model had been consulted.
 */
export function layerProvenance(options: {
  layer: keyof LayerSettings;
  fetchedAt: number;
  /** When the readings were taken, where the layer knows. */
  observedAt?: number | null;
  /** When the statement applies, where that differs from the observation. */
  validAt?: number | null;
  modelRun?: { initUtc: string; leadMinutes: number };
  cachedAgeSeconds?: number | null;
}): Provenance {
  const source = LAYER_SOURCES[options.layer];
  const { fetchedAt } = options;
  const observed = options.observedAt ?? fetchedAt;
  // A forecast stays a forecast whether or not the run behind it is known.
  //
  // Downgrading it to an observation when no run was passed was the wrong
  // trade: it bought a valid record at the cost of a true one, and an SPC
  // outlook reported as something observed at the moment it was fetched is
  // exactly the confusion this contract exists to refuse. Where the run is not
  // known the record says that instead.
  const forecast = source.kind === "forecast";
  return {
    sourceId: source.sourceId,
    label: source.label,
    attribution: source.attribution,
    attributionUrl: source.attributionUrl,
    kind: source.kind,
    observedAt: forecast ? null : observed,
    validAt: options.validAt ?? observed,
    fetchedAt,
    freshForMs: source.freshForMs,
    cachedAgeSeconds: options.cachedAgeSeconds ?? null,
    modelRun: options.modelRun,
    runUnknown: forecast && !options.modelRun ? true : undefined,
    derivedFrom: source.derivedFrom,
  };
}
