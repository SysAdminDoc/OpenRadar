import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import { formatNumber, useT } from "../i18n";
import { formatClock, useMeasurements } from "../lib/units";
import { sweepErrorText } from "../lib/level2";
import {
  barbParts,
  fastestMs,
  hodographPoint,
  knots,
  type VwpColumn,
  type VwpLevel,
} from "../lib/vwp";

/** How tall one level's row is, in the barb chart's own units. */
const ROW = 18;
/** How long a barb's staff is drawn. */
const STAFF = 22;

/**
 * One wind barb, pointing the way the wind comes from.
 *
 * Drawn rather than written out as a glyph because the font that has these is
 * not one this app ships, and a barb whose count is wrong is a wind speed
 * that is wrong. `barbParts` is what decides the count and it is tested on
 * its own.
 */
function Barb({ level }: { level: VwpLevel }) {
  if (level.speedMs === null || level.fromDegrees === null) return null;
  const parts = barbParts(knots(level.speedMs));
  const marks: React.ReactElement[] = [];
  let along = 0;
  const step = 4;
  for (let at = 0; at < parts.pennants; at += 1) {
    marks.push(
      <polygon
        key={`pennant-${at}`}
        points={`0,${along} 0,${along + step} 7,${along + step / 2}`}
      />,
    );
    along += step + 1.5;
  }
  for (let at = 0; at < parts.full; at += 1) {
    marks.push(
      <line key={`full-${at}`} x1={0} y1={along} x2={7} y2={along - 2.5} />,
    );
    along += 3;
  }
  if (parts.half) {
    marks.push(<line key="half" x1={0} y1={along} x2={3.5} y2={along - 1.2} />);
  }
  return (
    <g transform={`rotate(${level.fromDegrees})`}>
      <line x1={0} y1={0} x2={0} y2={-STAFF} />
      <g transform={`translate(0, ${-STAFF})`}>{marks}</g>
    </g>
  );
}

