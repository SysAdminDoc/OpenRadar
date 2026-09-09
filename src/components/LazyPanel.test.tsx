import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyPanel } from "./LazyPanel";
import { en } from "../i18n/en";
import { recentLog } from "../lib/log";

afterEach(cleanup);

function Throws(): never {
  throw new Error("Failed to fetch dynamically imported module");
}

/** A child that has not arrived, which is what a chunk on the way looks like. */
function Pending(): never {
  // Throwing a promise IS how a component tells React it is not ready. React
  // 19 still reads it, and `lazy` is built on it.
  throw new Promise<void>(() => {});
}

describe("a panel that arrives over the network", () => {
  it("keeps a failed chunk inside the panel's own frame", () => {
    // The failure this exists for. Every lazy panel used to throw past its
    // `Suspense` to the boundary in `main.tsx`, which unmounts the whole
    // workspace: the map, the timeline and the command bar went with a panel
    // the reader may never open again.
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <p>the map is still here</p>
        <LazyPanel
          title="Route"
          className="surface-panel--right"
          onClose={() => {}}
        >
          <Throws />
        </LazyPanel>
      </div>,
    );
    noise.mockRestore();

    expect(screen.getByText(en["panelChunk.failed"])).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Route" })).toBeTruthy();
    // Everything beside it is untouched, which is the whole point.
    expect(screen.getByText("the map is still here")).toBeTruthy();
  });

  it("keeps a chunk whose stylesheet did not arrive inside the frame too", () => {
    // Vite fetches a lazy chunk's CSS before the module and rejects with a
    // wording of its own when that fails. To a reader it is the same failure,
    // the panel did not arrive, but it matched none of the three engine
    // wordings, so this one was rethrown past the panel's frame and took the
    // whole workspace to the recovery screen: the outcome the frame exists to
    // prevent, reached by the one route it did not recognise.
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    function NoStylesheet(): never {
      throw new Error(
        "Unable to preload CSS for /assets/RoutePanel-a1b2c3d4.css",
      );
    }
    render(
      <div>
        <p>the map is still here</p>
        <LazyPanel
          title="Route"
          className="surface-panel--right"
          onClose={() => {}}
        >
          <NoStylesheet />
        </LazyPanel>
      </div>,
    );
    noise.mockRestore();

    expect(screen.getByText(en["panelChunk.failed"])).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Route" })).toBeTruthy();
    expect(screen.getByText("the map is still here")).toBeTruthy();
  });

  it("says which panel failed in the log, not which chunk", () => {
    // A hashed chunk file name tells a reader nothing and tells a report
    // nothing either. What they know is the panel they opened.
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <LazyPanel
        title="Tides"
        className="surface-panel--right"
        onClose={() => {}}
      >
        <Throws />
      </LazyPanel>,
    );
    noise.mockRestore();

    const said = recentLog().filter(
      (entry) => entry.scope === "panel" && entry.message.includes("Tides"),
    );
    expect(said.length).toBeGreaterThan(0);
    expect(said.at(-1)?.message).toContain("could not be fetched");
    expect(said.at(-1)?.level).toBe("error");
  });

  it("passes a panel's own render failure on to the fatal screen", async () => {
    // The boundary sits above the panel, so without a check it catches
    // everything the panel throws for the rest of the session and tells the
    // reader their download failed. It also costs them the screen that can
    // write a report: this one has no component stack, no diagnostics and no
    // way out of a layout the app cannot draw.
    function Breaks(): never {
      throw new Error("Cannot read properties of undefined (reading 'tilts')");
    }
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    const { log } = await import("../lib/log");
    const before = log ? recentLog().length : 0;
    expect(() =>
      render(
        <LazyPanel
          title="Settings"
          className="surface-panel--right"
          onClose={() => {}}
        >
          <Breaks />
        </LazyPanel>,
      ),
    ).toThrow(/reading 'tilts'/);
    noise.mockRestore();

    // And it says nothing about a fetch, in the log or on screen.
    expect(
      recentLog()
        .slice(before)
        .filter((entry) => entry.message.includes("could not be fetched")),
    ).toEqual([]);
  });

  it("holds the panel's own frame while the chunk is on the way", () => {
    // The second half of the defect. `data-panel-side` moves the map chrome
    // aside the moment the button is pressed, and a `null` fallback left it
    // shifted around nothing for as long as the chunk took.
    const { container } = render(
      <LazyPanel
        title="Wind Profile"
        className="surface-panel--right surface-panel--wide"
        onClose={() => {}}
      >
        <Pending />
      </LazyPanel>,
    );

    const waiting = container.querySelector("[data-panel-waiting]");
    expect(waiting).toBeTruthy();
    // The panel's own classes, or it holds a different amount of room than
    // the panel it stands in for and the chrome moves twice.
    expect(waiting?.className).toContain("surface-panel--wide");
    expect(screen.getByText("Wind Profile")).toBeTruthy();
  });

  it("can be closed while the chunk is still coming", () => {
    // A chunk that never arrives must not be a box with no way out of it.
    const closed = vi.fn();
    render(
      <LazyPanel
        title="Tides"
        className="surface-panel--right"
        onClose={closed}
      >
        <Pending />
      </LazyPanel>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Tides/ }));
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("gets out of the way of a panel that is already here", () => {
    // The ordinary path. A wrapper that drew a frame of its own around an
    // arrived panel would put two headers on screen, and the placeholder has
    // to be gone rather than merely behind it. The e2e case
    // `the wait for a chunk holds the room the panel is about to take` is
    // what watches the handover with a real chunk in flight.
    const { container } = render(
      <LazyPanel
        title="Wind Profile"
        className="surface-panel--right"
        onClose={() => {}}
      >
        <p>the wind profile</p>
      </LazyPanel>,
    );

    expect(screen.getByText("the wind profile")).toBeTruthy();
    expect(container.querySelector("[data-panel-waiting]")).toBeNull();
    expect(container.querySelectorAll("header")).toHaveLength(0);
  });
});
