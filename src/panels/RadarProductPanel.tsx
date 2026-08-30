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
import { translate, useT } from "../i18n";

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
