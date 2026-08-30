import { X } from "lucide-react";
import type { ReactNode } from "react";
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
  return (
    <section className={`surface-panel ${className}`} aria-label={title}>
      <header className="surface-panel__header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
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
