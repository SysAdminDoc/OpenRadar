import { formatNumber, translate, type StringKey } from "../i18n";
import {
  domainFor,
  mrmsAvailable,
  mrmsPeakNear,
  type MrmsProductId,
} from "./providers/mrms";

/**
 * The four-panel flash flood method, as a rule rather than as four pictures.
 *
 * The Weather Service's Central Region reads four grids side by side, each
 * with its own bars for an advisory and three levels of warning, and calls a
 * level when three of the four show it (Lincoln and Marquardt 2023, Technical
 * Attachment 23-03, section 2.2). The app draws all four; what a reader in a
 * flood cannot do in their head is hold sixteen numbers against four
 * readings and count.
 *
 * A guide and not a warning. The paper's own words are that the technique is
 * "just part of the warning decision process", beside the footprint of the
 * rain, its trend, the biases in the estimate and the reports coming in, and
 * every place this is shown says so.
 */

/** The four panels, in the order the paper lists them. */
export const FLOOD_PANELS = ["qpe", "ari", "ratio", "streamflow"] as const;
export type FloodPanel = (typeof FLOOD_PANELS)[number];

/** The levels a panel can reach, least to worst. */
export const FLOOD_TIERS = [
  "advisory",
  "warning",
  "considerable",
  "catastrophic",
] as const;
export type FloodTier = (typeof FLOOD_TIERS)[number];

/**
 * The bars, one per level, in the units the paper writes them in: inches of
 * rain in an hour, years between falls this heavy, per cent of guidance, and
 * cubic feet a second per square mile.
 */
export type FloodThresholds = Record<
  FloodPanel,
  [number, number, number, number]
>;

/**
 * Table 2 of the attachment, calibrated on the Chicago and Milwaukee service
 * areas over 2016 to 2022. The paper says they can be changed to match a
 * regional study, which is why the reader can.
 */
export const DEFAULT_FLOOD_THRESHOLDS: FloodThresholds = {
  qpe: [1.5, 2.0, 2.5, 2.7],
  ari: [1, 5, 125, 175],
  ratio: [125, 140, 325, 375],
  streamflow: [200, 230, 850, 1100],
};

/** What each panel read, in the grids' own units; null where it read nothing. */
export interface FloodReading {
  /** Rain in the past hour, radar only, in millimetres. */
  qpeMm: number | null;
  /** The worst window's return period, in years. */
  ariYears: number | null;
  /** The worst window's rain against guidance, in per cent. */
  ratioPercent: number | null;
  /** Modelled runoff, in cubic metres a second per square kilometre. */
  streamflowCms: number | null;
}

/**
 * Cubic feet a second per square mile, from cubic metres a second per square
 * kilometre. The grid is metric and the paper's bars are not: 35.3147 cubic
 * feet to the cubic metre over 0.386102 square miles to the square kilometre.
 */
export const CFS_PER_SQ_MI_PER_CMS_PER_SQ_KM = 35.3147 / 0.386102;

/** Each reading in the unit its bars are written in. */
export function inPaperUnits(
  reading: FloodReading,
): Record<FloodPanel, number | null> {
  return {
    qpe: reading.qpeMm === null ? null : reading.qpeMm / 25.4,
    ari: reading.ariYears,
    ratio: reading.ratioPercent,
    streamflow:
      reading.streamflowCms === null
        ? null
        : reading.streamflowCms * CFS_PER_SQ_MI_PER_CMS_PER_SQ_KM,
  };
}

/**
 * How far up its bars one reading reaches: 0 below the advisory bar, 1 to 4
 * for advisory to catastrophic, and null where the panel read nothing.
 */
export function panelLevel(
  value: number | null,
  bars: readonly number[],
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  let level = 0;
  bars.forEach((bar, at) => {
    if (value >= bar) level = at + 1;
  });
  return level;
}

/** What the four panels say, one by one and together. */
export interface FloodCall {
  levels: Record<FloodPanel, number | null>;
  /** The level three panels agree on, or null where no three do. */
  tier: FloodTier | null;
}

/**
 * The level three of the four panels show.
 *
 * "Show the same level" is read as reaching it: a panel at catastrophic is
 * also past the considerable bar, and a reading of catastrophic, catastrophic,
 * considerable and nothing is three panels at considerable. The call is the
 * highest level three of them reach. A panel that read nothing counts for
 * nothing, so with one missing the other three all have to agree.
 */
export function floodCall(
  reading: FloodReading,
  thresholds: FloodThresholds = DEFAULT_FLOOD_THRESHOLDS,
): FloodCall {
  const values = inPaperUnits(reading);
  const levels = {} as Record<FloodPanel, number | null>;
  for (const panel of FLOOD_PANELS) {
    levels[panel] = panelLevel(values[panel], thresholds[panel]);
  }
  let tier: FloodTier | null = null;
  FLOOD_TIERS.forEach((named, at) => {
    const reached = FLOOD_PANELS.filter(
      (panel) => (levels[panel] ?? 0) >= at + 1,
    ).length;
    if (reached >= 3) tier = named;
  });
  return { levels, tier };
}

