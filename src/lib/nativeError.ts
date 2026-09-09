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
const STATUS = new Set(["httpStatus", "gridHttpStatus"]);

/**
 * What each failure's arguments are called in the sentence that uses them.
 *
 * Named rather than numbered, which is what the catalogue's own header asks
 * for: `{0}` in a translation says nothing about what will land there, and a
 * translator moving a clause has to count the placeholders in the original to
 * find out. `{station}` and `{product}` need no counting, and a language whose
 * word order puts them the other way round can just do it.
 *
 * A code with no entry here falls back to the number, which is what a string
 * written for it would have to use. The catalogue gate refuses those, so the
 * fallback only ever runs for a failure whose sentence has no argument in it.
 */
const ARGUMENTS: Record<string, readonly string[]> = {
  unknownSite: ["station"],
  notWsr88d: ["station"],
  noVolume: ["station"],
  noLongerListed: ["station"],
  noStormMotion: ["station"],
  outOfRange: ["station"],
  noSweep: ["station", "product"],
  noProduct: ["product"],
  gridUnknownProduct: ["product"],
  gridNoFrames: ["product"],
  decode: ["reason"],
  encode: ["reason"],
  localRead: ["reason"],
  write: ["reason"],
  read: ["reason"],
  corrupt: ["reason"],
  invalidRequest: ["reason"],
  gridUnreadable: ["reason"],
  gridNotDrawn: ["reason"],
  invalidTime: ["at"],
  httpStatus: ["answer"],
  gridHttpStatus: ["answer"],
  tooLarge: ["count"],
  tooManyTiles: ["count"],
  tooManyDocuments: ["count"],
  newer: ["version"],
};

export function nativeErrorParams(
  code: string,
  args: readonly unknown[],
): Record<string, string | number> {
  const counted = COUNTED.has(code);
  const spoken = STATUS.has(code);
  const names = ARGUMENTS[code];
  const params: Record<string, string | number> = {};
  args.forEach((value, at) => {
    params[names?.[at] ?? String(at)] = counted
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

/**
 * What a native failure said for itself, for the log rather than the page.
 *
 * The page gets a sentence somebody wrote, keyed on the failure's code. That
 * is right for a reader and it throws away the part that identifies the
 * problem: which GRIB2 template would not unpack, what the decoder choked on.
 * Both errors that share `gridUnreadable` are indistinguishable in the toast
 * by design, and were indistinguishable in the log too, which is where
 * somebody debugging one of them has to look.
 */
export function nativeErrorDetail(failure: unknown): string {
  if (!failure || typeof failure !== "object") return "";
  const named = failure as { code?: unknown; args?: unknown; text?: unknown };
  const parts: string[] = [];
  if (typeof named.code === "string") parts.push(named.code);
  if (Array.isArray(named.args) && named.args.length) {
    parts.push(named.args.map((arg) => String(arg)).join(", "));
  } else if (typeof named.text === "string" && named.text) {
    parts.push(named.text);
  }
  return parts.join(": ");
}
