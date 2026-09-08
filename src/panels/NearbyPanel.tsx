import { Keyboard, LoaderCircle, TriangleAlert, Wind } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import type { NearbyCell, NearbyWarning } from "../lib/nearby";
import type { Approach } from "../lib/approach";
import { relativeTime } from "../lib/overlays";
import { formatClock, useMeasurements } from "../lib/units";
import { useT } from "../i18n";
import { MAX_NAME } from "../lib/cellNames";
import { LightningChip } from "../components/LightningChip";
import type { PlaceLightning } from "../lib/lightningWatch";

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
  /** The soonest storm heading for each watched place, soonest first. */
  approaching: Approach[];
  /** What the lightning watch counted for each watched place. */
  placeLightning: PlaceLightning[];
  /** Ticks once a minute, so the ages on the chips stay honest. */
  clock: number;
  /** What the reader calls each of them, by the algorithm's identifier. */
  cellNames: ReadonlyMap<string, string>;
  /** Naming one, or clearing the name by handing over nothing. */
  onNameCell: (id: string, name: string) => void;
  /** Why the storm list is empty, when it is empty for a reason. */
  cellsNote: "off" | "unavailable" | "loading" | "failed" | null;
  /**
   * Why the warning list cannot be read as an answer, when it cannot.
   *
   * The same shape as `cellsNote` and for the same reason. An empty list is
   * not the same statement as "nothing covers this place": the layer may be
   * off, the feed may never have arrived, or it may have failed and left the
   * last good list standing. This panel is the one surface a reader who
   * cannot see the map has, so a claim it cannot support is worse here than
   * anywhere else in the app.
   */
  alertsNote: "off" | "failed" | "loading" | null;
  /** The radar the tracker read, and when it ran, like every other surface. */
  station: string | null;
  observed: number | null;
  /** When the warnings were last fetched, which is the other half of it. */
  alertsFetchedAt: number | null;
  /**
   * What went wrong with the warnings, in the words the Alerts panel uses.
   *
   * The footer said "Loading watches and warnings" for as long as the feed
   * stayed refused, because a fetch that never succeeds never sets a fetched
   * time. The section above it had already been taught to say the warnings
   * could not be checked, and the two sat on screen together saying different
   * things about the same request.
   */
  alertsError: string | null;
  onClose: () => void;
}

/**
 * Why a section has nothing to list, said once.
 *
 * Three sections here answer the same question in the same two shapes, a
 * plain line or a line with a spinner, and each had written both out. The
 * third arrived with the warnings, which is when a shape stops being a
 * coincidence.
 */
