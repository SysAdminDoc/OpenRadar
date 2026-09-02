import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import { formatNumber, useT } from "../i18n";
import { formatClock, formatHeight, useMeasurements } from "../lib/units";
import {
  DEFAULT_BOX,
  MIXING_RATIOS,
  PRESSURE_LINES,
  dryAdiabats,
  isotherms,
  mixingRatioLines,
  moistAdiabats,
  pathOf,
  plot,
  traceOf,
  type ChartBox,
} from "../lib/skewt";
import {
  bulkShear,
  freezingLevel,
  hodographPoints,
  liftParcel,
  precipitableWater,
} from "../lib/thermo";
import {
  forecastSounding,
  nearestSite,
  observedSounding,
  type Sounding,
} from "../lib/sounding";

/**
 * The chart's own coordinate space, in the units the SVG is drawn in.
 *
 * A viewBox rather than pixels, so the whole thing scales with the panel and
 * nothing has to be recomputed when a reader resizes the window.
 */
const BOX: ChartBox = { ...DEFAULT_BOX, width: 300, height: 380 };
const PAD = { left: 34, right: 10, top: 8, bottom: 22 };
const HODO = { size: 150, rings: [10, 20, 30, 40, 50, 60] };

type Which = "observed" | "forecast";

interface SoundingPanelProps {
  /** The middle of the map, which is what a forecast column is taken over. */
  center: [number, number];
  /** The moment on the timeline, which is what both sides are asked for. */
  at: number;
  onClose: () => void;
}

/** The background of the chart, which does not change while a reader looks. */
function Background({ box }: { box: ChartBox }) {
  const dry = useMemo(() => dryAdiabats(box), [box]);
  const moist = useMemo(() => moistAdiabats(box), [box]);
  const mixing = useMemo(() => mixingRatioLines(box), [box]);
  const temperatures = useMemo(() => isotherms(box), [box]);
  return (
    <g className="skewt-background">
      {dry.map((line, at) => (
        <path key={`dry-${at}`} className="skewt-dry" d={pathOf(line)} />
      ))}
      {moist.map((line, at) => (
        <path key={`moist-${at}`} className="skewt-moist" d={pathOf(line)} />
      ))}
      {mixing.map((line) => (
        <path
          key={`mix-${line.value}`}
          className="skewt-mixing"
          d={pathOf(line.points)}
        />
      ))}
      {temperatures.map((value) => (
        <path
          key={`iso-${value}`}
          className={value === 0 ? "skewt-iso skewt-iso--zero" : "skewt-iso"}
          d={pathOf([plot(box, value, box.bottom), plot(box, value, box.top)])}
        />
      ))}
      {PRESSURE_LINES.map((pressure) => (
        <path
          key={`p-${pressure}`}
          className="skewt-pressure"
          d={pathOf([
            { x: 0, y: plot(box, 0, pressure).y },
            { x: box.width, y: plot(box, 0, pressure).y },
          ])}
        />
      ))}
    </g>
  );
}

/** The wind, as the circle a forecaster reads shear and turning off. */
function Hodograph({ sounding }: { sounding: Sounding }) {
  const t = useT();
  const points = hodographPoints(sounding.levels, 9000);
  if (points.length < 2) return null;
  const reach = Math.max(
    30,
    ...points.map((point) => Math.hypot(point.u, point.v)),
  );
  const scale = (HODO.size / 2 - 6) / reach;
  const centre = HODO.size / 2;
  const place = (u: number, v: number) => ({
    x: centre + u * scale,
    // North is up, and the SVG's y grows downward.
    y: centre - v * scale,
  });
  const path = pathOf(points.map((point) => place(point.u, point.v)));
  return (
    <figure className="hodograph">
      <svg
        viewBox={`0 0 ${HODO.size} ${HODO.size}`}
        role="img"
        aria-label={t("sounding.hodographLabel")}
      >
        {HODO.rings
          .filter((ring) => ring <= reach + 10)
          .map((ring) => (
            <circle
              key={ring}
              className="hodograph-ring"
              cx={centre}
              cy={centre}
              r={ring * scale}
            />
          ))}
        <path
          className="hodograph-axis"
          d={`M0,${centre} L${HODO.size},${centre} M${centre},0 L${centre},${HODO.size}`}
        />
        <path className="hodograph-trace" d={path} />
        {points.slice(0, 1).map((point) => {
          const at = place(point.u, point.v);
          return (
            <circle
              key="ground"
              className="hodograph-ground"
              cx={at.x}
              cy={at.y}
              r={3}
            />
          );
        })}
      </svg>
      <figcaption>{t("sounding.hodographNote")}</figcaption>
    </figure>
  );
}

