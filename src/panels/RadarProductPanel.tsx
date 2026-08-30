import { Check, CloudRain, Eye, Gauge, RadioTower } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import {
  LEVEL2_PRODUCTS,
  SINGLE_SITE_MIN_ZOOM,
  sweepAgeMinutes,
  type Level2ProductId,
} from "../lib/level2";
import type { SingleSiteState } from "../hooks/useSingleSiteRadar";
import type { RadarSettings } from "../lib/settings";
import { speedFromMetres, speedToMetres, speedUnit } from "../lib/units";
import { translate, useT } from "../i18n";

/**
 * A storm motion in the reader's own units, since it is a wind like any other.
 * The sweep carries it in metres a second, which is what the radar works in.
 */
function formatSpeed(metresPerSecond: number): string {
  const perHour =
    speedUnit() === "mph" ? metresPerSecond * 2.23694 : metresPerSecond * 3.6;
  return `${Math.round(perHour)} ${speedUnit()}`;
}

/**
 * How far each product's threshold can be pushed, in the product's own unit.
 *
 * The bottom of each range is off rather than a threshold: setting it to the
 * lowest reading would hide nothing and cost a redraw to say so.
 */
const THRESHOLD_RANGE: Record<
  Level2ProductId,
  { min: number; max: number; step: number }
> = {
  reflectivity: { min: 0, max: 70, step: 1 },
  velocity: { min: 0, max: 60, step: 1 },
  "storm-relative-velocity": { min: 0, max: 60, step: 1 },
  "spectrum-width": { min: 0, max: 15, step: 1 },
  "differential-reflectivity": { min: -2, max: 6, step: 0.5 },
  "correlation-coefficient": { min: 0, max: 1, step: 0.01 },
};

interface RadarProductPanelProps {
  radar: RadarSettings;
  /** Milliseconds, ticking once a minute, for the freshness readout. */
  clock: number;
  /** Null in a browser preview, where there is no native decoder to ask. */
  singleSite: SingleSiteState | null;
  onRadar: (radar: RadarSettings) => void;
  onClose: () => void;
}

function ageLabel(minutes: number): string {
  if (minutes < 1) return translate("radar.justIn");
  return translate("radar.minutesOld", { count: minutes });
}

