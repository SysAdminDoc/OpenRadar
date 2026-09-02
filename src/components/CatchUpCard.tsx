import { useT } from "../i18n";
import { awayFor, type CatchUp } from "../lib/catchUp";

/**
 * What the weather did at your places while the app was closed.
 *
 * A card rather than a toast: several lines, each with its own time, is not
 * something to read in the four seconds a toast lasts. It sits over the map,
 * takes one press to send away, and never comes back in that session.
 *
 * Nothing here is live. Every line is a row out of the record, written down
 * at the time by something that was watching, and it reads in the past tense
 * with its own time beside it, because a warning that reached somewhere on
 * Tuesday is not a warning now.
 */
export function CatchUpCard({
  summary,
  onDismiss,
  onOpenRecord,
}: {
  summary: CatchUp;
  onDismiss: () => void;
  onOpenRecord: () => void;
}) {
  const t = useT();
  const hidden = summary.total - summary.lines.length;

  return (
    <section className="catch-up" aria-label={t("catchUp.title")}>
      <div className="catch-up__title">
        <span>{t("catchUp.title")}</span>
        <small>
          {/* Both ends of the gap come from the summary. Reading the live
              clock here made the figure grow while the card was on screen,
              and while it was held back by a warning, so the sentence and
              the lines under it stopped agreeing. */}
          {t("catchUp.away", { away: awayFor(summary.since, summary.at) })}
        </small>
      </div>
      {summary.lines.length ? (
        <ol className="catch-up__lines">
          {summary.lines.map((line) => (
            <li key={line.id} data-catch-up-line={line.id}>
              <span>{line.text}</span>
              <small>
                {t("catchUp.line", { place: line.place, when: line.when })}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        // One line rather than an empty panel. A quiet week is an answer.
        <p className="source-note">{t("catchUp.quiet")}</p>
      )}
      {hidden > 0 ? (
        <p className="source-note">{t("catchUp.more", { count: hidden })}</p>
      ) : null}
      <div className="catch-up__actions">
        <button type="button" className="secondary-button" onClick={onDismiss}>
          {t("catchUp.dismiss")}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onOpenRecord}
        >
          {t("catchUp.open")}
        </button>
      </div>
    </section>
  );
}
