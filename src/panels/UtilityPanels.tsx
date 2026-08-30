import {
  ExternalLink,
  FileUp,
  Film,
  Info,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import { APP_VERSION } from "../lib/settings";

interface CloseOnlyProps {
  onClose: () => void;
}

export function VideosPanel({ onClose }: CloseOnlyProps) {
  return (
    <PanelShell
      eyebrow="Weather desk"
      title="Videos"
      onClose={onClose}
      className="surface-panel--right"
    >
      <div className="feature-card feature-card--accent">
        <Film size={24} />
        <div>
          <strong>Live weather video desk</strong>
          <span>
            Official briefings and verified public camera feeds will appear
            here.
          </span>
        </div>
      </div>
      <a
        className="link-row"
        href="https://www.youtube.com/@NWS"
        target="_blank"
        rel="noreferrer"
      >
        <span>
          <Radio size={18} />
          <strong>National Weather Service briefings</strong>
        </span>
        <ExternalLink size={16} />
      </a>
      <p className="source-note">
        External video opens in the default browser. OpenRadar does not sign you
        into any service.
      </p>
    </PanelShell>
  );
}

interface UploadPanelProps extends CloseOnlyProps {
  onFile: (file: File) => void;
}

export function UploadPanel({ onClose, onFile }: UploadPanelProps) {
  return (
    <PanelShell
      eyebrow="Local data"
      title="Upload"
      onClose={onClose}
      className="surface-panel--right"
    >
      <label className="drop-zone">
        <FileUp size={30} />
        <strong>Add a GeoJSON overlay</strong>
        <span>
          Choose a local .geojson or .json file. Nothing is sent to a server.
        </span>
        <input
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      </label>
    </PanelShell>
  );
}

interface MorePanelProps extends CloseOnlyProps {
  radarReady: boolean;
  mapReady: boolean;
}

export function MorePanel({ onClose, radarReady, mapReady }: MorePanelProps) {
  return (
    <PanelShell
      eyebrow={`OpenRadar v${APP_VERSION}`}
      title="More options"
      onClose={onClose}
      className="surface-panel--right"
    >
      <div className="status-list">
        <div>
          <span className={mapReady ? "status-dot is-live" : "status-dot"} />
          <span>
            <strong>Map renderer</strong>
            <small>{mapReady ? "Ready" : "Starting"}</small>
          </span>
        </div>
        <div>
          <span className={radarReady ? "status-dot is-live" : "status-dot"} />
          <span>
            <strong>Radar timeline</strong>
            <small>
              {radarReady ? "Receiving frames" : "Waiting for data"}
            </small>
          </span>
        </div>
      </div>
      <div className="feature-card">
        <ShieldCheck size={24} />
        <div>
          <strong>Private by default</strong>
          <span>Settings and imported overlays stay on this device.</span>
        </div>
      </div>
      <div className="feature-card">
        <Info size={24} />
        <div>
          <strong>Operational disclaimer</strong>
          <span>
            Use official warnings and local authorities for life-safety
            decisions.
          </span>
        </div>
      </div>
    </PanelShell>
  );
}
