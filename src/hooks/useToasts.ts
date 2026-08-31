import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMessage } from "../components/ToastHost";

/** How long a message stays on screen before it fades on its own. */
const LIFETIME_MS = 5200;
/** Three at once is as many as anyone reads. */
const MAX_VISIBLE = 3;

export interface Toasts {
  messages: ToastMessage[];
  push: (message: Omit<ToastMessage, "id">) => void;
  dismiss: (id: number) => void;
}

export function useToasts(): Toasts {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);
  /**
   * The timer that will take each message away, by the message it belongs to.
   *
   * Every one of these used to be created and then forgotten. Nothing cancelled
   * them, so a message the reader dismissed still had a timer running for it,
   * a message pushed out by three newer ones did too, and unmounting the
   * workspace left as many as had been shown still pending. None of that is
   * visible, which is exactly why it is worth holding: a timeout with no owner
   * is a thing that runs later for reasons nobody can trace.
   */
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setMessages((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: Omit<ToastMessage, "id">) => {
      const id = ++nextId.current;
      setMessages((current) => {
        // Anything pushed off the end goes now, along with its timer, rather
        // than waiting for a dismissal nobody will see.
        const kept = current.slice(-(MAX_VISIBLE - 1));
        for (const gone of current.slice(0, -(MAX_VISIBLE - 1))) {
          const timer = timers.current.get(gone.id);
          if (timer !== undefined) {
            window.clearTimeout(timer);
            timers.current.delete(gone.id);
          }
        }
        return [...kept, { ...message, id }];
      });
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), LIFETIME_MS),
      );
    },
    [dismiss],
  );

  // The workspace going away takes every pending dismissal with it.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { messages, push, dismiss };
}
