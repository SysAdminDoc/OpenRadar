import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayersPanel } from "./MapOptionsPanels";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { en } from "../i18n/en";
import type { WorkspaceOverlayFile } from "../lib/workspaceOverlays";
import type { GaugeQpePeriod } from "../lib/gaugeQpe";

afterEach(cleanup);

function panel(overrides: {
  layers?: Partial<typeof DEFAULT_SETTINGS.layers>;
  layerNotes?: Record<string, string | null>;
  overlayFiles?: WorkspaceOverlayFile[];
  onOverlayFiles?: (files: WorkspaceOverlayFile[]) => void;
  gaugeQpePeriod?: GaugeQpePeriod;
  onGaugeQpePeriod?: (period: GaugeQpePeriod) => void;
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
      onSatelliteProduct={vi.fn()}
      overlayOpacity={DEFAULT_SETTINGS.overlayOpacity}
      onOverlayOpacity={vi.fn()}
      overlayOrder={DEFAULT_SETTINGS.overlayOrder}
      onOverlayOrder={vi.fn()}
      overlayFiles={overrides.overlayFiles ?? []}
      onOverlayFiles={overrides.onOverlayFiles ?? vi.fn()}
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
