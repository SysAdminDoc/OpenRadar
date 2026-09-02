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
