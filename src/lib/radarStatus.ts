/**
 * What the office says about each radar, as the app words it.
 *
 * The native side asks the NWS for every station's own status and hands back
 * a code for why a site is not worth drawing. The wording lives here, beside
 * the rest of the copy, because the reason is what makes the difference
 * between a site that has quietly vanished from the picker and one the reader
 * can see is restarting.
 */

import { isDesktopRuntime } from "./settings";
import { formatAge } from "./units";
import { translate } from "../i18n";

/** Why the office's own report says a site is not worth drawing. */
export type SiteFault = "notOperating" | "noRecentData";

export interface SiteStatus {
  station: string;
  /** The RDA's own word, or null where the feed carries no report at all. */
  status: string | null;
  /** The maintenance line beside it, when there is one. */
  operability: string | null;
  /** When Level II was last received, as RFC 3339, or null. */
  levelTwoAt: string | null;
  fault: SiteFault | null;
}

/**
 * Past this, the legend says how long it has been.
 *
 * Lower than the fifteen minutes that makes a site not worth drawing, on
 * purpose: a held site is one the reader chose, so the app keeps drawing it
 * and says how old the last thing it heard is rather than deciding for them.
 */
const LATE_AFTER_MINUTES = 10;

/** The station list is a native fetch, so a browser preview has none of it. */
export function radarStatusAvailable(): boolean {
  return isDesktopRuntime();
}

export async function radarStatus(): Promise<SiteStatus[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SiteStatus[]>("radar_status");
}

/** What the office said about one site, or null when it said nothing. */
export function statusFor(
  said: readonly SiteStatus[],
  station: string | null,
): SiteStatus | null {
  if (!station) return null;
  return said.find((one) => one.station === station) ?? null;
}

/**
 * Why this site is not worth drawing, as a phrase that fits after a name.
 *
 * Null for a site with nothing wrong, and for one the feed does not report on
 * at all: not being mentioned is not a fault, and the wind profilers and the
 * odd overseas radar are never mentioned.
 */
export function faultReason(
  status: SiteStatus | null,
  now: number,
): string | null {
  if (!status?.fault) return null;
  if (status.fault === "notOperating") {
    // The maintenance line is the useful half when there is one: "restarting"
    // says more than "not operating", and it comes from the office rather
    // than from a guess here.
    return status.status
      ? translate("radar.faultNotOperating", { state: status.status })
      : translate("radar.faultOffline");
  }
  const late = minutesSinceLevelTwo(status, now);
  return late === null
    ? translate("radar.faultOffline")
    : translate("radar.faultNoRecentData", { age: formatAge(late) });
}

/** How long ago Level II was last received, in whole minutes. */
export function minutesSinceLevelTwo(
  status: SiteStatus | null,
  now: number,
): number | null {
  if (!status?.levelTwoAt) return null;
  const at = Date.parse(status.levelTwoAt);
  if (!Number.isFinite(at)) return null;
  // A clock disagreement reads as a negative age rather than a stale radar,
  // and a picture cannot be older than no time at all.
  return Math.max(0, Math.floor((now - at) / 60_000));
}

/**
 * What the legend says about a held site's silence, or null while it is
 * hearing from it.
 */
export function levelTwoLate(
  status: SiteStatus | null,
  now: number,
): string | null {
  const late = minutesSinceLevelTwo(status, now);
  if (late === null || late < LATE_AFTER_MINUTES) return null;
  return translate("chrome.levelTwoLate", { age: formatAge(late) });
}