/**
 * One sounding, fetched and drawn.
 *
 * Its own component so that switching between observed and forecast mounts a
 * fresh one: "no answer yet" is then simply where it starts, rather than a
 * state an effect has to put it back into on the way past.
 */
function SoundingView({
  which,
  center,
  at,
}: {
  which: Which;
  center: [number, number];
  at: number;
}) {
  const t = useT();
  const [answer, setAnswer] = useState<{
    sounding: Sounding | null;
    error: string | null;
  } | null>(null);
  // A second request while the first is in flight must not win by finishing
  // first, which is what the map moving under an open panel would cause.
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    const load =
      which === "observed"
        ? observedSounding(center[1], center[0], at)
        : forecastSounding(center[1], center[0], at);
    void load
      .then((sounding) => {
        if (request !== requestRef.current) return;
        setAnswer({ sounding, error: null });
      })
      .catch((failure: unknown) => {
        if (request !== requestRef.current) return;
        setAnswer({
          sounding: null,
          error:
            failure instanceof Error
              ? failure.message
              : t("sounding.failedAny"),
        });
      });
  }, [at, center, t, which]);

  const sounding = answer?.sounding ?? null;
  const error = answer?.error ?? null;
  const loading = answer === null;
  const parcel = useMemo(
    () => (sounding ? liftParcel(sounding.levels) : null),
    [sounding],
  );
  const near = nearestSite(center[1], center[0]);

  return (
    <>
      {loading ? (
        <p className="source-note" role="status">
          <LoaderCircle className="spin" size={14} />{" "}
          {which === "observed"
            ? t("sounding.loadingObserved", {
                site: near ? `${near.site.name}, ${near.site.state}` : "",
              })
            : t("sounding.loadingForecast")}
        </p>
      ) : null}

      {error ? <p className="inline-error">{error}</p> : null}

      {!loading && !error && !sounding ? (
        <p className="inline-error">
          {which === "observed"
            ? t("sounding.noneObserved")
            : t("sounding.noneForecast")}
        </p>
      ) : null}

      {sounding ? (
        <>
          {/* Which of the two this is, before anything read off it. A
              forecast sounding taken for an observation is the one way this
              panel could mislead somebody. */}
          <p
            className={
              sounding.kind === "forecast"
                ? "sounding-source sounding-source--forecast"
                : "sounding-source"
            }
            data-sounding-kind={sounding.kind}
          >
            <strong>
              {sounding.kind === "forecast"
                ? t("sounding.isForecast")
                : t("sounding.isObserved")}
            </strong>
            <small>
              {t("sounding.where", {
                place: sounding.label,
                when: formatClock(new Date(sounding.valid * 1000), {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })}
            </small>
          </p>

          <figure className="skewt">
            <svg
              viewBox={`${-PAD.left} ${-PAD.top} ${BOX.width + PAD.left + PAD.right} ${BOX.height + PAD.top + PAD.bottom}`}
              role="img"
              aria-label={t("sounding.chartLabel", { place: sounding.label })}
              data-sounding-chart={sounding.kind}
            >
              <clipPath id="skewt-clip">
                <rect x={0} y={0} width={BOX.width} height={BOX.height} />
              </clipPath>
              <g clipPath="url(#skewt-clip)">
                <Background box={BOX} />
                <path
                  className="skewt-dewpoint"
                  d={pathOf(
                    traceOf(BOX, sounding.levels, (level) => level.dewpoint),
                  )}
                />
                <path
                  className="skewt-temperature"
                  d={pathOf(
                    traceOf(BOX, sounding.levels, (level) => level.temperature),
                  )}
                />
                {parcel ? (
                  <path
                    className="skewt-parcel"
                    d={pathOf(
                      parcel.levels.map((level) =>
                        plot(BOX, level.parcel, level.pressure),
                      ),
                    )}
                  />
                ) : null}
              </g>
              <rect
                className="skewt-frame"
                x={0}
                y={0}
                width={BOX.width}
                height={BOX.height}
              />
              {PRESSURE_LINES.map((pressure) => (
                <text
                  key={`label-${pressure}`}
                  className="skewt-label"
                  x={-6}
                  y={plot(BOX, 0, pressure).y + 3}
                  textAnchor="end"
                >
                  {pressure}
                </text>
              ))}
              {[-40, -20, 0, 20, 40].map((value) => (
                <text
                  key={`t-${value}`}
                  className="skewt-label"
                  x={plot(BOX, value, BOX.bottom).x}
                  y={BOX.height + 14}
                  textAnchor="middle"
                >
                  {value}
                </text>
              ))}
            </svg>
            <figcaption>{t("sounding.chartNote")}</figcaption>
          </figure>

          <Hodograph sounding={sounding} />

          <dl className="sounding-numbers">
            {parcel ? (
              <>
                <div>
                  <dt>{t("sounding.cape")}</dt>
                  <dd>{Math.round(parcel.cape)} J/kg</dd>
                </div>
                <div>
                  <dt>{t("sounding.cin")}</dt>
                  <dd>{Math.round(parcel.cin)} J/kg</dd>
                </div>
                <div>
                  <dt>{t("sounding.lcl")}</dt>
                  <dd>{Math.round(parcel.lcl.pressure)} hPa</dd>
                </div>
                <div>
                  <dt>{t("sounding.lfc")}</dt>
                  <dd>
                    {parcel.lfc === null
                      ? t("sounding.none")
                      : `${Math.round(parcel.lfc)} hPa`}
                  </dd>
                </div>
                <div>
                  <dt>{t("sounding.el")}</dt>
                  <dd>
                    {parcel.el === null
                      ? t("sounding.none")
                      : `${Math.round(parcel.el)} hPa`}
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>{t("sounding.shear6")}</dt>
              <dd>
                {(() => {
                  const shear = bulkShear(sounding.levels, 6000);
                  return shear === null
                    ? t("sounding.none")
                    : `${Math.round(shear)} kt`;
                })()}
              </dd>
            </div>
            <div>
              <dt>{t("sounding.freezing")}</dt>
              <dd>
                {(() => {
                  const at_ = freezingLevel(sounding.levels);
                  return at_ === null ? t("sounding.none") : formatHeight(at_);
                })()}
              </dd>
            </div>
            <div>
              <dt>{t("sounding.water")}</dt>
              <dd>{formatNumber(precipitableWater(sounding.levels), 1)} mm</dd>
            </div>
          </dl>

          {/* Where every number above came from, in the panel rather than in
              a document nobody opens. A CAPE with no parcel named is a number
              two programs will disagree about for no visible reason. */}
          <p className="source-note">{t("sounding.assumptions")}</p>
          <p className="source-note">
            {t("sounding.credit", { source: sounding.attribution })}{" "}
            <a href={sounding.attributionUrl} target="_blank" rel="noreferrer">
              {sounding.attributionUrl}
            </a>
          </p>
          <p className="source-note">
            {t("sounding.mixingNote", {
              values: MIXING_RATIOS.join(", "),
            })}
          </p>
        </>
      ) : null}
    </>
  );
}

export function SoundingPanel({ center, at, onClose }: SoundingPanelProps) {
  const t = useT();
  // The labels are written in the reader's own units, and those can change
  // while a chart is on screen.
  useMeasurements();
  const [which, setWhich] = useState<Which>("observed");

  return (
    <PanelShell
      eyebrow={t("sounding.eyebrow")}
      title={t("sounding.title")}
      onClose={onClose}
      className="surface-panel--right surface-panel--wide"
    >
      <div
        className="segmented-control segmented-control--full"
        aria-label={t("sounding.which")}
      >
        <button
          type="button"
          className={which === "observed" ? "is-active" : ""}
          aria-pressed={which === "observed"}
          onClick={() => setWhich("observed")}
        >
          {t("sounding.observed")}
        </button>
        <button
          type="button"
          className={which === "forecast" ? "is-active" : ""}
          aria-pressed={which === "forecast"}
          onClick={() => setWhich("forecast")}
        >
          {t("sounding.forecast")}
        </button>
      </div>
      {/* Keyed, so the other kind starts from nothing rather than showing the
          last one's chart while its own is on the way. */}
      <SoundingView key={which} which={which} center={center} at={at} />
    </PanelShell>
  );
}
