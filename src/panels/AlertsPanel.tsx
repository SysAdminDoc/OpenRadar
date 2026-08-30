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

interface AlertsPanelProps {
  alerts: OverlayData;
  viewport: OverlayBounds | null;
  fetchedAt: number | null;
  error: string | null;
  onSelect: (bounds: OverlayBounds) => void;
  onClose: () => void;
}

function timeLabel(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
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
  onSelect,
  onClose,
}: AlertsPanelProps) {
  const visible = alerts.features.flatMap((feature) => {
    const bounds = featureBounds(feature.geometry);
    if (!bounds) return [];
    if (viewport && !boundsOverlap(bounds, viewport)) return [];
    return [{ feature, bounds }];
  });

  return (
    <PanelShell
      eyebrow="Watches and warnings"
      title="Alerts"
      onClose={onClose}
      className="surface-panel--right"
    >
      {visible.length ? (
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
                      Issued {timeLabel(feature.properties.issued)} · expires{" "}
                      {timeLabel(feature.properties.expires)}
                    </small>
                  </span>
                </button>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open the official product"
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
            <strong>No active alerts in view</strong>
            <span>
              Pan the map or zoom out to check a wider area. Alerts refresh
              every minute.
            </span>
          </div>
        </div>
      )}
      <p className="source-note">
        {error
          ? `Showing the last good list. ${error}`
          : fetchedAt
            ? `NWS watches and warnings, checked ${relativeTime(fetchedAt)}.`
            : "Loading NWS watches and warnings."}{" "}
        Use official warnings for life-safety decisions.
      </p>
    </PanelShell>
  );
}
