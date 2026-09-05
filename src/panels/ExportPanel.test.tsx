import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportPanel, type DataExportOffer } from "./ExportPanel";
import { en } from "../i18n/en";

afterEach(cleanup);

/**
 * A catalogue string as a pattern.
 *
 * Several of these carry brackets, and a bare `new RegExp` turns "Export loop
 * (WebM)" into a pattern that matches "Export loop WebM" and nothing on the
 * screen.
 */
function like(label: string) {
  return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function panel(
  overrides: {
    frameCount?: number;
    busy?: string | null;
    mp4Ready?: boolean | null;
    dataExports?: DataExportOffer[];
    onExportImage?: () => void;
    keyCount?: number;
    keysInExport?: boolean;
    onKeysInExport?: (on: boolean) => void;
  } = {},
) {
  return (
    <ExportPanel
      frameCount={overrides.frameCount ?? 12}
      busy={overrides.busy ?? null}
      progress={null}
      onExportImage={overrides.onExportImage ?? vi.fn()}
      onExportPostcard={vi.fn()}
      placeName=""
      onExportLoop={vi.fn()}
      onExportMp4={vi.fn()}
      mp4Ready={overrides.mp4Ready ?? true}
      onExportGif={vi.fn()}
      dataExports={overrides.dataExports ?? []}
      keyCount={overrides.keyCount ?? 0}
      keysInExport={overrides.keysInExport ?? false}
      onKeysInExport={overrides.onKeysInExport ?? vi.fn()}
      onClose={vi.fn()}
    />
  );
}

/**
 * What can be written out, and what cannot.
 *
 * Every button here is disabled under some condition, and a button offered
 * over a condition it cannot meet is worse than one that is not there: the
 * reader presses it, nothing happens, and there is no way to tell whether
 * the export failed or was never going to run.
 */
describe("putting the layer keys in the picture", () => {
  it("offers nothing when no layer on the map has bands", () => {
    // A switch about layers nobody has on says nothing about this export.
    render(panel({ keyCount: 0 }));
    expect(
      screen.queryByRole("checkbox", { name: like(en["export.keys"]) }),
    ).toBeNull();
  });

  it("is off until the reader turns it on", () => {
    const onKeysInExport = vi.fn();
    render(panel({ keyCount: 2, onKeysInExport }));
    const box = screen.getByRole("checkbox", { name: like(en["export.keys"]) });
    expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(box);
    expect(onKeysInExport).toHaveBeenCalledWith(true);
  });

  it("says how many keys would go in", () => {
    // The whole line rather than a digit: the panel is full of numbers and a
    // bare /2/ matches the frame count beside it.
    render(panel({ keyCount: 2 }));
    expect(
      screen.getByText(
        "The scales for the 2 banded layers on screen go down the right-hand side of anything you save.",
      ),
    ).toBeTruthy();

    cleanup();
    render(panel({ keyCount: 1 }));
    expect(
      screen.getByText(
        "The scale for the one banded layer on screen goes down the right-hand side of anything you save.",
      ),
    ).toBeTruthy();
  });
});

describe("what the export panel offers", () => {
  it("offers nothing to make a loop from one frame", () => {
    // A loop of one frame is a picture, and the still export above it is
    // already the way to get one.
    render(panel({ frameCount: 1 }));
    for (const label of [
      en["export.loop"],
      en["export.mp4"],
      en["export.gif"],
    ]) {
      expect(
        screen
          .getByRole("button", { name: like(label) })
          .hasAttribute("disabled"),
        label,
      ).toBe(true);
    }
    // The still is still offered: one frame is enough for that.
    expect(
      screen
        .getByRole("button", { name: like(en["export.image"]) })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("says how many frames a loop would carry", () => {
    render(panel({ frameCount: 12 }));
    // Beside the WebM and the MP4, both of which carry the whole loop.
    expect(screen.getAllByText(/12 frames/).length).toBeGreaterThan(1);
    // The GIF says its own number, which is capped below the loop's.
    expect(screen.getByText(/last \d+ frames/)).toBeTruthy();
  });

  it("says why the MP4 is not on offer in this build", () => {
    // Playwright's Chromium has no H.264 encoder and Edge does, which is the
    // engine the packaged app runs. A button that simply did nothing here
    // would read as a broken export.
    render(panel({ mp4Ready: false }));
    expect(screen.getByText(en["export.mp4Missing"])).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: like(en["export.mp4"]) })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("says nothing about it while the answer is still being asked for", () => {
    // Null draws the button as it will be, so it does not appear a moment
    // after the panel does.
    render(panel({ mp4Ready: null }));
    expect(screen.queryByText(en["export.mp4Missing"])).toBeNull();
  });

  it("stops every export while one is running, and says which", () => {
    render(panel({ busy: "loop" }));
    for (const label of [
      en["export.image"],
      en["export.loop"],
      en["export.mp4"],
      en["export.gif"],
    ]) {
      expect(
        screen
          .getByRole("button", { name: like(label) })
          .hasAttribute("disabled"),
        label,
      ).toBe(true);
    }
    // The one that is running says so with a spinner rather than its icon.
    expect(document.querySelector(".spin")).toBeTruthy();
  });

  it("leaves out the readings section when nothing on screen has any", () => {
    render(panel({ dataExports: [] }));
    expect(document.querySelector("[data-data-exports]")).toBeNull();
    expect(screen.queryByText(en["export.dataHeading"])).toBeNull();
  });

  it("offers one row per dataset drawn, and runs the one pressed", () => {
    const run = vi.fn();
    render(
      panel({
        dataExports: [
          { id: "radar", label: "Radar values", format: "csv", run },
          { id: "grid", label: "MRMS composite", format: "tif", run: vi.fn() },
        ],
      }),
    );
    const section = document.querySelector("[data-data-exports]");
    expect(section).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Radar values as csv/ }),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs the still export when it is pressed", () => {
    const onExportImage = vi.fn();
    render(panel({ onExportImage }));
    fireEvent.click(
      screen.getByRole("button", { name: like(en["export.image"]) }),
    );
    expect(onExportImage).toHaveBeenCalledTimes(1);
  });
});
