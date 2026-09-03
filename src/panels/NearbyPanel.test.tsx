import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NearbyPanel } from "./NearbyPanel";
import { cellKey, withName } from "../lib/cellNames";
import type { Approach } from "../lib/approach";

/**
 * Where a reader gives a storm a name.
 *
 * The pure helpers are held in `cellNames.test.ts`. What is held here is the
 * thing that actually broke: this is a controlled input, so whatever the
 * helper hands back is written into the field after every keystroke, and a
 * helper that trims the end deletes the space the moment it is typed.
 */

function markup(names: ReadonlyMap<string, string>, onName: () => void) {
  return (
    <NearbyPanel
      places={[{ id: "home", name: "Casa" }]}
      placeId="home"
      onPlace={() => undefined}
      warnings={[]}
      approaching={[]}
      cells={[
        { id: "A1", miles: 4, bearing: 180, sentence: "Storm A1, 4 mi south" },
      ]}
      cellNames={names}
      onNameCell={onName}
      cellsNote={null}
      station="KFWS"
      observed={Date.now()}
      alertsFetchedAt={Date.now()}
      onClose={() => undefined}
    />
  );
}

function panel(names: ReadonlyMap<string, string>, onName = vi.fn()) {
  const { rerender } = render(markup(names, onName));
  return {
    onName,
    rerender: (next: ReadonlyMap<string, string>) =>
      rerender(markup(next, onName)),
    field: () => screen.getByLabelText(/storm A1/i) as HTMLInputElement,
  };
}

afterEach(cleanup);

describe("naming a storm in the nearby list", () => {
  it("lets a reader type a name with spaces in it", () => {
    // Typed one character at a time, with the stored value written back each
    // time, which is what a controlled input does. Trimming the end in the
    // helper turned "The one over the lake" into "Theoneoverthelake".
    // The panel is handed names by the algorithm's own identifier; the store
    // behind them is keyed by station and identifier. Both are exercised,
    // because the trimming that broke this lives in the store.
    let held: ReadonlyMap<string, string> = new Map();
    const key = cellKey("KFWS", "A1");
    const shown = () => new Map([["A1", held.get(key) ?? ""]]);
    const wanted = "The one over the lake";
    const { field, rerender } = panel(shown());
    for (const character of wanted) {
      const typed = field().value + character;
      fireEvent.change(field(), { target: { value: typed } });
      held = withName(held, key, typed);
      // The stored value goes back into the field, which is what a
      // controlled input does and what deleted the spaces.
      rerender(shown());
    }
    expect(held.get(key)).toBe(wanted);
    expect(field().value).toBe(wanted);
  });

  it("hands what was typed to the caller unchanged", () => {
    const { onName, field } = panel(new Map());
    fireEvent.change(field(), { target: { value: "Big one " } });
    // The panel does not tidy anything: the rules about what a name may be
    // live in one place, and a second copy of them here would drift.
    expect(onName).toHaveBeenCalledWith("A1", "Big one ");
  });

  it("shows the name it was given", () => {
    const { field } = panel(new Map([["A1", "Big one"]]));
    expect(field().value).toBe("Big one");
  });
});

/** The panel with only the parts this section is about handed in. */
function approachPanel(
  overrides: {
    approaching?: Approach[];
    cellsNote?: "off" | "unavailable" | "loading" | null;
  } = {},
) {
  return (
    <NearbyPanel
      places={[{ id: "home", name: "Casa" }]}
      placeId="home"
      onPlace={() => undefined}
      warnings={[]}
      approaching={overrides.approaching ?? []}
      cells={[]}
      cellNames={new Map()}
      onNameCell={() => undefined}
      cellsNote={overrides.cellsNote ?? null}
      station="KFWS"
      observed={Date.now()}
      alertsFetchedAt={Date.now()}
      onClose={() => undefined}
    />
  );
}

describe("what the panel says is heading for a watched place", () => {
  it("lists each place with the storm and the minutes", () => {
    render(
      approachPanel({
        approaching: [
          {
            placeId: "school",
            placeName: "School",
            named: true,
            cellId: "A1",
            minutes: 12.4,
          },
          {
            placeId: "cabin",
            placeName: "Cabin",
            named: true,
            cellId: "B2",
            minutes: 0.2,
          },
        ],
      }),
    );
    const section = document.querySelector("[data-approaching]");
    expect(section?.textContent).toContain("A1 reaches School in about 12 min");
    // Under a minute is not "in about 0 min".
    expect(section?.textContent).toContain("B2 is reaching Cabin now");
    // And it says once, under the list, what all of it is.
    expect(section?.textContent).toContain("not a warning");
  });

  it("does not claim nothing is coming when nothing is tracking", () => {
    // The failure this replaces: with the Storm Cells layer off, or in a
    // browser preview where the tracker cannot run at all, the section said
    // "Nothing the radar is tracking is heading for your places", which is a
    // claim nobody had checked.
    render(approachPanel({ approaching: [], cellsNote: "off" }));
    const section = document.querySelector("[data-approaching]");
    expect(section?.textContent).toContain("Needs the Storm Cells layer");
    expect(section?.textContent).not.toContain("Nothing the radar is tracking");
  });

  it("says nothing is coming only when the tracker is running", () => {
    render(approachPanel({ approaching: [], cellsNote: null }));
    const section = document.querySelector("[data-approaching]");
    expect(section?.textContent).toContain("Nothing the radar is tracking");
  });
});
