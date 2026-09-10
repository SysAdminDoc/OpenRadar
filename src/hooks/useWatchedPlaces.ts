import type { AppSettings } from "../lib/settings";
import { useMemo } from "react";
import { watchRingFeatures } from "../lib/ring";
import { watchedPlaces } from "../lib/watch";

/**
 * The places being watched, and the ring drawn round each of them.
 *
 * The radius is the reader's and the label is in the units they are reading
 * in, so the rings are built here rather than in the map: that component has
 * no business knowing what a watched place is.
 */
export function useWatchedPlaces(settings: AppSettings) {
  const watchedForJournal = useMemo(
    () => watchedPlaces(settings),
    // The watched places and nothing else. Keyed on the whole settings object
    // this rebuilt on every write, which restarted the effect below with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.watch, settings.watchPlaces],
  );

  // The radius each watched place's rules are judged against, drawn as a ring
  // around it. Built here rather than in the map: the radius is the reader's,
  // the label is in the units they are reading in, and the map component has
  // no business knowing what a watched place is.
  const watchRings = useMemo(
    () => (settings.watchRings ? watchRingFeatures(watchedForJournal) : null),
    // The units are read by `formatDistance` from a store rather than passed
    // in, so the labels have to be rebuilt when the setting behind that store
    // changes. The rule cannot see that read and calls the dependency
    // unnecessary; without it a reader switching to metric keeps rings
    // labelled in miles until something else moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.watchRings, settings.units, watchedForJournal],
  );
  return { watchedForJournal, watchRings };
}
