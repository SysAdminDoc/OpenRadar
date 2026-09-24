import { readFileSync } from "node:fs";
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
import { FloodThresholdsSection } from "./FloodThresholdsSection";
import { NearbyPanel } from "./NearbyPanel";
import {
  DEFAULT_FLOOD_THRESHOLDS,
  normalizeFloodThresholds,
  type FloodReading,
  type FloodThresholds,
} from "../lib/flashFlood";
import { en } from "../i18n/en";

const readings = vi.hoisted(() => ({ at: vi.fn() }));

vi.mock("../lib/flashFlood", async (original) => {
  const real = await original<typeof import("../lib/flashFlood")>();
  return {
    ...real,
    floodReadingAt: (lon: number, lat: number) => readings.at(lon, lat),
  };
});

afterEach(() => {
  cleanup();
  readings.at.mockReset();
});

function table(thresholds: FloodThresholds = DEFAULT_FLOOD_THRESHOLDS) {
  const onThresholds = vi.fn();
  render(
    <FloodThresholdsSection
      thresholds={thresholds}
      onThresholds={onThresholds}
    />,
  );
  return onThresholds;
}

function box(panel: string, tier: string): HTMLInputElement {
  return screen.getByRole("spinbutton", { name: `${panel}, ${tier}` });
}

describe("the flash flood bars in Settings", () => {
  it("offers all sixteen, in the paper's units", () => {
    table();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(16);
    expect(box(en["flood.panelAri"], en["flood.tierConsiderable"]).value).toBe(
      "125",
    );
  });

  it("takes a bar when the box is left, not at every keystroke", () => {
    // Typing 200 into the box holding 125 passes through 2 on the way, and
    // 2 is under the warning bar. Taken per keystroke the box snapped back.
    const onThresholds = table();
    const considerable = box(
      en["flood.panelAri"],
      en["flood.tierConsiderable"],
    );
    fireEvent.change(considerable, { target: { value: "2" } });
    fireEvent.change(considerable, { target: { value: "150" } });
    expect(onThresholds).not.toHaveBeenCalled();
    fireEvent.blur(considerable);
    expect(onThresholds).toHaveBeenCalledWith({
      ...DEFAULT_FLOOD_THRESHOLDS,
      ari: [1, 5, 150, 175],
    });
  });

  it("puts back a bar that would stop a panel climbing, and says why", () => {
    const onThresholds = table();
    const considerable = box(
      en["flood.panelAri"],
      en["flood.tierConsiderable"],
    );
    fireEvent.change(considerable, { target: { value: "3" } });
    fireEvent.blur(considerable);
    expect(onThresholds).not.toHaveBeenCalled();
    expect(considerable.value).toBe("125");
    expect(screen.getByText(en["flood.mustClimb"])).toBeTruthy();
  });

  it("puts the paper's bars back when asked, and only offers to when moved", () => {
    table();
    expect(
      screen
        .getByRole("button", { name: en["flood.reset"] })
        .hasAttribute("disabled"),
    ).toBe(true);
    cleanup();
    const moved = normalizeFloodThresholds({ qpe: [1, 2, 3, 4] });
    const onThresholds = table(moved);
    fireEvent.click(screen.getByRole("button", { name: en["flood.reset"] }));
    expect(onThresholds).toHaveBeenCalledWith(DEFAULT_FLOOD_THRESHOLDS);
  });
});

/** A promise the test settles when it chooses to. */
function later<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function nearby(point: { lon: number; lat: number } | null) {
  render(
    <NearbyPanel
      places={[{ id: "home", name: "Home" }]}
      placeId="home"
      onPlace={() => undefined}
      warnings={[]}
      approaching={[]}
      cells={[]}
      cellNames={new Map()}
      onNameCell={() => undefined}
      cellsNote={null}
      alertsNote={null}
      station="KDMX"
      observed={null}
      alertsFetchedAt={1}
      alertsError={null}
      placeLightning={[]}
      clock={Date.parse("2026-09-24T18:00:00Z")}
      floodPoint={point}
      floodThresholds={DEFAULT_FLOOD_THRESHOLDS}
      onClose={() => undefined}
    />,
  );
}

describe("the flash flood call at the place Nearby is about", () => {
  it("reads the four panels there and says the call", async () => {
    const answer = later<FloodReading>();
    readings.at.mockReturnValue(answer.promise);
    nearby({ lon: -93.6, lat: 41.6 });
    expect(readings.at).toHaveBeenCalledWith(-93.6, 41.6);
    // Busy while the grids are read, like any other section waiting.
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    await act(async () =>
      answer.settle({
        qpeMm: 2.1 * 25.4,
        ariYears: 10,
        ratioPercent: 150,
        streamflowCms: 0.5,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe(
        "false",
      ),
    );
    expect(document.querySelector("[data-flood-call]")?.textContent).toBe(
      en["flood.callWarning"],
    );
    expect(
      document.querySelector("[data-flood-panels]")?.textContent,
    ).toContain("150% of flash flood guidance");
    // And it says what it is.
    expect(screen.getByText(en["flood.guide"])).toBeTruthy();
  });

  it("says there is nothing to read where there are no grids", async () => {
    readings.at.mockResolvedValue(null);
    nearby({ lon: -150, lat: 61 });
    await waitFor(() =>
      expect(screen.getByText(en["flood.unavailable"])).toBeTruthy(),
    );
  });
});

describe("the inspect tool", () => {
  it("hands out the point it read, both times it answers", () => {
    // The flood panels are read at the point an inspect reading is about.
    // The tool answers once at once and again when the gate comes back, and
    // a call that dropped the point would clear the flood line it follows.
    const source = readFileSync(
      join(process.cwd(), "src", "components", "MapViewport.tsx"),
      "utf8",
    );
    const from = source.indexOf('toolModeRef.current === "inspect"');
    const inspect = source.slice(
      from,
      source.indexOf('toolModeRef.current === "draw"', from),
    );
    const calls = [...inspect.matchAll(/onToolResult\?\.\(([^;]*)\);/g)];
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call[1]).toMatch(/,\s*point\s*\)?$/);
  });

  it("is shown with the panels at that point after it", () => {
    // App holds the point, reads the panels there, and hands the chrome the
    // readout with the flood line added rather than the tool's own.
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(app).toMatch(/useFloodReading\(inspected\)/);
    expect(app).toMatch(/withFloodReadout\(\s*toolResult,/);
    expect(app).toMatch(/toolResult=\{shownToolResult\}/);
  });
});
