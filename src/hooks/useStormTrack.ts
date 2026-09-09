import type { ToastMessage } from "../components/ToastHost";
import type { ArchiveReplay } from "./useRadarTimeline";
import type { MapViewportHandle } from "../components/MapViewport";
import type { SurfaceId } from "../components/CommandBar";
import {
  archiveFrames,
  loadStorm,
  replayFocus,
  stormTrack,
  trackBounds,
  type Storm,
} from "../lib/hurdat";
import { failureSentence } from "../lib/serviceAnswer";
import { translate, useLanguage } from "../i18n";
import { useCallback, useMemo, type RefObject } from "react";

/**
 * A storm out of the hurricane archive, and the two ways of arriving at one.
 *
 * The labels on its points are the reader's own words rather than the
 * archive's codes, so the track is rebuilt when the language changes. Keyed
 * on the storm alone it was correct while a label was "TS 65 kt" and wrong
 * the moment it became a sentence: every panel turned French and the points
 * on the map stayed English until the storm was picked again.
 */
export interface StormTrackOptions {
  historyStorm: Storm | null;
  setHistoryStorm: (storm: Storm | null) => void;
  setReplay: (replay: ArchiveReplay | null) => void;
  mapRef: RefObject<MapViewportHandle | null>;
  setActiveSurface: (surface: SurfaceId) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

export function useStormTrack({
  historyStorm,
  setHistoryStorm,
  setReplay,
  mapRef,
  setActiveSurface,
  pushToast,
}: StormTrackOptions) {
  // The labels on the points are the reader's own words now, not the
  // archive's codes, so this has to be rebuilt when the language changes.
  // Keyed on the storm alone it was correct while the label was "TS 65 kt"
  // and wrong the moment it became a sentence: every panel turned French and
  // the points on the map stayed English until the storm was picked again.
  const spoken = useLanguage();
  const stormTrackData = useMemo(
    () => (historyStorm ? stormTrack(historyStorm) : null),
    // `spoken` reads as unused because `stormTrack` reaches the catalogue
    // through the module rather than through an argument. It is the reason
    // this is rebuilt at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyStorm, spoken],
  );

  // Picking a storm frames its whole track; replaying one goes to the moment
  // the radar is about, which is a much tighter view.
  const showStorm = useCallback(
    (storm: Storm | null) => {
      setHistoryStorm(storm);
      setReplay(null);
      if (storm) mapRef.current?.fitBounds(trackBounds(storm.track));
    },
    [mapRef, setHistoryStorm, setReplay],
  );

  /**
   * A storm chosen by name in the search.
   *
   * The track is loaded here and handed to the same place a Storm history
   * result goes, so the track is drawn and the replay is offered exactly
   * where the archive reaches. A name the record does not hold, or a decade
   * file that will not load, leaves the workspace as it was and says so.
   */
  const showStormById = useCallback(
    (id: string) => {
      void loadStorm(id)
        .then((storm) => {
          showStorm(storm);
          setActiveSurface("history");
        })
        .catch((failure: unknown) =>
          pushToast({
            title: translate("history.unknownStorm"),
            detail: failureSentence(failure, translate("history.unknownStorm")),
          }),
        );
    },
    [pushToast, setActiveSurface, showStorm],
  );

  const replayStorm = useCallback(
    (storm: Storm) => {
      const frames = archiveFrames(storm);
      const focus = replayFocus(storm);
      if (!frames.length || !focus) return;
      setHistoryStorm(storm);
      setReplay({
        id: storm.id,
        label: translate("radar.archive"),
        attributionUrl: "https://mesonet.agron.iastate.edu/",
        frames,
        focusTime: focus.point[0],
      });
      mapRef.current?.flyTo({
        center: [focus.point[2], focus.point[1]],
        zoom: 7,
        bearing: 0,
        pitch: 0,
      });
      pushToast({
        title: translate("replay.title", {
          name: storm.name,
          year: storm.year,
        }),
        detail: translate(
          focus.landfall ? "replay.atLandfall" : "replay.atClosest",
        ),
      });
    },
    [mapRef, pushToast, setHistoryStorm, setReplay],
  );
  return { stormTrackData, showStorm, showStormById, replayStorm };
}