function Note({ text, waiting }: { text: string; waiting?: boolean }) {
  if (!waiting) return <p className="nearby-empty">{text}</p>;
  return (
    <p className="panel-loading">
      <LoaderCircle className="spin" size={16} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
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
  approaching,
  placeLightning,
  clock,
  cellNames,
  onNameCell,
  cellsNote,
  alertsNote,
  station,
  observed,
  alertsFetchedAt,
  alertsError,
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

      {/* A warning in hand is read out whatever else is wrong, which is why
          the list is asked for before the note: the storm sections below put
          their note first, because a stale storm track is worth less than
          saying the tracker is off, and a warning is never worth less than
          that. The note answers only for an empty list. */}
      <section className="nearby-block">
        <h3>{t("nearby.warningsHeading")}</h3>
        {warnings.length ? (
          <ul role="list" className="nearby-list">
            {warnings.map((warning) => (
              <li key={warning.id}>
                <TriangleAlert size={14} aria-hidden="true" />
                {/* The sentence is this app's; everything under it is the
                    office's own, unaltered, on the one surface that exists
                    for a reader who cannot see the map. It is read here
                    rather than folded into the sentence, because the
                    sentence goes into a live region that is announced again
                    whenever the nearest storm moves. */}
                <span>
                  {warning.sentence}
                  {warning.area ? (
                    <small className="nearby-office">
                      {t("alerts.area", { places: warning.area })}
                    </small>
                  ) : null}
                  {warning.description ? (
                    <small className="nearby-office" data-office-text>
                      {warning.description}
                    </small>
                  ) : null}
                  {warning.instruction ? (
                    <small className="nearby-office" data-office-instruction>
                      <strong>{t("alerts.instruction")}</strong>{" "}
                      {warning.instruction}
                    </small>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Note
            waiting={alertsNote === "loading"}
            text={t(
              alertsNote === "loading"
                ? "nearby.warningsLoading"
                : alertsNote === "off"
                  ? "nearby.warningsOff"
                  : alertsNote === "failed"
                    ? "nearby.warningsFailed"
                    : "nearby.noWarnings",
            )}
          />
        )}
      </section>

      {/* Every watched place, not only the one chosen above: a reader with
          a school and a cabin wants to know which of them a storm is heading
          for, and picking each in turn to find out is the thing this panel
          exists to save them. */}
      <section className="nearby-block" data-approaching>
        <h3>{t("approach.heading")}</h3>
        {/* The same three reasons the storm list below gives, because this
            section is made of the same data: with the tracker off, or not
            answering, or not read yet, "nothing is heading for your places"
            is a claim nobody checked. */}
        {cellsNote ? (
          <Note
            waiting={cellsNote === "loading"}
            text={t(
              cellsNote === "loading"
                ? "nearby.cellsLoading"
                : cellsNote === "off"
                  ? "approach.needsCells"
                  : cellsNote === "failed"
                    ? "nearby.cellsFailed"
                    : "nearby.cellsUnavailable",
            )}
          />
        ) : approaching.length ? (
          <>
            <ul role="list" className="nearby-list">
              {approaching.map((coming) => (
                <li key={`${coming.placeId}:${coming.cellId}`}>
                  <Wind size={15} aria-hidden="true" />
                  <span>
                    {coming.minutes < 1
                      ? t("approach.rowSoon", {
                          id: coming.cellId,
                          place: coming.placeName,
                        })
                      : t("approach.row", {
                          id: coming.cellId,
                          place: coming.placeName,
                          count: Math.round(coming.minutes),
                        })}
                  </span>
                </li>
              ))}
            </ul>
            {/* Said under the list rather than in each row: it is true of all
                of them and repeating it four times is how somebody stops
                reading it. */}
            <Note text={t("approach.note")} />
          </>
        ) : (
          <Note text={t("approach.none")} />
        )}
      </section>

      {/* One line per watched place, from the same window the watch reads.
          A place with no flashes in it is left out rather than called clear:
          an empty window is a satellite file that did not arrive as often as
          it is a quiet sky. */}
      {placeLightning.some((place) => place.newest !== null) ? (
        <section className="nearby-block" data-lightning>
          <h3>{t("nearby.lightningHeading")}</h3>
          <ul role="list" className="nearby-list">
            {placeLightning
              .filter((place) => place.newest !== null)
              .map((place) => (
                <li key={place.placeId}>
                  <span>
                    <strong>{place.placeName}</strong>
                    <LightningChip lightning={place} clock={clock} />
                  </span>
                </li>
              ))}
          </ul>
          <p className="nearby-empty">{t("lightningWatch.note")}</p>
        </section>
      ) : null}

      <section className="nearby-block">
        <h3>{t("nearby.cellsHeading")}</h3>
        {cellsNote ? (
          <Note
            waiting={cellsNote === "loading"}
            text={t(
              cellsNote === "loading"
                ? "nearby.cellsLoading"
                : cellsNote === "off"
                  ? "nearby.cellsOff"
                  : cellsNote === "failed"
                    ? "nearby.cellsFailed"
                    : "nearby.cellsUnavailable",
            )}
          />
        ) : cells.length ? (
          <ul role="list" className="nearby-list">
            {cells.map((cell) => (
              <li key={cell.id}>
                <Wind size={14} aria-hidden="true" />
                <span>
                  {cell.sentence}
                  {/* A storm somebody is watching for two hours gets called
                      something. The name goes on the map beside the
                      algorithm's own identifier and follows the storm the
                      algorithm says is the same one; it is held for the
                      session and written down nowhere. */}
                  <input
                    type="text"
                    className="cell-name"
                    value={cellNames.get(cell.id) ?? ""}
                    maxLength={MAX_NAME}
                    aria-label={t("nearby.nameCell", { id: cell.id })}
                    placeholder={t("nearby.nameCellPlaceholder")}
                    onChange={(event) =>
                      onNameCell(cell.id, event.target.value)
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Note text={t("nearby.noCells")} />
        )}
      </section>

      <section className="nearby-block">
        <h3>
          <Keyboard size={14} aria-hidden="true" /> {t("nearby.keysHeading")}
        </h3>
        <p className="nearby-empty">{t("nearby.keysBody")}</p>
      </section>

      <p className="source-note">
        {alertsNote === "off"
          ? t("alerts.noteOff")
          : alertsError
            ? // "Showing the last good list" is a claim about a list, and on
              // the ordinary first failure there has never been one: a
              // question that changed and then failed leaves the idle state
              // with an error on it, so a fetched time is what says whether
              // anything is standing.
              alertsFetchedAt
              ? t("alerts.noteError", { error: alertsError })
              : t("alerts.noteFailed", { error: alertsError })
            : alertsFetchedAt
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
