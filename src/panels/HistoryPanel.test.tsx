import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryPanel } from "./HistoryPanel";
import * as hurdat from "../lib/hurdat";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

const ALPHA: hurdat.Storm = {
  id: "AL012020",
  name: "Alpha Storm",
  year: 2020,
  basin: "AL",
  ace: 4.5,
  peakWindKt: 55,
  start: 1_600_000_000,
  end: 1_600_021_600,
  fixes: 2,
  track: [
    [1_600_000_000, 28, -90, 45, 0, 0],
    [1_600_021_600, 29, -89, 55, 0, 0],
  ],
  statuses: ["TS"],
};

const BETA: hurdat.Storm = {
  ...ALPHA,
  id: "AL022021",
  name: "Beta Storm",
  year: 2021,
};

let loadStorm: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(hurdat, "loadStorms").mockResolvedValue([ALPHA, BETA]);
  loadStorm = vi.spyOn(hurdat, "loadStorm");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function resultButtons() {
  fireEvent.change(
    screen.getByRole("searchbox", {
      name: "Search past storms by name or year",
    }),
    { target: { value: "storm" } },
  );
  return {
    alpha: await screen.findByRole("button", { name: /Alpha Storm 2020/ }),
    beta: await screen.findByRole("button", { name: /Beta Storm 2021/ }),
  };
}

function renderPanel(
  onSelect = vi.fn(),
  selectedId: string | null = null,
  {
    replayId = null,
    bundlesAvailable = false,
    onSaveBundle = vi.fn(),
  }: {
    replayId?: string | null;
    bundlesAvailable?: boolean;
    onSaveBundle?: (includeWorkspace: boolean) => void;
  } = {},
) {
  return render(
    <HistoryPanel
      selectedId={selectedId}
      replayId={replayId}
      onSelect={onSelect}
      onReplay={() => {}}
      onStopReplay={() => {}}
      onSaveBundle={onSaveBundle}
      onOpenBundle={() => {}}
      bundlesAvailable={bundlesAvailable}
      almanac={false}
      onFlyTo={() => {}}
      onClose={() => {}}
    />,
  );
}

describe("HistoryPanel selection", () => {
  it("keeps the last click when an older storm load finishes later", async () => {
    const alpha = deferred<hurdat.Storm>();
    const beta = deferred<hurdat.Storm>();
    loadStorm.mockImplementation((id: string) =>
      id === ALPHA.id ? alpha.promise : beta.promise,
    );
    const onSelect = vi.fn();
    renderPanel(onSelect);

    const buttons = await resultButtons();
    fireEvent.click(buttons.alpha);
    fireEvent.click(buttons.beta);

    await act(async () => beta.resolve(BETA));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith(BETA);

    await act(async () => alpha.resolve(ALPHA));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith(BETA);
  });

  it("clears a failed selection error after a later selection succeeds", async () => {
    const alpha = deferred<hurdat.Storm>();
    const beta = deferred<hurdat.Storm>();
    loadStorm.mockImplementation((id: string) =>
      id === ALPHA.id ? alpha.promise : beta.promise,
    );
    const onSelect = vi.fn();
    renderPanel(onSelect);

    const buttons = await resultButtons();
    fireEvent.click(buttons.alpha);
    await act(async () => alpha.reject(new Error("Alpha did not load.")));
    expect(screen.getByText("Alpha did not load.")).toBeTruthy();

    fireEvent.click(buttons.beta);
    await act(async () => beta.resolve(BETA));
    expect(screen.queryByText("Alpha did not load.")).toBeNull();
    expect(onSelect).toHaveBeenLastCalledWith(BETA);
  });

  it("reuses the storm loaded by a result click when the selection changes", async () => {
    loadStorm.mockResolvedValue(ALPHA);

    function Harness() {
      const [selectedId, setSelectedId] = useState<string | null>(null);
      return (
        <HistoryPanel
          selectedId={selectedId}
          replayId={null}
          onSelect={(storm) => setSelectedId(storm?.id ?? null)}
          onReplay={() => {}}
          onStopReplay={() => {}}
          onSaveBundle={() => {}}
          onOpenBundle={() => {}}
          bundlesAvailable={false}
          almanac={false}
          onFlyTo={() => {}}
          onClose={() => {}}
        />
      );
    }

    render(<Harness />);
    const buttons = await resultButtons();
    fireEvent.click(buttons.alpha);

    expect(await screen.findByText("Alpha Storm 2020")).toBeTruthy();
    expect(loadStorm).toHaveBeenCalledTimes(1);
    expect(loadStorm).toHaveBeenCalledWith(ALPHA.id);
  });

  it("clears the current error when the selected storm is cleared", async () => {
    const beta = deferred<hurdat.Storm>();
    loadStorm.mockImplementation((id: string) =>
      id === ALPHA.id ? Promise.resolve(ALPHA) : beta.promise,
    );
    const onSelect = vi.fn();

    function Harness() {
      const [selectedId, setSelectedId] = useState<string | null>(ALPHA.id);
      return (
        <HistoryPanel
          selectedId={selectedId}
          replayId={null}
          onSelect={(storm) => {
            setSelectedId(storm?.id ?? null);
            onSelect(storm);
          }}
          onReplay={() => {}}
          onStopReplay={() => {}}
          onSaveBundle={() => {}}
          onOpenBundle={() => {}}
          bundlesAvailable={false}
          almanac={false}
          onFlyTo={() => {}}
          onClose={() => {}}
        />
      );
    }

    render(<Harness />);
    const clear = await screen.findByRole("button", { name: "Clear" });
    const buttons = await resultButtons();
    fireEvent.click(buttons.beta);
    await act(async () => beta.reject(new Error("Beta did not load.")));
    expect(screen.getByText("Beta did not load.")).toBeTruthy();

    fireEvent.click(clear);
    expect(screen.queryByText("Beta did not load.")).toBeNull();
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe("HistoryPanel replay bundles", () => {
  it("offers to keep the replay that is actually on the map", async () => {
    loadStorm.mockResolvedValue(ALPHA);
    const onSaveBundle = vi.fn();
    const { rerender } = renderPanel(vi.fn(), ALPHA.id, {
      bundlesAvailable: true,
      onSaveBundle,
    });
    expect(await screen.findByText("Alpha Storm 2020")).toBeTruthy();
    // A storm can be picked without being replayed, and there is nothing to
    // bundle until its frames are on screen.
    expect(
      screen.queryByRole("button", { name: /Save replay bundle/ }),
    ).toBeNull();
    // Opening one, though, does not depend on a replay.
    expect(
      screen.getByRole("button", { name: /Open a replay bundle/ }),
    ).toBeTruthy();

    rerender(
      <HistoryPanel
        selectedId={ALPHA.id}
        replayId={ALPHA.id}
        onSelect={() => {}}
        onReplay={() => {}}
        almanac={false}
        onFlyTo={() => {}}
        onStopReplay={() => {}}
        onSaveBundle={onSaveBundle}
        onOpenBundle={() => {}}
        bundlesAvailable
        onClose={() => {}}
      />,
    );
    const save = await screen.findByRole("button", {
      name: /Save replay bundle/,
    });

    // The workspace stays out until it is asked for, and the panel says so
    // rather than the caller assuming.
    fireEvent.click(save);
    expect(onSaveBundle).toHaveBeenLastCalledWith(false);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include my workspace/ }),
    );
    fireEvent.click(save);
    expect(onSaveBundle).toHaveBeenLastCalledWith(true);
  });

  it("offers neither where nothing can write a file", async () => {
    loadStorm.mockResolvedValue(ALPHA);
    renderPanel(vi.fn(), ALPHA.id, { replayId: ALPHA.id });
    expect(await screen.findByText("Alpha Storm 2020")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Save replay bundle/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Open a replay bundle/ }),
    ).toBeNull();
  });
});

