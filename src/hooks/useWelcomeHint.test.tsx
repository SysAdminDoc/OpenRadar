import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWelcomeHint } from "./useWelcomeHint";
import { en } from "../i18n/en";
import { metarOverlay } from "../lib/overlays/metar";

const CENTER: [number, number] = [-96.8, 32.78];

/** A station near the opening view, reporting whatever the test wants. */
function reporting(raw: string, tempC: number | null, minutesAgo = 5) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: CENTER },
        properties: {
          id: "KDAL",
          raw,
          tempC,
          observed: Math.floor((Date.now() - minutesAgo * 60_000) / 1000),
        },
      },
    ],
  };
}

const CLEAR = "KDAL 021253Z 15012KT 10SM FEW040 21/09 A2989";
const RAIN = "KDAL 021253Z 15012KT 6SM -RA BR OVC012 12/11 A2989";

beforeEach(() => {
  // No station by default: the tests about when the hint appears should not
  // depend on the weather.
  vi.spyOn(metarOverlay, "fetchData").mockResolvedValue({
    type: "FeatureCollection",
    features: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the hint that says where everything is", () => {
  it("is shown once to somebody who has not seen it", async () => {
    const push = vi.fn();
    const onSeen = vi.fn();
    renderHook(() =>
      useWelcomeHint({
        ready: true,
        seen: false,
        center: CENTER,
        push,
        onSeen,
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    // With no station to hear from, the signpost is the whole of it.
    expect(push.mock.calls[0][0].title).toBe(en["welcome.detail"]);
    expect(onSeen).toHaveBeenCalledTimes(1);
  });

  it("opens with what a station is actually reporting", async () => {
    vi.spyOn(metarOverlay, "fetchData").mockResolvedValue(
      reporting(RAIN, 12) as never,
    );
    const push = vi.fn();
    renderHook(() =>
      useWelcomeHint({
        ready: true,
        seen: false,
        center: CENTER,
        push,
        onSeen: vi.fn(),
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const said = String(push.mock.calls[0][0].title);
    // The source, the reading and the time, and the signpost kept beneath it.
    expect(said).toContain("KDAL");
    expect(said).toContain("rain");
    expect(push.mock.calls[0][0].detail).toBe(en["welcome.detail"]);
  });

  it("says plainly when there is nothing to report", async () => {
    vi.spyOn(metarOverlay, "fetchData").mockResolvedValue(
      reporting(CLEAR, 21) as never,
    );
    const push = vi.fn();
    renderHook(() =>
      useWelcomeHint({
        ready: true,
        seen: false,
        center: CENTER,
        push,
        onSeen: vi.fn(),
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const said = String(push.mock.calls[0][0].title);
    expect(said).toContain("nothing falling");
    // And it reaches for nothing to make the line more interesting.
    expect(said).not.toMatch(/warning|watch|severe|storm/i);
  });

  it("is not shown again once it has been", async () => {
    const push = vi.fn();
    renderHook(() =>
      useWelcomeHint({
        ready: true,
        seen: true,
        center: CENTER,
        push,
        onSeen: vi.fn(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).not.toHaveBeenCalled();
  });

  it("waits for the saved settings before deciding", async () => {
    // The flag arrives with the settings. Showing the hint before they are
    // read would show it to everybody, every launch.
    const push = vi.fn();
    const { rerender } = renderHook(
      (props: { ready: boolean; seen: boolean }) =>
        useWelcomeHint({ ...props, center: CENTER, push, onSeen: vi.fn() }),
      { initialProps: { ready: false, seen: false } },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).not.toHaveBeenCalled();

    rerender({ ready: true, seen: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).not.toHaveBeenCalled();
  });

  it("shows it once even while the flag is still being written", async () => {
    // Saving is asynchronous, so the hook can be rendered again with the old
    // value before the new one comes back round.
    const push = vi.fn();
    const { rerender } = renderHook(
      (props: { seen: boolean }) =>
        useWelcomeHint({
          ready: true,
          ...props,
          center: CENTER,
          push,
          onSeen: vi.fn(),
        }),
      { initialProps: { seen: false } },
    );
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    rerender({ seen: false });
    rerender({ seen: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).toHaveBeenCalledTimes(1);
  });
});
