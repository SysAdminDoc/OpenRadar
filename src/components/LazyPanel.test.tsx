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
    expect(said.at(-1)?.message).toContain("could not be drawn");
    expect(said.at(-1)?.level).toBe("error");
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
