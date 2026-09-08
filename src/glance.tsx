import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ensureLanguage, setLanguage } from "./i18n";
import { loadSettings } from "./lib/settings";
import { Window } from "./glanceWindow";
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
