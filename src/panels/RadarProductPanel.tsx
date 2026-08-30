import { Check, CloudRain, Eye, Gauge, RadioTower } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import type { RadarSettings } from "../lib/settings";

interface RadarProductPanelProps {
  radar: RadarSettings;
  onRadar: (radar: RadarSettings) => void;
  onClose: () => void;
}

export function RadarProductPanel({
  radar,
  onRadar,
  onClose,
}: RadarProductPanelProps) {
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
          <small>Universal Blue, two-hour loop</small>
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
          value={radar.opacity}
          onChange={(event) =>
            onRadar({ ...radar, opacity: Number(event.target.value) })
          }
        />
      </label>
    </PanelShell>
  );
}
