import type { ToastMessage } from "../components/ToastHost";
import type { AppSettings } from "../lib/settings";
import { pairingById } from "../lib/alertPairings";
import { translate } from "../i18n";
import { useCallback } from "react";
import { useWorkspaceOverlays } from "./useWorkspaceOverlays";

/**
 * Three presses that answer a reader rather than the weather.
 *
 * The layer that explains a warning, from the warning's own popup. The
 * switch that gives up on a wind field the map could not draw. And the test
 * that proves a notification works, which somebody presses on a calm
 * afternoon rather than finding out during a tornado warning.
 */
export interface WorkspacePressOptions {
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  overlays: ReturnType<typeof useWorkspaceOverlays>;
}

export function useWorkspacePresses({
  settingsRef,
  onSettings: applySettings,
  pushToast,
  overlays,
}: WorkspacePressOptions) {
  // The layer that explains a warning, from the warning's own popup.
  //
  // Switches only. It does not move the camera, does not restyle the
  // polygon, and does not touch the warning's own presentation: the pairing
  // is a suggestion about where to look rather than a claim about the hazard.
  const applyPairing = useCallback(
    (id: string) => {
      const pairing = pairingById(id);
      if (!pairing) return;
      const current = settingsRef.current;
      const next: AppSettings = {
        ...current,
        layers: { ...current.layers, ...pairing.layers },
      };
      if (pairing.radarProduct) {
        next.radar = { ...current.radar, product: pairing.radarProduct };
      }
      applySettings(next);
      const names = Object.keys(pairing.layers)
        .map((key) => translate(`layer.${key}` as "layer.metar"))
        .join(", ");
      pushToast({
        title: translate("pairing.shown", { layer: names }),
        detail: translate("pairing.shownBody"),
        actionLabel: translate("toast.undo"),
        onAction: () => applySettings(current),
      });
    },
    [applySettings, pushToast, settingsRef],
  );

  // The wind layer's shaders would not build on this card, so the viewport has
  // taken the layer back out and the switch has to follow it. Left on, it
  // described a layer that was not being drawn, and the map read as a calm
  // afternoon: the reader would have had no way to tell that from the real
  // thing. No undo, because pressing it would only fail again on the same
  // card; the switch is there to try again with.
  const handleWindUndrawable = useCallback(() => {
    const current = settingsRef.current;
    if (!current.layers.wind) return;
    applySettings({
      ...current,
      layers: { ...current.layers, wind: false },
    });
    pushToast({
      title: translate("wind.noDraw"),
      detail: translate("wind.noDrawBody"),
    });
  }, [applySettings, pushToast, settingsRef]);

  // A test the reader asked for is answered on the desktop path only. When the
  // notification does not go out, the watch has already put the same alert in
  // front of them as a toast, and a second message saying it worked would be
  // the app talking about itself rather than about the weather.
  const sendWatchTest = useCallback(() => {
    void (async () => {
      const delivered = await overlays.sendWatchTest();
      if (delivered) {
        pushToast({
          title: translate("watch.testSent"),
          detail: translate("watch.testSentBody"),
        });
      }
    })();
  }, [overlays, pushToast]);
  return { applyPairing, handleWindUndrawable, sendWatchTest };
}
