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
    // The RDA's own word is the useful half: it says whether a radar will be
    // back shortly or not this afternoon, and it comes from the office rather
    // than from a guess here. What it must not do is arrive untranslated in
    // the middle of a translated sentence, which is what happened while this
    // key was a bare "{state}".
    //
    // The live feed carries two words today, checked rather than assumed:
    // Operate on 199 sites and Start-Up on four. Start-Up is the one that
    // reaches here, and it gets a sentence somebody wrote. Anything else is
    // wrapped, so the office's word is still shown and still sits inside the
    // reader's own language.
    if (!status.status) return translate("radar.faultOffline");
    if (status.status.trim().toLowerCase() === "start-up") {
      return translate("radar.faultStartUp");
    }
    return translate("radar.faultNotOperating", { state: status.status });
  }
  const late = minutesSinceLevelTwo(status, now);
  return late === null
    ? translate("radar.faultOffline")
    : translate("radar.faultNoRecentData", { age: formatAge(late) });
}

/**
 * Whether the office's own report says this site has stopped.
 *
 * The picker already passes over a faulted site when it chooses one. A site
 * the reader chose by hand is different: it keeps being drawn, because the
 * last volume is still the last thing anybody knows, and until now the only
 * sign was the age on the legend. KLWX went down inside a tornado warning on
 * 2026-08-17 and the picture simply stopped moving.
 */
export function siteHasStopped(status: SiteStatus | null): boolean {
  return Boolean(status?.fault);
}

/**
 * The nearest site in reach that is still publishing, or null when none is.
 *
 * In reach order, which is nearest first, and never the one already held. A
 * site the feed says nothing about is offered: the report covers the network
 * and not the wind profilers or the odd overseas radar, and not being
 * mentioned has never been a fault here.
 */
export function nextPublishingSite(
  held: string | null,
  inReach: readonly { station: string }[],
  said: readonly SiteStatus[],
): string | null {
  for (const site of inReach) {
    if (site.station === held) continue;
    if (siteHasStopped(statusFor(said, site.station))) continue;
    return site.station;
  }
  return null;
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
