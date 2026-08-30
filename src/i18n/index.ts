/**
 * The workspace in more than one language.
 *
 * Copy lives in `en.ts` and `es.ts` rather than in the components. `es.ts` is
 * typed against `en.ts`, so a string added on one side and not the other is a
 * build error rather than an English sentence in a Spanish window.
 *
 * The language is external mutable state with its own subscribers, which is
 * what `useSyncExternalStore` is for. A component that shows copy calls
 * `useT()` and re-renders when the language changes, so switching takes effect
 * where you are rather than on the next restart.
 */
import { useSyncExternalStore } from "react";
import { en, type Catalogue, type StringKey } from "./en";
import { es } from "./es";
import { pseudo } from "./pseudo";

export type LanguageId = "en" | "es" | "pseudo";

export const LANGUAGES: Array<{ id: LanguageId; label: string }> = [
  // Each language is named in itself, which is how someone who cannot read the
  // current one finds their own.
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  // A generated language that is longer and more accented than either, for
  // finding labels that only fit in English.
  { id: "pseudo", label: "Pseudolocale" },
];

const CATALOGUES: Record<LanguageId, Catalogue> = { en, es, pseudo };

export function isLanguage(value: unknown): value is LanguageId {
  return value === "en" || value === "es" || value === "pseudo";
}

let current: LanguageId = "en";
const listeners = new Set<() => void>();

export function language(): LanguageId {
  return current;
}

export function setLanguage(next: LanguageId) {
  if (next === current) return;
  current = next;
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
 */
export function locale(which: LanguageId = current): string {
  return which === "es" ? "es" : "en";
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
  const catalogue = CATALOGUES[which] ?? en;
  // A key missing from a translation falls back to English rather than showing
  // the key itself. The type checker stops this from happening, but a stored
  // language from a future build should not paint the screen with identifiers.
  const template = catalogue[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** The translate function, and a re-render when the language changes. */
export function useT(): (key: StringKey, params?: Params) => string {
  const which = useSyncExternalStore(subscribe, language, () => "en" as const);
  return (key, params) => translate(key, params, which);
}

/** The current language, for a component that needs to know which it is. */
export function useLanguage(): LanguageId {
  return useSyncExternalStore(subscribe, language, () => "en" as const);
}

export type { StringKey } from "./en";
