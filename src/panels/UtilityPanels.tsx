import { Download, FileUp, FolderOpen, Info, ShieldCheck } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import type { UpdateState } from "../lib/updates";
import type { LogEntry } from "../lib/log";
import { DIAGNOSTIC_SOURCES, type ProviderHealth } from "../lib/providers";
import { APP_VERSION } from "../lib/settings";

interface CloseOnlyProps {
  onClose: () => void;
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
  /** Where the update check has got to, and what it found. */
  update: UpdateState;
  /** Absent in a browser preview, which has nothing to update. */
  onUpdate: (() => void) | null;
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
  update,
  onUpdate,
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
                      ? record.frameCount
                        ? `${record.frameCount} frames, ${ageLabel(record.lastSuccess)}`
                        : `Answered ${ageLabel(record.lastSuccess)}`
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
      <div className="feature-card" data-update-state={update.status}>
        <Download size={24} />
        <div>
          <strong>
            {update.status === "available"
              ? `OpenRadar ${update.offer.version} is out`
              : update.status === "ready"
                ? "Restarting into the new version"
                : update.status === "downloading"
                  ? `Downloading, ${update.percent}%`
                  : update.status === "checking"
                    ? "Checking for a newer version"
                    : update.status === "error"
                      ? "The update check failed"
                      : `OpenRadar v${APP_VERSION}`}
          </strong>
          <span>
            {update.status === "available"
              ? update.offer.notes.split("\n")[0] ||
                "Install it and OpenRadar restarts into it."
              : update.status === "error"
                ? update.message
                : update.status === "current"
                  ? "This is the newest version."
                  : "Updates are downloaded from the project's own releases."}
          </span>
          {onUpdate ? (
            <button
              type="button"
              className="secondary-button"
              disabled={
                update.status === "checking" ||
                update.status === "downloading" ||
                update.status === "ready"
              }
              onClick={onUpdate}
            >
              {update.status === "available"
                ? `Install ${update.offer.version}`
                : "Check for updates"}
            </button>
          ) : null}
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
