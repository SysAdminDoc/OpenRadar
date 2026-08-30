import { useCallback, useState } from "react";
import { log } from "../lib/log";
import {
  checkForUpdate,
  installUpdate,
  updatesAvailable,
  type UpdateState,
} from "../lib/updates";

export interface UpdatesState {
  state: UpdateState;
  /** Null in a browser preview, where there is nothing to update. */
  act: (() => void) | null;
}

/**
 * One button that does the right next thing: check, then install what the
 * check found. Nothing happens on its own, because an update that downloads
 * itself in the background is not what a radar app should be doing during a
 * storm.
 */
export function useUpdates(options: {
  onToast: (toast: { title: string; detail?: string }) => void;
}): UpdatesState {
  const { onToast } = options;
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  const act = useCallback(() => {
    setState((current) => {
      if (current.status === "available") {
        void installUpdate((percent) =>
          setState({ status: "downloading", percent }),
        )
          .then(() => setState({ status: "ready" }))
          .catch((failure: unknown) => {
            const message = messageFor(failure, "The update did not install.");
            log.error("app", message);
            setState({ status: "error", message });
            onToast({ title: "The update did not install", detail: message });
          });
        return { status: "downloading", percent: 0 };
      }

      void checkForUpdate()
        .then((offer) => {
          if (!offer) {
            setState({ status: "current" });
            onToast({ title: "OpenRadar is up to date" });
            return;
          }
          setState({ status: "available", offer });
          onToast({
            title: `OpenRadar ${offer.version} is available`,
            detail: "Install it from Diagnostics.",
          });
        })
        .catch((failure: unknown) => {
          const message = messageFor(failure, "The update check failed.");
          log.warn("app", message);
          setState({ status: "error", message });
        });
      return { status: "checking" };
    });
  }, [onToast]);

  return { state, act: updatesAvailable() ? act : null };
}

function messageFor(failure: unknown, fallback: string): string {
  if (typeof failure === "string") return failure;
  return failure instanceof Error ? failure.message : fallback;
}
