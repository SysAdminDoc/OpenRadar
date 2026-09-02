import {
  Check,
  CloudRain,
  Eye,
  FolderOpen,
  Gauge,
  History,
  RadioTower,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { PanelShell } from "../components/PanelShell";
import {
  LEVEL2_PRODUCTS,
  SINGLE_SITE_MIN_ZOOM,
  stationSummary,
  sweepAgeMinutes,
  type Level2ProductId,
} from "../lib/level2";
import type { SingleSiteState } from "../hooks/useSingleSiteRadar";
import type { RadarSettings, WatchState } from "../lib/settings";
import type { StormCellState } from "../hooks/useStormCells";
import {
  CLASSIFICATION_PRODUCT_KEYS,
  CLASSIFICATION_PRODUCTS,
  type ClassificationProduct,
} from "../lib/classification";
import { soonestArrival } from "../lib/cells";
import {
  TDWR_SITES,
  radarCapabilities,
  supportedProduct,
} from "../lib/radarKinds";
import { speedFromMetres, speedToMetres, speedUnit } from "../lib/units";
import { formatNumber, translate, useT } from "../i18n";

/**
 * A storm motion in the reader's own units, since it is a wind like any other.
 * The sweep carries it in metres a second, which is what the radar works in.
 */
function formatSpeed(metresPerSecond: number): string {
  return `${Math.round(speedFromMetres(metresPerSecond))} ${speedUnit()}`;
}

/**
 * How far each product's threshold can be pushed, in the product's own unit.
 *
 * The bottom of each range is off rather than a threshold: setting it to the
 * lowest reading would hide nothing and cost a redraw to say so.
 */
const THRESHOLD_RANGE: Record<
  Level2ProductId,
  { min: number; max: number; step: number; unit: "speed" | "own" }
> = {
  reflectivity: { min: 0, max: 70, step: 1, unit: "own" },
  "long-range-reflectivity": { min: 0, max: 70, step: 1, unit: "own" },
  // These three are speeds in metres a second, which is what the radar works
  // in and not what most people read in.
  velocity: { min: 0, max: 60, step: 1, unit: "speed" },
  "storm-relative-velocity": { min: 0, max: 60, step: 1, unit: "speed" },
  "spectrum-width": { min: 0, max: 15, step: 1, unit: "speed" },
  "differential-reflectivity": { min: -2, max: 6, step: 0.5, unit: "own" },
  "correlation-coefficient": { min: 0, max: 1, step: 0.01, unit: "own" },
};

interface RadarProductPanelProps {
  radar: RadarSettings;
  /** Milliseconds, ticking once a minute, for the freshness readout. */
  clock: number;
  /** Null in a browser preview, where there is no native decoder to ask. */
  singleSite: SingleSiteState | null;
  /** What the radar's own tracking algorithm is following. */
  stormCells: StormCellState;
  /** The place the reader asked to be told about. */
  watch: WatchState;
  onRadar: (radar: RadarSettings) => void;
  onClose: () => void;
}

function ageLabel(minutes: number): string {
  if (minutes < 1) return translate("radar.justIn");
  return translate("radar.minutesOld", { count: minutes });
}

function utcInputValue(now: number): string {
  return new Date(now).toISOString().slice(0, 16);
}

function utcArchiveTime(value: string): string {
  return new Date(`${value}:00Z`).toISOString();
}

function utcSweepLabel(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime())
    ? value
    : `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function RadarProductPanel({
  radar,
  clock,
  singleSite,
  stormCells,
  watch,
  onRadar,
  onClose,
}: RadarProductPanelProps) {
  const t = useT();
  const [archiveStation, setArchiveStation] = useState(
    () => radar.station ?? singleSite?.station ?? "",
  );
  const [archiveAt, setArchiveAt] = useState(() => utcInputValue(clock));
  const sweep = singleSite?.sweep ?? null;
  const productUnit =
    LEVEL2_PRODUCTS.find((product) => product.id === radar.product)?.unit ?? "";
  const threshold = radar.thresholds[radar.product] ?? null;
  // The mosaic is its own product with its own scale, so it has its own floor.
  const mosaicThreshold = radar.thresholds.mosaic ?? null;

  // What the cells mean for the reader, which is the whole point of drawing
  // them: not how many storms there are, but whether one is coming here.
  const soonest = watch.enabled
    ? soonestArrival(
        stormCells.report,
        { lon: watch.center[0], lat: watch.center[1] },
        clock,
      )
    : null;
  // The map draws rotation as a red ring, which somebody reading the panel
  // rather than the map would never see.
  const rotatingLine = stormCells.rotating.size
    ? t("cells.rotating", { id: [...stormCells.rotating].join(", ") })
    : null;
  const arrivalLine = !watch.enabled
    ? t("cells.needsWatch")
    : soonest
      ? soonest.minutes < 1
        ? t("cells.arrivingSoon", { id: soonest.cell.id })
        : t("cells.arriving", {
            id: soonest.cell.id,
            count: Math.round(soonest.minutes),
          })
      : stormCells.report?.cells.length
        ? t("cells.nothingComing")
        : t("cells.none");
  const unfoldForced = radar.product === "storm-relative-velocity";
  const range = THRESHOLD_RANGE[radar.product];
  // What the held radar can be asked for. The map being followed is a
  // WSR-88D; a terminal radar has to be named to be held.
  const capabilities = radarCapabilities(
    singleSite?.station ?? sweep?.station ?? radar.station,
  );
  // A velocity threshold is a speed, and every other speed in this panel is
  // shown in what the reader reads in. The sweep is handed metres a second
  // whatever the box says, which is what the radar works in.
  const speedProduct = range.unit === "speed";
  const toShown = (metres: number) =>
    speedProduct ? speedFromMetres(metres) : metres;
  const fromShown = (shown: number) =>
    speedProduct ? speedToMetres(shown) : shown;
  const thresholdUnit = speedProduct ? speedUnit() : productUnit;
  const shownRange = {
    min: speedProduct ? Math.round(toShown(range.min)) : range.min,
    max: speedProduct ? Math.round(toShown(range.max)) : range.max,
    step: speedProduct ? 1 : range.step,
  };
  const tilts = sweep?.tilts ?? [];
  const showHistorical = () =>
    onRadar({
      ...radar,
      enabled: true,
      singleSite: true,
      live: false,
    });
  const openLocal = async () => {
    if (await singleSite?.openLocal()) showHistorical();
  };
  const openArchive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!singleSite) return;
    const loaded = await singleSite.openArchive(
      archiveStation,
      utcArchiveTime(archiveAt),
    );
    if (loaded) showHistorical();
  };
  return (
    <PanelShell
      eyebrow={t("radar.eyebrow")}
      title={t("radar.title")}
      onClose={onClose}
      className="surface-panel--product"
    >
      <button
        type="button"
        className={`product-option${!radar.singleSite ? " is-active" : ""}`}
        aria-pressed={!radar.singleSite}
        onClick={() => onRadar({ ...radar, enabled: true, singleSite: false })}
      >
        <CloudRain size={21} />
        <span>
          <strong>{t("radar.composite")}</strong>
          <small>{t("radar.compositeDetail")}</small>
        </span>
        {!radar.singleSite ? <Check size={17} /> : null}
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
            <strong>{formatNumber(radar.animationSpeed, 1)}</strong>
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

      <label className="range-row">
        <span>
          <strong>{t("radar.thresholdMosaic")}</strong>
          <output>
            {mosaicThreshold === null
              ? t("radar.thresholdOff")
              : t("radar.thresholdValue", {
                  value: formatNumber(mosaicThreshold, 0),
                  unit: "dBZ",
                })}
          </output>
        </span>
        <input
          type="range"
          min={0}
          max={70}
          step={1}
          aria-label={t("radar.thresholdMosaic")}
          value={mosaicThreshold ?? 0}
          onChange={(event) => {
            const asked = Number(event.target.value);
            const next = { ...radar.thresholds };
            if (asked <= 0) delete next.mosaic;
            else next.mosaic = asked;
            onRadar({ ...radar, thresholds: next });
          }}
        />
      </label>
      <p className="source-note">{t("radar.thresholdMosaicDetail")}</p>

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
              <small>
                {/* Storm relative reads its wind off the sweep, and a fit
                    against a folded field collapses, so it unfolds whatever
                    this says. The control says so rather than sitting
                    unchecked over a sweep that has been unfolded anyway. */}
                {unfoldForced
                  ? t("radar.dealiasForced")
                  : t("radar.dealiasDetail")}
              </small>
            </span>
            <input
              type="checkbox"
              checked={radar.dealias || unfoldForced}
              disabled={unfoldForced}
              onChange={(event) =>
                onRadar({ ...radar, dealias: event.target.checked })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>

          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("radar.live")}</strong>
              <small>{t("radar.liveDetail")}</small>
            </span>
            <input
              type="checkbox"
              checked={radar.live && !singleSite.historical}
              disabled={!radar.singleSite || singleSite.historical}
              onChange={(event) =>
                onRadar({ ...radar, live: event.target.checked })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>

          {/* Only offered where there are two sweeps to composite. A finished
              volume has nothing behind it to fade. */}
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("radar.persistence")}</strong>
              <small>{t("radar.persistenceDetail")}</small>
            </span>
            <input
              type="checkbox"
              checked={
                radar.persistence && radar.live && !singleSite.historical
              }
              disabled={
                !radar.singleSite || !radar.live || singleSite.historical
              }
              onChange={(event) =>
                onRadar({ ...radar, persistence: event.target.checked })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>

          <section className="archive-browser" aria-labelledby="archive-title">
            <div className="archive-browser__title">
              <History size={17} aria-hidden="true" />
              <span>
                <strong id="archive-title">{t("radar.archiveBrowse")}</strong>
                <small>{t("radar.archiveBrowseDetail")}</small>
              </span>
            </div>

            {singleSite.historical ? (
              <div className="archive-current" data-historical-radar>
                <span>
                  <strong>
                    {singleSite.mode === "local"
                      ? t("radar.localArchive")
                      : t("radar.publicArchive")}
                  </strong>
                  <small>
                    {sweep
                      ? t("radar.archiveCurrent", {
                          source: sweep.source.label,
                          time: utcSweepLabel(sweep.collected),
                        })
                      : singleSite.loading
                        ? t("radar.archiveReading")
                        : (singleSite.error ?? t("radar.archiveUnavailable"))}
                  </small>
                </span>
                <button type="button" onClick={singleSite.resumeRecent}>
                  {t("radar.returnRecent")}
                </button>
              </div>
            ) : null}

            <button
              type="button"
              className="archive-open"
              disabled={singleSite.loading}
              onClick={() => void openLocal()}
            >
              <FolderOpen size={16} aria-hidden="true" />
              {t("radar.openArchive")}
            </button>

            <form
              className="archive-form"
              onSubmit={(event) => void openArchive(event)}
            >
              <label>
                <span>{t("radar.archiveStation")}</span>
                <input
                  type="text"
                  value={archiveStation}
                  required
                  minLength={4}
                  maxLength={4}
                  pattern="[A-Za-z0-9]{4}"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-label={t("radar.archiveStation")}
                  placeholder={t("radar.archiveStationPlaceholder")}
                  onChange={(event) =>
                    setArchiveStation(event.target.value.toUpperCase())
                  }
                />
              </label>
              <label>
                <span>{t("radar.archiveTime")}</span>
                <input
                  type="datetime-local"
                  value={archiveAt}
                  required
                  aria-label={t("radar.archiveTime")}
                  onChange={(event) => setArchiveAt(event.target.value)}
                />
              </label>
              <button type="submit" disabled={singleSite.loading}>
                {singleSite.loading
                  ? t("radar.archiveReading")
                  : t("radar.loadArchive")}
              </button>
            </form>
          </section>

          {radar.singleSite ? (
            <div
              className="site-controls"
              data-single-site={sweep?.station ?? ""}
            >
              <p className="source-note">
                {singleSite.error
                  ? singleSite.error
                  : sweep
                    ? singleSite.historical
                      ? t("radar.historicalSweepLine", {
                          station: sweep.station,
                          site: sweep.siteName,
                          product: sweep.product,
                          tilt: formatNumber(sweep.elevationDegrees, 2),
                          time: utcSweepLabel(sweep.collected),
                        })
                      : t("radar.sweepLine", {
                          station: sweep.station,
                          site: sweep.siteName,
                          product: sweep.product,
                          tilt: formatNumber(sweep.elevationDegrees, 2),
                          age: ageLabel(sweepAgeMinutes(sweep, clock)),
                        })
                    : singleSite.loading
                      ? t("radar.reading", {
                          station: singleSite.station ?? t("radar.nearestSite"),
                        })
                      : t("radar.zoomIn", { zoom: SINGLE_SITE_MIN_ZOOM })}
              </p>
              {/* Only for a station the reader pinned. The site the map
                  happens to be over is not theirs and does not need a badge
                  saying how far away it is. */}
              {sweep && radar.station ? (
                <p className="source-note" data-station-badge={sweep.station}>
                  {stationSummary(sweep, watch, clock)}
                </p>
              ) : null}
              {sweep?.radar === "TDWR" ? (
                <p className="source-note" data-radar-kind>
                  {t("radar.terminalLine", {
                    range: Math.round(sweep.rangeKm),
                    source: sweep.source.label,
                  })}
                </p>
              ) : null}

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
                    <option
                      key={product.id}
                      value={product.id}
                      disabled={!capabilities.products.includes(product.id)}
                    >
                      {t(product.key)}
                    </option>
                  ))}
                </select>
              </label>
              {capabilities.radar === "TDWR" ? (
                <p className="source-note" data-terminal-note>
                  {t("radar.terminalProducts")}
                </p>
              ) : null}

              <label className="range-row">
                <span>
                  <strong>{t("radar.threshold")}</strong>
                  <output>
                    {threshold === null
                      ? t("radar.thresholdOff")
                      : t("radar.thresholdValue", {
                          value: formatNumber(
                            toShown(threshold),
                            shownRange.step < 1 ? 2 : 0,
                          ),
                          unit: thresholdUnit,
                        })}
                  </output>
                </span>
                <input
                  type="range"
                  min={shownRange.min}
                  max={shownRange.max}
                  step={shownRange.step}
                  aria-label={t("radar.thresholdLabel")}
                  value={toShown(threshold ?? range.min)}
                  onChange={(event) => {
                    const asked = fromShown(Number(event.target.value));
                    // The bottom of the slider is off rather than a threshold
                    // of the lowest reading, which would hide nothing anyway
                    // and cost a redraw to say so.
                    const next = { ...radar.thresholds };
                    if (asked <= range.min) {
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
                        {formatNumber(angle, 2)}°
                      </option>
                    ))
                  ) : (
                    <option value={0}>{formatNumber(0.5, 2)}°</option>
                  )}
                </select>
              </label>

              {/* Beside the moments rather than in the layers panel, because
                  it is a product of this site like they are: which Level III
                  field the classification layer reads. */}
              <label className="select-row" data-classification-product>
                <span>{t("radar.classification")}</span>
                <select
                  value={radar.classificationProduct}
                  aria-label={t("radar.classificationLabel")}
                  onChange={(event) =>
                    onRadar({
                      ...radar,
                      classificationProduct: event.target
                        .value as ClassificationProduct,
                    })
                  }
                >
                  {CLASSIFICATION_PRODUCTS.map((product) => (
                    <option key={product} value={product}>
                      {t(CLASSIFICATION_PRODUCT_KEYS[product])}
                    </option>
                  ))}
                </select>
              </label>
              <p className="source-note">{t("radar.classificationDetail")}</p>

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
                  onChange={(event) => {
                    const station = event.target.value || null;
                    // A product the new radar does not have goes back to
                    // reflectivity, so the picker never shows a choice the
                    // map is not drawing.
                    onRadar({
                      ...radar,
                      station,
                      product: supportedProduct(station, radar.product),
                    });
                  }}
                >
                  <option value="">{t("radar.followMap")}</option>
                  {sweep && sweep.radar !== "TDWR" ? (
                    <option value={sweep.station}>
                      {t("radar.hold", { station: sweep.station })}
                    </option>
                  ) : null}
                  {/* The airports' own radars, which the nearest-site search
                      never hands over: a reader names one to hold it. */}
                  <optgroup label={t("radar.terminalRadars")}>
                    {TDWR_SITES.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.id} · {site.name}, {site.state}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </div>
          ) : null}
        </>
      ) : null}

      {stormCells.report || stormCells.loading ? (
        <div className="settings-section" data-storm-cells>
          <div className="settings-section__title">
            <span>{t("cells.eyebrow")}</span>
            <small>
              {stormCells.report
                ? t("cells.count", {
                    count: stormCells.report.cells.length,
                  })
                : t("cells.reading")}
            </small>
          </div>
          <p className="source-note" data-cell-arrival>
            {arrivalLine}
          </p>
          {rotatingLine ? (
            <p className="source-note" data-cell-rotating>
              {rotatingLine}
            </p>
          ) : null}
        </div>
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
