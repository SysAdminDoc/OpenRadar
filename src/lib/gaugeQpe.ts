/**
 * How far back the gauge-corrected accumulation reaches.
 *
 * One switch with a period beside it rather than three switches. They are the
 * same measurement over three windows, only one can be drawn at once, and the
 * grid cache is told as much: three slots held for grids that can never be
 * resident together is a hundred and fifty megabytes of ceiling nothing can
 * ever use.
 *
 * On its own, and importing nothing, because both the settings and the MRMS
 * provider need it and the provider already imports the settings.
 */

export const GAUGE_QPE_PERIODS = ["1h", "24h", "72h"] as const;

export type GaugeQpePeriod = (typeof GAUGE_QPE_PERIODS)[number];

export function isGaugeQpePeriod(value: unknown): value is GaugeQpePeriod {
  return GAUGE_QPE_PERIODS.includes(value as GaugeQpePeriod);
}
