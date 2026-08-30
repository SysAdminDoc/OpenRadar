import { useCallback, useRef, useState } from "react";
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

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: Omit<ToastMessage, "id">) => {
      const id = ++nextId.current;
      setMessages((current) => [
        ...current.slice(-(MAX_VISIBLE - 1)),
        { ...message, id },
      ]);
      window.setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  return { messages, push, dismiss };
}
