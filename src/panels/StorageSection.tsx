import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "../i18n";
import { formatPackBytes } from "../lib/incidentPacks";
import {
  clearDiskCache,
  diskCacheAvailable,
  diskCacheSize,
} from "../lib/tileCache";

/**
 * What the app is holding on disk, and a way to give it back.
 *
 * The cache fills itself as somebody uses the map and evicts on its own
 * budget, which is right and invisible. What was missing is a remedy: a
 * reader whose last view had gone stale, or who simply wanted the space, had
 * to find the directory by hand. The size was in Diagnostics and nowhere a
 * reader would look for it.
 *
 * Incident packs and replay bundles are not this. They are downloads somebody
 * asked for, they have their own limit and their own delete, and this button
 * never touches them; the note says so, because a Clear button beside a list
 * of downloads has to say what it will not take.
 */
export function StorageSection({
  onCleared,
  onFailed,
}: {
  onCleared: (freed: string) => void;
  onFailed: (why: string) => void;
}) {
  const t = useT();
  const available = diskCacheAvailable();
  const [bytes, setBytes] = useState<number | null>(null);
  const [working, setWorking] = useState(false);

  const read = useCallback(() => {
    if (!available) return;
    void diskCacheSize()
      .then((size) => setBytes(size.bytes))
      .catch(() => {
        // A size that cannot be read is not worth a failure of its own: the
        // row says nothing rather than a number nobody can trust.
        setBytes(null);
      });
  }, [available]);

  useEffect(read, [read]);

  const clear = () => {
    setWorking(true);
    void clearDiskCache()
      .then((freed) => {
        onCleared(formatPackBytes(freed.bytes));
        // Read back rather than assumed to be zero: a write that failed left
        // its entry behind, and the row should say so.
        read();
      })
      .catch((failure: unknown) => {
        onFailed(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => setWorking(false));
  };

  return (
    <div className="settings-section" data-storage>
      <div className="settings-section__title">
        <span>{t("storage.title")}</span>
        <small>{t("storage.format")}</small>
      </div>
      <p className="source-note">{t("storage.detail")}</p>

      {!available ? (
        <p className="empty-copy">{t("storage.desktopOnly")}</p>
      ) : (
        <div className="storage-row">
          <span>
            <strong>{t("storage.held")}</strong>
            <small data-storage-size>
              {bytes === null ? t("storage.unknown") : formatPackBytes(bytes)}
            </small>
          </span>
          <button
            type="button"
            className="secondary-button storage-row__clear"
            onClick={clear}
            disabled={working || bytes === 0}
          >
            <Trash2 size={15} />
            {t("storage.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
