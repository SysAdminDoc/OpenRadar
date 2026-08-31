import { useCallback, useRef, useState } from "react";
import { log } from "../lib/log";
import {
  checkForUpdate,
  installUpdate,
  updatesAvailable,
  type UpdateOffer,
  type UpdateState,
} from "../lib/updates";
import { translate } from "../i18n";

export interface UpdatesState {
  state: UpdateState;
  /** Null in a browser preview, where there is nothing to update. */
  act: (() => void) | null;
}

function messageFor(failure: unknown, fallback: string): string {
  if (typeof failure === "string") return failure;
  return failure instanceof Error ? failure.message : fallback;
}

/**
 * One button that does the right next thing: check, then install what the
 * check found. Nothing happens on its own, because an update that downloads
 * itself in the middle of a storm is not much use to anyone.
 */
export function useUpdates(options: {
  onToast: (toast: { title: string; detail?: string }) => void;
}): UpdatesState {
  const { onToast } = options;
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  // What a check found, held apart from the rendered state so the click can
  // read it without a state updater doing the work. React runs an updater
  // twice in a development build, and two of these would be two downloads.
  const offerRef = useRef<UpdateOffer | null>(null);
  const busyRef = useRef(false);

  const act = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const done = () => {
      busyRef.current = false;
    };

    if (offerRef.current) {
      setState({ status: "downloading", percent: 0 });
      void installUpdate((percent) =>
        setState({ status: "downloading", percent }),
      )
        .then(() => {
          // The app is restarting into the new build, so nothing follows this.
          setState({ status: "ready" });
        })
        .catch((failure: unknown) => {
          const message = messageFor(failure, translate("update.notInstalled"));
          log.error("app", message);
          // A restart that never came leaves the offer standing, so the button
          // says install rather than sticking on a restart that is not coming.
          setState({ status: "error", message });
          onToast({
            title: translate("update.notInstalledTitle"),
            detail: message,
          });
        })
        .finally(done);
      return;
    }

    setState({ status: "checking" });
    void checkForUpdate()
      .then((offer) => {
        offerRef.current = offer;
        if (!offer) {
          setState({ status: "current" });
          onToast({ title: translate("update.upToDate") });
          return;
        }
        setState({ status: "available", offer });
        onToast({
          title: translate("update.available", { version: offer.version }),
          detail: translate("update.installFrom"),
        });
      })
      .catch((failure: unknown) => {
        // Nothing is cleared here. This branch is only reached when there was
        // no offer to begin with, so the check either rejected before it could
        // set one, or it set a real one and something after it threw. In the
        // second case the offer is genuine and the button should still say
        // install; clearing it would throw away an update that was found.
        const message = messageFor(failure, translate("update.checkFailed"));
        log.warn("app", message);
        setState({ status: "error", message });
      })
      .finally(done);
  }, [onToast]);

  return { state, act: updatesAvailable() ? act : null };
}
