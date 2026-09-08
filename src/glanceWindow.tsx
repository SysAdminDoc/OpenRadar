import { useEffect, useState } from "react";
import { translate } from "./i18n";
import { formatClock } from "./lib/units";
import { useLatestReply } from "./hooks/useLatestReply";

/**
 * The glance window itself, in a file of its own.
 *
 * It was declared beside the mount and never exported, which is the one shape
 * the refresh rule refuses: a component in a file with nothing exported cannot
 * be swapped without reloading the page. The warning it printed was the only
 * thing `npm run lint` ever said, and a gate that always says one thing is a
 * gate whose second thing goes unnoticed.
 */
interface Glance {
  /** The reader's own word for the place, or empty. */
  place: string;
  /** Whether a warning stands there. */
  warning: boolean;
  /** The headline, when there is one. */
  headline: string;
  /** A still of the map as a data URL, or empty. */
  picture: string;
  /** When the frame it shows was observed, in milliseconds. */
  observedMs: number | null;
  /** Who it came from. */
  source: string;
  /** When the workspace last wrote this. */
  at: number;
}

/** How often to re-read. The workspace writes on its own clock. */
const READ_EVERY_MS = 20_000;

async function read(): Promise<Glance | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const held = await invoke<Glance | null>("glance_read");
    return held;
  } catch {
    return null;
  }
}

export function Window() {
  const [held, setHeld] = useState<Glance | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const latest = useLatestReply();
  useEffect(() => {
    const reply = latest();
    const pull = () => {
      void read().then((next) => {
        if (!reply.current()) return;
        setHeld(next);
        setNow(Date.now());
      });
    };
    pull();
    const timer = window.setInterval(pull, READ_EVERY_MS);
    return () => {
      reply.close();
      window.clearInterval(timer);
    };
  }, [latest]);

  if (!held) {
    return (
      <main className="glance glance--empty">
        <p>{translate("glance.waiting")}</p>
      </main>
    );
  }

  const minutes =
    held.observedMs === null
      ? null
      : Math.max(0, Math.round((now - held.observedMs) / 60_000));

  return (
    <main className="glance" data-warning={held.warning ? "1" : undefined}>
      {held.picture ? (
        <img src={held.picture} alt={translate("glance.picture")} />
      ) : null}
      <div className="glance__words">
        <strong>{held.place || translate("watch.home")}</strong>
        {/* The one thing this window exists to say. */}
        <span>
          {held.warning
            ? held.headline || translate("glance.warning")
            : translate("glance.quiet")}
        </span>
        <small>
          {minutes === null
            ? held.source
            : translate("ambientScreen.age", {
                source: held.source,
                minutes,
              })}
        </small>
        <small>
          {translate("glance.updated", {
            when: formatClock(held.at, { hour: "numeric", minute: "2-digit" }),
          })}
        </small>
      </div>
    </main>
  );
}
