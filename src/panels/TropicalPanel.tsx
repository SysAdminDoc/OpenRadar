import { ExternalLink, Navigation, Tornado } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import type { GeoPoint } from "../lib/geo";
import { relativeTime, stormCategory, type OverlayData } from "../lib/overlays";
import { activeStorms } from "../lib/tropical";

interface TropicalPanelProps {
  products: OverlayData;
  fetchedAt: number | null;
  error: string | null;
  layerOn: boolean;
  onEnableLayer: () => void;
  onFollow: (point: GeoPoint) => void;
  onClose: () => void;
}

export function TropicalPanel({
  products,
  fetchedAt,
  error,
  layerOn,
  onEnableLayer,
  onFollow,
  onClose,
}: TropicalPanelProps) {
  const storms = activeStorms(products);
  const outlooks = products.features.filter(
    (feature) => feature.properties.kind === "outlook",
  );

  return (
    <PanelShell
      eyebrow="National Hurricane Center"
      title="Tropical"
      onClose={onClose}
      className="surface-panel--right"
    >
      {!layerOn ? (
        <div className="feature-card">
          <Tornado size={24} />
          <div>
            <strong>The tropical layer is switched off</strong>
            <span>Turn it back on to see cones, tracks, and outlooks.</span>
            <button
              type="button"
              className="secondary-button"
              onClick={onEnableLayer}
            >
              Turn on Tropical
            </button>
          </div>
        </div>
      ) : null}

      {storms.length ? (
        <div className="storm-list">
          {storms.map((storm) => (
            <div className="storm-row" key={storm.id}>
              <div>
                <strong>{storm.name}</strong>
                <small>
                  {stormCategory(storm.windKt)} · {storm.windKt} kt
                  {storm.pressureMb ? ` · ${storm.pressureMb} mb` : ""}
                </small>
                <small>
                  Advisory {storm.advisoryNumber} · {storm.advisoryDate}
                </small>
              </div>
              <div className="storm-row__actions">
                <button
                  type="button"
                  onClick={() => onFollow({ lat: storm.lat, lon: storm.lon })}
                >
                  <Navigation size={14} /> Follow
                </button>
                {storm.advisoryUrl ? (
                  <a
                    href={storm.advisoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Read the advisory for ${storm.name}`}
                  >
                    <ExternalLink size={14} /> Advisory
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {layerOn && !storms.length ? (
        <div className="feature-card">
          <Tornado size={24} />
          <div>
            <strong>No active tropical cyclones</strong>
            <span>
              {outlooks.length
                ? "Areas the outlook is watching are listed below."
                : "The outlook has nothing under watch either."}
            </span>
          </div>
        </div>
      ) : null}

      {outlooks.length ? (
        <div className="storm-list">
          {outlooks.map((feature, index) => (
            <div
              className="storm-row"
              key={`${feature.properties.basin}-${index}`}
            >
              <div>
                <strong>{String(feature.properties.basin)} outlook</strong>
                <small>
                  Two days {String(feature.properties.prob2day)} ·{" "}
                  {String(feature.properties.risk2day)}
                </small>
                <small>
                  Seven days {String(feature.properties.prob7day)} ·{" "}
                  {String(feature.properties.risk7day)}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <p className="source-note">
        {error
          ? `Showing the last good products. ${error}`
          : fetchedAt
            ? `NHC products, checked ${relativeTime(fetchedAt)}.`
            : "Loading NHC products."}{" "}
        Official advisories at nhc.noaa.gov are the source of record.
      </p>
    </PanelShell>
  );
}
