import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandBar } from "./CommandBar";

afterEach(cleanup);

/** The rail with nothing switched on, which is what a first launch shows. */
function railed() {
  return render(
    <CommandBar
      activeSurface={null}
      activeTool={null}
      dualPane={false}
      projection="mercator"
      presets={[false, false, false]}
      onSurface={vi.fn()}
      onTool={vi.fn()}
      onLocate={vi.fn()}
      onDualPane={vi.fn()}
      onProjection={vi.fn()}
      onPreset={vi.fn()}
      onShare={vi.fn()}
    />,
  );
}

describe("the surfaces the rail can reach", () => {
  it("gives the readout and the sounding a button of their own", () => {
    // Both opened only by typing their name into Commands. The readout is the
    // one that answers the map in words, so the reader it exists for is the
    // one least able to guess what it is filed under; the sounding is what a
    // forecaster comes to this app for. A palette entry is not a way in for
    // somebody who does not already know the word.
    const { getByRole } = railed();
    for (const name of ["Nearby weather", "Sounding"]) {
      expect(getByRole("button", { name }), name).toBeTruthy();
    }
  });
});

describe("the compact command bar", () => {
  it("keeps the command palette as its route to the full workspace", () => {
    const onSurface = vi.fn();
    const { container } = render(
      <CommandBar
        activeSurface={null}
        activeTool={null}
        dualPane={false}
        projection="mercator"
        presets={[false, false, false]}
        onSurface={onSurface}
        onTool={vi.fn()}
        onLocate={vi.fn()}
        onDualPane={vi.fn()}
        onProjection={vi.fn()}
        onPreset={vi.fn()}
        onShare={vi.fn()}
      />,
    );

    const compact = container.querySelector(".compact-command-group");
    expect(compact).not.toBeNull();
    within(compact as HTMLElement)
      .getByRole("button", {
        name: "Commands",
      })
      .click();
    expect(onSurface).toHaveBeenCalledWith("commands");
  });
});