/** The wind, height by height, as a column of barbs. */
function BarbColumn({ column }: { column: VwpColumn }) {
  const t = useT();
  const height = column.levels.length * ROW + 20;
  return (
    <svg
      className="vwp-barbs"
      viewBox={`0 0 60 ${height}`}
      width={60}
      height={height}
      role="img"
      aria-label={t("vwp.columnLabel", { volume: column.volume })}
    >
      {column.levels.map((level, at) => {
        const y = height - 10 - at * ROW;
        if (level.speedMs === null) {
          return (
            <text key={level.heightKm} x={30} y={y + 3} className="vwp-nd">
              {t("vwp.noData")}
            </text>
          );
        }
        return (
          <g key={level.heightKm} transform={`translate(30, ${y})`}>
            <Barb level={level} />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The same winds as a hodograph, which is the shape a forecaster reads.
 *
 * The trace joins the levels that were measured, in height order, and skips
 * the ones that were not: a hodograph drawn straight through a gap invents
 * shear across a slab of air nobody read.
 */
function Hodograph({
  column,
  fastest,
}: {
  column: VwpColumn;
  fastest: number;
}) {
  const t = useT();
  const size = 160;
  const middle = size / 2;
  const scale = fastest > 0 ? (size / 2 - 14) / fastest : 0;
  const points = column.levels
    .map((level) => ({ level, at: hodographPoint(level) }))
    .filter((each) => each.at !== null);

  const rings = [10, 20, 30].filter((ring) => ring <= fastest + 10);
  return (
    <svg
      className="vwp-hodograph"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={t("vwp.hodographLabel")}
    >
      {rings.map((ring) => (
        <circle key={ring} cx={middle} cy={middle} r={ring * scale} />
      ))}
      <line x1={middle} y1={0} x2={middle} y2={size} className="vwp-axis" />
      <line x1={0} y1={middle} x2={size} y2={middle} className="vwp-axis" />
      <polyline
        className="vwp-trace"
        points={points
          .map(
            (each) =>
              `${middle + (each.at?.east ?? 0) * scale},${
                middle - (each.at?.north ?? 0) * scale
              }`,
          )
          .join(" ")}
      />
      {points.map((each) => (
        <circle
          key={each.level.heightKm}
          className="vwp-point"
          cx={middle + (each.at?.east ?? 0) * scale}
          cy={middle - (each.at?.north ?? 0) * scale}
          r={2}
        />
      ))}
    </svg>
  );
}

interface VwpPanelProps {
  /** The site the profile is read from, or null when none is held. */
  station: string | null;
  /**
   * Why there is no site to read, when there is not.
   *
   * A replay hands over no station on purpose, and telling that reader to
   * hold one is wrong advice under a map that plainly has one held.
   */
  quiet?: "noSite" | "historical";
  /** The volume times the loop is showing, newest last. */
  times: string[];
  /** Asks the native side, or null in a browser preview. */
  read: ((station: string, times: string[]) => Promise<VwpColumn[]>) | null;
  onClose: () => void;
}

export function VwpPanel({
  station,
  quiet = "noSite",
  times,
  read,
  onClose,
}: VwpPanelProps) {
  const t = useT();
  useMeasurements();
  const [answer, setAnswer] = useState<{
    columns: VwpColumn[];
    error: string | null;
  } | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!read || !station) return;
    // Nothing is set on the way in: the panel is mounted fresh for each
    // site and volume list, so "no answer yet" is where it starts rather
    // than something an effect has to put it into.
    const request = ++requestRef.current;
    void read(station, times)
      .then((columns) => {
        if (request !== requestRef.current) return;
        setAnswer({ columns, error: null });
      })
      .catch((failure: unknown) => {
        if (request !== requestRef.current) return;
        // The native side answers with its own `{code, args, text}`, which is
        // never an `Error`, so checking for one sent every refusal to the
        // same "not available here": a terminal radar, a time that would not
        // parse, a bucket that was down and a volume that would not decode
        // all read alike. `sweepErrorText` is what every other Level II
        // surface already puts them through.
        setAnswer({ columns: [], error: sweepErrorText(failure) });
      });
    // `times` is a new array every render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, station, times.join(",")]);

  const columns = answer?.columns ?? [];
  const fastest = fastestMs(columns);
  const heights = columns[0]?.levels ?? [];

  return (
    <PanelShell
      eyebrow={t("vwp.eyebrow")}
      title={t("vwp.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      {!read || !station ? (
        <p className="empty-copy">
          {/* Written out rather than built on a suffix: the coverage gate
              refuses a key assembled from a variable. */}
          {quiet === "historical" ? t("vwp.historical") : t("vwp.needsSite")}
        </p>
      ) : answer === null ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" size={16} />
          <span>{t("vwp.loading")}</span>
        </div>
      ) : answer.error ? (
        <div className="panel-error">
          <strong>{t("vwp.failedTitle")}</strong>
          <span>{answer.error}</span>
        </div>
      ) : columns.length === 0 ? (
        // An answer with no columns in it. The chart below would draw an
        // empty height rail and a list that owns no list items, which reads
        // as a panel that is still loading rather than one that has been
        // told there is nothing to draw.
        <p className="empty-copy">{t("vwp.nothingToDraw")}</p>
      ) : (
        <>
          <div className="vwp-chart">
            <ol className="vwp-heights" role="list">
              {[...heights].reverse().map((level) => (
                <li key={level.heightKm}>{formatNumber(level.heightKm, 1)}</li>
              ))}
            </ol>
            {columns.map((column) => (
              <div key={column.volume} className="vwp-column">
                <BarbColumn column={column} />
                <small className="vwp-volume">
                  {column.collected
                    ? formatClock(Date.parse(column.collected))
                    : column.volume}
                </small>
              </div>
            ))}
          </div>
          {columns.length ? (
            <div className="vwp-hodographs">
              {columns.map((column) => (
                <Hodograph
                  key={column.volume}
                  column={column}
                  fastest={fastest}
                />
              ))}
            </div>
          ) : null}
          <p className="source-note">{t("vwp.note")}</p>
        </>
      )}
    </PanelShell>
  );
}
