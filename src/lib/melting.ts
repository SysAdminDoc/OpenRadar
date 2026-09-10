import { isDesktopRuntime } from "./runtime";

/**
 * Where the snow is turning to rain, read off the held radar's own high cut.
 *
 * The hail size in the readout is worked out against a freezing level, and
 * the one it uses today comes from a sounding that may be hours old and a
 * hundred miles away. The bright band is in the volume on screen: falling
 * snow picks up a skin of meltwater before it collapses into a raindrop, and
 * for those few hundred metres the radar sees a bright, wet, disagreeing
 * target that nothing else in the sky looks like.
 *
 * Decoded natively, so a browser preview has none of it.
 */

export interface MeltingLayer {
  /** The top of the band, in kilometres above the radar. */
  topKm: number;
  bottomKm: number;
  /** The height the most gates agreed on, which is the band's own middle. */
  peakKm: number;
  /** The cut it was read from, in degrees. */
  elevationDegrees: number;
  /** How many gates were in the band. */
  gates: number;
}

/** Why a volume has no melting layer to report. */
export type NoLayer = {
  reason: "noHighTilt" | "missingMoment" | "nothingMelting";
};

export function meltingAvailable(): boolean {
  return isDesktopRuntime();
}

/**
 * The layer, or the reason there is none.
 *
 * A result rather than a null, because "no cut goes high enough" and "nothing
 * in the cut is melting" are different things and the panel says which. A
 * volume in progress often has neither: the high cuts come last in a scan.
 */
export async function fetchMelting(
  station: string,
): Promise<MeltingLayer | NoLayer> {
  const { invoke } = await import("@tauri-apps/api/core");
  const answer = await invoke<{ Ok?: MeltingLayer; Err?: NoLayer }>(
    "level2_melting",
    { station },
  );
  // Rust's `Result` crosses as one key or the other. Read rather than
  // assumed: an answer with neither is a shape nobody promised, and reading
  // it as a layer would put a height of `undefined` on the panel.
  if (answer && typeof answer === "object" && "Ok" in answer && answer.Ok) {
    return answer.Ok;
  }
  if (answer && typeof answer === "object" && "Err" in answer && answer.Err) {
    return answer.Err;
  }
  return { reason: "nothingMelting" };
}

/** Whether an answer is a layer or a reason there is none. */
export function isLayer(
  answer: MeltingLayer | NoLayer | null,
): answer is MeltingLayer {
  return answer !== null && "peakKm" in answer;
}
