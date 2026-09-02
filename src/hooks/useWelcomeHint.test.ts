import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWelcomeHint } from "./useWelcomeHint";

/**
 * The one piece of onboarding this app has.
 *
 * Everything the workspace can do is behind two buttons and nothing on screen
 * says so, so the signpost is the part somebody actually needs. The weather
 * above it is the part that makes it worth reading. What is held here is that
 * the first does not wait on the second, and that "shown once" is a promise
 * the app can keep without a service answering.
 */

const HOME: [number, number] = [-96.8, 32.78];
const RAIN = "KAMB 021253Z 18008KT 6SM -RA BR OVC012 12/11 A2989";

let answer: (value: unknown) => void;
let fetching: Promise<unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  fetching = new Promise((resolve) => {
    answer = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await fetching;
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            icaoId: "KAMB",
            obsTime: Math.floor(Date.now() / 1000) - 300,
            temp: 12,
            dewp: 11,
            wdir: 180,
            wspd: 8,
            wgst: null,
            rawOb: RAIN,
            lat: HOME[1],
            lon: HOME[0],
            name: "Test Field, TX, US",
            cover: "OVC",
            fltCat: "MVFR",
          },
        ],
      };
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function hint(seen = false) {
  const push = vi.fn();
  const onSeen = vi.fn();
  renderHook(() =>
    useWelcomeHint({ ready: true, seen, center: HOME, push, onSeen }),
  );
  return { push, onSeen };
}

describe("the greeting", () => {
  it("remembers it was shown before the station has answered", async () => {
    const { onSeen, push } = hint();
    // The flag goes down at once, in the effect itself, with nothing awaited
    // in between. Writing it at the end of the fetch meant a reader who quit
    // during the wait, or who had no network at all, was greeted again on the
    // next launch, and every launch after that.
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("goes without the weather rather than waiting for ever", async () => {
    const { push } = hint();
    await vi.advanceTimersByTimeAsync(2_600);
    // The signpost is what somebody needs. A machine with no network used to
    // get nothing at all.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].title).toContain("Commands");
  });

  it("says what the weather is doing when a station answers in time", async () => {
    const { push } = hint();
    answer(null);
    await vi.advanceTimersByTimeAsync(10);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].title).toContain("KAMB");
    // And the signpost is still there, under it.
    expect(push.mock.calls[0][0].detail).toContain("Commands");
  });

  it("still says it after the flag it just wrote comes back round", async () => {
    // What the app actually does: `onSeen` writes the settings, the settings
    // come back with `seen` true, and the hook re-renders. Depending on that
    // value tore the effect down and took the pending greeting with it, so
    // the flag went down and nothing was ever shown.
    const push = vi.fn();
    let told: (() => void) | null = null;
    const { rerender } = renderHook(
      (props: { seen: boolean }) =>
        useWelcomeHint({
          ready: true,
          seen: props.seen,
          center: HOME,
          push,
          onSeen: () => told?.(),
        }),
      { initialProps: { seen: false } },
    );
    told = () => rerender({ seen: true });
    rerender({ seen: false });
    answer(null);
    await vi.advanceTimersByTimeAsync(10);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].title).toContain("KAMB");
  });

  it("says nothing at all to somebody who has seen it", async () => {
    const { push, onSeen } = hint(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(push).not.toHaveBeenCalled();
    expect(onSeen).not.toHaveBeenCalled();
  });
});
