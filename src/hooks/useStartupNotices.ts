import { useCallback, useEffect, type RefObject } from "react";
import type { MapViewportHandle } from "../components/MapViewport";
import type { ToastMessage } from "../components/ToastHost";
import { translate } from "../i18n";
import {
  noteWorkspaceDrawn,
  restoreArrangement,
  settingsRecovery,
  startedPlain,
  type AppSettings,
} from "../lib/settings";
import { useLatestReply } from "./useLatestReply";
import { UNDO_LIFETIME_MS } from "./useToasts";
import { useWelcomeHint } from "./useWelcomeHint";

/**
 * What the workspace says once it has started, and the mark it leaves that it
 * did.
 *
 * Four things that each happen once per start and read nothing but whether
 * the settings have loaded: the mark that the workspace drew, the notice that
 * a start was stood down to a plain arrangement, the one that the settings
 * file could not be read, and the welcome line.
 */
export function useStartupNotices(options: {
  hydrated: boolean;
  mapRef: RefObject<MapViewportHandle | null>;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  settings: AppSettings;
  settingsRef: { readonly current: AppSettings };
  applySettings: (next: AppSettings) => void;
}): void {
  const { hydrated, mapRef, pushToast, settings, settingsRef, applySettings } =
    options;

  // The workspace is up, which is the whole of what the count is about: a
  // start that never got this far is the one worth standing an arrangement
  // down for.
  const latestDrawn = useLatestReply();
  useEffect(() => {
    if (!hydrated) return;
    // After the map has drawn, not when the settings parsed. Everything this
    // is protecting against is applied on the render AFTER hydration: the map
    // itself, the theme, the colour table a product is drawn with, the camera
    // the projection has to show. Reported at hydration, the mark was gone
    // before any of them existed, and a workspace that died on its first
    // frame every time was never once counted.
    const reply = latestDrawn();
    void mapRef.current?.onceIdle().then(() => {
      if (reply.current()) void noteWorkspaceDrawn();
    });
    return reply.close;
  }, [hydrated, latestDrawn, mapRef]);

  // Two starts that did not finish, and the arrangement stood down for this
  // one. Said out loud with the one press that puts it back, because a
  // workspace that quietly opens without the reader's theme and saved view
  // reads as the app having forgotten them.
  useEffect(() => {
    if (!hydrated) return;
    if (!startedPlain()) return;
    pushToast({
      title: translate("app.startedPlain"),
      detail: translate("app.startedPlainBody"),
      actionLabel: translate("app.startedPlainRestore"),
      // As long as every other toast that offers to undo something. Five
      // seconds is enough for a notice and not enough to read a sentence
      // about the workspace being different and decide what to do about it.
      lifetimeMs: UNDO_LIFETIME_MS,
      onAction: () => {
        void restoreArrangement();
      },
    });
  }, [hydrated, pushToast]);

  // A settings file that would not parse used to be silent: the workspace
  // opened on the defaults and the reader was left wondering where their
  // places went. Said once, after the load, whether the copy went back or
  // there was none to go back to. The two are different news.
  useEffect(() => {
    if (!hydrated) return;
    const recovered = settingsRecovery();
    if (!recovered) return;
    pushToast(
      recovered.stuck
        ? {
            // The one that will happen again on every launch until the reader
            // does something about it, and the one where a good copy is
            // sitting beside the file unused.
            title: translate("app.settingsLocked"),
            detail: translate("app.settingsLockedBody"),
          }
        : recovered.restored
          ? {
              title: translate("app.settingsRestored"),
              detail: translate("app.settingsRestoredBody"),
            }
          : {
              title: translate("app.settingsUnreadable"),
              detail: translate("app.settingsUnreadableBody"),
            },
    );
  }, [hydrated, pushToast]);

  // Everything the workspace can do is behind Commands and Layers, and nothing
  // on screen says either exists. One toast, once.
  const markWelcomeSeen = useCallback(() => {
    applySettings({ ...settingsRef.current, seenWelcome: true });
  }, [applySettings, settingsRef]);
  useWelcomeHint({
    ready: hydrated,
    seen: settings.seenWelcome,
    // Where the map opened, which is what the line is about.
    center: settings.camera.center,
    push: pushToast,
    onSeen: markWelcomeSeen,
  });
}
