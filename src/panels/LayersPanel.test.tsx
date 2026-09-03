import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { LayersPanel } from "./MapOptionsPanels";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { en } from "../i18n/en";
import type { WorkspaceOverlayFile } from "../lib/workspaceOverlays";
import type { GaugeQpePeriod } from "../lib/gaugeQpe";
import type { AzShearLevel, RotationPeriod } from "../lib/rotationTrack";
import type { UndoableRemoval } from "../components/ToastHost";

afterEach(cleanup);

function panel(overrides: {
  layers?: Partial<typeof DEFAULT_SETTINGS.layers>;
  layerNotes?: Record<string, string | null>;
  overlayFiles?: WorkspaceOverlayFile[];
  onOverlayFiles?: (files: WorkspaceOverlayFile[]) => void;
  onRemoved?: (removal: UndoableRemoval) => void;
  gaugeQpePeriod?: GaugeQpePeriod;
  onGaugeQpePeriod?: (period: GaugeQpePeriod) => void;
  rotationPeriod?: RotationPeriod;
  onRotationPeriod?: (period: RotationPeriod) => void;
  azShearLevel?: AzShearLevel;
  onAzShearLevel?: (level: AzShearLevel) => void;
  wpcDay?: number;
  onWpcDay?: (day: number) => void;
  wssiDay?: number;
  onWssiDay?: (day: number) => void;
}) {
  return (
    <LayersPanel
      layers={{ ...DEFAULT_SETTINGS.layers, ...overrides.layers }}
      layerNotes={overrides.layerNotes}
      satelliteProduct={DEFAULT_SETTINGS.satelliteProduct}
      gaugeQpePeriod={
        overrides.gaugeQpePeriod ?? DEFAULT_SETTINGS.gaugeQpePeriod
      }
      onGaugeQpePeriod={overrides.onGaugeQpePeriod ?? vi.fn()}
      rotationPeriod={
        overrides.rotationPeriod ?? DEFAULT_SETTINGS.rotationPeriod
      }
      onRotationPeriod={overrides.onRotationPeriod ?? vi.fn()}
      azShearLevel={overrides.azShearLevel ?? DEFAULT_SETTINGS.azShearLevel}
      onAzShearLevel={overrides.onAzShearLevel ?? vi.fn()}
      wpcDay={overrides.wpcDay ?? DEFAULT_SETTINGS.wpcDay}
      onWpcDay={overrides.onWpcDay ?? vi.fn()}
      wssiDay={overrides.wssiDay ?? DEFAULT_SETTINGS.wssiDay}
      onWssiDay={overrides.onWssiDay ?? vi.fn()}
      onSatelliteProduct={vi.fn()}
      overlayOpacity={DEFAULT_SETTINGS.overlayOpacity}
      onOverlayOpacity={vi.fn()}
      overlayOrder={DEFAULT_SETTINGS.overlayOrder}
      onOverlayOrder={vi.fn()}
      overlayFiles={overrides.overlayFiles ?? []}
      onOverlayFiles={overrides.onOverlayFiles ?? vi.fn()}
      onRemoved={overrides.onRemoved ?? vi.fn()}
      alertTypes={DEFAULT_SETTINGS.alertTypes}
      surgeCategory={DEFAULT_SETTINGS.surgeCategory}
      onLayers={vi.fn()}
      onAlertTypes={vi.fn()}
      onSurgeCategory={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe("a layer that is switched on and drawing nothing", () => {
  it("says why, where the switch is", () => {
    // Somebody who turns a layer on and sees nothing is looking at the switch.
    // The severe probability layer worked out a reason and nothing read it, so
    // a reader got a blank map that looked exactly like a quiet afternoon.
    render(
      panel({
        layers: { probSevere: true },
        layerNotes: { probSevere: "the reading has gone stale" },
      }),
    );
    expect(screen.getByText("the reading has gone stale")).toBeTruthy();
    // And the description it replaces is gone, rather than both being shown.
    expect(screen.queryByText(en["layers.probSevereDetail"])).toBeNull();
  });

  it("keeps the description when there is nothing wrong", () => {
    render(panel({ layers: { probSevere: true } }));
    expect(screen.getByText(en["layers.probSevereDetail"])).toBeTruthy();
  });

  it("says nothing about a layer the reader has switched off", () => {
    // A layer nobody asked for is not failing, it is off.
    render(
      panel({
        layers: { probSevere: false },
        layerNotes: { probSevere: "the reading has gone stale" },
      }),
    );
    expect(screen.queryByText("the reading has gone stale")).toBeNull();
    expect(screen.getByText(en["layers.probSevereDetail"])).toBeTruthy();
  });
});

describe("one accumulation over three windows", () => {
  it("keeps its period out of the way until the layer is on", () => {
    // Three switches for the same measurement is three things to read and
    // three grids the cache has to find room for. One switch with a period
    // beside it is one of each, and the period has nothing to say while the
    // switch is off.
    render(panel({ layers: { gaugeQpe: false } }));
    expect(screen.queryByLabelText(en["layers.gaugeQpePeriod"])).toBeNull();
  });

  it("offers every window and marks the one in use", () => {
    render(panel({ layers: { gaugeQpe: true }, gaugeQpePeriod: "24h" }));
    const control = screen.getByLabelText(en["layers.gaugeQpePeriod"]);
    const chosen = within(control).getByRole("button", { pressed: true });
    expect(chosen.textContent).toBe(en["gaugeQpe.24h"]);
    expect(within(control).getAllByRole("button")).toHaveLength(3);
  });

  it("asks for the window that was pressed", () => {
    const onGaugeQpePeriod = vi.fn();
    render(
      panel({
        layers: { gaugeQpe: true },
        gaugeQpePeriod: "24h",
        onGaugeQpePeriod,
      }),
    );
    const control = screen.getByLabelText(en["layers.gaugeQpePeriod"]);
    fireEvent.click(
      within(control).getByRole("button", { name: en["gaugeQpe.72h"] }),
    );
    expect(onGaugeQpePeriod).toHaveBeenCalledWith("72h");
  });
});

describe("taking an imported file off the map", () => {
  function file(id: string, name: string): WorkspaceOverlayFile {
    return {
      id,
      name,
      enabled: true,
      opacity: 1,
      shapes: { type: "FeatureCollection", features: [] },
    };
  }

  /**
   * The panel with a parent that actually applies what it is told.
   *
   * An undo is only worth anything against the list as it stands after the
   * removal, so a test that hands the panel a fixed array and a spy cannot
   * see whether the file comes back in the right place, or whether pressing
   * undo twice puts it in twice.
   */
  function Harness({
    start,
    onRemoved,
  }: {
    start: WorkspaceOverlayFile[];
    onRemoved: (removal: UndoableRemoval) => void;
  }) {
    const [files, setFiles] = useState(start);
    return panel({
      layers: { customOverlay: true },
      overlayFiles: files,
      onOverlayFiles: setFiles,
      onRemoved,
    });
  }

  function shown(): string[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>("[data-overlay-file]"),
    ).map((row) => row.dataset.overlayFile ?? "");
  }

  it("offers an undo that puts it back at the height it was drawn at", () => {
    // A file dropped on the window is somebody's own data, and the removal was
    // one press with no toast and no way back. Putting it on the end of the
    // list would be a different picture: it would draw over whatever used to
    // be above it.
    let removal: UndoableRemoval | null = null;
    render(
      <Harness
        start={[file("a", "Counties"), file("b", "Route"), file("c", "Pins")]}
        onRemoved={(next) => {
          removal = next;
        }}
      />,
    );
    // The list is drawn top first over a bottom-first array.
    expect(shown()).toEqual(["c", "b", "a"]);

    fireEvent.click(
      screen.getByLabelText(en["layers.fileRemove"].replace("{name}", "Route")),
    );
    expect(shown()).toEqual(["c", "a"]);
    if (!removal) throw new Error("no undo was offered");
    expect((removal as UndoableRemoval).title).toContain("Route");

    act(() => (removal as UndoableRemoval).undo());
    expect(shown()).toEqual(["c", "b", "a"]);
  });

  it("does nothing when the undo is used a second time", () => {
    // The file is already back after the first press. A second one must not
    // put a second copy of it in the list.
    let removal: UndoableRemoval | null = null;
    render(
      <Harness
        start={[file("a", "Counties"), file("b", "Route")]}
        onRemoved={(next) => {
          removal = next;
        }}
      />,
    );
    fireEvent.click(
      screen.getByLabelText(en["layers.fileRemove"].replace("{name}", "Route")),
    );
    if (!removal) throw new Error("no undo was offered");
    act(() => (removal as UndoableRemoval).undo());
    expect(shown()).toEqual(["b", "a"]);
    act(() => (removal as UndoableRemoval).undo());
    expect(shown()).toEqual(["b", "a"]);
  });
});
