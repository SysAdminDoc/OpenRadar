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
    onReportIssue?: (withPlace: boolean) => void;
  } = {},
) {
  return (
    <MorePanel
      onReportIssue={overrides.onReportIssue ?? vi.fn()}
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
        onExportPalette={vi.fn()}
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

  it("names each table button with the words that are on it", () => {
    // WCAG 2.5.3. What a control is called has to contain what it says, or
    // "click Save as a file" reaches nothing at all. Save shipped named
    // "Save {name} as a .pal file" while reading "Save as a file", so not
    // one word on the button was in its name; Remove beside it was right
    // from the start, which is the shape both follow now.
    render(upload([table("My reflectivity")]));
    const buttons = screen
      .getAllByRole("button")
      .filter((each) =>
        each.getAttribute("aria-label")?.includes("My reflectivity"),
      );
    // Both of them, so a row that stopped rendering one would not pass by
    // having nothing left to check.
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      const named = button.getAttribute("aria-label") ?? "";
      const shown = (button.textContent ?? "").trim();
      expect(shown.length, `${named} has no visible words`).toBeGreaterThan(0);
      expect(named.toLowerCase()).toContain(shown.toLowerCase());
    }
  });
});

describe("opening a report from the diagnostics panel", () => {
  it("copies the block and opens the form in one press", () => {
    // Two halves of one act. The block cannot travel in the address, so the
    // press has to do both or the reader arrives at an empty form.
    const onReportIssue = vi.fn();
    render(diagnostics({ onReportIssue }));

    const button = screen.getByRole("button", {
      name: en["diagnostics.report"],
    });
    fireEvent.click(button);

    expect(onReportIssue).toHaveBeenCalledTimes(1);
    // The argument is whether the reader asked for their watched place, which
    // is off until they say so, the same as the Copy button beside it.
    expect(onReportIssue).toHaveBeenCalledWith(false);
  });

  it("carries the watched place only once the reader has asked for it", () => {
    // The half that matters for privacy, and the half the test above cannot
    // reach: with no watched place the switch is never rendered, so `false`
    // is the only answer it could ever have given and a hardcoded `false`
    // would have passed it.
    const onReportIssue = vi.fn();
    render(diagnostics({ onReportIssue, hasWatchedPlace: true }));

    const consent = screen.getByRole("checkbox");
    expect(consent).toHaveProperty("checked", false);

    fireEvent.click(consent);
    fireEvent.click(
      screen.getByRole("button", { name: en["diagnostics.report"] }),
    );
    expect(onReportIssue).toHaveBeenCalledWith(true);
  });
});