/** The grid behind each panel. */
const PANEL_PRODUCTS: Record<FloodPanel, MrmsProductId> = {
  qpe: "qpe-hour",
  ari: "ari-max",
  ratio: "ffg-max",
  streamflow: "unit-streamflow",
};

/**
 * How far round a place the peak is read, in miles.
 *
 * The paper took each case's peak "within several miles" of the report,
 * averaged over four pixels. A reader's place is a point with a town round
 * it, and a storm's worst cell a few miles off is the one that floods the
 * creek through it.
 */
export const FLOOD_READ_MILES = 3;

/**
 * The four panels at a place, from the newest grid of each.
 *
 * Null where the app cannot read them at all: a browser preview has no grids,
 * and the FLASH products are made for the lower forty-eight only.
 */
export async function floodReadingAt(
  lon: number,
  lat: number,
): Promise<FloodReading | null> {
  if (!mrmsAvailable()) return null;
  const domain = domainFor([lon, lat]);
  if (domain?.id !== "CONUS") return null;
  const read = async (panel: FloodPanel) => {
    try {
      const peak = await mrmsPeakNear(
        PANEL_PRODUCTS[panel],
        lat,
        lon,
        FLOOD_READ_MILES,
        domain.id,
      );
      return peak ? peak.value : null;
    } catch {
      // One grid that would not answer leaves that panel empty rather than
      // taking the other three with it.
      return null;
    }
  };
  const [qpeMm, ariYears, ratioPercent, streamflowCms] = await Promise.all(
    FLOOD_PANELS.map(read),
  );
  return { qpeMm, ariYears, ratioPercent, streamflowCms };
}

/**
 * A reader's bars as the settings file holds them, or the paper's where they
 * are not usable.
 *
 * Each panel's four are taken or refused together, because a panel's bars
 * are only a scale while they climb: a considerable bar below the warning
 * bar would call a level the rain had not reached. A panel with anything
 * wrong keeps the paper's four rather than a mix.
 */
export function normalizeFloodThresholds(raw: unknown): FloodThresholds {
  const held = (raw ?? {}) as Partial<Record<FloodPanel, unknown>>;
  const out = {} as FloodThresholds;
  for (const panel of FLOOD_PANELS) {
    const bars = held[panel];
    const usable =
      Array.isArray(bars) &&
      bars.length === 4 &&
      bars.every((bar) => typeof bar === "number" && Number.isFinite(bar)) &&
      bars[0] > 0 &&
      bars.every((bar, at) => at === 0 || bar >= bars[at - 1]);
    out[panel] = usable
      ? ([...bars] as FloodThresholds[FloodPanel])
      : ([...DEFAULT_FLOOD_THRESHOLDS[panel]] as FloodThresholds[FloodPanel]);
  }
  return out;
}

/** Each tier's name, as the settings table heads its column. */
export const TIER_KEYS: Record<FloodTier, StringKey> = {
  advisory: "flood.tierAdvisory",
  warning: "flood.tierWarning",
  considerable: "flood.tierConsiderable",
  catastrophic: "flood.tierCatastrophic",
};

/** Each tier as the sentence that calls it. */
const CALL_KEYS: Record<FloodTier, StringKey> = {
  advisory: "flood.callAdvisory",
  warning: "flood.callWarning",
  considerable: "flood.callConsiderable",
  catastrophic: "flood.callCatastrophic",
};

/**
 * The four readings and the call, as the two lines a readout shows.
 *
 * In the paper's units, like the bars in Settings, because the point of the
 * line is to be held against them.
 */
export function floodWords(
  reading: FloodReading,
  thresholds: FloodThresholds = DEFAULT_FLOOD_THRESHOLDS,
): { panels: string; call: string } {
  const paper = inPaperUnits(reading);
  const missing = (panel: StringKey) =>
    translate("flood.panelMissing", { panel: translate(panel) });
  const panels = [
    paper.qpe === null
      ? missing("flood.panelQpe")
      : translate("flood.qpeValue", { inches: formatNumber(paper.qpe, 2) }),
    paper.ari === null
      ? missing("flood.panelAri")
      : translate("flood.ariValue", { years: Math.round(paper.ari) }),
    paper.ratio === null
      ? missing("flood.panelRatio")
      : translate("flood.ratioValue", {
          percent: formatNumber(paper.ratio, 0),
        }),
    paper.streamflow === null
      ? missing("flood.panelStreamflow")
      : translate("flood.streamflowValue", {
          runoff: formatNumber(paper.streamflow, 0),
        }),
  ].join(" · ");
  const { tier } = floodCall(reading, thresholds);
  return {
    panels,
    call: tier ? translate(CALL_KEYS[tier]) : translate("flood.noCall"),
  };
}

/**
 * An inspect readout with the four panels at its point after it.
 *
 * Written on demand like the readout it follows, so a language changed while
 * it is on screen reaches it too. The readout alone where there is nothing to
 * add: a point outside the grids, or a reading not yet in.
 */
export function withFloodReadout(
  render: (() => string) | null,
  reading: FloodReading | null,
  thresholds: FloodThresholds,
): (() => string) | null {
  if (!render || !reading) return render;
  return () => {
    const said = floodWords(reading, thresholds);
    return [
      render(),
      translate("flood.inspect", { panels: said.panels, call: said.call }),
    ].join(" · ");
  };
}
