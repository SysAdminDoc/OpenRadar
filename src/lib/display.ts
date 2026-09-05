import { isDesktopRuntime } from "./settings";

/**
 * Keeping the screen on while the full-screen view is showing.
 *
 * A view meant to be left on a second monitor is worth nothing if Windows
 * turns that monitor off twenty minutes in, and the page cannot stop it: the
 * Screen Wake Lock API is not implemented in WebView2, so this has to go
 * through the native side.
 *
 * Two things keep it honest. It is asked for only while the view is actually
 * showing, so a workspace nobody is looking at cannot hold somebody's screen
 * on all night. And it is off unless the reader turned it on, because taking
 * over a machine's power behaviour is not something to do by default.
 */

/** Whether this build can hold the display awake at all. */
export async function displayAwakeAvailable(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("display_awake_available");
  } catch {
    return false;
  }
}

/** Takes the hold, or gives it back. */
export async function holdDisplayAwake(hold: boolean): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("display_awake", { hold });
}

/**
 * Whether the hold should stand right now.
 *
 * All three have to be true together, and the one that matters most is the
 * last: the hold follows the view rather than the setting, so leaving the
 * full-screen view gives the screen back even with the setting still on.
 */
export function displayShouldHold(state: {
  available: boolean;
  wanted: boolean;
  showing: boolean;
}): boolean {
  return state.available && state.wanted && state.showing;
}
