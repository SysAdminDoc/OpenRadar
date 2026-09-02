import type { CSSProperties } from "react";

/**
 * How much of a slider's track sits behind its handle.
 *
 * A browser draws the part of a slider you have already dragged past in the
 * accent colour, and it stops the moment the handle is styled: giving the
 * handle a size a pointer can hit cost every slider in the app its filled
 * track, so all twelve of them became a uniform grey line with a dot on it.
 * Chromium has no pseudo-element for the filled part, so the share has to
 * reach the stylesheet as a number and be painted as a gradient.
 *
 * Returned as a style object rather than set from an effect because these are
 * controlled inputs: the value and the fill then change in the same render,
 * and a slider that mounts already part-way along is right on its first
 * frame.
 */
export function rangeFill(
  value: number,
  min: number,
  max: number,
): CSSProperties {
  const span = max - min;
  const along = span > 0 ? (value - min) / span : 0;
  const held = Math.min(1, Math.max(0, Number.isFinite(along) ? along : 0));
  return { "--range-fill": `${(held * 100).toFixed(2)}%` } as CSSProperties;
}
