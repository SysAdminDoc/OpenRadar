import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ensureLanguage, setLanguage, translate } from "./i18n";
import { loadSettings } from "./lib/settings";
import { formatClock } from "./lib/units";
import "./glance.css";

/**
 * The small window that answers "is it about to rain" without the workspace.
 *
 * A radar app that has to be brought to the front to answer that is a radar
 * app that gets closed. This is the smallest thing that answers it: the place
 * the reader named, whether a warning stands there, and one still picture of
 * the map with the time and the source under it.
 *
 * It is deliberately not the workspace in a small window. A second live map is
 * a second WebGL context and a few hundred megabytes, for a window whose whole
 * job is one glance. What it shows is a frame the workspace has already drawn
 * and put in the shared store, so this window fetches nothing, decodes
 * nothing, and cannot fall behind the app it is beside.
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

function Window() {
  const [held, setHeld] = useState<Glance | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let open = true;
    const pull = () => {
      void read().then((next) => {
        if (!open) return;
        setHeld(next);
        setNow(Date.now());
      });
    };
    pull();
    const timer = window.setInterval(pull, READ_EVERY_MS);
    return () => {
      open = false;
      window.clearInterval(timer);
    };
  }, []);

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

async function start() {
  // The reader's own language, read from the same settings the workspace
  // uses, so this window is not the one English surface in a French app.
  try {
    const settings = await loadSettings();
    await ensureLanguage(settings.language);
    setLanguage(settings.language);
    // And the reader's own theme. The stylesheet was dark whatever the
    // workspace was, so a reader on the light theme opened a small dark
    // window beside a light one. The attribute is the same one the workspace
    // sets on itself, and the dark look is what the absence of it means.
    if (settings.theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch {
    // A window that cannot read the settings still has something to say.
  }
  const host = document.getElementById("glance");
  if (!host) return;
  createRoot(host).render(
    <StrictMode>
      <Window />
    </StrictMode>,
  );
}

void start();
