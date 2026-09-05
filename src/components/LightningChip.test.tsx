import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LightningChip } from "./LightningChip";
import {
  LIGHTNING_FRESH_MS,
  QUIET_AFTER_MS,
  type PlaceLightning,
} from "../lib/lightningWatch";

const NOW = Date.parse("2026-09-04T18:00:00Z");

function counted(overrides: Partial<PlaceLightning> = {}): PlaceLightning {
  return {
    placeId: "home",
    placeName: "Home",
    named: false,
    flashes: 3,
    newest: NOW,
    nearestMiles: 6,
    nearestBearing: 90,
    // Read just now, so the age below is the sky going quiet rather than
    // nobody looking.
    checkedAt: NOW + QUIET_AFTER_MS,
    radiusMiles: 10,
    ...overrides,
  };
}

afterEach(cleanup);

describe("the chip on a watched place", () => {
  it("draws nothing for a place with no flash behind it", () => {
    // Two different silences, and neither is an all-clear: a place the feed
    // has said nothing about, and a place whose window held no flash.
    const { container } = render(
      <LightningChip lightning={undefined} clock={NOW} />,
    );
    expect(container.querySelector(".lightning-chip")).toBeNull();
    cleanup();
    const empty = render(
      <LightningChip
        lightning={counted({ newest: null, flashes: 0, nearestMiles: null })}
        clock={NOW}
      />,
    );
    expect(empty.container.querySelector(".lightning-chip")).toBeNull();
  });

  it("steps through the three as the clock moves and nothing else does", () => {
    // The same flash, read at three moments. Elapsed time is the whole rule,
    // which is the finding the testbed's stoplight exists to carry: a count
    // that has stopped rising is not an all-clear.
    const place = counted();
    const step = () =>
      document.querySelector(".lightning-chip")?.getAttribute("data-step");

    render(<LightningChip lightning={place} clock={NOW + 60_000} />);
    expect(step()).toBe("fresh");
    // The nearest flash, said in the reader's own measure and as a compass
    // point rather than a bearing in degrees.
    expect(screen.getByText(/6.0 mi to the east/)).toBeTruthy();
    cleanup();

    render(
      <LightningChip lightning={place} clock={NOW + LIGHTNING_FRESH_MS} />,
    );
    expect(step()).toBe("recent");
    cleanup();

    render(<LightningChip lightning={place} clock={NOW + QUIET_AFTER_MS} />);
    expect(step()).toBe("clear");
    // Said in words as well as in colour, because the colour is not readable
    // to everybody and is not a signal on its own.
    expect(screen.getByText(/Quiet for/)).toBeTruthy();
  });
});
