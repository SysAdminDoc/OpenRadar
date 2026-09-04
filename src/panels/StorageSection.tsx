import { useCallback, useEffect, useRef, useState } from "react";
import { runOnce, useInFlight } from "../lib/inFlight";
import { Trash2 } from "lucide-react";
import { useT } from "../i18n";
import { formatPackBytes } from "../lib/incidentPacks";
import { log } from "../lib/log";
import { isOnline } from "../lib/online";
import {
  clearDiskCache,
  diskCacheAvailable,
  diskCacheSize,
} from "../lib/tileCache";

/** Named so a remount of this panel finds the clear that is already going. */
const CACHE_CLEAR = "cache-clear";

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
  /** The whole line to say, because what it says depends on the network. */
  onCleared: (detail: string) => void;
  onFailed: (why: string) => void;
}) {
  const t = useT();
  const available = diskCacheAvailable();
  /**
   * Undefined until the first answer, null when there was no answer.
   *
   * Not the same thing, and folding them together said "Not readable" for
   * the fraction of a second before every first read and left Clear pressable
   * over a size nobody had yet.
   */
  const [bytes, setBytes] = useState<number | null | undefined>(undefined);
  // Outside the component: closing Settings and opening it again while a
  // clear is running would otherwise show a pressable button over it.
  const working = useInFlight(CACHE_CLEAR);

  const read = useCallback(() => {
    if (!available) return;
    void diskCacheSize()
      .then((size) => setBytes(size.bytes))
      .catch(() => {
        // A size that cannot be read is not worth a failure of its own: the
        // row says so rather than showing a number nobody can trust.
        setBytes(null);
      });
  }, [available]);

  useEffect(read, [read]);

  // And again whenever a clear finishes, driven by the job ending rather
  // than by the closure that started it. Settings can be closed and reopened
  // mid-clear, and the instance that pressed the button is gone by then: its
  // read landed on a dead component, so the reopened panel sat showing the
  // size it happened to catch on the way past, over an empty cache, with
  // Clear still pressable because it never saw the zero.
  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current && !working) read();
    wasWorking.current = working;
  }, [working, read]);

  const clear = () => {
    void runOnce(CACHE_CLEAR, async () => {
      try {
        const cleared = await clearDiskCache();
        // What came back, and what a reader loses by it. The last view IS
        // this cache: with no network, clearing it is the difference between
        // opening on what they saw and opening on nothing, and a line that
        // says the map will fetch what it needs again is not true there.
        onCleared(
          isOnline()
            ? t("storage.clearedBody", {
                freed: formatPackBytes(cleared.freed),
              })
            : t("storage.clearedOffline", {
                freed: formatPackBytes(cleared.freed),
              }),
        );
      } catch (failure: unknown) {
        // The command itself returns no error, so anything landing here came
        // from the bridge: an older build with no such command, or a message
        // that would not cross. Stringifying an unknown put things like
        // [object Object] in a toast, which tells a reader nothing and
        // cannot be translated. The raw value goes to the log instead.
        if (failure instanceof Error) {
          onFailed(failure.message);
        } else {
          log.warn("storage", String(failure));
          onFailed(t("storage.clearFailedUnknown"));
        }
      }
    });
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
              {bytes === undefined
                ? t("storage.reading")
                : bytes === null
                  ? t("storage.unknown")
                  : formatPackBytes(bytes)}
            </small>
          </span>
          <button
            type="button"
            className="secondary-button storage-row__clear"
            onClick={clear}
            // Nothing to press over a size that is not there yet and none
            // over a cache that is already empty.
            disabled={working || bytes === 0 || bytes === undefined}
          >
            <Trash2 size={15} />
            {t("storage.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
