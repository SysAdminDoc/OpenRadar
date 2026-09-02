import { BellRing, ExternalLink, LoaderCircle } from "lucide-react";
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
import { calmAdvice } from "../lib/calm";
import { safePopupUrl } from "../lib/mapPopup";
import { formatClock } from "../lib/units";

interface AlertsPanelProps {
  alerts: OverlayData;
  viewport: OverlayBounds | null;
  fetchedAt: number | null;
  error: string | null;
  layerOn: boolean;
  /** True while these came out of the archive rather than off the live feed. */
  replaying: boolean;
  onEnableLayer: () => void;
  calm: boolean;
  onSelect: (bounds: OverlayBounds) => void;
  onClose: () => void;
}

/**
 * A moment, with a year when it is not this one.
 *
 * A warning replayed out of the 2011 archive read "Apr 27, 22:00" here, which
 * is indistinguishable from this April, and that is the one way this layer
 * could do harm. Adding a year unconditionally would put one on every live
 * warning for the sake of the rare historical one, so it is added when it
 * says something.
 */
function timeLabel(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value))
    return translate("alerts.unknownTime");
  const at = new Date(value);
  const thisYear = at.getFullYear() === new Date().getFullYear();
  return formatClock(at, {
    ...(thisYear ? {} : { year: "numeric" }),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AlertsPanel({
  alerts,
  viewport,
  fetchedAt,
  error,
  layerOn,
  onEnableLayer,
  /** True in the calmer presentation, which adds a line about what to do. */
  calm,
  onSelect,
  replaying,
  onClose,
}: AlertsPanelProps) {
  const t = useT();
  const visible = alerts.features.flatMap((feature) => {
    const bounds = featureBounds(feature.geometry);
    if (!bounds) return [];
    if (viewport && !boundsOverlap(bounds, viewport)) return [];
    return [{ feature, bounds }];
  });
  const loading = layerOn && fetchedAt === null && error === null;
  // Read off the polygons where there are any, and taken from the caller
  // where there are none. Deriving it from the features alone meant a replay
  // frame that genuinely held no warning fell through to "NWS watches and
  // warnings, checked just now", which is a live claim on a picture of 2022.
  const historical =
    replaying ||
    alerts.features.some((feature) => feature.properties.historical === true);

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
        <div className="alert-list" role="list">
          {visible.map(({ feature, bounds }, index) => {
            const severity = String(
              feature.properties.severity ?? "minor",
            ) as AlertSeverity;
            // Straight out of the feed, so it goes through the same check a
            // map popup's link does: https only, no credentials in it.
            const url = safePopupUrl(String(feature.properties.url ?? ""));
            // The damage threat the office attached, when they attached one.
            // Most warnings carry none, and those read exactly as before.
            const impact = String(feature.properties.impact ?? "");
            return (
              <div
                className="alert-row"
                role="listitem"
                key={`${feature.properties.headline}-${index}`}
              >
                <button type="button" onClick={() => onSelect(bounds)}>
                  <i
                    aria-hidden="true"
                    style={{ background: SEVERITY_COLOR[severity] }}
                  />
                  <span>
                    <strong>
                      {String(feature.properties.headline)}
                      <em className="alert-severity" data-severity={severity}>
                        {t(`alerts.severity.${severity}` as never)}
                      </em>
                      {impact ? (
                        <em className="alert-tag" data-impact={impact}>
                          {t("alerts.impactBadge", {
                            tag: t(`alerts.impact.${impact}` as never),
                          })}
                        </em>
                      ) : null}
                    </strong>
                    <small>
                      {t("alerts.issued", {
                        issued: timeLabel(feature.properties.issued),
                        expires: timeLabel(feature.properties.expires),
                      })}
                    </small>
                    {calm && !feature.properties.instruction ? (
                      // The warning is unchanged: the same headline, the same
                      // severity, the same colour, at the same moment. This is
                      // a line under it saying what to do, which is what
                      // somebody frightened of the weather actually needs and
                      // what the office's own headline is not for.
                      //
                      // Only when the office gave no instruction of its own.
                      // A line this app wrote is a fallback for silence, not
                      // something to print above a forecaster's words.
                      <small className="alert-advice" data-calm-advice>
                        <strong>{t("calm.what")}</strong>{" "}
                        {/* From the office's own name for the product, not
                            from the app's hazard grouping: that grouping puts
                            a tsunami warning and an evacuation order in with
                            the tornadoes on purpose, and advice written for
                            the group told both of them to go to the lowest
                            floor. */}
                        {calmAdvice(String(feature.properties.headline ?? ""))}
                      </small>
                    ) : null}
                  </span>
                </button>
                {/* What the office wrote, OUTSIDE the button.

                    A button's accessible name is its content, so putting the
                    description and the instruction inside it made the name of
                    a control whose whole job is "take me to this warning" up
                    to two thousand characters long, read out in full with no
                    way to skip it. It belongs beside the button, not in it. */}
                {feature.properties.area ||
                feature.properties.description ||
                feature.properties.instruction ? (
                  <div className="alert-office-block">
                    {feature.properties.area ? (
                      <small className="alert-area">
                        {t("alerts.area", {
                          places: String(feature.properties.area),
                        })}
                      </small>
                    ) : null}
                    {feature.properties.description ? (
                      <small className="alert-office" data-office-text>
                        {String(feature.properties.description)}
                      </small>
                    ) : null}
                    {feature.properties.instruction ? (
                      <small className="alert-office" data-office-instruction>
                        <strong>{t("alerts.instruction")}</strong>{" "}
                        {String(feature.properties.instruction)}
                      </small>
                    ) : null}
                  </div>
                ) : null}
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
      ) : loading ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" size={22} />
          <span>{t("alerts.noteLoading")}</span>
        </div>
      ) : error ? null : (
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
            : historical
              ? t("alerts.noteArchived")
              : fetchedAt
                ? t("alerts.noteChecked", { when: relativeTime(fetchedAt) })
                : t("alerts.noteLoading")}{" "}
        {t("alerts.noteSafety")}
      </p>
    </PanelShell>
  );
}
