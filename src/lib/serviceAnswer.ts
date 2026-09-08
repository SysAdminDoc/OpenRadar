import { translate } from "../i18n";
import { log } from "./log";

/**
 * What a service's answer means, in the reader's words rather than in HTTP's.
 *
 * Nine messages printed a bare status code at somebody who is trying to find
 * out whether it is going to rain: "The tide service returned 503." A number
 * out of a protocol is the code's word for what happened, and it tells a
 * reader nothing about whether to wait, to check what they typed, or to give
 * up.
 *
 * Grouped rather than enumerated, because the difference between 502 and 504
 * is not one the reader can act on: both mean wait. The number itself is
 * written to the log on the way past, so the block a reader pastes into a bug
 * report still carries it.
 */
export function serviceAnswer(status: number): string {
  log.info("service", `A service answered ${status}.`);
  if (status === 404) return translate("service.notFound");
  if (status === 429) return translate("service.tooMany");
  if (status === 401 || status === 403) return translate("service.refused");
  if (status >= 500) return translate("service.busy");
  if (status >= 400) return translate("service.refused");
  return translate("service.unexpected");
}

/**
 * What to tell a reader about a failure, whatever it turned out to be.
 *
 * `serviceAnswer` above says what a status means, and every fetch in this app
 * turns a bad status into one of the catalogue's own sentences before it
 * throws. What none of them could say is the case where there is no status at
 * all: a refused connection, a name that would not resolve, a captive portal,
 * a proxy, an aeroplane. `fetch` rejects with a `TypeError` there, and the
 * panels printed its message, which is the browser engine's own words. In
 * Chromium that is "Failed to fetch", in English, in every language the app
 * is read in, and WebView2 on another channel phrases it differently again.
 *
 * So the shape of the failure decides: a `TypeError` is the request never
 * reaching anybody, and any other `Error` is carrying a sentence this app
 * wrote and is used as it stands.
 *
 * The fallback is the panel's own words for a failure with nothing in it at
 * all, which is what a rejection from the native bridge looks like. Each
 * panel has a better sentence for that than any general one: the sounding
 * could not be read, the route could not be planned. A reached service that
 * would not answer is still described by the line above rather than by the
 * fallback, because saying why beats saying whose.
 */
export function failureSentence(failure: unknown, fallback?: string): string {
  if (failure instanceof TypeError) return translate("service.unreachable");
  if (failure instanceof Error && failure.message) return failure.message;
  return fallback ?? translate("service.failed");
}