describe("HistoryPanel while a storm is being fetched", () => {
  it("says which row is loading, and only that row", async () => {
    // A decade file is a network round trip and nothing happened on screen
    // between the press and the answer, so a slow line read as a dead click.
    const alpha = deferred<hurdat.Storm>();
    loadStorm.mockReturnValueOnce(alpha.promise);
    renderPanel();
    const rows = await resultButtons();

    expect(rows.alpha.getAttribute("aria-busy")).toBe("false");
    fireEvent.click(rows.alpha);

    expect(rows.alpha.getAttribute("aria-busy")).toBe("true");
    expect(rows.beta.getAttribute("aria-busy")).toBe("false");
    // And still pressable. Holding the list shut while one row loads would
    // make the panel unable to change its mind, which it is written to do.
    expect((rows.beta as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      alpha.resolve(ALPHA);
      // The flag is cleared in a `finally`, which is two microtasks past the
      // resolve, so awaiting the promise alone is not enough.
      await alpha.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rows.alpha.getAttribute("aria-busy")).toBe("false");
  });

  it("stops saying it is busy when the fetch fails", async () => {
    const alpha = deferred<hurdat.Storm>();
    loadStorm.mockReturnValueOnce(alpha.promise);
    renderPanel();
    const rows = await resultButtons();
    fireEvent.click(rows.alpha);
    expect(rows.alpha.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      alpha.reject(new Error("the decade could not be read"));
      await alpha.promise.catch(() => {});
      await Promise.resolve();
      await Promise.resolve();
    });

    // A failed fetch that never let go would leave the row spinning for the
    // rest of the session.
    expect(rows.alpha.getAttribute("aria-busy")).toBe("false");
  });
});

describe("HistoryPanel when the selection moves under a fetch", () => {
  it("still lets the row go", async () => {
    // The flag used to be cleared only when the generation still matched, and
    // the generation is bumped in two places that never touch it. Anything
    // that changed the selection while a decade file was in flight left the
    // row it started on spinning, and reporting aria-busy, for the life of
    // the panel.
    const alpha = deferred<hurdat.Storm>();
    loadStorm.mockReturnValueOnce(alpha.promise);
    const { rerender } = renderPanel();
    const rows = await resultButtons();
    fireEvent.click(rows.alpha);
    expect(rows.alpha.getAttribute("aria-busy")).toBe("true");

    // A storm arriving from somewhere else entirely, which is what opening a
    // replay bundle does.
    rerender(
      <HistoryPanel
        selectedId={BETA.id}
        replayId={null}
        onSelect={vi.fn()}
        onReplay={() => {}}
        onStopReplay={() => {}}
        onSaveBundle={vi.fn()}
        onOpenBundle={() => {}}
        bundlesAvailable={false}
        almanac={false}
        onFlyTo={() => {}}
        onClose={() => {}}
      />,
    );

    await act(async () => {
      alpha.resolve(ALPHA);
      await alpha.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rows.alpha.getAttribute("aria-busy")).toBe("false");
  });
});
