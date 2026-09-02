import { formatMeasure } from "../i18n";

/**
 * The arguments a native failure carries, ready to fill a sentence with.
 *
 * The Rust side sends its arguments as strings, because most of them are: a
 * call sign, a product name, a path, whatever a service said. Three of them
 * are counts, and a count that lands in a sentence is read by a person, so it
 * has to be written the way that person writes numbers rather than the way
 * `usize::to_string` writes them. A French reader was being told the export
 * would be "4300000 mesures".
 *
 * Which failures carry a count is written down rather than guessed at from
 * the shape of the string. A layout version and a station whose name happens
 * to be digits are both machine values that must come through untouched.
 */
const COUNTED = new Set(["tooLarge", "tooManyTiles", "tooManyFeatures"]);

export function nativeErrorParams(
  code: string,
  args: readonly unknown[],
): Record<string, string> {
  const counted = COUNTED.has(code);
  const params: Record<string, string> = {};
  args.forEach((value, at) => {
    params[String(at)] = counted ? measured(value) : String(value);
  });
  return params;
}

function measured(value: unknown): string {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && String(value).trim() !== ""
    ? formatMeasure(number)
    : String(value);
}
