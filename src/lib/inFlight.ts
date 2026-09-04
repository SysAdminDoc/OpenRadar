import { useSyncExternalStore } from "react";

/**
 * Jobs that are running right now, by name.
 *
 * The state lives here rather than in a component because the panels that
 * start these jobs are mounted only while their surface is open. Settings can
 * be closed and reopened during a long export, and that remount reset a
 * component's own `exporting` flag: the button came back pressable and a
 * second run started over the top of the first, writing the same filenames
 * concurrently. Nothing about "is this export still going" belongs to a piece
 * of the screen that can go away while it is.
 */
const running = new Set<string>();
const watchers = new Set<() => void>();

function changed(): void {
  for (const watch of [...watchers]) watch();
}

function subscribe(watch: () => void): () => void {
  watchers.add(watch);
  return () => {
    watchers.delete(watch);
  };
}

/** Whether a job by this name is going, readable outside a component. */
export function inFlight(job: string): boolean {
  return running.has(job);
}

/**
 * Runs `work` unless a job by that name is already going, in which case this
 * does nothing at all. Resolves to whether it ran.
 */
export async function runOnce(
  job: string,
  work: () => Promise<void>,
): Promise<boolean> {
  if (running.has(job)) return false;
  running.add(job);
  changed();
  try {
    await work();
  } finally {
    running.delete(job);
    changed();
  }
  return true;
}

/** Re-renders when the named job starts or finishes, remount included. */
export function useInFlight(job: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => running.has(job),
    () => false,
  );
}

/** Test seam: nothing in the app clears a job it did not start. */
export function forgetInFlight(): void {
  running.clear();
  changed();
}
