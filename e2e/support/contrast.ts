/**
 * Reading a contrast ratio off what the browser actually painted.
 *
 * Shared because the two things worth checking this way live in different
 * specs: the chrome's own surfaces are scanned beside the axe run, and the
 * map popup is a fixed light card that only opens where its fixture is.
 */

/** WCAG relative luminance of an `rgb(...)` string. */
export function luminance(colour: string): number {
  const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [];
  const [red, green, blue] = parts;
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

export function contrast(one: string, two: string): number {
  const light = Math.max(luminance(one), luminance(two));
  const dark = Math.min(luminance(one), luminance(two));
  return (light + 0.05) / (dark + 0.05);
}
