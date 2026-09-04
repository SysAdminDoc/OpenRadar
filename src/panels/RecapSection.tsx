import { useEffect, useMemo, useState } from "react";
import { runOnce, useInFlight } from "../lib/inFlight";
import { ImageDown, LoaderCircle } from "lucide-react";
import { useT } from "../i18n";
import { journalAvailable, journalRows, type JournalRow } from "../lib/journal";
import { recapCredits, recapFrom, recapLines } from "../lib/recap";
import { drawRecapCard } from "../lib/recapCard";
import { exportFileName } from "../lib/export";
import { saveFile } from "../lib/saveFile";

/** Named so a remount of this panel finds the save that is already going. */
const RECAP_SAVE = "recap-save";

/**
 * A year at your own places, from your own record, on any date you like.
 *
 * Nothing here is fetched and nothing is estimated. The figures are counted
 * off the file on the disk, the period they cover is stated rather than
 * implied, and a record that started in March says so instead of letting ten
 * months read as a year.
 *
 * There is no comparison in it, no rank, no streak and no target, because a
 * recap of somebody's own weather is a nice thing and a leaderboard made of
 * severe weather is not.
 */

/** The windows worth offering. A month, a season, a year. */
const SPANS = [30, 90, 365] as const;

export function RecapSection({
  clock,
  onSaved,
  onFailed,
}: {
  clock: number;
  onSaved: (path: string | null) => void;
  onFailed: (why: string) => void;
}) {
  const t = useT();
  // Undefined until the record has been read, so the empty sentence does not
  // render for a frame over a year somebody actually had.
  const [read, setRead] = useState<JournalRow[] | undefined>(undefined);
  const rows = useMemo(() => read ?? [], [read]);
  const [days, setDays] = useState<number>(365);
  const [withPlaces, setWithPlaces] = useState(false);
  // Drawing and encoding the card is asynchronous; the button is held shut
  // for the whole of it, and outside this component, so closing Settings and
  // opening it again mid-save does not hand the reader a second press.
  const saving = useInFlight(RECAP_SAVE);

  useEffect(() => {
    void journalRows().then(setRead);
  }, [clock]);

  const recap = useMemo(
    () => recapFrom(rows, clock - days * 86_400_000, clock),
    [rows, days, clock],
  );
  const lines = useMemo(
    () => (recap ? recapLines(recap, { places: withPlaces }) : []),
    [recap, withPlaces],
  );

  if (!journalAvailable()) return null;

  return (
    <div className="settings-section" data-recap>
      <div className="settings-section__title">
        <span>{t("recap.title")}</span>
      </div>
      <p className="source-note">{t("recap.note")}</p>

      <select
        value={String(days)}
        aria-label={t("recap.span")}
        onChange={(event) => setDays(Number(event.target.value))}
      >
        {SPANS.map((span) => (
          <option key={span} value={String(span)}>
            {span === 365
              ? t("recap.spanYear")
              : t("recap.spanDays", { days: span })}
          </option>
        ))}
      </select>

      {recap ? (
        <>
          <ul role="list" className="recap-lines">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("recap.includePlaces")}</strong>
              <small>{t("recap.includePlacesDetail")}</small>
            </span>
            <input
              type="checkbox"
              checked={withPlaces}
              onChange={(event) => setWithPlaces(event.target.checked)}
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>
          <button
            type="button"
            className="secondary-button"
            // Drawing the card and encoding it is asynchronous, and the
            // button stayed pressable through it, so a second press wrote a
            // second copy of the same name over the first.
            disabled={saving}
            onClick={() => {
              void runOnce(RECAP_SAVE, async () => {
                try {
                  const blob = await drawRecapCard({
                    title: t("recap.title"),
                    lines,
                    credits: recapCredits(recap),
                  });
                  const saved = await saveFile(
                    exportFileName("openradar-year", "png"),
                    blob,
                  );
                  onSaved(saved.path);
                } catch (failure) {
                  onFailed(
                    failure instanceof Error
                      ? failure.message
                      : t("journal.failed"),
                  );
                }
              });
            }}
          >
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ImageDown size={16} />
            )}{" "}
            {t("recap.save")}
          </button>
        </>
      ) : read === undefined ? null : (
        // Nothing rather than a card of noughts: an absence of records is not
        // an absence of weather.
        <p className="source-note">{t("recap.empty")}</p>
      )}
    </div>
  );
}
