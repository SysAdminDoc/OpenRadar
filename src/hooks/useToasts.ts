import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMessage } from "../components/ToastHost";

/** How long a message stays on screen before it fades on its own. */
const LIFETIME_MS = 5200;

/**
 * How long a message carrying an undo stays.
 *
 * Five seconds is right for "that worked" and wrong for the only way back
 * from deleting a year of somebody's own weather. Half a minute is long
 * enough to notice what happened and short enough that it is still a toast.
 */
export const UNDO_LIFETIME_MS = 30_000;

/**
 * The marker that says the clocks are stopped, kept in the same set as the
 * messages waiting on them. Ids come from a counter that starts at zero, so
 * nothing below it can be one.
 */
const HOLDING = -1;

/** Three at once is as many as anyone reads. */
const MAX_VISIBLE = 3;

export interface Toasts {
  messages: ToastMessage[];
  push: (message: Omit<ToastMessage, "id">) => void;
  dismiss: (id: number) => void;
  /** Stops every timer while a reader is reading or reaching. */
  hold: () => void;
  /** Starts them again. */
  release: () => void;
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

  /**
   * How long each message asked for, so a held one can be given its own back
   * rather than the ordinary five seconds. An undo asks for thirty.
   */
  const lifetimes = useRef(new Map<number, number>());
  /**
   * Declared up here because `dismiss` above has to reach it, and named as
   * the ref rather than aliased, so the hooks rule can see that a callback
   * reading it depends on nothing.
   */
  const heldRef = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    // Out of the held list too. A message dismissed by hand during a hold
    // stayed in it, so releasing scheduled a timer for something already
    // gone: harmless to the reader, and a timeout with no owner is exactly
    // what the note above says is worth not having.
    heldRef.current.delete(id);
    lifetimes.current.delete(id);
    setMessages((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: Omit<ToastMessage, "id">) => {
      const id = ++nextId.current;
      setMessages((current) => {
        // Anything pushed off the end goes now, along with its timer, rather
        // than waiting for a dismissal nobody will see.
        // A message carrying an undo is not pushed off by newer ones. It is
        // the only way back from something destructive, and two toasts about
        // a layer failing to load should not take it away.
        //
        // Sliced by an index rather than by a negative count: `slice(-0)` is
        // the whole array, so with two undos held the arithmetic inverted and
        // kept everything while cancelling the timers of messages that were
        // still on screen. They then stayed for ever.
        const holding = current.filter((toast) => toast.onAction);
        const ordinary = current.filter((toast) => !toast.onAction);
        const room = Math.max(0, MAX_VISIBLE - 1 - holding.length);
        const from = Math.max(0, ordinary.length - room);
        const kept = [...holding, ...ordinary.slice(from)];
        for (const gone of ordinary.slice(0, from)) {
          const timer = timers.current.get(gone.id);
          if (timer !== undefined) {
            window.clearTimeout(timer);
            timers.current.delete(gone.id);
          }
        }
        return [
          ...current.filter((toast) => kept.includes(toast)),
          { ...message, id },
        ];
      });
      const lifetime = message.lifetimeMs ?? LIFETIME_MS;
      lifetimes.current.set(id, lifetime);
      if (heldRef.current.has(HOLDING)) {
        // Held from the moment it arrives, rather than given a clock that
        // runs while the reader is still on the message above it.
        heldRef.current.set(id, lifetime);
      } else {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), lifetime),
        );
      }
    },
    [dismiss],
  );

  /**
   * Holds every pending dismissal while the reader is on the toasts, and what
   * each one is owed when they start again.
   *
   * A message with an action button had a few seconds to be noticed, read
   * and pressed, and the host sits near the end of the tab order: somebody
   * tabbing towards an undo could watch it go while they were still on the
   * way. Pointing at one holds it for the same reason.
   *
   * What is left of a running `setTimeout` is not recoverable, so releasing
   * starts a fresh lifetime rather than the remainder. It has to be the
   * message's OWN lifetime: an undo asks for thirty seconds, and a first
   * version handed everything the ordinary five, so hovering the one message
   * that most needs reading made it leave six times sooner. That is the exact
   * opposite of what this is for.
   *
   * A map rather than a set and two flags, because the hooks rule forbids
   * mutating a plain object handed to `useRef` and allows a map. `HOLDING`
   * is below every id, which start at one, so it cannot collide; its value is
   * how many reasons are holding, since the pointer and the focus are two and
   * either can end without the other.
   */
  // Plain functions rather than `useCallback`. These write a ref, which the
  // hooks rule will not allow inside a memoised callback, and nothing below
  // them is memoised on their identity.
  const hold = () => {
    const reasons = heldRef.current.get(HOLDING) ?? 0;
    heldRef.current.set(HOLDING, reasons + 1);
    if (reasons > 0) return;
    for (const [id, timer] of timers.current) {
      window.clearTimeout(timer);
      heldRef.current.set(id, lifetimes.current.get(id) ?? LIFETIME_MS);
    }
    timers.current.clear();
  };
  const release = () => {
    const reasons = heldRef.current.get(HOLDING) ?? 0;
    if (reasons === 0) return;
    if (reasons > 1) {
      heldRef.current.set(HOLDING, reasons - 1);
      return;
    }
    heldRef.current.delete(HOLDING);
    for (const [id, lifetime] of heldRef.current) {
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), lifetime),
      );
    }
    heldRef.current.clear();
  };

  // The workspace going away takes every pending dismissal with it.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { messages, push, dismiss, hold, release };
}
