import { X } from "lucide-react";

export interface ToastMessage {
  id: number;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastHostProps {
  messages: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastHost({ messages, onDismiss }: ToastHostProps) {
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
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
            aria-label="Dismiss notification"
            onClick={() => onDismiss(message.id)}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
