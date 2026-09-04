import { serviceAnswer } from "./serviceAnswer";
/**
 * The arguments a native failure carries, ready to fill a sentence with.
 *
 * The Rust side sends its arguments as strings, because most of them are: a
 * call sign, a product name, a path, whatever a service said. Two of them
 * are counts, and a count that lands in a sentence is read by a person, so it
 * has to be written the way that person writes numbers rather than the way
 * `usize::to_string` writes them. A French reader was being told the export
 * would be "4300000 mesures".
 *
 * Which failures carry a count is written down rather than guessed at from
 * the shape of the string. A layout version and a station whose name happens
 * to be digits are both machine values that must come through untouched, and
 * these two are every native variant that carries a count: `TooLarge` in
 * `data_export.rs` and `TooManyTiles` in `bundles.rs`.
 */
const COUNTED = new Set(["tooLarge", "tooManyTiles"]);

/**
 * The failures whose one argument is an HTTP status.
 *
 * A number out of a protocol tells a reader nothing about whether to wait or
 * to give up, which is what `serviceAnswer` exists to say, and every page-side
 * fetch already goes through it. The native side had no way to: it was
 * sending the whole of `reqwest`'s own message instead, address and all, so a
 * bucket key that 404s reached the panel as an S3 URL and a status code in
 * English. Now it sends the status and this says it in words.
 */
const STATUS = new Set(["httpStatus"]);

export function nativeErrorParams(
  code: string,
  args: readonly unknown[],
): Record<string, string | number> {
  const counted = COUNTED.has(code);
  const spoken = STATUS.has(code);
  const params: Record<string, string | number> = {};
  args.forEach((value, at) => {
    params[String(at)] = counted
      ? measured(value)
      : spoken && at === 0
        ? serviceAnswer(Number(value))
        : String(value);
  });
  return params;
}

/**
 * A counted argument as a number, so the sentence can choose its own words.
 *
 * Handed over raw rather than formatted. These two sentences count things, and
 * a plural block cannot read "4,300,000" as a number: it would fall to the
 * plural arm and print no number at all. The block writes the number itself,
 * in the reader's own notation, which is what the formatting here was for.
 * Anything that is not a number still comes through as it was.
 */
function measured(value: unknown): string | number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && String(value).trim() !== ""
    ? number
    : String(value);
}
