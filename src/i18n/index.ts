/**
 * The workspace in more than one language.
 *
 * Copy lives in `en.ts`, `es.ts` and `fr.ts` rather than in the components.
 * The translations are typed against `en.ts`, so a string added on one side
 * and not the others is a build error rather than an English sentence in a
 * Spanish or French window.
 *
 * The language is external mutable state with its own subscribers, which is
 * what `useSyncExternalStore` is for. A component that shows copy calls
 * `useT()` and re-renders when the language changes, so switching takes effect
 * where you are rather than on the next restart.
 *
 * Spanish and French are fetched when first wanted rather than shipped in the
 * first load. Each is as long again as the English, and a reader of one needs
 * no byte of the others. `ensureLanguage` is how a caller waits: both places
 * that restore a saved language do, so a French reader's first screen is
 * already French rather than English for a moment.
 */
import { useCallback, useSyncExternalStore } from "react";
import { en, type Catalogue, type StringKey } from "./en";
import { pseudo } from "./pseudo";

export type LanguageId = "en" | "es" | "fr" | "pseudo";

/** The languages that are fetched rather than shipped in the first load. */
type FetchedId = "es" | "fr";

export const LANGUAGES: Array<{ id: LanguageId; label: string }> = [
  // Each language is named in itself, which is how someone who cannot read the
  // current one finds their own.
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "fr", label: "Français" },
  // A generated language that is longer and more accented than any of them,
  // for finding labels that only fit in English.
  { id: "pseudo", label: "Pseudolocale" },
];

const FETCHERS: Record<FetchedId, () => Promise<Catalogue>> = {
  es: () => import("./es").then((module) => module.es),
  fr: () => import("./fr").then((module) => module.fr),
};

const fetched: Partial<Record<FetchedId, Catalogue>> = {};
const arriving: Partial<Record<FetchedId, Promise<void>>> = {};

function isFetched(which: LanguageId): which is FetchedId {
  return which === "es" || which === "fr";
}

function catalogue(which: LanguageId): Catalogue {
  if (isFetched(which)) return fetched[which] ?? en;
  return which === "pseudo" ? pseudo : en;
}

/**
 * Have the copy for a language in hand.
 *
 * Resolves at once for the languages that ship, and for the fetched ones once
 * they have arrived. A fetch that fails leaves English on screen, which is a
 * readable workspace rather than a screen of keys, and is tried again the
 * next time somebody asks.
 */
export function ensureLanguage(which: LanguageId): Promise<void> {
  if (!isFetched(which) || fetched[which]) return Promise.resolve();
  const already = arriving[which];
  if (already) return already;
  const wanted = FETCHERS[which]()
    .then((copy) => {
      fetched[which] = copy;
      for (const listener of listeners) listener();
    })
    .catch(() => {
      arriving[which] = undefined;
    });
  arriving[which] = wanted;
  return wanted;
}

export function isLanguage(value: unknown): value is LanguageId {
  return (
    value === "en" || value === "es" || value === "fr" || value === "pseudo"
  );
}

let current: LanguageId = "en";
const listeners = new Set<() => void>();

export function language(): LanguageId {
  return current;
}

export function setLanguage(next: LanguageId) {
  if (next === current) return;
  current = next;
  // Copy that is not here yet arrives on its own and tells the subscribers
  // again, so a switch made without waiting still lands.
  void ensureLanguage(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The locale to format dates and numbers with.
 *
 * The pseudolocale is English underneath, so dates in it stay readable and the
 * padding is what is being looked at.
 *
 * French is Canadian French, which is the reason it is here: the app draws
 * ECCC's radar and every Canadian weather product is published in it. The
 * region matters to more than the wording, since fr-CA writes a date the way
 * a reader in Quebec expects rather than the way one in France does.
 */
export function locale(which: LanguageId = current): string {
  if (which === "es") return "es";
  return which === "fr" ? "fr-CA" : "en";
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * A measured number, written the way the reader writes numbers.
 *
 * `toFixed` is English: it puts a point between the units and the tenths, and
 * Spanish and French both put a comma there. A tilt of 0.5 degrees and a tide
 * of 3.42 feet were coming out in English notation in every window, which is
 * the sort of thing that reads as a translation nobody finished.
 *
 * The digit count is the caller's, because it is a statement about the
 * instrument rather than about the language: a radar tilt is read to a
 * hundredth of a degree whoever is looking at it. Grouping is the locale's,
 * and almost nothing here reaches a thousand: the two that do, an export over
 * a gigabyte and a pack ceiling, gain the separator English has always wanted
 * there.
 *
 * The formatters are kept because building one is the expensive part and the
 * readouts call this on every mouse move.
 */
export function formatNumber(
  value: number,
  digits = 0,
  which: LanguageId = current,
): string {
  return formatter(locale(which), digits, digits).format(value);
}

/**
 * A number whose precision is the number's own, in the reader's notation.
 *
 * A legend stop is 5, 20 and 35 on one scale and 0.01, 0.1 and 0.5 on the
 * next, and a fixed digit count is wrong for at least one of them: it either
 * writes 5 as 5.00 or throws away the hundredth that made the stop worth
 * labelling. This is `String(value)` with a comma where the reader writes a
 * comma, which is what a legend, a storm report magnitude and a count all
 * want.
 */
export function formatMeasure(
  value: number,
  maxDigits = decimals(value),
  which: LanguageId = current,
): string {
  return formatter(locale(which), 0, maxDigits).format(value);
}

/**
 * How many decimals a number is actually carrying.
 *
 * The default has to be the value's own precision rather than a number
 * somebody picked, or this quietly rounds. A colour table can label a stop at
 * 0.0125, and a cap of two digits turned that into 0.01 and a stop at 0.001
 * into 0, so the bar beside the map stopped saying what the map was painted
 * with. Twenty is the ceiling `Intl` accepts and far past anything real.
 */
function decimals(value: number): number {
  const text = String(value);
  if (/e/i.test(text)) return 20;
  const point = text.indexOf(".");
  return point < 0 ? 0 : Math.min(text.length - point - 1, 20);
}

function formatter(tag: string, min: number, max: number): Intl.NumberFormat {
  const key = `${tag}:${min}:${max}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(tag, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    numberFormats.set(key, format);
  }
  return format;
}

export type Params = Record<string, string | number>;

/**
 * One string, with its parameters filled in.
 *
 * Parameters are named rather than positional, because word order is not the
 * same in every language and a sentence assembled by concatenation cannot be
 * translated at all.
 */
export function translate(
  key: StringKey,
  params?: Params,
  which: LanguageId = current,
): string {
  // A key missing from a translation falls back to English rather than showing
  // the key itself. The type checker stops this from happening, but a stored
  // language from a future build should not paint the screen with identifiers.
  const template = catalogue(which)[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** The translate function, and a re-render when the language changes. */
export function useT(): (key: StringKey, params?: Params) => string {
  const which = useSyncExternalStore(subscribe, language, () => "en" as const);
  // Stable while the language is, so an effect that depends on it runs when
  // the language changes and not on every render.
  return useCallback(
    (key: StringKey, params?: Params) => translate(key, params, which),
    [which],
  );
}

/** The current language, for a component that needs to know which it is. */
export function useLanguage(): LanguageId {
  return useSyncExternalStore(subscribe, language, () => "en" as const);
}

export type { StringKey } from "./en";