export function RadarProductPanel({
  radar,
  clock,
  singleSite,
  onRadar,
  onClose,
}: RadarProductPanelProps) {
  const t = useT();
  const sweep = singleSite?.sweep ?? null;
  const threshold = radar.thresholds[radar.product] ?? null;
  const productUnit =
    LEVEL2_PRODUCTS.find((product) => product.id === radar.product)?.unit ?? "";
  const tilts = sweep?.tilts ?? [];
  return (
    <PanelShell
      eyebrow={t("radar.eyebrow")}
      title={t("radar.title")}
      onClose={onClose}
      className="surface-panel--product"
    >
      <button
        type="button"
        className="product-option is-active"
        aria-pressed="true"
        onClick={() => onRadar({ ...radar, enabled: true })}
      >
        <CloudRain size={21} />
        <span>
          <strong>{t("radar.composite")}</strong>
          <small>{t("radar.compositeDetail")}</small>
        </span>
        <Check size={17} />
      </button>
      <div className="product-metrics">
        <div>
          <Eye size={17} />
          <span>
            <strong>{Math.round(radar.opacity * 100)}%</strong>
            <small>{t("radar.opacity")}</small>
          </span>
        </div>
        <div>
          <Gauge size={17} />
          <span>
            <strong>{radar.animationSpeed.toFixed(1)}</strong>
            <small>{t("radar.speed")}</small>
          </span>
        </div>
        <div>
          <RadioTower size={17} />
          <span>
            <strong>{t("radar.minutes", { count: radar.loopMinutes })}</strong>
            <small>{t("radar.history")}</small>
          </span>
        </div>
      </div>
      <label className="toggle-row toggle-row--plain">
        <span>
          <strong>{t("radar.show")}</strong>
          <small>{t("radar.showDetail")}</small>
        </span>
        <input
          type="checkbox"
          checked={radar.enabled}
          onChange={(event) =>
            onRadar({ ...radar, enabled: event.target.checked })
          }
        />
        <i className="toggle-track" aria-hidden="true" />
      </label>
      {singleSite ? (
        <>
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("radar.singleSite")}</strong>
              <small>
                {t("radar.singleSiteDetail", { zoom: SINGLE_SITE_MIN_ZOOM })}
              </small>
            </span>
            <input
              type="checkbox"
              checked={radar.singleSite}
              onChange={(event) =>
                onRadar({ ...radar, singleSite: event.target.checked })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>

          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("radar.dealias")}</strong>
              <small>{t("radar.dealiasDetail")}</small>
            </span>
            <input
              type="checkbox"
              checked={radar.dealias}
              onChange={(event) =>
                onRadar({ ...radar, dealias: event.target.checked })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>

          {radar.singleSite ? (
            <div
              className="site-controls"
              data-single-site={sweep?.station ?? ""}
            >
              <p className="source-note">
                {singleSite.error
                  ? singleSite.error
                  : sweep
                    ? t("radar.sweepLine", {
                        station: sweep.station,
                        site: sweep.siteName,
                        product: sweep.product,
                        tilt: sweep.elevationDegrees.toFixed(2),
                        age: ageLabel(sweepAgeMinutes(sweep, clock)),
                      })
                    : singleSite.loading
                      ? t("radar.reading", {
                          station: singleSite.station ?? t("radar.nearestSite"),
                        })
                      : t("radar.zoomIn", { zoom: SINGLE_SITE_MIN_ZOOM })}
              </p>

              <label className="select-row">
                <span>{t("radar.product")}</span>
                <select
                  value={radar.product}
                  aria-label={t("radar.productLabel")}
                  onChange={(event) =>
                    onRadar({
                      ...radar,
                      product: event.target.value as Level2ProductId,
                    })
                  }
                >
                  {LEVEL2_PRODUCTS.map((product) => (
                    <option key={product.id} value={product.id}>
                      {t(product.key)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="range-row">
                <span>
                  <strong>{t("radar.threshold")}</strong>
                  <output>
                    {threshold === null
                      ? t("radar.thresholdOff")
                      : t("radar.thresholdValue", {
                          value: threshold.toFixed(
                            THRESHOLD_RANGE[radar.product].step < 1 ? 2 : 0,
                          ),
                          unit: productUnit,
                        })}
                  </output>
                </span>
                <input
                  type="range"
                  min={THRESHOLD_RANGE[radar.product].min}
                  max={THRESHOLD_RANGE[radar.product].max}
                  step={THRESHOLD_RANGE[radar.product].step}
                  aria-label={t("radar.thresholdLabel")}
                  value={threshold ?? THRESHOLD_RANGE[radar.product].min}
                  onChange={(event) => {
                    const asked = Number(event.target.value);
                    // The bottom of the slider is off rather than a threshold
                    // of the lowest reading, which would hide nothing anyway
                    // and cost a redraw to say so.
                    const next = { ...radar.thresholds };
                    if (asked <= THRESHOLD_RANGE[radar.product].min) {
                      delete next[radar.product];
                    } else {
                      next[radar.product] = asked;
                    }
                    onRadar({ ...radar, thresholds: next });
                  }}
                />
              </label>
              <p className="source-note">
                {radar.product === "velocity" ||
                radar.product === "storm-relative-velocity"
                  ? t("radar.thresholdSpeed")
                  : t("radar.thresholdDetail")}
              </p>

              <label className="select-row">
                <span>{t("radar.tilt")}</span>
                <select
                  value={Math.min(radar.tilt, Math.max(0, tilts.length - 1))}
                  aria-label={t("radar.tiltLabel")}
                  disabled={!tilts.length}
                  onChange={(event) =>
                    onRadar({ ...radar, tilt: Number(event.target.value) })
                  }
                >
                  {tilts.length ? (
                    tilts.map((angle, index) => (
                      <option key={angle} value={index}>
                        {angle.toFixed(2)}°
                      </option>
                    ))
                  ) : (
                    <option value={0}>0.50°</option>
                  )}
                </select>
              </label>

              {radar.product === "storm-relative-velocity" ? (
                <div className="settings-section" data-storm-motion>
                  <div className="settings-section__title">
                    <span>{t("radar.stormMotion")}</span>
                    <small>
                      {radar.stormMotion
                        ? t("radar.stormMotionGiven", {
                            speed: formatSpeed(radar.stormMotion.speedMs),
                            from: Math.round(radar.stormMotion.fromDegrees),
                          })
                        : sweep?.stormMotion
                          ? t("radar.stormMotionRead", {
                              speed: formatSpeed(sweep.stormMotion.speedMs),
                              from: Math.round(sweep.stormMotion.fromDegrees),
                            })
                          : t("radar.stormMotionNone")}
                    </small>
                  </div>
                  <label className="select-row">
                    <span>
                      {t("radar.stormMotionSpeed", { unit: speedUnit() })}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={Math.round(speedFromMetres(80))}
                      step={1}
                      // The box is in the reader's own units; the sweep is
                      // always given the metres a second it works in.
                      value={Math.round(
                        speedFromMetres(
                          radar.stormMotion?.speedMs ??
                            sweep?.stormMotion?.speedMs ??
                            0,
                        ),
                      )}
                      aria-label={t("radar.stormMotionSpeed", {
                        unit: speedUnit(),
                      })}
                      onChange={(event) =>
                        onRadar({
                          ...radar,
                          stormMotion: {
                            speedMs: speedToMetres(Number(event.target.value)),
                            fromDegrees:
                              radar.stormMotion?.fromDegrees ??
                              sweep?.stormMotion?.fromDegrees ??
                              0,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="select-row">
                    <span>{t("radar.stormMotionFrom")}</span>
                    <input
                      type="number"
                      min={0}
                      max={359}
                      step={5}
                      value={Math.round(
                        radar.stormMotion?.fromDegrees ??
                          sweep?.stormMotion?.fromDegrees ??
                          0,
                      )}
                      aria-label={t("radar.stormMotionFrom")}
                      onChange={(event) =>
                        onRadar({
                          ...radar,
                          stormMotion: {
                            speedMs:
                              radar.stormMotion?.speedMs ??
                              sweep?.stormMotion?.speedMs ??
                              0,
                            fromDegrees: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  {radar.stormMotion ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onRadar({ ...radar, stormMotion: null })}
                    >
                      {t("radar.stormMotionClear")}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <label className="select-row">
                <span>{t("radar.site")}</span>
                <select
                  value={radar.station ?? ""}
                  aria-label={t("radar.siteLabel")}
                  onChange={(event) =>
                    onRadar({ ...radar, station: event.target.value || null })
                  }
                >
                  <option value="">{t("radar.followMap")}</option>
                  {sweep ? (
                    <option value={sweep.station}>
                      {t("radar.hold", { station: sweep.station })}
                    </option>
                  ) : null}
                </select>
              </label>
            </div>
          ) : null}
        </>
      ) : null}

      <label className="range-row">
        <span>
          <strong>{t("radar.opacity")}</strong>
          <output>{Math.round(radar.opacity * 100)}%</output>
        </span>
        <input
          type="range"
          min="0.05"
          max="1"
          step="0.05"
          aria-label={t("radar.opacityLabel")}
          value={radar.opacity}
          onChange={(event) =>
            onRadar({ ...radar, opacity: Number(event.target.value) })
          }
        />
      </label>
    </PanelShell>
  );
}
