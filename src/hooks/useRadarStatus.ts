import { useEffect, useState } from "react";
import { log } from "../lib/log";
import {
  radarStatus,
  radarStatusAvailable,
  type SiteStatus,
} from "../lib/radarStatus";

/**
 * How often the office is asked.
 *
 * It publishes with a two-minute cache and the native side holds the answer
 * for the same two minutes, so asking faster returns the same bytes twice.
 */
const REFRESH_MS = 120_000;

/** One shared empty answer, so nothing downstream sees a new array a second. */
const NOTHING: SiteStatus[] = [];

/**
 * What the office says about every radar, while somebody is looking at one.
 *
 * Asked for only while a single site is on the map. The whole country comes
 * back in one request, so there is nothing to narrow, and a reader watching
 * the national mosaic has no use for it.
 */
export function useRadarStatus(options: {
  enabled: boolean;
  pageVisible: boolean;
}): SiteStatus[] {
  const { enabled, pageVisible } = options;
  const [said, setSaid] = useState<SiteStatus[]>(NOTHING);

  useEffect(() => {
    if (!enabled || !radarStatusAvailable()) return;
    let open = true;
    const ask = () => {
      void radarStatus()
        .then((found) => {
          if (open) setSaid(found);
        })
        .catch((failure: unknown) => {
          // A status feed that cannot be read is not a report that anything is
          // wrong with any radar. The picker loses its reasons, the
          // nearest-site choice falls back to watching the archive, and the
          // picture on the map is unaffected.
          if (!open) return;
          log.warn(
            "radar",
            failure instanceof Error
              ? failure.message
              : "The radar station list could not be read.",
          );
        });
    };
    ask();
    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const timer = window.setInterval(ask, REFRESH_MS);
    return () => {
      open = false;
      window.clearInterval(timer);
    };
  }, [enabled, pageVisible]);

  // Held rather than cleared when the reader zooms out, so coming back to a
  // site draws its status straight away; not handed out, so nothing can show
  // a report from a view that has been closed.
  return enabled ? said : NOTHING;
}
