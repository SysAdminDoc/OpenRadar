import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useT } from "../i18n";

interface PanelShellProps {
  eyebrow: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}

export function PanelShell({
  eyebrow,
  title,
  children,
  onClose,
  className = "",
}: PanelShellProps) {
  const t = useT();
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);

  // Whatever opened this panel gets the focus back when it closes. Without it
  // focus falls to the document body, and the next Tab starts again from the
  // top of the window rather than from the button that was just pressed.
  //
  // Read on the first render rather than in the effect. Swapping one panel
  // for another happens in a single commit, and React runs the outgoing
  // panel's cleanup before the incoming panel's effect: the old panel had
  // already put the focus back on its own rail button by then, so the new
  // panel recorded that button as its opener and Escape returned one along.
  // Rendering happens before either, while the focus is still on the button
  // the reader actually pressed.
  const openedFromRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ||
      !(document.activeElement instanceof HTMLElement) ||
      document.activeElement === document.body
      ? null
      : document.activeElement,
  );
  useEffect(() => {
    // Taken now rather than read in the cleanup. It was written on the first
    // render and is never written again, so the two are the same value; the
    // hooks rule cannot know that and is right to ask in general.
    const opener = openedFromRef.current;
    // The heading, so a screen reader announces what opened rather than
    // reading out whichever control happens to be first.
    panelRef.current?.querySelector<HTMLElement>("h2")?.focus();

    return () => {
      // Only if it is still on the page: a command that swapped one panel for
      // another leaves nothing to go back to.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <section
      ref={panelRef}
      className={`surface-panel ${className}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      // Escape is what closes a dialog. This is the dialog's own behaviour
      // while it has focus, not an application shortcut.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="surface-panel__header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          {/* Focusable only by script, so the panel can announce itself
              without adding a stop to everyone's tab order. */}
          <h2 id={headingId} tabIndex={-1}>
            {title}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={t("panel.close", { title })}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="surface-panel__body">{children}</div>
    </section>
  );
}
