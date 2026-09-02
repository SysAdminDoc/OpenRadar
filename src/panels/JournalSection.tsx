import { useCallback, useEffect, useState } from "react";
import { Trash2, Download } from "lucide-react";
import { translate, useT } from "../i18n";
import { formatClock } from "../lib/units";
import {
  clearJournal,
  journalAvailable,
  journalPath,
  journalRows,
  journalText,
  JOURNAL_MAX_MB,
  JOURNAL_RETENTION_DAYS,
  type JournalRow,
} from "../lib/journal";
import { saveFile } from "../lib/saveFile";

/**
 * The reader's own record, in plain form, with the two buttons that matter.
 *
 * This is the one file in the app that writes down where somebody lives, so
 * the panel says exactly what is in it, shows every row of it as it is on
 * disk, hands it over as itself, and deletes the whole thing in one press.
 * Nothing here is a summary or a count standing in for the content: the
 * reader looks at the file.
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

export function JournalSection({
  /** Ticks once a minute, which is how the list notices a row that arrived. */
  clock,
  onSaved,
  onFailed,
  onCleared,
}: {
  clock: number;
  onSaved: (path: string | null) => void;
  onFailed: (why: string) => void;
  onCleared: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [where, setWhere] = useState<string | null>(null);

  const reload = useCallback(() => {
    void journalRows().then(setRows);
    void journalPath().then(setWhere);
  }, []);

  // Re-read on the clock as well as on mount. A warning arriving while the
  // panel is open used to leave the list, the count and the export holding
  // the snapshot from when it opened, so what a reader took away was not the
  // whole file.
  useEffect(reload, [reload, clock]);

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
        <small>{t("journal.count", { count: rows.length })}</small>
      </div>
      <p className="source-note">
        {t("journal.note", {
          days: JOURNAL_RETENTION_DAYS,
          size: JOURNAL_MAX_MB,
        })}
      </p>
      {where ? <p className="source-note">{where}</p> : null}
      {rows.length ? (
        <ol className="journal-rows">
          {rows
            .slice()
            .reverse()
            .map((row) => (
              <li key={`${row.at}-${row.place}-${row.text}`}>
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
              </li>
            ))}
        </ol>
      ) : (
        <p className="source-note">{t("journal.empty")}</p>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={!rows.length}
        onClick={() => {
          void (async () => {
            try {
              const saved = await saveFile(
                "openradar-journal.jsonl",
                new Blob([journalText(rows)], { type: "application/x-ndjson" }),
              );
              onSaved(saved.path);
            } catch (failure) {
              onFailed(
                failure instanceof Error
                  ? failure.message
                  : t("journal.failed"),
              );
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
          void clearJournal()
            .then(() => {
              reload();
              onCleared();
            })
            .catch((failure: unknown) =>
              onFailed(
                failure instanceof Error
                  ? failure.message
                  : translate("journal.failed"),
              ),
            );
        }}
      >
        <Trash2 size={16} /> {t("journal.clear")}
      </button>
    </div>
  );
}
