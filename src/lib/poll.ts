import { isOnline } from "./online";

/**
 * A repeating ask that does not run while the machine has no network.
 *
 * Every surface in the workspace refreshes on a timer of its own: the radar
 * loop, the warnings, the lightning, the wind, the storm cells, the national
 * grids, the site listing, the watch. With no network each one went on asking
 * and failing on its own schedule, writing a line into the log every time and
 * stamping an error over its own last good answer. From the reader's side
 * twelve services all appeared to be down at once.
 *
 * The picture already on screen is untouched by any of this. Only the asking
 * stops, and it starts again the moment the machine says it has a network
 * rather than at the end of whatever interval was running: a laptop lid
 * closed for an hour should not open onto a two-minute wait.
 *
 * `isOnline` and not "has anything come back": whether to bother asking is
 * exactly the question the browser's own flag answers well. Whether anything
 * ACTUALLY came back is a different question, answered by `noteReached` in
 * the same module, and it is the one the reader is told about.
 */
export function pollWhileOnline(
  run: () => void,
  everyMs: number,
  /**
   * Whether to ask straight away as well as on the timer.
   *
   * True for almost everything: a surface with nothing on it wants an answer
   * now rather than in two minutes. False where the caller makes its own
   * first ask under a condition of its own, which would otherwise be asked
   * twice on every mount.
   */
  immediately = true,
): () => void {
  const attempt = () => {
    if (!isOnline()) return;
    run();
  };
  if (immediately) attempt();
  const timer = window.setInterval(attempt, everyMs);
  window.addEventListener("online", attempt);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", attempt);
  };
}
