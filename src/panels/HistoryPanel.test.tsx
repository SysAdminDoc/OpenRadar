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

function renderPanel(onSelect = vi.fn(), selectedId: string | null = null) {
  return render(
    <HistoryPanel
      selectedId={selectedId}
      replayId={null}
      onSelect={onSelect}
      onReplay={() => {}}
      onStopReplay={() => {}}
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
