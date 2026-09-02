import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Download, Pencil } from "lucide-react";
import { translate, useT } from "../i18n";
import { formatClock } from "../lib/units";
import {
  clearJournal,
  filterJournal,
  journalAvailable,
  journalMarkdown,
  journalPath,
  journalRows,
  journalText,
  journalThumbData,
  journalThumbFileName,
  removeJournalRow,
  restoreJournalRows,
  setJournalNote,
  JOURNAL_FILTER,
  JOURNAL_MAX_MB,
  JOURNAL_RETENTION_DAYS,
  JOURNAL_THUMBS_MAX_MB,
  type JournalFilter,
  type JournalRow,
} from "../lib/journal";
import { saveFile } from "../lib/saveFile";
import { figureLines, figuresFrom } from "../lib/figures";

/**
 * The reader's own record, in plain form, with the buttons that matter.
 *
 * This is the one file in the app that writes down where somebody lives, so
 * the panel says exactly what is in it, shows every row of it as it is on
 * disk, hands it over as itself, and deletes it in one press, whole or a row
 * at a time. Nothing here is a summary or a count standing in for the content:
 * the reader looks at the file.
 *
 * A row is the app's account of what the weather did. The note on it is the
 * reader's, and it is the only part of this the app never writes.
 */

/** A row's own time, or a plain word when the row cannot say. */
function observedLabel(observed: string): string {
  const at = Date.parse(observed);
  if (!Number.isFinite(at)) return translate("journal.undated");
  return formatClock(at, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** How far back the reader can narrow to, in days. Zero is everything kept. */
const SPANS = [0, 7, 30, 365] as const;

export function JournalSection({
  /** Ticks once a minute, which is how the list notices a row that arrived. */
  clock,
  /** False when the reader has stopped the record being written to. */
  writing,
  onWriting,
  onSaved,
  onFailed,
  onCleared,
  onRemoved,
}: {
  clock: number;
  writing: boolean;
  onWriting: (on: boolean) => void;
  onSaved: (path: string | null) => void;
  onFailed: (why: string) => void;
  /**
   * The record was deleted, and here is how to put it back.
   *
   * Deleting is one press with no dialog, which the project asks for, and
   * that only works if the press is reversible. The rows are handed over
   * rather than a flag, because putting them back is the whole undo.
   */
  onCleared: (undo: () => void) => void;
  /** One row was deleted, and here is how to put that one back. */
  onRemoved: (undo: () => void) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [where, setWhere] = useState<string | null>(null);
  const [filter, setFilter] = useState<JournalFilter>(JOURNAL_FILTER);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );

  const reload = useCallback(() => {
    void journalRows().then(setRows);
    void journalPath().then(setWhere);
  }, []);

  // Re-read on the clock as well as on mount. A warning arriving while the
  // panel is open used to leave the list, the count and the export holding
  // the snapshot from when it opened, so what a reader took away was not the
  // whole file.
  useEffect(reload, [reload, clock]);

  const shown = useMemo(
    () => filterJournal(rows, filter, clock),
    [rows, filter, clock],
  );

  // Counted off the whole record rather than off what a filter has left, so
  // narrowing the list to look at one place does not silently change what
  // the figures say.
  const figures = useMemo(() => figuresFrom(rows), [rows]);

  // One object URL per picture, asked for once and let go when the panel
  // closes. A picture the budget has taken back simply does not appear; the
  // row it belonged to is still the record and still reads.
  //
  // The set of rows this runs over changes on every clock tick and on every
  // keystroke in the search box, so "asked for once" has to mean once ever
  // rather than once per pass. An earlier version marked a pending read with
  // an empty string, which is falsy, so the guard let every pass ask again;
  // it also cancelled the whole batch on each pass, and somebody typing
  // faster than a round trip saw no pictures at all.
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const heldRef = useRef<Record<string, string>>({});
  const askedRef = useRef(new Set<string>());
  const openRef = useRef(true);
  useEffect(
    () => () => {
      openRef.current = false;
    },
    [],
  );
  useEffect(() => {
    for (const row of shown) {
      if (!row.thumb || askedRef.current.has(row.id)) continue;
      askedRef.current.add(row.id);
      void journalThumbData(row.thumb).then((bytes) => {
        if (!openRef.current || !bytes) return;
        const url = URL.createObjectURL(
          new Blob([bytes as BlobPart], { type: "image/png" }),
        );
        heldRef.current[row.id] = url;
        setPictures((held) => ({ ...held, [row.id]: url }));
      });
    }
  }, [shown]);
  useEffect(() => {
    const held = heldRef.current;
    return () => {
      for (const url of Object.values(held)) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, []);

  const failed = useCallback(
    (failure: unknown) =>
      onFailed(
        failure instanceof Error
          ? failure.message
          : translate("journal.failed"),
      ),
    [onFailed],
  );

  if (!journalAvailable()) {
    return (
      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("journal.title")}</span>
        </div>
        <p className="source-note">{t("journal.desktopOnly")}</p>
      </div>
    );
  }

  return (
    <div className="settings-section" data-journal>
      <div className="settings-section__title">
        <span>{t("journal.title")}</span>
        <small>
          {/* What is on screen when a filter is on, and the whole file when
              it is not. A count of the file above a list of six rows is two
              numbers that disagree in front of somebody. */}
          {shown.length === rows.length
            ? t("journal.count", { count: rows.length })
            : t("journal.countShown", {
                shown: shown.length,
                count: rows.length,
              })}
        </small>
      </div>
      <p className="source-note">
        {t("journal.note", {
          days: JOURNAL_RETENTION_DAYS,
          size: JOURNAL_MAX_MB,
          pictures: JOURNAL_THUMBS_MAX_MB,
        })}
      </p>
      {where ? <p className="source-note">{where}</p> : null}

      <label className="toggle-row toggle-row--plain">
        <span>
          <strong>{t("settings.journalWriting")}</strong>
          <small>{t("settings.journalWritingDetail")}</small>
        </span>
        <input
          type="checkbox"
          checked={writing}
          onChange={(event) => onWriting(event.target.checked)}
        />
        <i className="toggle-track" aria-hidden="true" />
      </label>

      <div className="settings-section__title">
        <span>{t("figures.title")}</span>
      </div>
      <p className="source-note">{t("figures.note")}</p>
      {figures ? (
        <>
          {/* The figures can come to nothing at all: a record with rows but
              nothing worth summarising yet. See the note beside the watched
              places. */}
          <ul
            role={figureLines(figures).length ? "list" : undefined}
            className="recap-lines"
            data-journal-figures
          >
            {figureLines(figures).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {/* Switching the record off stops new rows; it does not delete the
              ones already there, and the list, the export and the year card
              all still show them. Saying "nothing to count" over the top of
              a list of rows was two things on one screen disagreeing. */}
          {writing ? null : (
            <p className="source-note">{t("figures.paused")}</p>
          )}
        </>
      ) : (
        // Nothing counted rather than a row of noughts: an absence of records
        // is not an absence of weather.
        <p className="source-note">
          {writing ? t("journal.empty") : t("figures.off")}
        </p>
      )}

      {rows.length ? (
        <div className="journal-filter">
          <input
            type="search"
            value={filter.query}
            aria-label={t("journal.search")}
            placeholder={t("journal.search")}
            onChange={(event) =>
              setFilter((held) => ({ ...held, query: event.target.value }))
            }
          />
          <select
            value={filter.kind}
            aria-label={t("journal.kind")}
            onChange={(event) =>
              setFilter((held) => ({ ...held, kind: event.target.value }))
            }
          >
            <option value="">{t("journal.kindAny")}</option>
            <option value="alert">{t("journal.kindAlert")}</option>
            <option value="observation">{t("journal.kindObservation")}</option>
          </select>
          <select
            value={String(filter.days)}
            aria-label={t("journal.since")}
            onChange={(event) =>
              setFilter((held) => ({
                ...held,
                days: Number(event.target.value),
              }))
            }
          >
            {SPANS.map((days) => (
              <option key={days} value={String(days)}>
                {days === 0
                  ? t("journal.sinceAny")
                  : t("journal.sinceDays", { days })}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {shown.length ? (
        <ol role="list" className="journal-rows">
          {shown
            .slice()
            .reverse()
            .map((row) => (
              <li key={row.id} data-journal-row={row.id}>
                {pictures[row.id] ? (
                  <img
                    className="journal-thumb"
                    src={pictures[row.id]}
                    alt={t("journal.picture", { text: row.text })}
                  />
                ) : null}
                <strong>{row.place}</strong>
                <span>{row.text}</span>
                <small>
                  {t("journal.row", {
                    source: row.source,
                    // A hand-edited line can carry a time that is not one, and
                    // `Intl` throws on an invalid date rather than returning
                    // something. One bad row used to take the whole panel down,
                    // which is the opposite of keeping the good rows.
                    when: observedLabel(row.observed),
                    obtained: row.obtained,
                  })}
                </small>
                {editing?.id === row.id ? (
                  <div className="journal-note-edit">
                    <textarea
                      value={editing.text}
                      aria-label={t("journal.noteLabel")}
                      placeholder={t("journal.notePlaceholder")}
                      rows={3}
                      autoFocus
                      onChange={(event) =>
                        setEditing({ id: row.id, text: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        const text = editing.text;
                        setEditing(null);
                        void setJournalNote(row.id, text)
                          .then(reload)
                          .catch(failed);
                      }}
                    >
                      {t("journal.noteSave")}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setEditing(null)}
                    >
                      {t("journal.noteDiscard")}
                    </button>
                  </div>
                ) : (
                  <>
                    {row.note ? (
                      <p className="journal-note">{row.note}</p>
                    ) : null}
                    <div className="journal-row-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setEditing({ id: row.id, text: row.note })
                        }
                      >
                        <Pencil size={14} />{" "}
                        {row.note
                          ? t("journal.noteEdit")
                          : t("journal.noteAdd")}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        aria-label={t("journal.removeRow")}
                        onClick={() => {
                          void removeJournalRow(row.id)
                            .then(() => {
                              reload();
                              onRemoved(() => {
                                void restoreJournalRows([row])
                                  .then(reload)
                                  .catch(failed);
                              });
                            })
                            .catch(failed);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
        </ol>
      ) : (
        <p className="source-note">
          {rows.length ? t("journal.noneMatch") : t("journal.empty")}
        </p>
      )}

      <button
        type="button"
        className="secondary-button"
        disabled={!rows.length}
        onClick={() => {
          void (async () => {
            try {
              // Files, plural, and readable ones. The record as it is on disk,
              // the same thing written for a person, and every picture beside
              // them under the name the text refers to. A single blob would
              // be smaller and would need this app to open it.
              const saved = await saveFile(
                "openradar-journal.jsonl",
                new Blob([journalText(rows)], { type: "application/x-ndjson" }),
              );
              await saveFile(
                "openradar-journal.md",
                new Blob([journalMarkdown(rows, t("journal.exportHeading"))], {
                  type: "text/markdown",
                }),
              );
              for (const row of rows) {
                if (!row.thumb) continue;
                const bytes = await journalThumbData(row.thumb);
                if (!bytes) continue;
                await saveFile(
                  journalThumbFileName(row),
                  new Blob([bytes as BlobPart], { type: "image/png" }),
                );
              }
              // One toast, naming the folder the whole set landed in. A
              // message per file during an export of a year is not feedback.
              onSaved(saved.path);
            } catch (failure) {
              failed(failure);
            }
          })();
        }}
      >
        <Download size={16} /> {t("journal.export")}
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={!rows.length}
        onClick={() => {
          // No dialog, per the project's own rule, but an acknowledgement:
          // the most destructive control in the app said nothing at all.
          const held = rows;
          void clearJournal()
            .then(() => {
              reload();
              onCleared(() => {
                void restoreJournalRows(held).then(reload).catch(failed);
              });
            })
            .catch(failed);
        }}
      >
        <Trash2 size={16} /> {t("journal.clear")}
      </button>
    </div>
  );
}
