import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NearbyPanel } from "./NearbyPanel";
import { cellKey, withName } from "../lib/cellNames";
import type { Approach } from "../lib/approach";
import type { NearbyWarning } from "../lib/nearby";

/** A fixed moment, so nothing here depends on when the suite runs. */
const CLOCK = Date.parse("2026-09-04T18:00:00Z");

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
      alertsNote={null}
      station="KFWS"
      observed={Date.now()}
      alertsFetchedAt={Date.now()}
      alertsError={null}
      placeLightning={[]}
      clock={CLOCK}
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
    cellsNote?: "off" | "unavailable" | "loading" | "failed" | null;
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
      alertsNote={null}
      station="KFWS"
      observed={Date.now()}
      alertsFetchedAt={Date.now()}
      alertsError={null}
      placeLightning={[]}
      clock={CLOCK}
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

  it("does not claim nothing is coming when the tracker could not be read", () => {
    // The same claim-about-the-sky, from the fourth state the note gained
    // last: a read that failed leaves no report and no loading flag, so the
    // section had nothing to distinguish it from a clear afternoon.
    render(approachPanel({ approaching: [], cellsNote: "failed" }));
    const section = document.querySelector("[data-approaching]");
    expect(section?.textContent).toContain("could not be read");
    expect(section?.textContent).not.toContain("Nothing the radar is tracking");
  });
});

/**
 * What the warnings section is allowed to claim.
 *
 * "No warnings over this place" is a statement about the sky, and an empty
 * list is not one: the layer may be off, the feed may never have arrived, or
 * it may have failed. This panel is the whole of what a reader who cannot see
 * the map has, so it said the safest-sounding of those four things whatever
 * had actually happened. On a refused connection the section read "No
 * warnings over this place" while the footer three sections down said
 * "Loading NWS watches and warnings".
 */
function warningsSection(
  alertsNote: "off" | "failed" | "loading" | null,
  warnings: NearbyWarning[] = [],
) {
  render(
    <NearbyPanel
      places={[{ id: "home", name: "Casa" }]}
      placeId="home"
      onPlace={() => undefined}
      warnings={warnings}
      approaching={[]}
      cells={[]}
      cellNames={new Map()}
      onNameCell={() => undefined}
      cellsNote={null}
      alertsNote={alertsNote}
      station="KFWS"
      observed={CLOCK}
      alertsFetchedAt={alertsNote === null ? CLOCK : null}
      alertsError={alertsNote === "failed" ? "The service is busy." : null}
      placeLightning={[]}
      clock={CLOCK}
      onClose={() => undefined}
    />,
  );
}

describe("what the warnings section says when it has nothing to list", () => {
  it("says nothing covers the place only when the feed answered", () => {
    warningsSection(null);
    expect(screen.getByText(/no warnings over this place/i)).toBeTruthy();
  });

  it("says the warnings could not be checked when the feed failed", () => {
    warningsSection("failed");
    expect(screen.queryByText(/no warnings over this place/i)).toBeNull();
    expect(screen.getByText(/could not be checked/i)).toBeTruthy();
  });

  it("says it is still checking before the first answer", () => {
    warningsSection("loading");
    expect(screen.queryByText(/no warnings over this place/i)).toBeNull();
    expect(screen.getByText(/checking the warnings/i)).toBeTruthy();
  });

  it("says the layer is off rather than that the sky is clear", () => {
    warningsSection("off");
    expect(screen.queryByText(/no warnings over this place/i)).toBeNull();
    expect(screen.getByText(/switched off/i)).toBeTruthy();
  });

  it("reads a warning out whatever else is wrong", () => {
    // The note answers for an empty list and never instead of one. A feed
    // that failed after handing over a tornado warning still has the tornado
    // warning, and that is the line this panel exists to say.
    warningsSection("failed", [
      {
        id: "a",
        sentence: "Tornado Warning over Casa.",
        area: "",
        description: "",
        instruction: "",
      } as NearbyWarning,
    ]);
    expect(screen.getByText(/tornado warning over casa/i)).toBeTruthy();
    expect(screen.queryByText(/could not be checked/i)).toBeNull();
  });
});

/**
 * The line under the whole panel, which answers for the same request the
 * warnings section does.
 *
 * The section was taught the four states and the footer was not, so on a
 * refused connection the section said the warnings could not be checked while
 * the line three sections below it said they were still loading. Both were on
 * screen at once, describing one request. A test scoped to the section cannot
 * see that, which is why these read the whole panel.
 */
describe("what the line under the panel says about the same request", () => {
  it("does not say the warnings are loading once the feed has failed", () => {
    warningsSection("failed");
    const note = document.querySelector(".source-note");
    expect(note?.textContent ?? "").not.toMatch(
      /loading watches and warnings/i,
    );
    expect(note?.textContent ?? "").toMatch(/the service is busy/i);
  });

  it("says the layer is off rather than that it is still loading", () => {
    warningsSection("off");
    const note = document.querySelector(".source-note");
    expect(note?.textContent ?? "").not.toMatch(
      /loading watches and warnings/i,
    );
    expect(note?.textContent ?? "").toMatch(/while the layer is off/i);
  });

  it("still says it is loading before the first answer", () => {
    warningsSection("loading");
    const note = document.querySelector(".source-note");
    expect(note?.textContent ?? "").toMatch(/loading watches and warnings/i);
  });

  it("says when it was checked once the feed has answered", () => {
    warningsSection(null);
    const note = document.querySelector(".source-note");
    expect(note?.textContent ?? "").toMatch(/checked/i);
    expect(note?.textContent ?? "").not.toMatch(
      /loading watches and warnings/i,
    );
  });
});
