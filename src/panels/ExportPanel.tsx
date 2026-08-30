import { Camera, Film, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { PanelShell } from "../components/PanelShell";

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
  const [note] = useState(
    "Both go straight to your downloads folder. Nothing is uploaded.",
  );

  return (
    <PanelShell
      eyebrow="Take it with you"
      title="Export"
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
        Export image
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
        Export loop
        {frameCount > 1 ? ` (${frameCount} frames)` : ""}
      </button>

      {progress ? (
        <p className="source-note" role="status">
          Recording frame {progress.done} of {progress.total}. Leave the window
          in front while it runs.
        </p>
      ) : null}

      <div className="feature-card">
        <Film size={24} />
        <div>
          <strong>What lands in the file</strong>
          <span>
            The map exactly as it is now, with the frame time, the radar source,
            and the credits burned into the corner.
          </span>
        </div>
      </div>

      <p className="source-note">{note}</p>
    </PanelShell>
  );
}
