import {
  Download,
  FileUp,
  FolderOpen,
  Info,
  ShieldCheck,
  X,
} from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import type { Palette } from "../lib/palette";
import type { UpdateState } from "../lib/updates";
import type { LogEntry } from "../lib/log";
import { DIAGNOSTIC_SOURCES, type ProviderHealth } from "../lib/providers";
import { APP_VERSION } from "../lib/settings";
import { locale, translate, useT } from "../i18n";

interface CloseOnlyProps {
  onClose: () => void;
}

interface UploadPanelProps extends CloseOnlyProps {
  onFile: (file: File) => void;
  /** The colour table in force, if one has been loaded. */
  palette: Palette | null;
  onClearPalette: () => void;
}

export function UploadPanel({
  onClose,
  onFile,
  palette,
  onClearPalette,
}: UploadPanelProps) {
  const t = useT();
  return (
    <PanelShell
      eyebrow={t("upload.eyebrow")}
      title={t("upload.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      <label className="drop-zone">
        <FileUp size={30} />
        <strong>{t("upload.dropTitle")}</strong>
        <span>{t("upload.dropBody")}</span>
        <input
          type="file"
          accept=".geojson,.json,.txt,.php,.pal,application/geo+json,application/json,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      </label>

      {palette ? (
        <div className="storm-row" data-palette={palette.name}>
          <div>
            <strong>{palette.name}</strong>
            <small>
              {t("upload.colours", { count: palette.stops.length })}
              {palette.units
                ? t("upload.forUnits", { units: palette.units })
                : t("upload.forReflectivity")}
            </small>
            {palette.skipped.length ? (
              <small>
                {t("upload.skipped", { names: palette.skipped.join(", ") })}
              </small>
            ) : null}
          </div>
          <div className="storm-row__actions">
            <button type="button" onClick={onClearPalette}>
              <X size={14} /> {t("upload.clearPalette")}
            </button>
          </div>
        </div>
      ) : null}
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
  return new Intl.DateTimeFormat(locale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(at));
}

function ageLabel(at: number | null): string {
  if (at === null) return translate("diagnostics.neverContacted");
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (minutes < 1) return translate("diagnostics.underAMinute");
  return translate("diagnostics.minutesAgo", { count: minutes });
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
  const t = useT();
  return (
    <PanelShell
      eyebrow={t("diagnostics.eyebrow", { version: APP_VERSION })}
      title={t("diagnostics.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      <div className="status-list">
        <div>
          <span className={mapReady ? "status-dot is-live" : "status-dot"} />
          <span>
            <strong>{t("diagnostics.renderer")}</strong>
            <small>
              {mapReady
                ? t("diagnostics.rendererReady")
                : t("diagnostics.rendererStarting")}
            </small>
          </span>
        </div>
        <div>
          <span className={radarReady ? "status-dot is-live" : "status-dot"} />
          <span>
            <strong>{t("diagnostics.timeline")}</strong>
            <small>
              {radarReady
                ? t("diagnostics.receiving", {
                    source: activeSource ?? t("diagnostics.live"),
                  })
                : t("diagnostics.waiting")}
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
                    ? t("diagnostics.failing", {
                        error: record.lastError,
                        count: record.consecutiveFailures,
                      })
                    : record?.lastSuccess
                      ? record.frameCount
                        ? t("diagnostics.frames", {
                            count: record.frameCount,
                            when: ageLabel(record.lastSuccess),
                          })
                        : t("diagnostics.answered", {
                            when: ageLabel(record.lastSuccess),
                          })
                      : t("diagnostics.standingBy")}
                </small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="diagnostics-log">
        <div className="diagnostics-log__title">
          <span>{t("diagnostics.recentEvents")}</span>
          <button type="button" onClick={onOpenLogFolder}>
            <FolderOpen size={14} /> {t("diagnostics.openLogs")}
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
          <p className="source-note">{t("diagnostics.nothingWrong")}</p>
        )}
      </div>
      <div className="feature-card" data-update-state={update.status}>
        <Download size={24} />
        <div>
          <strong>
            {update.status === "available"
              ? t("diagnostics.updateAvailable", {
                  version: update.offer.version,
                })
              : update.status === "ready"
                ? t("diagnostics.updateReady")
                : update.status === "downloading"
                  ? t("diagnostics.updateDownloading", {
                      percent: update.percent,
                    })
                  : update.status === "checking"
                    ? t("diagnostics.updateChecking")
                    : update.status === "error"
                      ? t("diagnostics.updateFailed")
                      : t("diagnostics.version", { version: APP_VERSION })}
          </strong>
          <span>
            {update.status === "available"
              ? update.offer.notes.split("\n")[0] ||
                t("diagnostics.updateFallbackNotes")
              : update.status === "error"
                ? update.message
                : update.status === "current"
                  ? t("diagnostics.upToDate")
                  : t("diagnostics.updateSource")}
          </span>
          {onUpdate ? (
            <button
              type="button"
              className="secondary-button"
              // A restart that never comes must not leave this saying so
              // with no way back; only work in flight disables it.
              disabled={
                update.status === "checking" || update.status === "downloading"
              }
              onClick={onUpdate}
            >
              {update.status === "available"
                ? t("diagnostics.install", { version: update.offer.version })
                : t("diagnostics.check")}
            </button>
          ) : null}
        </div>
      </div>
      <div className="feature-card">
        <ShieldCheck size={24} />
        <div>
          <strong>{t("diagnostics.privateTitle")}</strong>
          <span>{t("diagnostics.privateBody")}</span>
        </div>
      </div>
      <div className="feature-card">
        <Info size={24} />
        <div>
          <strong>{t("diagnostics.disclaimerTitle")}</strong>
          <span>{t("diagnostics.disclaimerBody")}</span>
        </div>
      </div>
    </PanelShell>
  );
}
