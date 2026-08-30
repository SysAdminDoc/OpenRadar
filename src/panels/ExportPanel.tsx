import { Camera, Film, LoaderCircle } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import { useT } from "../i18n";

interface ExportPanelProps {
  frameCount: number;
  busy: string | null;
  progress: { done: number; total: number } | null;
  onExportImage: () => void;
  onExportLoop: () => void;
  onClose: () => void;
}

export function ExportPanel({
  frameCount,
  busy,
  progress,
  onExportImage,
  onExportLoop,
  onClose,
}: ExportPanelProps) {
  const t = useT();

  return (
    <PanelShell
      eyebrow={t("export.eyebrow")}
      title={t("export.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      <button
        type="button"
        className="secondary-button"
        disabled={Boolean(busy)}
        onClick={onExportImage}
      >
        {busy === "image" ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Camera size={16} />
        )}
        {t("export.image")}
      </button>

      <button
        type="button"
        className="secondary-button"
        disabled={Boolean(busy) || frameCount < 2}
        onClick={onExportLoop}
      >
        {busy === "loop" ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Film size={16} />
        )}
        {t("export.loop")}
        {frameCount > 1 ? t("export.loopFrames", { count: frameCount }) : ""}
      </button>

      {progress ? (
        <p className="source-note" role="status">
          {t("export.recording", {
            done: progress.done,
            total: progress.total,
          })}
        </p>
      ) : null}

      <div className="feature-card">
        <Film size={24} />
        <div>
          <strong>{t("export.cardTitle")}</strong>
          <span>{t("export.cardBody")}</span>
        </div>
      </div>

      <p className="source-note">{t("export.note")}</p>
    </PanelShell>
  );
}
