import { Keyboard, LoaderCircle, TriangleAlert, Wind } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import type { NearbyCell, NearbyWarning } from "../lib/nearby";
import { relativeTime } from "../lib/overlays";
import { formatClock, useMeasurements } from "../lib/units";
import { useT } from "../i18n";

export interface NearbyPlaceOption {
  id: string;
  name: string;
}

interface NearbyPanelProps {
  places: NearbyPlaceOption[];
  placeId: string;
  onPlace: (id: string) => void;
  warnings: NearbyWarning[];
  cells: NearbyCell[];
  /** Why the storm list is empty, when it is empty for a reason. */
  cellsNote: "off" | "unavailable" | "loading" | null;
  /** The radar the tracker read, and when it ran, like every other surface. */
  station: string | null;
  observed: number | null;
  /** When the warnings were last fetched, which is the other half of it. */
  alertsFetchedAt: number | null;
  onClose: () => void;
}

/**
 * The map, answered in words.
 *
 * Everything here is also on the map. That is the point: a reader who cannot
 * see the canvas gets the same three answers from the same data rather than a
 * reduced version of the app.
 */
export function NearbyPanel({
  places,
  placeId,
  onPlace,
  warnings,
  cells,
  cellsNote,
  station,
  observed,
  alertsFetchedAt,
  onClose,
}: NearbyPanelProps) {
  const t = useT();
  // Every line in this panel is a measurement or a clock, and both are the
  // reader's own choice. Without the subscription the panel goes on saying
  // miles after the switch to kilometres, until something else redraws it.
  useMeasurements();
  return (
    <PanelShell
      eyebrow={t("nearby.eyebrow")}
      title={t("nearby.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      <p className="nearby-intro">{t("nearby.intro")}</p>

      <label className="nearby-place">
        <span>{t("nearby.place")}</span>
        <select
          value={placeId}
          onChange={(event) => onPlace(event.target.value)}
        >
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </select>
      </label>

      <section className="nearby-block">
        <h3>{t("nearby.warningsHeading")}</h3>
        {warnings.length ? (
          <ul className="nearby-list">
            {warnings.map((warning) => (
              <li key={warning.id}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{warning.sentence}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nearby-empty">{t("nearby.noWarnings")}</p>
        )}
      </section>

      <section className="nearby-block">
        <h3>{t("nearby.cellsHeading")}</h3>
        {cellsNote === "loading" ? (
          <p className="panel-loading">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>{t("nearby.cellsLoading")}</span>
          </p>
        ) : cellsNote === "off" ? (
          <p className="nearby-empty">{t("nearby.cellsOff")}</p>
        ) : cellsNote === "unavailable" ? (
          <p className="nearby-empty">{t("nearby.cellsUnavailable")}</p>
        ) : cells.length ? (
          <ul className="nearby-list">
            {cells.map((cell) => (
              <li key={cell.id}>
                <Wind size={14} aria-hidden="true" />
                <span>{cell.sentence}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nearby-empty">{t("nearby.noCells")}</p>
        )}
      </section>

      <section className="nearby-block">
        <h3>
          <Keyboard size={14} aria-hidden="true" /> {t("nearby.keysHeading")}
        </h3>
        <p className="nearby-empty">{t("nearby.keysBody")}</p>
      </section>

      <p className="source-note">
        {alertsFetchedAt
          ? t("alerts.noteChecked", { when: relativeTime(alertsFetchedAt) })
          : t("alerts.noteLoading")}{" "}
        {station && observed
          ? t("nearby.source", { station, when: formatClock(observed) })
          : ""}{" "}
        {t("alerts.noteSafety")}
      </p>
    </PanelShell>
  );
}
