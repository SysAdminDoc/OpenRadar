import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayersPanel } from "./MapOptionsPanels";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { en } from "../i18n/en";
import type { WorkspaceOverlayFile } from "../lib/workspaceOverlays";

afterEach(cleanup);

function panel(overrides: {
  layers?: Partial<typeof DEFAULT_SETTINGS.layers>;
  layerNotes?: Record<string, string | null>;
  overlayFiles?: WorkspaceOverlayFile[];
  onOverlayFiles?: (files: WorkspaceOverlayFile[]) => void;
}) {
  return (
    <LayersPanel
      layers={{ ...DEFAULT_SETTINGS.layers, ...overrides.layers }}
      layerNotes={overrides.layerNotes}
      satelliteProduct={DEFAULT_SETTINGS.satelliteProduct}
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
