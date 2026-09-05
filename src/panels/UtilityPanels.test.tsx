import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MorePanel, UploadPanel } from "./UtilityPanels";
import { en } from "../i18n/en";
import type { ProviderHealth } from "../lib/providers";

afterEach(cleanup);

function diagnostics(
  overrides: {
    health?: ProviderHealth[];
    log?: Array<{ at: number; level: string; scope: string; message: string }>;
    hasWatchedPlace?: boolean;
    onCopyDiagnostics?: (withPlace: boolean) => void;
  } = {},
) {
  return (
    <MorePanel
      onClose={vi.fn()}
      update={{ status: "idle" } as never}
      onUpdate={null}
      radarReady
      mapReady
      activeSource="MRMS"
      health={overrides.health ?? []}
      log={(overrides.log ?? []) as never}
      onOpenLogFolder={vi.fn()}
      onCopyDiagnostics={overrides.onCopyDiagnostics ?? vi.fn()}
      hasWatchedPlace={overrides.hasWatchedPlace ?? false}
    />
  );
}

/**
 * The panel a bug report is written from, and the one a colour table is
 * loaded through.
 *
 * What matters in both is the empty state. Diagnostics with no log is a quiet
 * afternoon rather than a broken panel, and the switch that puts a reader's
 * watched place into a report has to be absent when there is no place and off
 * when there is: a switch that remembered would quietly put somebody's home
 * in the next report they sent.
 */
describe("the diagnostics panel", () => {
  it("says a source is standing by before it has answered", () => {
    render(diagnostics());
    expect(
      screen.getAllByText(en["diagnostics.standingBy"]).length,
    ).toBeGreaterThan(0);
  });

  it("says what a source failed with, and how many times in a row", () => {
    render(
      diagnostics({
        health: [
          {
            id: "mrms",
            lastSuccess: null,
            lastFailure: Date.now() - 60_000,
            lastError: "the service returned 503",
            consecutiveFailures: 3,
            frameCount: 0,
          },
        ],
      }),
    );
    // The count in full, not a digit that happens to be somewhere on the
    // line: the error string carries a 503, so a bare digit match reads as
    // green whatever number the panel puts in the count.
    expect(
      screen.getByText("the service returned 503 (3 in a row)"),
    ).toBeTruthy();
  });

  it("says nothing is wrong rather than showing an empty list", () => {
    render(diagnostics({ log: [] }));
    expect(screen.getByText(en["diagnostics.nothingWrong"])).toBeTruthy();
    // A list that owns no list items is a broken list rather than an empty
    // one, which is what every accessibility gate in the suite reports. The
    // sources above have their own list and it is never empty.
    expect(document.querySelector(".diagnostics-log ol")).toBeNull();
  });

  it("offers the watched place only when there is one, and never by default", () => {
    const onCopyDiagnostics = vi.fn();
    render(diagnostics({ hasWatchedPlace: false, onCopyDiagnostics }));
    expect(screen.queryByText(en["diagnostics.includePlace"])).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: en["diagnostics.copy"] }),
    );
    expect(onCopyDiagnostics).toHaveBeenCalledWith(false);
  });

  it("puts the place in only after the reader asks for it", () => {
    const onCopyDiagnostics = vi.fn();
    render(diagnostics({ hasWatchedPlace: true, onCopyDiagnostics }));
    const consent = screen.getByRole("checkbox", {
      name: new RegExp(en["diagnostics.includePlace"]),
    });
    expect((consent as HTMLInputElement).checked).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: en["diagnostics.copy"] }),
    );
    expect(onCopyDiagnostics).toHaveBeenLastCalledWith(false);

    fireEvent.click(consent);
    fireEvent.click(
      screen.getByRole("button", { name: en["diagnostics.copy"] }),
    );
    expect(onCopyDiagnostics).toHaveBeenLastCalledWith(true);
  });
});

describe("the upload panel", () => {
  /** One table, shaped the way the parser hands them over. */
  function table(name: string) {
    return {
      name,
      product: null,
      units: "dBZ",
      step: null,
      stops: [
        { value: 5, color: "#04e9e7", toColor: null },
        { value: 75, color: "#fdfdfd", toColor: null },
      ],
      rangeFolded: null,
      skipped: [],
    };
  }

  function upload(palettes: Array<ReturnType<typeof table>> = []) {
    return (
      <UploadPanel
        onClose={vi.fn()}
        onFile={vi.fn()}
        palettes={palettes as never}
        paletteAssignments={{}}
        onAssignPalette={vi.fn()}
        onRemovePalette={vi.fn()}
      />
    );
  }

  it("says nothing about a library nobody has put anything in", () => {
    render(upload([]));
    expect(screen.queryByText(en["upload.libraryHeading"])).toBeNull();
  });

  it("lists the tables that have been loaded", () => {
    render(upload([table("My reflectivity")]));
    expect(screen.getByText(en["upload.libraryHeading"])).toBeTruthy();
    expect(screen.getByText(/My reflectivity/)).toBeTruthy();
  });
});
