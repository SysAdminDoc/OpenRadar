import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDisplayAwake } from "./useDisplayAwake";

/**
 * The screen held on for a view meant to be left up, and given back.
 *
 * The half that matters is the giving back. A hold taken and never released
 * is somebody's monitor burning all night because they glanced at a radar
 * loop once, and nothing on screen would say so. So the three ways out are
 * all pinned here: leaving the view, the setting going off, and the tree
 * going away, which is what a window closing does to it.
 */

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("../lib/settings", async (original) => {
  const real = await original<typeof import("../lib/settings")>();
  return { ...real, isDesktopRuntime: () => true };
});

/**
 * Lets everything the hook started finish.
 *
 * Both calls leave through a dynamic import, so a single microtask flush
 * drains the availability answer without reaching what it caused. A test that
 * asserted no hold had been taken after one flush would pass whether the gate
 * worked or not, which is the whole of what that test is for.
 */
async function settle() {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

/** Every command the hook sent, in order, as `[name, hold]` pairs. */
function asked() {
  return invoke.mock.calls.map(([name, args]) => [
    name,
    (args as { hold?: boolean } | undefined)?.hold,
  ]);
}

/** Only the holds and releases, which is what the acceptance is about. */
function holds() {
  return asked()
    .filter(([name]) => name === "display_awake")
    .map(([, hold]) => hold);
}

function Harness(props: {
  wanted: boolean;
  showing: boolean;
  onFailure?: (failure: unknown) => void;
}) {
  useDisplayAwake(props);
  return null;
}

/** Renders, and lets the availability question settle. */
async function show(props: {
  wanted: boolean;
  showing: boolean;
  onFailure?: (failure: unknown) => void;
}) {
  const view = render(<Harness {...props} />);
  await settle();
  return view;
}

beforeEach(() => {
  invoke.mockImplementation((name: string) =>
    name === "display_awake_available"
      ? Promise.resolve(true)
      : Promise.resolve(undefined),
  );
});

afterEach(() => {
  cleanup();
  invoke.mockReset();
});

describe("holding the screen on for the full-screen view", () => {
  it("asks when the view comes up, and only then", async () => {
    const view = await show({ wanted: true, showing: false });
    // The setting alone holds nothing: a workspace nobody is looking at must
    // not be able to keep a screen awake.
    expect(holds()).toEqual([]);

    await act(async () => {
      view.rerender(<Harness wanted showing />);
    });
    await settle();
    expect(holds()).toEqual([true]);
  });

  it("gives the screen back when the view is left", async () => {
    const view = await show({ wanted: true, showing: true });
    expect(holds()).toEqual([true]);

    await act(async () => {
      view.rerender(<Harness wanted showing={false} />);
    });
    await settle();
    expect(holds()).toEqual([true, false]);
  });

  it("gives the screen back when the window goes", async () => {
    // Unmounting is what a closing window does to this tree, and the release
    // has to ride on that rather than on anybody remembering to leave the
    // view first.
    const view = await show({ wanted: true, showing: true });
    expect(holds()).toEqual([true]);

    await act(async () => {
      view.unmount();
    });
    await settle();
    expect(holds()).toEqual([true, false]);
  });

  it("gives the screen back when the setting goes off under it", async () => {
    const view = await show({ wanted: true, showing: true });
    await act(async () => {
      view.rerender(<Harness wanted={false} showing />);
    });
    await settle();
    expect(holds()).toEqual([true, false]);
  });

  it("asks for nothing at all where it cannot be honoured", async () => {
    invoke.mockImplementation((name: string) =>
      name === "display_awake_available"
        ? Promise.resolve(false)
        : Promise.resolve(undefined),
    );
    await show({ wanted: true, showing: true });
    // The control on a test that asserts nothing happened: the question was
    // asked, so the hook ran and this is a refusal rather than a render that
    // never got as far as either call.
    expect(asked().map(([name]) => name)).toEqual(["display_awake_available"]);
    expect(holds()).toEqual([]);
  });

  it("says what was refused rather than swallowing it", async () => {
    // The native side answers zero when the system declines the request, and
    // a caller that never looked would leave a reader believing their screen
    // will stay on for the next eight hours when it will not.
    invoke.mockImplementation((name: string) =>
      name === "display_awake_available"
        ? Promise.resolve(true)
        : Promise.reject(new Error("the system refused the display request")),
    );
    const onFailure = vi.fn();
    await show({ wanted: true, showing: true, onFailure });
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect((onFailure.mock.calls[0][0] as Error).message).toBe(
      "the system refused the display request",
    );
  });

  it("does not raise a refused release at anybody", async () => {
    // There is no view left to say it on, and the process ending releases the
    // hold anyway. What must not happen is an unhandled rejection taking the
    // window down on the way out.
    const onFailure = vi.fn();
    const view = await show({ wanted: true, showing: true, onFailure });
    invoke.mockImplementation((name: string) =>
      name === "display_awake_available"
        ? Promise.resolve(true)
        : Promise.reject(new Error("nobody is listening")),
    );
    await act(async () => {
      view.unmount();
    });
    await settle();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
