import { useEffect, useRef } from "react";
import { translate } from "../i18n";
import type { StringKey } from "../i18n";

/**
 * Says out loud what the workspace only showed.
 *
 * Three states used to be visible and nothing else: a layer that stopped
 * drawing left a note in the Layers panel and a line in the log, going
 * offline greyed a chip in the top bar, and a stalled loop wrote its reason
 * into the timeline. A reader who cannot see any of that heard nothing at
 * all unless they happened to have the right panel open and re-read it.
 *
 * Each is announced on the way in and on the way out, once per transition
 * rather than once per poll: the overlays re-fetch on a timer, so anything
 * keyed on the state rather than on the change would have said the same
 * sentence every few minutes for as long as the failure lasted.
 */
export function useStateNotices(options: {
  /** Whether the machine is offline, from the one place that knows. */
  offline: boolean;
  /** The layers whose last fetch failed, each carrying its own name key. */
  failing: Array<{ id: string; nameKey: StringKey }>;
  /** Whatever the timeline is saying went wrong, or null. */
  timelineError: string | null;
  push: (message: { title: string; detail?: string }) => void;
}): void {
  const { offline, failing, timelineError, push } = options;

  // The push function is rebuilt on some renders; announcing is keyed on the
  // state changing, never on the callback changing.
  const pushRef = useRef(push);
  useEffect(() => {
    pushRef.current = push;
  }, [push]);

  const wasOffline = useRef(offline);
  useEffect(() => {
    if (offline === wasOffline.current) return;
    wasOffline.current = offline;
    pushRef.current({
      title: translate(offline ? "notice.offline" : "notice.online"),
      detail: translate(offline ? "notice.offlineBody" : "notice.onlineBody"),
    });
  }, [offline]);

  // Joined rather than compared as arrays, because the array itself is new on
  // every render and only its contents mean anything.
  const failingKey = failing
    .map((layer) => layer.id)
    .sort()
    .join(",");
  // The last set that carried names, so a layer that has just recovered can
  // still be named after it has gone from the failing list.
  const known = useRef(failing);
  useEffect(() => {
    known.current = [
      ...failing,
      ...known.current.filter(
        (held) => !failing.some((layer) => layer.id === held.id),
      ),
    ];
  }, [failing]);

  const wasFailing = useRef(failingKey);
  useEffect(() => {
    const before = wasFailing.current;
    if (failingKey === before) return;
    wasFailing.current = failingKey;
    const now = failingKey ? failingKey.split(",") : [];
    const then = before ? before.split(",") : [];
    // Only what changed, so a second layer failing does not re-announce the
    // first, and one recovering out of three is not read as all-clear.
    const broke = now.filter((id) => !then.includes(id));
    const mended = then.filter((id) => !now.includes(id));
    // From the adapter rather than built from the id. Eleven of the twelve
    // are `layer.<id>` and the twelfth is the alerts layer, whose id is
    // `alerts` and whose line is `layer.weatherAlerts`, so a derived key
    // named nothing at all in the one message that most needed a name.
    const named = new Map(known.current.map((layer) => [layer.id, layer]));
    const name = (id: string) => {
      const layer = named.get(id);
      return layer ? translate(layer.nameKey) : id;
    };
    if (broke.length) {
      pushRef.current({
        title: translate("notice.layerFailing", {
          layer: broke.map(name).join(", "),
        }),
        detail: translate("notice.layerFailingBody"),
      });
    }
    if (mended.length) {
      pushRef.current({
        title: translate("notice.layerBack", {
          layer: mended.map(name).join(", "),
        }),
      });
    }
  }, [failingKey]);

  const wasStalled = useRef(timelineError !== null);
  useEffect(() => {
    const stalled = timelineError !== null;
    if (stalled === wasStalled.current) return;
    wasStalled.current = stalled;
    if (stalled) {
      pushRef.current({
        title: translate("notice.loopStalled"),
        // The timeline's own words, which say which service and why.
        detail: timelineError ?? undefined,
      });
      return;
    }
    pushRef.current({ title: translate("notice.loopBack") });
  }, [timelineError]);
}
