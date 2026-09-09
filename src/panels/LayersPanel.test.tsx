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
import { LayersPanel } from "./LayersPanel";
import {
  DEFAULT_CUBE_LEVEL,
  type CappiField,
  type CubeLevel,
} from "../lib/cappi";
import type {
  IsothermLevel,
  LightningForecast,
  LightningJump,
  LightningWindow,
} from "../lib/lightningGrids";
import { DEFAULT_SETTINGS } from "../lib/settings";
import {
  IDLE_OVERLAY,
  type OverlayState,
  type OverlayStates,
} from "../hooks/useOverlays";
import { OVERLAY_ADAPTERS } from "../lib/overlays";
import type { OverlayId } from "../lib/overlays";
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
  cappiField?: CappiField;
  onCappiField?: (field: CappiField) => void;
  cappiLevel?: CubeLevel;
  onCappiLevel?: (level: CubeLevel) => void;
  lightningWindow?: LightningWindow;
  onLightningWindow?: (window: LightningWindow) => void;
  lightningForecastWindow?: LightningForecast;
  onLightningForecastWindow?: (window: LightningForecast) => void;
  lightningJumpWindow?: LightningJump;
  onLightningJumpWindow?: (window: LightningJump) => void;
  isothermLevel?: IsothermLevel;
  onIsothermLevel?: (level: IsothermLevel) => void;
  wpcDay?: number;
  onWpcDay?: (day: number) => void;
  wssiDay?: number;
  onWssiDay?: (day: number) => void;
  overlayOpacity?: Record<string, number>;
  onOverlayOpacity?: (next: Record<string, number>) => void;
  overlayOrder?: string[];
  onOverlayOrder?: (order: string[]) => void;
  onOrderSaid?: (said: string) => void;
  overlayStates?: OverlayStates;
  now?: number;
}) {
  return (
    <LayersPanel
      layers={{ ...DEFAULT_SETTINGS.layers, ...overrides.layers }}
      layerNotes={overrides.layerNotes}
      overlayStates={overrides.overlayStates}
      now={overrides.now}
      spcDay={DEFAULT_SETTINGS.spcDay}
      spcHazard={DEFAULT_SETTINGS.spcHazard}
      onSpcDay={() => {}}
      onSpcHazard={() => {}}
      satelliteBand={DEFAULT_SETTINGS.satelliteBand}
      spacecraft={"east"}
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
      cappiField={overrides.cappiField ?? "reflectivity"}
      onCappiField={overrides.onCappiField ?? vi.fn()}
      cappiLevel={overrides.cappiLevel ?? DEFAULT_CUBE_LEVEL}
      onCappiLevel={overrides.onCappiLevel ?? vi.fn()}
      lightningWindow={
        overrides.lightningWindow ?? DEFAULT_SETTINGS.lightningWindow
      }
      onLightningWindow={overrides.onLightningWindow ?? vi.fn()}
      lightningForecastWindow={
        overrides.lightningForecastWindow ??
        DEFAULT_SETTINGS.lightningForecastWindow
      }
      onLightningForecastWindow={overrides.onLightningForecastWindow ?? vi.fn()}
      lightningJumpWindow={
        overrides.lightningJumpWindow ?? DEFAULT_SETTINGS.lightningJumpWindow
      }
      onLightningJumpWindow={overrides.onLightningJumpWindow ?? vi.fn()}
      isothermLevel={overrides.isothermLevel ?? DEFAULT_SETTINGS.isothermLevel}
      onIsothermLevel={overrides.onIsothermLevel ?? vi.fn()}
      wpcDay={overrides.wpcDay ?? DEFAULT_SETTINGS.wpcDay}
      onWpcDay={overrides.onWpcDay ?? vi.fn()}
      wssiDay={overrides.wssiDay ?? DEFAULT_SETTINGS.wssiDay}
      onWssiDay={overrides.onWssiDay ?? vi.fn()}
      onSatelliteBand={vi.fn()}
      overlayOpacity={
        overrides.overlayOpacity ?? DEFAULT_SETTINGS.overlayOpacity
      }
      onOverlayOpacity={overrides.onOverlayOpacity ?? vi.fn()}
      overlayOrder={overrides.overlayOrder ?? DEFAULT_SETTINGS.overlayOrder}
      onOverlayOrder={overrides.onOverlayOrder ?? vi.fn()}
      onOrderSaid={overrides.onOrderSaid ?? vi.fn()}
      overlayFiles={overrides.overlayFiles ?? []}
      onOverlayFiles={overrides.onOverlayFiles ?? vi.fn()}
      onRemoved={overrides.onRemoved ?? vi.fn()}
      alertTypes={DEFAULT_SETTINGS.alertTypes}
      surgeCategory={DEFAULT_SETTINGS.surgeCategory}
      onLayers={vi.fn()}
      onAlertTypes={vi.fn()}
      onSurgeCategory={vi.fn()}
      smoothGrids={false}
      onSmoothGrids={vi.fn()}
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

describe("one grid at any of thirty-three heights", () => {
  it("keeps the field and the height out of the way until the layer is on", () => {
    render(panel({ layers: { cappi: false } }));
    expect(screen.queryByLabelText(en["layers.cappiField"])).toBeNull();
    expect(
      screen.queryByRole("slider", { name: en["layers.cappiHeight"] }),
    ).toBeNull();
  });

  it("offers the three fields and marks the one in use", () => {
    render(panel({ layers: { cappi: true }, cappiField: "correlation" }));
    const control = screen.getByLabelText(en["layers.cappiField"]);
    const chosen = within(control).getByRole("button", { pressed: true });
    expect(chosen.textContent).toBe(en["layers.cappiCorrelation"]);
    expect(within(control).getAllByRole("button")).toHaveLength(3);
  });

  it("asks for the field that was pressed", () => {
    const onCappiField = vi.fn();
    render(panel({ layers: { cappi: true }, onCappiField }));
    fireEvent.click(
      within(screen.getByLabelText(en["layers.cappiField"])).getByRole(
        "button",
        { name: en["layers.cappiDifferential"] },
      ),
    );
    expect(onCappiField).toHaveBeenCalledWith("differential");
  });

  it("steps the slider through the list rather than through kilometres", () => {
    // The heights are not evenly spaced: a quarter of a kilometre apart at the
    // bottom and whole ones at the top. A slider running over the kilometres
    // would land between two of them, and the network publishes nothing there.
    const onCappiLevel = vi.fn();
    render(panel({ layers: { cappi: true }, onCappiLevel }));
    const slider = screen.getByRole("slider", {
      name: en["layers.cappiHeight"],
    });
    expect(slider.getAttribute("max")).toBe("32");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(onCappiLevel).toHaveBeenCalledWith("00.50");
    fireEvent.change(slider, { target: { value: "32" } });
    expect(onCappiLevel).toHaveBeenCalledWith("19.00");
  });

  it("announces the height rather than the position behind the thumb", () => {
    // The value on the input is an index. Read out as it stands a reader
    // hears "ten", which is a place in a list and not a height.
    render(panel({ layers: { cappi: true }, cappiLevel: "03.00" }));
    const slider = screen.getByRole("slider", {
      name: en["layers.cappiHeight"],
    });
    expect(slider.getAttribute("value")).toBe("10");
    expect(slider.getAttribute("aria-valuetext")).toBe("9,843 ft");
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

describe("reordering the layers from the keyboard", () => {
  it("keeps the button in the tab order and says what moved", () => {
    // A button that disables itself under the focus drops the focus on the
    // body, so a reader moving a layer to the top lost their place at the
    // exact moment they arrived there, and nothing said the order had
    // changed at all.
    const onOverlayOrder = vi.fn();
    const onOrderSaid = vi.fn();
    render(
      panel({
        layers: { weatherAlerts: true, stormReports: true },
        overlayOrder: ["stormReports", "alerts"],
        onOverlayOrder,
        onOrderSaid,
      }),
    );

    const list = document.querySelector(".layer-order");
    expect(list).toBeTruthy();
    const buttons = within(list as HTMLElement).getAllByRole("button");
    // Every one of them is still reachable, whatever it can do.
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }

    // The row at the top cannot go higher, and says so without leaving.
    const top = buttons[0];
    expect(top.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(top);
    expect(onOverlayOrder).not.toHaveBeenCalled();
    expect(onOrderSaid).not.toHaveBeenCalled();

    // Both directions, by name against the layer each one passed rather
    // than by position. Clicking whichever happens to be enabled would let a
    // missing announcement on one of the two go unnoticed.
    const up = buttons.filter((button) =>
      button.getAttribute("aria-label")?.startsWith("Move"),
    );
    const movable = up.filter(
      (button) => button.getAttribute("aria-disabled") !== "true",
    );
    expect(movable.length).toBe(2);
    for (const button of movable) fireEvent.click(button);

    expect(onOverlayOrder).toHaveBeenCalledTimes(2);
    expect(onOrderSaid).toHaveBeenCalledTimes(2);
    const said = onOrderSaid.mock.calls.map((call) => call[0] as string);
    for (const line of said) expect(line).not.toContain("{");

    // One of each direction, and the right way round. "Moved above" and
    // "moved below" are the whole content of the message, so a pair that
    // reads the same, or reads backwards, tells the reader nothing or
    // something false.
    // The words between the two layer names, which is the whole of what
    // distinguishes the two sentences.
    const between = (line: string) =>
      line.replace("{layer}", "").replace("{other}", "").trim();
    const above = between(en["layers.movedUp"]);
    const below = between(en["layers.movedDown"]);
    expect(above).not.toBe(below);
    expect(said.filter((line) => line.includes(above))).toHaveLength(1);
    expect(said.filter((line) => line.includes(below))).toHaveLength(1);
  });
});

describe("what an opacity slider is called", () => {
  it("keeps its name while it is dragged, and announces the value beside it", () => {
    // A control's name is what it is called. Both opacity sliders carried the
    // live percentage in the name as well as in `aria-valuetext`, so a screen
    // reader heard the reading twice on every step of a drag, and the name it
    // announced on focus was a different name a moment later.
    const onOverlayOpacity = vi.fn();
    const { rerender } = render(
      panel({
        layers: { weatherAlerts: true },
        overlayOpacity: { alerts: 0.35 },
        onOverlayOpacity,
      }),
    );
    const named = en["layers.opacityFor"].replace(
      "{layer}",
      en["layer.weatherAlerts"],
    );
    const slider = screen.getByRole("slider", { name: named });
    expect(slider.getAttribute("aria-valuetext")).toBe("35%");
    // The property, rather than the string: a name with the reading in it
    // carries a digit, whatever the catalogue happens to word it as.
    expect(slider.getAttribute("aria-label")).not.toMatch(/\d/);

    rerender(
      panel({
        layers: { weatherAlerts: true },
        overlayOpacity: { alerts: 0.7 },
        onOverlayOpacity,
      }),
    );
    // The same control, by the same name, reading something else.
    const moved = screen.getByRole("slider", { name: named });
    expect(moved.getAttribute("aria-valuetext")).toBe("70%");
    expect(moved.getAttribute("aria-label")).toBe(
      slider.getAttribute("aria-label"),
    );
  });
});

describe("what a layer's own source is doing", () => {
  const NOW = Date.parse("2026-09-09T18:00:00Z");

  /** Every layer idle, with one of them saying something else. */
  function states(id: OverlayId, state: Partial<OverlayState>): OverlayStates {
    const all = Object.fromEntries(
      OVERLAY_ADAPTERS.map((adapter) => [adapter.id, IDLE_OVERLAY]),
    ) as OverlayStates;
    return { ...all, [id]: { ...IDLE_OVERLAY, ...state } };
  }

  it("says a source is not answering, on the row that switches it", () => {
    // Diagnostics knows and the legend knows. Neither is where somebody is
    // looking a second after they pressed the switch and nothing happened.
    render(
      panel({
        layers: { earthquakes: true },
        now: NOW,
        overlayStates: states("earthquakes", {
          fetchedAt: NOW - 120_000,
          error: "The request failed.",
        }),
      }),
    );
    const said = screen.getByText(
      (_text, node) =>
        node?.getAttribute("data-layer-state") === "earthquakes:failed",
    );
    expect(said.textContent).toContain(en["layers.stateFailed"]);
    // With the age of what is still on the map, because the older picture is
    // the reason the layer is still showing something.
    expect(said.textContent).toContain("2");
  });

  it("says nothing at all about a layer that is switched off", () => {
    // Scoped to what this case rendered rather than to the document: the
    // renders in this file share one, so a whole-document query answers for
    // the case before it.
    const { container } = render(
      panel({
        layers: { earthquakes: false },
        now: NOW,
        overlayStates: states("earthquakes", {
          fetchedAt: NOW - 120_000,
          error: "The request failed.",
        }),
      }),
    );
    expect(
      container.querySelector('[data-layer-state^="earthquakes:"]'),
    ).toBeNull();
    // The layers that ARE on still say what they are doing, so this is the
    // switch being off rather than the whole panel having gone quiet.
    expect(container.querySelector("[data-layer-state]")).not.toBeNull();
  });

  it("says nothing about a layer with no source of its own", () => {
    // The national grids, the sweep and the reader's own files all answer
    // somewhere else, and a state read from an overlay they do not have would
    // be a sentence about the wrong thing.
    const { container } = render(
      panel({
        layers: { hail: true },
        now: NOW,
        overlayStates: states("earthquakes", {}),
      }),
    );
    expect(container.querySelector('[data-layer-state^="hail:"]')).toBeNull();
  });
});

describe("the seven headings the switches are read under", () => {
  it("puts every switch under one of them, and renders all seven", () => {
    // Forty-six switches ran together in the order they were added, so
    // finding one meant reading past thirty rows. A group nobody put a switch
    // in is a heading over nothing; a switch in no group is one that would
    // vanish from the panel, which is worse than the list it replaced.
    const { container } = render(panel({}));
    const headings = [...container.querySelectorAll("[data-layer-group]")].map(
      (node) => node.getAttribute("data-layer-group"),
    );
    expect(headings).toEqual([
      "hazards",
      "radar",
      "water",
      "sky2",
      "sky",
      "reference",
      "yours",
    ]);
    for (const group of headings) {
      const rows = container.querySelectorAll(
        `[data-layer-group="${group}"] .toggle-row`,
      );
      expect(rows.length, `${group} has no switches`).toBeGreaterThan(0);
    }
    // And nothing was lost on the way: every switch the panel used to show
    // is still on it, counted rather than named.
    expect(
      container.querySelectorAll(".setting-list .toggle-row"),
    ).toHaveLength(46);
  });

  it("names each heading in the reader's own language", () => {
    render(panel({}));
    expect(screen.getByText(en["layers.groupHazards"])).toBeTruthy();
    expect(screen.getByText(en["layers.groupYours"])).toBeTruthy();
  });

  it("files a switch where its answer comes from", () => {
    // Three anchors rather than the whole table, which would only be the
    // source written twice. What this catches is a switch filed somewhere a
    // reader would never look for it, which the counting above cannot see.
    const { container } = render(panel({}));
    const groupOf = (key: string) =>
      container
        .querySelector(`[data-layer="${key}"]`)
        ?.closest("[data-layer-group]")
        ?.getAttribute("data-layer-group") ?? null;
    expect(groupOf("weatherAlerts")).toBe("hazards");
    expect(groupOf("lightningFlashes")).toBe("sky2");
    expect(groupOf("customOverlay")).toBe("yours");
  });
});
