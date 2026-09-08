import { useCallback, useEffect, useRef, useState } from "react";
import { log } from "../lib/log";
import { pollWhileOnline } from "../lib/poll";
import {
  checkForUpdate,
  installUpdate,
  updatesAvailable,
  type UpdateOffer,
  type UpdateState,
} from "../lib/updates";
import { translate } from "../i18n";
import { failureSentence } from "../lib/serviceAnswer";

/**
 * How long after launch the first quiet check happens, and how often after
 * that.
 *
 * An hour, because the first minutes of a launch belong to the map. A day,
 * because that is how often a release could possibly appear and a copy left
 * open on a second monitor for a month should not have to be asked.
 */
export const FIRST_QUIET_CHECK_MS = 3_600_000;
export const QUIET_CHECK_EVERY_MS = 24 * 3_600_000;

export interface UpdatesState {
  state: UpdateState;
  /** Null in a browser preview, where there is nothing to update. */
  act: (() => void) | null;
}

function messageFor(failure: unknown, fallback: string): string {
  if (typeof failure === "string") return failure;
  return failureSentence(failure, fallback);
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

  // A copy left open never learned anything. The West Palm Beach radar was
  // dark for thirty-three days in every installed build while a fix sat on the
  // release page, and the only way to find out was to open a panel and press a
  // button. So the app asks, once an hour after launch and once a day after
  // that, and does nothing else with the answer: no download, no toast, no
  // window. The button is still the only thing that installs anything, which
  // is the promise this hook was written around and the promise SECURITY.md
  // makes. What changes is what the button says before it is pressed.
  useEffect(() => {
    if (!updatesAvailable()) return;
    let stopPolling: (() => void) | null = null;

    const quietly = () => {
      // Not while the reader's own press is in flight, and not once there is
      // an offer: a second answer cannot say anything the first did not, and
      // overwriting it would reset a download the reader had started.
      if (busyRef.current || offerRef.current) return;
      void checkForUpdate()
        .then((offer) => {
          if (!offer || busyRef.current || offerRef.current) return;
          offerRef.current = offer;
          setState({ status: "available", offer });
        })
        .catch((failure: unknown) => {
          // The log and nowhere else. Nobody asked, so nobody is waiting to
          // hear that it failed, and a workspace that announces its own
          // failed update check at three in the morning is exactly the
          // notification this app does not send.
          log.warn("app", messageFor(failure, translate("update.checkFailed")));
        });
    };

    const first = window.setTimeout(() => {
      // `pollWhileOnline` asks straight away and then on the timer, and it
      // skips an ask while the machine says it has no network rather than
      // failing on one.
      stopPolling = pollWhileOnline(quietly, QUIET_CHECK_EVERY_MS);
    }, FIRST_QUIET_CHECK_MS);

    return () => {
      window.clearTimeout(first);
      stopPolling?.();
    };
  }, []);

  return { state, act: updatesAvailable() ? act : null };
}
