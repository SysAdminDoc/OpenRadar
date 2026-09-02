import { useEffect, useRef } from "react";
import { translate } from "../i18n";
import type { ToastMessage } from "../components/ToastHost";
import { metarOverlay } from "../lib/overlays/metar";
import { haversineMiles } from "../lib/geo";
import { openingLine } from "../lib/opening";
import { log } from "../lib/log";

/** How far around the opening view to look for a station, in degrees. */
const BOX_DEGREES = 1.25;

/**
 * One toast, once: what the weather is doing, and where everything is.
 *
 * There is no other onboarding. Everything the workspace can do is in the
 * command list and the layers panel, and nothing on screen says either of them
 * exists, so somebody opening it for the first time sees a map and no way in.
 *
 * The line above that hint is the reason to open the app on a calm day. It is
 * one station's own report, named and dated, and it says plainly when there is
 * nothing falling rather than reaching for something to fill itself with. It
 * never mentions a hazard: a warning is a warning and belongs in the warning
 * surfaces, and there is no wording here that could stand between a reader and
 * something serious.
 *
 * It is a toast rather than a dialog because a dialog would be a thing to
 * dismiss before the weather could be looked at, and it is shown once because
 * a hint that keeps coming back is not a hint.
 */
export function useWelcomeHint(options: {
  /** Nothing is shown until the saved settings have been read. */
  ready: boolean;
  seen: boolean;
  /** Where the map opened, which is where the weather is asked about. */
  center: [number, number];
  push: (message: Omit<ToastMessage, "id">) => void;
  /** Remembers that it has been shown, so it is not shown again. */
  onSeen: () => void;
}): void {
  const { ready, seen, push, onSeen } = options;
  // Through a ref, because it is an array rebuilt on every settings read: as
  // a dependency it restarted the effect constantly, and each restart aborted
  // the fetch the last one was waiting on, so the greeting never arrived.
  const centerRef = useRef(options.center);
  useEffect(() => {
    centerRef.current = options.center;
  }, [options.center]);
  // Once per run of the app, whatever else re-renders. Writing the flag is
  // asynchronous, so without this the effect can fire twice before the
  // settings come back round.
  const shown = useRef(false);

  useEffect(() => {
    if (!ready || seen || shown.current) return;
    shown.current = true;
    const [lon, lat] = centerRef.current;
    let live = true;
    const controller = new AbortController();

    // Said at once with the hint, and said again with the weather when a
    // station answers. A greeting that waits on a service is a greeting
    // nobody sees.
    const nearest = async () => {
      try {
        const data = await metarOverlay.fetchData(
          {
            west: lon - BOX_DEGREES,
            south: lat - BOX_DEGREES,
            east: lon + BOX_DEGREES,
            north: lat + BOX_DEGREES,
          },
          controller.signal,
        );
        if (!live) return null;
        let best: (typeof data.features)[number] | null = null;
        let away = Number.POSITIVE_INFINITY;
        for (const feature of data.features) {
          const [stationLon, stationLat] = feature.geometry.coordinates as [
            number,
            number,
          ];
          const miles = haversineMiles(
            { lon, lat },
            { lon: stationLon, lat: stationLat },
          );
          if (miles < away) {
            away = miles;
            best = feature;
          }
        }
        if (!best) return null;
        return openingLine(
          {
            station: String(best.properties.id ?? ""),
            raw: String(best.properties.raw ?? ""),
            temperatureC:
              typeof best.properties.tempC === "number"
                ? best.properties.tempC
                : null,
            observed:
              typeof best.properties.observed === "number"
                ? best.properties.observed * 1000
                : Number.NaN,
          },
          Date.now(),
        );
      } catch (failure) {
        // A greeting is not worth an error in front of somebody on their
        // first launch.
        if (live && !controller.signal.aborted) {
          log.info(
            "welcome",
            failure instanceof Error ? failure.message : "No station answered.",
          );
        }
        return null;
      }
    };

    void nearest().then((line) => {
      if (!live) return;
      push({
        // The weather first when there is any to report, and the signpost
        // either way: somebody who has just installed this still needs to
        // know where everything is.
        title: line ?? translate("welcome.detail"),
        detail: line ? translate("welcome.detail") : undefined,
      });
      onSeen();
    });

    return () => {
      live = false;
      controller.abort();
    };
  }, [onSeen, push, ready, seen]);
}
