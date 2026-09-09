import type { ToastMessage } from "../components/ToastHost";
import type { AppSettings } from "../lib/settings";
import type { UndoableRemoval } from "../components/ToastHost";
import { UNDO_LIFETIME_MS } from "./useToasts";
import { failureSentence } from "../lib/serviceAnswer";
import { saveFile } from "../lib/saveFile";
import { translate } from "../i18n";
import { type Palette, paletteUnit, writePalette } from "../lib/palette";
import { useCallback } from "react";
import {
  withPalette,
  withPaletteAssigned,
  withoutPalette,
} from "../lib/palette";

/**
 * What a reader can do with a colour table they have loaded.
 *
 * Send it back out as the file it came in as, take it off the shelf with a
 * way back, and put one in force for a unit. Colour tables are what this
 * hobby actually shares, and one tuned here used to live and die inside the
 * settings file.
 */
export interface PaletteActionOptions {
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

export function usePaletteActions({
  settingsRef,
  onSettings: applySettings,
  pushToast,
}: PaletteActionOptions) {
  // A table back out as the file it came in as. Colour tables are what
  // this hobby actually shares, and one tuned here used to live and die
  // inside the settings file.
  const exportPalette = useCallback(
    (palette: Palette) => {
      const name = `${palette.name.replace(/\.pal$/i, "")}.pal`;
      void saveFile(name, new Blob([writePalette(palette)]))
        .then((saved) => {
          // Where it landed, the way every other export says it. `saveFile`
          // answers with a record rather than a flag, so testing the record
          // itself only ever asked whether an object is an object.
          pushToast({
            title: translate("upload.paletteSaved", { name }),
            detail: saved.path ?? translate("toast.settingsSavedBody"),
          });
        })
        .catch((failure: unknown) => {
          pushToast({
            title: translate("upload.paletteNotSaved"),
            detail: failureSentence(
              failure,
              translate("upload.paletteNotSaved"),
            ),
          });
        });
    },
    [pushToast],
  );

  // Loading a colour table is work: a file found, opened and dropped on the
  // window. Removing one was the action that threw that away with nothing to
  // say so and no way back.
  const removePalette = useCallback(
    (name: string) => {
      const previous = settingsRef.current;
      const found = previous.palettes.find((held) => held.name === name);
      if (!found) return;
      // Which unit it was in force for, if any, so the undo can put it back
      // there and the toast can say what actually changed on the map.
      const heldUnit = Object.entries(previous.paletteAssignments).find(
        ([, assigned]) => assigned === name,
      )?.[0];
      applySettings(withoutPalette(previous, name));
      pushToast({
        title: translate("toast.paletteCleared"),
        // Only claim the fallback when there was something to fall back from.
        // A table sitting on the shelf, in force for nothing, changes no
        // picture when it goes.
        detail: heldUnit
          ? translate("toast.paletteClearedBody", { name })
          : translate("toast.paletteShelvedBody", { name }),
        actionLabel: translate("toast.undo"),
        // Only this table, put back where it was. Restoring the whole
        // snapshot would undo anything else the reader did in between: remove
        // A, remove B, undo A, and B came back too.
        onAction: () => {
          const now = settingsRef.current;
          const back = withPalette(now, found);
          if (!back) return;
          applySettings(
            heldUnit
              ? back
              : withPaletteAssigned(
                  back,
                  paletteUnit(found),
                  now.paletteAssignments[paletteUnit(found).toLowerCase()] ??
                    null,
                ),
          );
        },
      });
    },
    [applySettings, pushToast, settingsRef],
  );

  /**
   * The way back from a removal a panel made, as a held toast.
   *
   * The panel knows what went and what to call it; the window is the same one
   * a cleared record gets, because the presses this covers all throw away
   * something the reader made or downloaded rather than a preference.
   */
  const offerUndo = useCallback(
    (removal: UndoableRemoval) => {
      pushToast({
        title: removal.title,
        detail: removal.detail,
        actionLabel: translate("toast.undo"),
        onAction: removal.undo,
        lifetimeMs: UNDO_LIFETIME_MS,
      });
    },
    [pushToast],
  );

  const assignPalette = useCallback(
    (unit: string, name: string | null) => {
      applySettings(withPaletteAssigned(settingsRef.current, unit, name));
    },
    [applySettings, settingsRef],
  );
  return { exportPalette, removePalette, assignPalette, offerUndo };
}
