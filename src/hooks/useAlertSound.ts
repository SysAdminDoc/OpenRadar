import { useCallback, useEffect } from "react";
import { translate } from "../i18n";
import { isDesktopRuntime } from "../lib/runtime";
import { failureSentence } from "../lib/serviceAnswer";
import {
  keepSoundPath,
  loadAlertSound,
  setAlertSound,
  setAlertVolume,
  SOUND_EXTENSIONS,
} from "../lib/sound";
import type { AppSettings } from "../lib/settings";
import type { ToastMessage } from "../components/ToastHost";
import { useLatestReply } from "./useLatestReply";

export interface AlertSoundOptions {
  /** How loud the kit is played, nought to one. */
  volume: number;
  /** A sound file of the reader's own, by path, or null for the kit. */
  path: string | null;
  /** The settings as they stand now, for a change made from a callback. */
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

/**
 * The sound an alert makes, and the file a reader chose for it.
 *
 * Two things the native side has to be told rather than asked, and one
 * question that can only be answered by trying: whether the file is still
 * there, still small enough and still audio. That is decided in one place,
 * so a file that stops working later is reported the same way as one that
 * never worked at all.
 */
export function useAlertSound({
  volume,
  path,
  settingsRef,
  onSettings: applySettings,
  pushToast,
}: AlertSoundOptions): () => Promise<void> {
  useEffect(() => {
    setAlertVolume(volume);
  }, [volume]);

  /**
   * Asks for a sound file of the reader's own.
   *
   * The path is what is kept. Whether it can actually be used is decided by
   * the effect below, in one place, so a file that stops working later is
   * reported the same way as one that never worked.
   */
  const chooseAlertSound = useCallback(async () => {
    if (!isDesktopRuntime()) {
      // Said rather than swallowed. A button that does nothing at all is the
      // one thing worse than a button that fails.
      pushToast({
        title: translate("alerts.soundFileFailed"),
        detail: translate("journal.desktopOnly"),
      });
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: SOUND_EXTENSIONS }],
      });
      if (typeof chosen !== "string") return;
      applySettings({ ...settingsRef.current, alertSoundPath: chosen });
    } catch (failure) {
      pushToast({
        title: translate("alerts.soundFileFailed"),
        // Not `failure.message`. A file the dialog or the decoder refused
        // throws the engine's own words, in English whatever language the
        // app is in, and this goes straight into a toast.
        detail: failureSentence(failure, translate("alerts.soundFile.decode")),
      });
    }
  }, [applySettings, pushToast, settingsRef]);

  // question is recognised and dropped. Shared by every effect below that
  // reads something and writes what it gets back.
  // One per effect: a single counter shared between them would mean each
  // effect that started invalidated whichever sibling was still waiting.
  const latestSound = useLatestReply();

  // Read once, when the path changes. A file that has moved away, grown too
  // big or stopped being audio is reported here and the built-in kit answers
  // instead, rather than a warning arriving in silence.
  useEffect(() => {
    setAlertSound(path);
    if (!path) return;
    // Guarded, because choosing a second file while the first is still being
    // read used to let the older answer land last: it cleared the sound that
    // had just loaded and blamed a file the reader had already replaced.
    const reply = latestSound();
    void loadAlertSound(path).then((answer) => {
      if (!reply.current() || answer.ok) return;
      setAlertSound(null);
      pushToast({
        title: translate("alerts.soundFileFailed"),
        detail: translate(`alerts.soundFile.${answer.reason}`),
      });
      // Said once, then stop naming it.
      if (keepSoundPath(answer.reason)) return;
      applySettings({ ...settingsRef.current, alertSoundPath: null });
    });
    return reply.close;
  }, [path, pushToast, applySettings, settingsRef, latestSound]);

  return chooseAlertSound;
}
