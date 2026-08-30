import { BellRing, ExternalLink } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import {
  SEVERITY_COLOR,
  boundsOverlap,
  featureBounds,
  relativeTime,
  type OverlayBounds,
  type OverlayData,
} from "../lib/overlays";
import type { AlertSeverity } from "../lib/overlays/alerts";
import { translate, useT } from "../i18n";

interface AlertsPanelProps {
  alerts: OverlayData;
  viewport: OverlayBounds | null;
  fetchedAt: number | null;
  error: string | null;
  layerOn: boolean;
  onEnableLayer: () => void;
  onSelect: (bounds: OverlayBounds) => void;
  onClose: () => void;
}

function timeLabel(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value))
    return translate("alerts.unknownTime");
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AlertsPanel({
  alerts,
  viewport,
  fetchedAt,
  error,
  layerOn,
  onEnableLayer,
  onSelect,
  onClose,
}: AlertsPanelProps) {
  const t = useT();
  const visible = alerts.features.flatMap((feature) => {
    const bounds = featureBounds(feature.geometry);
    if (!bounds) return [];
    if (viewport && !boundsOverlap(bounds, viewport)) return [];
    return [{ feature, bounds }];
  });

  return (
    <PanelShell
      eyebrow={t("alerts.eyebrow")}
      title={t("alerts.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      {!layerOn ? (
        <div className="feature-card">
          <BellRing size={24} />
          <div>
            <strong>{t("alerts.layerOffTitle")}</strong>
            <span>{t("alerts.layerOffBody")}</span>
            <button
              type="button"
              className="secondary-button"
              onClick={onEnableLayer}
            >
              {t("alerts.turnOn")}
            </button>
          </div>
        </div>
      ) : visible.length ? (
        <div className="alert-list">
          {visible.map(({ feature, bounds }, index) => {
            const severity = String(
              feature.properties.severity ?? "minor",
            ) as AlertSeverity;
            const url = String(feature.properties.url ?? "");
            return (
              <div
                className="alert-row"
                key={`${feature.properties.headline}-${index}`}
              >
                <button type="button" onClick={() => onSelect(bounds)}>
                  <i style={{ background: SEVERITY_COLOR[severity] }} />
                  <span>
                    <strong>{String(feature.properties.headline)}</strong>
                    <small>
                      {t("alerts.issued", {
                        issued: timeLabel(feature.properties.issued),
                        expires: timeLabel(feature.properties.expires),
                      })}
                    </small>
                  </span>
                </button>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("alerts.openProduct")}
                  >
                    <ExternalLink size={15} />
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="feature-card">
          <BellRing size={24} />
          <div>
            <strong>{t("alerts.noneTitle")}</strong>
            <span>{t("alerts.noneBody")}</span>
          </div>
        </div>
      )}
      <p className="source-note">
        {!layerOn
          ? t("alerts.noteOff")
          : error
            ? t("alerts.noteError", { error })
            : fetchedAt
              ? t("alerts.noteChecked", { when: relativeTime(fetchedAt) })
              : t("alerts.noteLoading")}{" "}
        {t("alerts.noteSafety")}
      </p>
    </PanelShell>
  );
}
