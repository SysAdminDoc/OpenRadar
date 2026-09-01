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
 *
 * Spanish is fetched when it is first wanted rather than shipped in the first
 * load. It is as long as the English again, and a reader of English never
 * needs a byte of it. `ensureLanguage` is how a caller waits for it: both
 * places that restore a saved language do, so a Spanish reader's first screen
 * is already Spanish rather than English for a moment.
 */
import { useCallback, useSyncExternalStore } from "react";
import { en, type Catalogue, type StringKey } from "./en";
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

let spanish: Catalogue | null = null;
let spanishArriving: Promise<void> | null = null;

function catalogue(which: LanguageId): Catalogue {
  if (which === "es") return spanish ?? en;
  return which === "pseudo" ? pseudo : en;
}

/**
 * Have the copy for a language in hand.
 *
 * Resolves at once for everything but Spanish, and for Spanish once it has
 * been fetched. A fetch that fails leaves English on screen, which is a
 * readable workspace rather than a screen of keys, and is tried again the
 * next time somebody asks.
 */
export function ensureLanguage(which: LanguageId): Promise<void> {
  if (which !== "es" || spanish) return Promise.resolve();
  spanishArriving ??= import("./es")
    .then((module) => {
      spanish = module.es;
      for (const listener of listeners) listener();
    })
    .catch(() => {
      spanishArriving = null;
    });
  return spanishArriving;
}

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
