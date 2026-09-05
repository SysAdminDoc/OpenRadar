import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { MapStage } from "./MapStage";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { nightMoment, subsolarLongitude } from "../lib/terminator";
import type { RadarFrame } from "../lib/providers/types";

/**
 * What each pane is told about the sun.
 *
 * The arithmetic in `terminator.ts` has its own tests, and passing those says
 * nothing about whether the workspace calls it with the right moment: the wash
 * was drawn for the wall clock for as long as `nightAt` was one shared value,
 * and every one of those tests was green. So this mounts the stage with a real
 * frame and reads the prop the viewport is actually handed.
 */

const captured: Array<Record<string, unknown>> = [];

vi.mock("./MapViewport", () => ({
  MapViewport: (props: Record<string, unknown>) => {
    captured.push(props);
    return <div data-testid="viewport" />;
  },
}));

function frameAt(iso: string, id = "ridge"): RadarFrame {
  return {
    providerId: id as RadarFrame["providerId"],
    // Seconds, which is what a frame carries and half of what this is about:
    // the clock is milliseconds and the two were being compared.
    time: Date.parse(iso) / 1000,
    tileUrl: "https://example.test/{z}/{x}/{y}.png",
    tileSize: 256,
    maxZoom: 10,
    attribution: "test",
  };
}

/** Now, as far as this file is concerned, and nowhere near 2011. */
const CLOCK = Date.parse("2026-09-05T21:00:00Z");

function mount(
  overrides: Partial<ComponentProps<typeof MapStage>> = {},
): Record<string, unknown>[] {
  captured.length = 0;
  const noop = () => {};
  render(
    <MapStage
      settings={DEFAULT_SETTINGS}
      clock={CLOCK}
      mapRef={{ current: null }}
      secondMapRef={{ current: null }}
      activeFrame={undefined}
      compareFrame={undefined}
      compareSweep={null}
      satelliteTime={null}
      compareSatelliteTime={null}
      satelliteAgeMinutes={null}
      overlays={{}}
      route={null}
      customOverlay={null}
      stormTrack={null}
      sweep={null}
      mrmsLayers={[]}
      flashes={null}
      cells={null}
      classification={null}
      forecastSmoke={null}
      probSevere={null}
      overlayOpacity={{}}
      overlayOrder={[]}
      flashWindowMinutes={30}
      flashClock={CLOCK}
      wind={null}
      activeTool={null}
      dualPane={false}
      compareOffset={0}
      onCompareOffset={noop}
      onCameraChange={noop}
      onPrimaryMove={noop}
      onSecondaryMove={noop}
      onCursorChange={noop}
      onToolResult={noop}
      onSection={noop}
      onOverlayAction={noop}
      onMapStatus={noop}
      {...overrides}
    />,
  );
  return captured;
}

afterEach(cleanup);

describe("the moment each pane draws the sun for", () => {
  it("follows the frame on screen rather than the wall clock", () => {
    const outbreak = "2011-04-27T21:00:00Z";
    const [primary] = mount({ activeFrame: frameAt(outbreak) });

    const at = primary.nightAt as number;
    // The wash for that afternoon, not for tonight. Compared through the
    // subsolar longitude rather than the raw number, because that is what the
    // reader sees: fifteen degrees an hour, so 2026 and 2011 at the same hour
    // could share one and the assertion below would be satisfied by the bug.
    expect(subsolarLongitude(at)).toBeCloseTo(
      subsolarLongitude(Date.parse(outbreak)),
      6,
    );
    expect(at).toBe(Date.parse(outbreak));
    expect(at).not.toBe(CLOCK);
  });

  it("gives the compare pane its own moment", () => {
    // Six hours apart, which is ninety degrees of longitude: two panes that
    // shared one value would draw the same edge over two different storms.
    const panes = mount({
      dualPane: true,
      activeFrame: frameAt("2011-04-27T21:00:00Z"),
      compareFrame: frameAt("2011-04-27T15:00:00Z"),
    });
    expect(panes).toHaveLength(2);
    const [primary, compare] = panes;
    expect(primary.nightAt).toBe(Date.parse("2011-04-27T21:00:00Z"));
    expect(compare.nightAt).toBe(Date.parse("2011-04-27T15:00:00Z"));
    expect(
      Math.abs(
        subsolarLongitude(primary.nightAt as number) -
          subsolarLongitude(compare.nightAt as number),
      ),
    ).toBeGreaterThan(80);
  });

  it("falls back to the clock while there is no frame", () => {
    // Not zero. The viewport treats zero as "no wash", so a workspace that has
    // not fetched a loop yet would have the layer switched on and nothing
    // drawn.
    const [primary] = mount();
    expect(primary.nightAt).toBe(CLOCK);
    expect(primary.nightAt).not.toBe(0);
  });

  it("gives the compare pane the primary's moment when it has none of its own", () => {
    // `compareFrame` is undefined whenever the offset asks for more history
    // than the loop holds, which is every scrub near the start of one. The
    // pane still draws: the basemap, the overlays and the wash are not gated
    // on a radar frame. Falling back to the clock there put tonight's
    // terminator on the right-hand side of a 2011 replay.
    const outbreak = "2011-04-27T21:00:00Z";
    const panes = mount({
      dualPane: true,
      activeFrame: frameAt(outbreak),
      compareFrame: undefined,
    });
    expect(panes).toHaveLength(2);
    expect(panes[1].nightAt).toBe(Date.parse(outbreak));
    expect(panes[1].nightAt).not.toBe(CLOCK);
  });

  it("answers one moment for two frames inside the same minute", () => {
    // Both have to be the frame's own minute, not merely equal to each other:
    // with the wiring reverted to the wall clock they would also be equal, and
    // an assertion that only compares them to one another is satisfied by the
    // defect.
    const [early] = mount({ activeFrame: frameAt("2011-04-27T21:00:20Z") });
    const [late] = mount({ activeFrame: frameAt("2011-04-27T21:00:59Z") });
    expect(early.nightAt).toBe(Date.parse("2011-04-27T21:00:00Z"));
    expect(late.nightAt).toBe(early.nightAt);
  });
});

describe("the rule the panes call", () => {
  it("rounds a frame down to its minute and keeps the clock for nothing", () => {
    expect(nightMoment(Date.parse("2011-04-27T21:00:59Z") / 1000, CLOCK)).toBe(
      Date.parse("2011-04-27T21:00:00Z"),
    );
    expect(nightMoment(undefined, CLOCK)).toBe(CLOCK);
    // A frame time that is not a number is not a moment, and answering NaN
    // would draw a polygon of NaN coordinates rather than no polygon.
    expect(nightMoment(Number.NaN, CLOCK)).toBe(CLOCK);
  });
});
