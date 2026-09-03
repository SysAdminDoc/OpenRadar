import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { rememberWebviewVersion } from "../lib/crashReport";
import { diagnosticsBlock } from "../lib/diagnostics";
import { DEFAULT_SETTINGS, resetLayout } from "../lib/settings";
import { en } from "../i18n/en";

/** The line the report writes above a watched place, when it has one. */
const WATCHED_PLACE = "Watched place (added by the reader):";

afterEach(cleanup);

function Throws(): never {
  throw new Error("the sweep could not be drawn");
}

function ThrowsAString(): never {
  throw "a string, not an error";
}

/** jsdom has no clipboard at all, so it is defined rather than spied on. */
function clipboardInto(): string[] {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(String(text));
        return Promise.resolve();
      },
    },
  });
  return written;
}

describe("what a reader can do when the workspace will not draw", () => {
  it("hands over a report rather than only a reload button", () => {
    // The message alone said something had gone wrong and gave them nothing
    // to do but reload into the same crash. The tracker asks for a report the
    // app already knows how to write.
    const written = clipboardInto();
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
    // Both stacks, told apart by something only one of them has. Asserting
    // on the component name alone proved nothing: it appears in the React
    // component stack too, so dropping `error.stack` entirely left this
    // green. The thrown error's own stack opens with the `Error:` line, and
    // the component stack is the only one that reaches the boundary itself.
    expect(report).toContain("Error: the sweep could not be drawn");
    expect(report).toMatch(/at ErrorBoundary \(/);
    // And what the crash screen cannot know is stated as such rather than
    // guessed: nothing was drawing.
    expect(report).toContain("Map ready: false");
  });

  it("never carries the reader's watched place", () => {
    // The one thing in a report that is about the person rather than the
    // machine. It reaches a report only by being passed in, and the crash
    // screen has no app left to pass it.
    //
    // The header is asserted against the block's own output rather than
    // written out here from memory: the first version of this test looked for
    // the word "Watching", which appears nowhere in the product, so it would
    // have passed with the place printed in full.
    const withPlace = diagnosticsBlock({
      renderer: null,
      mapReady: true,
      radarReady: true,
      activeSource: null,
      health: [],
      log: [],
      place: { label: "Casa", latitude: 41.5868, longitude: -93.6501 },
    });
    expect(withPlace).toContain(WATCHED_PLACE);
    expect(withPlace).toContain("Casa");

    const written = clipboardInto();
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
    expect(written[0]).not.toContain(WATCHED_PLACE);
  });

  it("redacts a message that carries where the reader is", () => {
    // The message is the string most likely to carry a position: a failed
    // request names the URL it failed on, and a forecast request carries a
    // latitude and longitude to four decimals, which is about ten metres. It
    // went into the report raw while the stacks beside it were redacted.
    const report = diagnosticsBlock({
      renderer: null,
      mapReady: false,
      radarReady: false,
      activeSource: null,
      health: [],
      log: [],
      failure: {
        message:
          "Failed to fetch https://api.open-meteo.com/v1/forecast?latitude=41.5868&longitude=-93.6501",
        stack: null,
        componentStack: null,
      },
    });
    expect(report).toContain("The workspace stopped drawing");
    expect(report).not.toContain("41.5868");
    expect(report).not.toContain("-93.6501");
  });

  it("says so on the button when the clipboard refuses", () => {
    // Reading `navigator.clipboard` throws outright on a webview that has
    // none, before there is a promise for a catch to attach to, and React
    // does not catch what an event handler throws. The button did nothing and
    // said nothing, on the one screen whose whole job is producing this text.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Throws />
      </ErrorBoundary>,
    );
    noise.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: en["fatal.copy"] }));
    return screen.findByRole("button", { name: en["fatal.copyRefused"] });
  });

  it("never claims this is not a native window", () => {
    // The crash screen has no app left to run an effect, so it built its
    // report with nothing for the runtime and the report wrote that as "not a
    // native window" — a false statement, in the one report a reader sends
    // after a graphics crash. It now uses whatever the workspace read before
    // it stopped, and says unknown when nobody got that far.
    const written = clipboardInto();
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    rememberWebviewVersion("152.0.4191.62");
    render(
      <ErrorBoundary>
        <Throws />
      </ErrorBoundary>,
    );
    noise.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: en["fatal.copy"] }));
    expect(written[0]).toContain("Webview runtime: 152.0.4191.62");
    expect(written[0]).not.toContain("not a native window");
  });

  it("survives something thrown that is not an Error", () => {
    // `throw "boom"` has no message and no stack. The screen used to show an
    // empty paragraph and the report used to say the workspace stopped
    // drawing because of `undefined`.
    const written = clipboardInto();
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowsAString />
      </ErrorBoundary>,
    );
    noise.mockRestore();

    expect(screen.getByText("a string, not an error")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en["fatal.copy"] }));
    expect(written[0]).toContain("a string, not an error");
    expect(written[0]).not.toContain("undefined");
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
