/**
 * English, made longer and stranger, for finding labels that only fit in
 * English.
 *
 * Translations run longer than the original more often than not, and Spanish
 * runs about a fifth longer than English on average. A label sized to its
 * English text clips in every other language, and the only reliable way to
 * find those before someone else does is to render a language that is worse
 * than the real ones.
 *
 * The rules: every letter is replaced with an accented one so an untranslated
 * string stands out on sight, the text is padded by a bit over a third so
 * anything sized to fit exactly will not, and the whole thing is bracketed so
 * a truncated string is obvious from its missing end. What is not touched is
 * anything inside braces, because those are parameter names the code fills in.
 */
import { en, type Catalogue, type StringKey } from "./en";

const LETTERS: Record<string, string> = {
  a: "á",
  b: "ƀ",
  c: "ć",
  d: "đ",
  e: "é",
  f: "ƒ",
  g: "ğ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ł",
  m: "ɱ",
  n: "ñ",
  o: "ó",
  p: "ƥ",
  q: "ɋ",
  r: "ř",
  s: "š",
  t: "ŧ",
  u: "ú",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
  A: "Á",
  B: "Ɓ",
  C: "Ć",
  D: "Đ",
  E: "É",
  F: "Ƒ",
  G: "Ğ",
  H: "Ĥ",
  I: "Í",
  J: "Ĵ",
  K: "Ķ",
  L: "Ł",
  M: "Ṁ",
  N: "Ñ",
  O: "Ó",
  P: "Ƥ",
  Q: "Ɋ",
  R: "Ř",
  S: "Š",
  T: "Ŧ",
  U: "Ú",
  V: "Ṽ",
  W: "Ŵ",
  X: "Ẋ",
  Y: "Ý",
  Z: "Ž",
};

/** How much longer the generated text runs than the original. */
export const PSEUDO_PADDING = 0.35;

export function pseudoize(value: string): string {
  const parts = value.split(/(\{\w+\})/);
  const accented = parts
    .map((part) =>
      part.startsWith("{") && part.endsWith("}")
        ? part
        : [...part]
            .map((character) => LETTERS[character] ?? character)
            .join(""),
    )
    .join("");

  // Padded with a run of the same character rather than repeated words, so the
  // length is what is being tested and not the reader's patience.
  const extra = Math.ceil(value.length * PSEUDO_PADDING);
  return `⟦${accented}${extra > 0 ? ` ${"·".repeat(extra)}` : ""}⟧`;
}

export const pseudo: Catalogue = Object.fromEntries(
  Object.entries(en).map(([key, value]) => [key, pseudoize(value)]),
) as Record<StringKey, string>;
