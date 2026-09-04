import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStateNotices } from "./useStateNotices";
import { OVERLAY_ADAPTERS } from "../lib/overlays";
import { en } from "../i18n/en";
import type { StringKey } from "../i18n";

type Notice = { title: string; detail?: string };
type Layer = { id: string; nameKey: StringKey };

/** The two the tests drive, named the way the registry names them. */
const ALERTS: Layer = { id: "alerts", nameKey: "layer.weatherAlerts" };
const METAR: Layer = { id: "metar", nameKey: "layer.metar" };

/**
 * The hook with a spy for a toast host, driven by re-rendering with new
 * state the way the workspace does.
 */
function drive(start: {
  offline?: boolean;
  failing?: Layer[];
  timelineError?: string | null;
}) {
  const said: Notice[] = [];
  const push = (message: Notice) => said.push(message);
  const view = renderHook(
    (props: {
      offline: boolean;
      failing: Layer[];
      timelineError: string | null;
    }) => useStateNotices({ ...props, push }),
    {
      initialProps: {
        offline: start.offline ?? false,
        failing: start.failing ?? [],
        timelineError: start.timelineError ?? null,
      },
    },
  );
  return {
    said,
    to(next: {
      offline?: boolean;
      failing?: Layer[];
      timelineError?: string | null;
    }) {
      view.rerender({
        offline: next.offline ?? false,
        failing: next.failing ?? [],
        timelineError: next.timelineError ?? null,
      });
    },
  };
}

describe("what the workspace says when something stops working", () => {
  it("says nothing at all while nothing has changed", () => {
    // The overlays re-fetch on a timer. Anything keyed on the state rather
    // than on the change would say the same sentence every few minutes for
    // as long as the failure lasted.
    const run = drive({ failing: [ALERTS] });
    expect(run.said).toEqual([]);
    run.to({ failing: [ALERTS] });
    run.to({ failing: [ALERTS] });
    expect(run.said).toEqual([]);
  });

  it("says a machine went offline, and that it came back", () => {
    const run = drive({});
    run.to({ offline: true });
    expect(run.said).toHaveLength(1);
    expect(run.said[0].title).toBe(en["notice.offline"]);

    run.to({ offline: false });
    expect(run.said).toHaveLength(2);
    expect(run.said[1].title).toBe(en["notice.online"]);
  });

  it("names the layer that stopped, and only the one that changed", () => {
    const run = drive({});
    run.to({ failing: [ALERTS] });
    expect(run.said).toHaveLength(1);
    expect(run.said[0].title).toContain(en["layer.weatherAlerts"]);

    // A second one failing does not re-announce the first.
    run.to({ failing: [ALERTS, METAR] });
    expect(run.said).toHaveLength(2);
    expect(run.said[1].title).toContain(en["layer.metar"]);
    expect(run.said[1].title).not.toContain(en["layer.weatherAlerts"]);

    // And one recovering out of two is not read as all-clear.
    run.to({ failing: [ALERTS] });
    expect(run.said).toHaveLength(3);
    expect(run.said[2].title).toBe(
      en["notice.layerBack"].replace("{layer}", en["layer.metar"]),
    );
  });

  it("says the loop stalled, carrying the reason the timeline gave", () => {
    const run = drive({});
    run.to({ timelineError: "The radar archive did not answer." });
    expect(run.said).toHaveLength(1);
    expect(run.said[0].title).toBe(en["notice.loopStalled"]);
    expect(run.said[0].detail).toBe("The radar archive did not answer.");

    // A different reason is not a new transition: it is still stalled.
    run.to({ timelineError: "Still nothing." });
    expect(run.said).toHaveLength(1);

    run.to({ timelineError: null });
    expect(run.said).toHaveLength(2);
    expect(run.said[1].title).toBe(en["notice.loopBack"]);
  });

  it("does not announce the state it started in", () => {
    // Opening the workspace already offline is not a transition. The chrome
    // says so from the first frame, and a toast on mount would fire on every
    // remount of the tree.
    const run = drive({
      offline: true,
      failing: [ALERTS],
      timelineError: "nothing yet",
    });
    expect(run.said).toEqual([]);
  });

  it("carries a body only where there is something to add", () => {
    const run = drive({});
    run.to({ offline: true });
    expect(run.said[0].detail).toBe(en["notice.offlineBody"]);
    run.to({ offline: false });
    // Coming back needs explaining: the map goes and fetches what it missed,
    // which is why the view is about to change under the reader.
    expect(run.said[1].detail).toBe(en["notice.onlineBody"]);

    run.to({ failing: [ALERTS] });
    expect(run.said[2].detail).toBe(en["notice.layerFailingBody"]);
    run.to({ failing: [] });
    // A layer drawing again needs nothing beyond the fact of it.
    expect(run.said[3].title).toContain(en["layer.weatherAlerts"]);
    expect(run.said[3].detail).toBeUndefined();
  });
});

describe("every layer can be named in a notice", () => {
  it("gives each adapter a catalogue key that exists", () => {
    // The alerts adapter is `alerts` and its line is `layer.weatherAlerts`,
    // so building the key from the id named nothing at all in the one
    // message that most needed a name. The registry says it now, and this is
    // what stops the next adapter shipping without one.
    expect(OVERLAY_ADAPTERS.length).toBeGreaterThan(5);
    for (const adapter of OVERLAY_ADAPTERS) {
      expect(adapter.nameKey, adapter.id).toMatch(/^layer\./);
      const said = (en as Record<string, string>)[adapter.nameKey];
      expect(said, `${adapter.id} -> ${adapter.nameKey}`).toBeTruthy();
    }

    // And no two share one. A key that merely exists is not the same as the
    // right key: pointing the alerts layer at `layer.metar` satisfies every
    // check above and tells a reader their surface observations stopped when
    // it was their warnings.
    const keys = OVERLAY_ADAPTERS.map((adapter) => adapter.nameKey);
    expect(new Set(keys).size, keys.join(", ")).toBe(keys.length);

    // The eleven that can be derived are derived, so the one exception has
    // to be deliberate rather than a typo nobody notices.
    const odd = OVERLAY_ADAPTERS.filter(
      (adapter) => adapter.nameKey !== `layer.${adapter.id}`,
    );
    expect(odd.map((adapter) => `${adapter.id} -> ${adapter.nameKey}`)).toEqual(
      ["alerts -> layer.weatherAlerts"],
    );
  });
});
