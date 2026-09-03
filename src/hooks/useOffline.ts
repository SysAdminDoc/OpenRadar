import { useSyncExternalStore } from "react";
import {
  offlineSince,
  offlineSinceOnServer,
  subscribeOffline,
} from "../lib/online";

/**
 * When the machine went offline, or null while it is on.
 *
 * One answer for the whole workspace. Before this only the timeline knew:
 * every overlay went on polling and failing into the log, the watch's health
 * line said its sources were failing rather than that it could not see, and
 * the only hint a reader had was "showing the last view" on the radar, which
 * says nothing about the warnings drawn over it.
 */
export function useOfflineSince(): number | null {
  return useSyncExternalStore(
    subscribeOffline,
    offlineSince,
    offlineSinceOnServer,
  );
}
