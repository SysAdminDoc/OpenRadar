import { X } from "lucide-react";
import { useT } from "../i18n";

export interface ToastMessage {
  id: number;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * How long it stays, in milliseconds, when the usual few seconds is wrong.
   *
   * For the one case that matters: an undo. A message saying a thing happened
   * can go when it has been read, but a message that is the only way back
   * from deleting somebody's whole record has to outlast the moment they
   * realise what they did.
   */
  lifetimeMs?: number;
}

/**
 * A removal a panel wants to offer a way back from.
 *
 * The panel knows what went and what to say about it; only the workspace has
 * the toasts. Handed up as one shape rather than a prop per removal, because
 * the five presses that need it, an incident pack, a workspace theme, an alert
 * sound, an overlay file and a watched place, differ in nothing but their
 * words.
 */
export interface UndoableRemoval {
  title: string;
  detail?: string;
  undo: () => void;
}

interface ToastHostProps {
  /** Stops the dismissal clocks while a reader is on them. */
  onHold: () => void;
  onRelease: () => void;
  messages: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastHost({
  messages,
  onDismiss,
  onHold,
  onRelease,
}: ToastHostProps) {
  const t = useT();
  return (
    <div
      className="toast-host"
      aria-live="polite"
      aria-atomic="false"
      // A message with an undo had a few seconds to be noticed, read and
      // pressed, and this host sits near the end of the tab order: somebody
      // tabbing towards the button could watch it go while they were still
      // on the way. Focus and the pointer both hold the clock.
      onFocusCapture={onHold}
      onBlurCapture={onRelease}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
    >
      {messages.map((message) => (
        <div className="toast" key={message.id}>
          <div className="toast__copy">
            <strong>{message.title}</strong>
            {message.detail ? <span>{message.detail}</span> : null}
          </div>
          {message.actionLabel && message.onAction ? (
            <button
              className="toast__action"
              type="button"
              onClick={() => {
                message.onAction?.();
                onDismiss(message.id);
              }}
            >
              {message.actionLabel}
            </button>
          ) : null}
          <button
            className="icon-button toast__close"
            type="button"
            aria-label={t("toast.dismiss")}
            onClick={() => onDismiss(message.id)}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
