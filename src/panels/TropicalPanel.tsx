import { ExternalLink, Navigation, Tornado } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import type { GeoPoint } from "../lib/geo";
import { relativeTime, stormCategory, type OverlayData } from "../lib/overlays";
import { activeStorms } from "../lib/tropical";
import { useT } from "../i18n";

interface TropicalPanelProps {
  products: OverlayData;
  fetchedAt: number | null;
  error: string | null;
  layerOn: boolean;
  onEnableLayer: () => void;
  onFollow: (point: GeoPoint, name: string) => void;
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
  const t = useT();
  const storms = activeStorms(products);
  const outlooks = products.features.filter(
    (feature) => feature.properties.kind === "outlook",
  );

  return (
    <PanelShell
      eyebrow={t("tropical.eyebrow")}
      title={t("tropical.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      {!layerOn ? (
        <div className="feature-card">
          <Tornado size={24} />
          <div>
            <strong>{t("tropical.layerOffTitle")}</strong>
            <span>{t("tropical.layerOffBody")}</span>
            <button
              type="button"
              className="secondary-button"
              onClick={onEnableLayer}
            >
              {t("tropical.turnOn")}
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
                  {t("tropical.strength", {
                    category: stormCategory(storm.windKt),
                    knots: storm.windKt,
                  })}
                  {storm.pressureMb
                    ? t("tropical.pressure", { value: storm.pressureMb })
                    : ""}
                </small>
                <small>
                  {t("tropical.advisory", {
                    number: storm.advisoryNumber,
                    date: storm.advisoryDate,
                  })}
                </small>
              </div>
              <div className="storm-row__actions">
                <button
                  type="button"
                  onClick={() =>
                    onFollow({ lat: storm.lat, lon: storm.lon }, storm.name)
                  }
                >
                  <Navigation size={14} /> {t("tropical.follow")}
                </button>
                {storm.advisoryUrl ? (
                  <a
                    href={storm.advisoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("tropical.readAdvisory", {
                      name: storm.name,
                    })}
                  >
                    <ExternalLink size={14} /> {t("tropical.advisoryLink")}
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
            <strong>{t("tropical.noneTitle")}</strong>
            <span>
              {outlooks.length
                ? t("tropical.noneWithOutlook")
                : t("tropical.noneAtAll")}
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
                <strong>
                  {t("tropical.outlookTitle", {
                    basin: String(feature.properties.basin),
                  })}
                </strong>
                <small>
                  {t("tropical.twoDays", {
                    chance: String(feature.properties.prob2day),
                    risk: String(feature.properties.risk2day),
                  })}
                </small>
                <small>
                  {t("tropical.sevenDays", {
                    chance: String(feature.properties.prob7day),
                    risk: String(feature.properties.risk7day),
                  })}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <p className="source-note">
        {error
          ? t("tropical.noteError", { error })
          : fetchedAt
            ? t("tropical.noteChecked", { when: relativeTime(fetchedAt) })
            : t("tropical.noteLoading")}{" "}
        {t("tropical.noteSource")}
      </p>
    </PanelShell>
  );
}
