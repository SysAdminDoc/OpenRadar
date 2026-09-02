import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import type { GeoPoint } from "../lib/geo";
import {
  distancePosition,
  distanceTicks,
  heightPosition,
  heightTicks,
  type CrossSection,
} from "../lib/crossSection";
import { sweepErrorText } from "../lib/level2";
import { formatNumber, useT } from "../i18n";
import { formatClock, formatDistance, formatHeight } from "../lib/units";
import { useMeasurements } from "../lib/units";

/** Kilometres, in whichever units the reader is in. */
const KM_TO_MILES = 0.621371;
const KM_TO_FEET = 3280.84;

interface CrossSectionPanelProps {
  /** The two ends of the line, as the reader put them down. */
  line: { from: GeoPoint; to: GeoPoint };
  /** How to cut the volume, or null when there is no site to cut. */
  take: ((from: GeoPoint, to: GeoPoint) => Promise<CrossSection>) | null;
  onClose: () => void;
}

export function CrossSectionPanel({
  line,
  take,
  onClose,
}: CrossSectionPanelProps) {
  const t = useT();
  // The labels are written in the reader's own units, and those can change
  // while a slice is on screen.
  useMeasurements();
  // One answer, whichever it turns out to be. Nothing is set on the way in:
  // the panel is mounted fresh for each line, so "no answer yet" is simply
  // where it starts rather than something an effect has to put it into.
  const [answer, setAnswer] = useState<{
    section: CrossSection | null;
    error: string | null;
  } | null>(null);
  // A line drawn while an older one is still being cut must win, whichever
  // answer comes back last.
  const requestRef = useRef(0);
  const section = answer?.section ?? null;
  const error = answer?.error ?? null;
  const loading = Boolean(take) && answer === null;

  useEffect(() => {
    // Nothing to cut is not a failure: the panel says so below.
    if (!take) return;
    const request = ++requestRef.current;
    void take(line.from, line.to)
      .then((cut) => {
        if (request !== requestRef.current) return;
        setAnswer({ section: cut, error: null });
      })
      .catch((failure: unknown) => {
        if (request !== requestRef.current) return;
        setAnswer({ section: null, error: sweepErrorText(failure) });
      });
  }, [line, take]);

  return (
    <PanelShell
      eyebrow={t("section.eyebrow")}
      title={t("section.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      {!take ? <p className="source-note">{t("section.noSite")}</p> : null}

      {loading ? (
        <p className="source-note">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />{" "}
          {t("section.cutting")}
        </p>
      ) : null}

      {error ? <p className="source-note">{error}</p> : null}

      {section ? (
        <>
          <figure className="cross-section" data-station={section.station}>
            <div className="cross-section__plot">
              <img
                src={section.image}
                alt={t("section.imageAlt", {
                  product: section.product,
                  station: section.station,
                  distance: formatDistance(section.distanceKm * KM_TO_MILES),
                  top: formatHeight(section.topKm * KM_TO_FEET),
                })}
                width={section.width}
                height={section.height}
              />
              {heightTicks(section).map((km) => {
                const at = heightPosition(section, km);
                return at === null ? null : (
                  <span
                    key={`h${km}`}
                    className="cross-section__height"
                    style={{ bottom: `${at}%` }}
                  >
                    {formatHeight(km * KM_TO_FEET)}
                  </span>
                );
              })}
            </div>
            <div className="cross-section__axis">
              {distanceTicks(section).map((km) => {
                const at = distancePosition(section, km);
                return at === null ? null : (
                  <span key={`d${km}`} style={{ left: `${at}%` }}>
                    {formatDistance(km * KM_TO_MILES)}
                  </span>
                );
              })}
            </div>
            <figcaption>
              {t("section.caption", {
                product: section.product,
                unit: section.unit || t("section.noUnit"),
                station: section.station,
                site: section.siteName,
              })}
            </figcaption>
          </figure>

          <ul className="reading-list">
            <li>
              {t("section.collected", {
                when: formatClock(new Date(section.collected), {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </li>
            <li>
              {section.lowestCut !== null && section.highestCut !== null
                ? t("section.cuts", {
                    low: formatNumber(section.lowestCut, 2),
                    high: formatNumber(section.highestCut, 2),
                    count: section.tilts.length,
                  })
                : t("section.noCuts")}
            </li>
            <li>{t("section.gaps")}</li>
            {section.dealiased ? <li>{t("section.unfolded")}</li> : null}
            {section.paletteApplied ? <li>{t("section.palette")}</li> : null}
            <li>{section.source.label}</li>
          </ul>
        </>
      ) : null}
    </PanelShell>
  );
}
