import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { DEFAULT_SETTINGS, resetLayout } from "../lib/settings";
import { en } from "../i18n/en";

afterEach(cleanup);

function Throws(): never {
  throw new Error("the sweep could not be drawn");
}

describe("what a reader can do when the workspace will not draw", () => {
  it("hands over a report rather than only a reload button", () => {
    // The message alone said something had gone wrong and gave them nothing
    // to do but reload into the same crash. The tracker asks for a report the
    // app already knows how to write.
    const written: string[] = [];
    // jsdom has no clipboard at all, so it is defined rather than spied on.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(String(text));
          return Promise.resolve();
        },
      },
    });
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Throws />
      </ErrorBoundary>,
    );
    noise.mockRestore();

    expect(screen.getByText("the sweep could not be drawn")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en["fatal.copy"] }));

    expect(written).toHaveLength(1);
    const report = written[0];
    expect(report).toContain("The workspace stopped drawing");
    expect(report).toContain("the sweep could not be drawn");
    // The stack is the part a tracker actually needs.
    expect(report).toContain("Throws");
    // And what the crash screen cannot know is stated as such rather than
    // guessed: nothing was drawing.
    expect(report).toContain("Map ready: false");
  });

  it("never carries the reader's watched place", () => {
    // The one thing in a report that is about the person rather than the
    // machine. It reaches a report only by being passed in, and the crash
    // screen has no app left to pass it.
    const written: string[] = [];
    // jsdom has no clipboard at all, so it is defined rather than spied on.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(String(text));
          return Promise.resolve();
        },
      },
    });
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Throws />
      </ErrorBoundary>,
    );
    noise.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: en["fatal.copy"] }));
    // A report that said nothing would pass the line below for the wrong
    // reason, so check first that a real one was written.
    expect(written[0]).toContain("the sweep could not be drawn");
    expect(written[0]).not.toContain("Watching");
  });
});

describe("putting the workspace back the way it opens", () => {
  it("resets what can wedge it and nothing a reader set up", () => {
    // The arrangement is what stops the window drawing: a camera somewhere
    // the projection cannot show, a text scale nothing fits at, an overlay
    // order left over from a file that is no longer loaded. What must survive
    // is everything they would otherwise have to set up again.
    const theirs = {
      ...DEFAULT_SETTINGS,
      camera: {
        center: [12.3, 45.6] as [number, number],
        zoom: 14,
        bearing: 90,
        pitch: 60,
      },
      textScale: 130 as const,
      projection: "globe" as const,
      overlayOrder: ["something", "left", "over"],
      overlayOpacity: { alerts: 0.1 },
      watch: {
        ...DEFAULT_SETTINGS.watch,
        enabled: true,
        name: "the house",
        center: [-93.6, 41.6] as [number, number],
      },
      layers: { ...DEFAULT_SETTINGS.layers, counties: true, vil: true },
      radar: { ...DEFAULT_SETTINGS.radar, station: "KDMX", loopVolumes: 22 },
    };

    const back = resetLayout(theirs);

    expect(back.camera).toEqual(DEFAULT_SETTINGS.camera);
    expect(back.textScale).toBe(DEFAULT_SETTINGS.textScale);
    expect(back.projection).toBe(DEFAULT_SETTINGS.projection);
    expect(back.overlayOrder).toEqual(DEFAULT_SETTINGS.overlayOrder);
    expect(back.overlayOpacity).toEqual(DEFAULT_SETTINGS.overlayOpacity);

    // Untouched, all of it.
    expect(back.watch.name).toBe("the house");
    expect(back.watch.center).toEqual([-93.6, 41.6]);
    expect(back.layers.counties).toBe(true);
    expect(back.layers.vil).toBe(true);
    expect(back.radar.station).toBe("KDMX");
    expect(back.radar.loopVolumes).toBe(22);
    expect(back.palettes).toEqual(theirs.palettes);
    expect(back.incidentPacks).toEqual(theirs.incidentPacks);
  });
});
