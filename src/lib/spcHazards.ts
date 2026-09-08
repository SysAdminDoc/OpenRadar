/**
 * The hazards the Storm Prediction Center breaks its outlook down by.
 *
 * A leaf with no imports of its own, which is the whole point of it. These
 * four strings were declared beside the adapter that fetches the outlook, and
 * `settings.ts` reached across for them: settings imported the adapter, the
 * adapter imported the tile cache, and the tile cache imported settings, so
 * the three of them closed a cycle at runtime. It worked only because nothing
 * in that ring read a half-initialised module while it was still evaluating.
 *
 * The last time this shape appeared the symptom was a provider's coverage
 * list loading empty, which took Alaska, Hawaii, Guam and Puerto Rico off the
 * radar chain with nothing on screen to say why.
 */
export type SpcHazard = "categorical" | "tornado" | "hail" | "wind";

/** The hazards Day 1 and Day 2 break their probabilities down by. */
export const SPC_HAZARDS: SpcHazard[] = [
  "categorical",
  "tornado",
  "hail",
  "wind",
];
