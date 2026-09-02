import { useCallback, useEffect, useState } from "react";
import { Trash2, Download } from "lucide-react";
import { useT } from "../i18n";
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
export function JournalSection({
  onSaved,
  onFailed,
}: {
  onSaved: (path: string | null) => void;
  onFailed: (why: string) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [where, setWhere] = useState<string | null>(null);

  const reload = useCallback(() => {
    void journalRows().then(setRows);
    void journalPath().then(setWhere);
  }, []);

  useEffect(reload, [reload]);

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
                    when: formatClock(Date.parse(row.observed), {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }),
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
          void clearJournal().then(reload);
        }}
      >
        <Trash2 size={16} /> {t("journal.clear")}
      </button>
    </div>
  );
}
