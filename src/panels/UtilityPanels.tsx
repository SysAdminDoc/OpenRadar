import {
  ExternalLink,
  FileUp,
  Film,
  FolderOpen,
  Info,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import type { LogEntry } from "../lib/log";
import { DIAGNOSTIC_SOURCES, type ProviderHealth } from "../lib/providers";
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
        <strong>Add an overlay</strong>
        <span>
          Choose a local GeoJSON file or a GRLevelX placefile. Nothing is sent
          to a server.
        </span>
        <input
          type="file"
          accept=".geojson,.json,.txt,.php,application/geo+json,application/json,text/plain"
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
  activeSource: string | null;
  health: ProviderHealth[];
  log: LogEntry[];
  onOpenLogFolder: () => void;
}

function clockLabel(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(at));
}

function ageLabel(at: number | null): string {
  if (at === null) return "not contacted yet";
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (minutes < 1) return "less than a minute ago";
  return `${minutes} min ago`;
}

export function MorePanel({
  onClose,
  radarReady,
  mapReady,
  activeSource,
  health,
  log,
  onOpenLogFolder,
}: MorePanelProps) {
  return (
    <PanelShell
      eyebrow={`OpenRadar v${APP_VERSION}`}
      title="Diagnostics"
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
              {radarReady
                ? `${activeSource ?? "Live"} · receiving frames`
                : "Waiting for data"}
            </small>
          </span>
        </div>
        {DIAGNOSTIC_SOURCES.map((provider) => {
          const record = health.find((item) => item.id === provider.id);
          const healthy = Boolean(record?.lastSuccess) && !record?.lastError;
          return (
            <div key={provider.id}>
              <span className={healthy ? "status-dot is-live" : "status-dot"} />
              <span>
                <strong>{provider.label}</strong>
                <small>
                  {record?.lastError
                    ? `${record.lastError} (${record.consecutiveFailures} in a row)`
                    : record?.lastSuccess
                      ? `${record.frameCount} frames, ${ageLabel(record.lastSuccess)}`
                      : "Standing by"}
                </small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="diagnostics-log">
        <div className="diagnostics-log__title">
          <span>Recent events</span>
          <button type="button" onClick={onOpenLogFolder}>
            <FolderOpen size={14} /> Open log folder
          </button>
        </div>
        {log.length ? (
          <ol>
            {log
              .slice(-12)
              .reverse()
              .map((entry) => (
                <li
                  key={`${entry.at}-${entry.message}`}
                  data-level={entry.level}
                >
                  <span>{clockLabel(entry.at)}</span>
                  <strong>{entry.scope}</strong>
                  <small>{entry.message}</small>
                </li>
              ))}
          </ol>
        ) : (
          <p className="source-note">Nothing has gone wrong yet.</p>
        )}
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
