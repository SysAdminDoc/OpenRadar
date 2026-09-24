import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrossSectionPanel } from "./CrossSectionPanel";
import { NearbyPanel } from "./NearbyPanel";
import { SearchPanel } from "./SearchPanel";
import { SoundingPanel } from "./SoundingPanel";
import type { CrossSection } from "../lib/crossSection";

/**
 * A panel waiting on its first answer says so on the dialog.
 *
 * `AUD-480` made the accessibility sweep wait on `data-busy` rather than on a
 * guess about how long a fetch takes, and gave it to the five panels whose
 * sweep had flaked. Four more drew a spinner inside `PanelShell` and passed
 * nothing, and the sweep opens all four, so the flake could come back on any
 * of them. A reader in a screen reader is in the dialog, not looking at the
 * spinner, and `aria-busy` is how they are told.
 */

const lookups = vi.hoisted(() => ({
  observed: vi.fn(),
  forecast: vi.fn(),
  places: vi.fn(),
}));

vi.mock("../lib/sounding", async (original) => {
  const real = await original<typeof import("../lib/sounding")>();
  return {
    ...real,
    observedSounding: () => lookups.observed(),
    forecastSounding: () => lookups.forecast(),
  };
});

vi.mock("../lib/weather", async (original) => {
  const real = await original<typeof import("../lib/weather")>();
  return { ...real, searchPlaces: () => lookups.places() };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  lookups.observed.mockReset();
  lookups.forecast.mockReset();
  lookups.places.mockReset();
});

function dialog() {
  return screen.getByRole("dialog");
}

function busy() {
  return [dialog().getAttribute("aria-busy"), dialog().dataset.busy ?? null];
}

/** A promise the test settles when it chooses to. */
function later<T>() {
  let settle!: (value: T) => void;
  let refuse!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    refuse = reject;
  });
  return { promise, settle, refuse };
}

describe("a panel waiting on its first answer", () => {
  it("the sounding is busy until the balloon or the failure is in", async () => {
    const observed = later<null>();
    lookups.observed.mockReturnValue(observed.promise);
    render(
      <SoundingPanel
        center={[-93.6, 41.6]}
        at={1_756_747_800}
        onClose={vi.fn()}
      />,
    );
    expect(busy()).toEqual(["true", "true"]);
    await act(async () => observed.settle(null));
    await waitFor(() => expect(busy()).toEqual(["false", null]));

    // Switching to the model is a new question, so busy again until it is
    // answered, and a refusal is an answer.
    const forecast = later<null>();
    lookups.forecast.mockReturnValue(forecast.promise);
    fireEvent.click(screen.getByRole("button", { name: /forecast/i }));
    expect(busy()).toEqual(["true", "true"]);
    await act(async () => forecast.refuse(new Error("the archive is busy")));
    await waitFor(() => expect(busy()).toEqual(["false", null]));
  });

  it("the vertical slice is busy while it is being cut", async () => {
    const cut = later<CrossSection>();
    render(
      <CrossSectionPanel
        line={{
          from: { lon: -94.1, lat: 41.6 },
          to: { lon: -93.4, lat: 41.9 },
        }}
        take={() => cut.promise}
        onClose={vi.fn()}
      />,
    );
    expect(busy()).toEqual(["true", "true"]);
    await act(async () => cut.refuse(new Error("no volume")));
    await waitFor(() => expect(busy()).toEqual(["false", null]));
  });

  it("the nearby panel is busy while either list is still coming", () => {
    const nearby = (
      alertsNote: "loading" | null,
      cellsNote: "loading" | null,
    ) => (
      <NearbyPanel
        places={[{ id: "home", name: "Home" }]}
        placeId="home"
        onPlace={() => undefined}
        warnings={[]}
        approaching={[]}
        cells={[]}
        cellNames={new Map()}
        onNameCell={() => undefined}
        cellsNote={cellsNote}
        alertsNote={alertsNote}
        station="KDMX"
        observed={Date.parse("2026-09-04T18:00:00Z")}
        alertsFetchedAt={null}
        alertsError={null}
        placeLightning={[]}
        clock={Date.parse("2026-09-04T18:00:00Z")}
        onClose={() => undefined}
      />
    );
    const { rerender } = render(nearby("loading", null));
    expect(busy()).toEqual(["true", "true"]);
    rerender(nearby(null, "loading"));
    expect(busy()).toEqual(["true", "true"]);
    rerender(nearby(null, null));
    expect(busy()).toEqual(["false", null]);
  });

  it("the search is busy from the keystroke to the answer", async () => {
    vi.useFakeTimers();
    const found = later<[]>();
    lookups.places.mockReturnValue(found.promise);
    render(
      <SearchPanel
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onSelectStorm={vi.fn()}
      />,
    );
    expect(busy()).toEqual(["false", null]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Ames" },
    });
    expect(busy()).toEqual(["true", "true"]);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => found.settle([]));
    expect(busy()).toEqual(["false", null]);
  });
});

/** Every panel component under the directory, tests left out. */
function panels(from: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(from)) {
    const path = join(from, name);
    if (statSync(path).isDirectory()) {
      found.push(...panels(path));
    } else if (name.endsWith(".tsx") && !name.includes(".test.")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Whether a spinner stands for the content or for a press.
 *
 * A spinner inside a button says the thing the reader just asked for is
 * running, and the panel around it is not about to change: an export in
 * progress is not a dialog waiting on its answer. Anywhere else the spinner
 * is where content will be.
 */
function spinsOutsideAButton(source: string): boolean {
  for (const found of source.matchAll(/<LoaderCircle\b/g)) {
    const before = source.slice(0, found.index);
    const opened = before.lastIndexOf("<button");
    const closed = before.lastIndexOf("</button>");
    if (opened === -1 || closed > opened) return true;
  }
  return false;
}

describe("the gate on that", () => {
  it("finds a spinner outside a button and not inside one", () => {
    expect(spinsOutsideAButton("<p><LoaderCircle /></p>")).toBe(true);
    expect(
      spinsOutsideAButton("<button>{a ? <LoaderCircle /> : null}</button>"),
    ).toBe(false);
    expect(
      spinsOutsideAButton("<button>x</button><span><LoaderCircle /></span>"),
    ).toBe(true);
  });

  it("holds every panel that spins for its content to saying so", () => {
    const root = join(process.cwd(), "src", "panels");
    const files = panels(root);
    expect(files.length).toBeGreaterThan(10);
    const silent = files
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return (
          source.includes("<PanelShell") &&
          spinsOutsideAButton(source) &&
          !/\bbusy=\{/.test(source)
        );
      })
      .map((path) => path.slice(root.length + 1));
    expect(silent).toEqual([]);
  });
});
