import { Check, CloudRain, Eye, Gauge, RadioTower } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import {
  LEVEL2_PRODUCTS,
  SINGLE_SITE_MIN_ZOOM,
  type Level2ProductId,
} from "../lib/level2";
import type { SingleSiteState } from "../hooks/useSingleSiteRadar";
import type { RadarSettings } from "../lib/settings";

interface RadarProductPanelProps {
  radar: RadarSettings;
  /** Null in a browser preview, where there is no native decoder to ask. */
  singleSite: SingleSiteState | null;
  onRadar: (radar: RadarSettings) => void;
  onClose: () => void;
}

export function RadarProductPanel({
  radar,
  singleSite,
  onRadar,
  onClose,
}: RadarProductPanelProps) {
  const sweep = singleSite?.sweep ?? null;
  const tilts = sweep?.tilts ?? [];
  return (
    <PanelShell
      eyebrow="Radar product"
      title="Composite Radar"
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
          <strong>Composite reflectivity</strong>
          <small>Two-hour loop from the active source</small>
        </span>
        <Check size={17} />
      </button>
      <div className="product-metrics">
        <div>
          <Eye size={17} />
          <span>
            <strong>{Math.round(radar.opacity * 100)}%</strong>
            <small>Opacity</small>
          </span>
        </div>
        <div>
          <Gauge size={17} />
          <span>
            <strong>{radar.animationSpeed.toFixed(1)}</strong>
            <small>Speed</small>
          </span>
        </div>
        <div>
          <RadioTower size={17} />
          <span>
            <strong>{radar.loopMinutes} min</strong>
            <small>History</small>
          </span>
        </div>
      </div>
      <label className="toggle-row toggle-row--plain">
        <span>
          <strong>Show radar</strong>
          <small>Keep the basemap visible when radar is hidden</small>
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
              <strong>Single site up close</strong>
              <small>
                Past zoom {SINGLE_SITE_MIN_ZOOM} the nearest NEXRAD site's own
                Level II sweep replaces the national mosaic
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
                {sweep
                  ? `${sweep.station} · ${sweep.siteName} · ${sweep.product} at ${sweep.elevationDegrees.toFixed(2)}°`
                  : singleSite.loading
                    ? `Reading the latest volume from ${singleSite.station ?? "the nearest site"}.`
                    : singleSite.error
                      ? singleSite.error
                      : `Zoom past ${SINGLE_SITE_MIN_ZOOM} over the United States to bring a site in.`}
              </p>

              <label className="select-row">
                <span>Product</span>
                <select
                  value={radar.product}
                  aria-label="Level II product"
                  onChange={(event) =>
                    onRadar({
                      ...radar,
                      product: event.target.value as Level2ProductId,
                    })
                  }
                >
                  {LEVEL2_PRODUCTS.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="select-row">
                <span>Tilt</span>
                <select
                  value={Math.min(radar.tilt, Math.max(0, tilts.length - 1))}
                  aria-label="Level II tilt"
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
                <span>Site</span>
                <select
                  value={radar.station ?? ""}
                  aria-label="Radar site"
                  onChange={(event) =>
                    onRadar({ ...radar, station: event.target.value || null })
                  }
                >
                  <option value="">Follow the map</option>
                  {sweep ? (
                    <option value={sweep.station}>Hold {sweep.station}</option>
                  ) : null}
                </select>
              </label>
            </div>
          ) : null}
        </>
      ) : null}

      <label className="range-row">
        <span>
          <strong>Opacity</strong>
          <output>{Math.round(radar.opacity * 100)}%</output>
        </span>
        <input
          type="range"
          min="0.05"
          max="1"
          step="0.05"
          aria-label="Radar opacity"
          value={radar.opacity}
          onChange={(event) =>
            onRadar({ ...radar, opacity: Number(event.target.value) })
          }
        />
      </label>
    </PanelShell>
  );
}
