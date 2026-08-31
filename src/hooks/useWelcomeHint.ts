import { useEffect, useRef } from "react";
import { translate } from "../i18n";
import type { ToastMessage } from "../components/ToastHost";

/**
 * One toast, once, saying where the commands and the layers are.
 *
 * There is no other onboarding. Everything the workspace can do is in the
 * command list and the layers panel, and nothing on screen says either of them
 * exists, so somebody opening it for the first time sees a map and no way in.
 *
 * It is a toast rather than a dialog because a dialog would be a thing to
 * dismiss before the weather could be looked at, and it is shown once because
 * a hint that keeps coming back is not a hint.
 */
export function useWelcomeHint(options: {
  /** Nothing is shown until the saved settings have been read. */
  ready: boolean;
  seen: boolean;
  push: (message: Omit<ToastMessage, "id">) => void;
  /** Remembers that it has been shown, so it is not shown again. */
  onSeen: () => void;
}): void {
  const { ready, seen, push, onSeen } = options;
  // Once per run of the app, whatever else re-renders. Writing the flag is
  // asynchronous, so without this the effect can fire twice before the
  // settings come back round.
  const shown = useRef(false);

  useEffect(() => {
    if (!ready || seen || shown.current) return;
    shown.current = true;
    push({
      title: translate("welcome.title"),
      detail: translate("welcome.detail"),
    });
    onSeen();
  }, [onSeen, push, ready, seen]);
}
