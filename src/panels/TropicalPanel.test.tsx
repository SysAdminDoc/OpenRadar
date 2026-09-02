import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TropicalPanel } from "./TropicalPanel";
import { EMPTY_OVERLAY, type OverlayData } from "../lib/overlays";
import { en } from "../i18n/en";

afterEach(cleanup);

/** One storm at forecast hour zero, which is the row the panel lists. */
function storms(bin: string): OverlayData {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-70, 25] },
        properties: {
          kind: "point",
          tau: 0,
          bin,
          name: "Ida",
          maxWind: 90,
          advisory: "12",
          advisoryDate: "2026-09-01",
        },
      },
    ],
  } as OverlayData;
}

function panel(
  fetchedAt: number | null,
  error: string | null,
  products: OverlayData = EMPTY_OVERLAY,
) {
  return (
    <TropicalPanel
      products={products}
      fetchedAt={fetchedAt}
      error={error}
      layerOn
      onEnableLayer={vi.fn()}
      onFollow={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe("the tropical feed state", () => {
  it("does not call a pending or failed request an empty result", () => {
    const { rerender } = render(panel(null, null));
    expect(screen.queryByText(en["tropical.noneTitle"])).toBeNull();
    expect(
      screen.getAllByText(en["tropical.noteLoading"]).length,
    ).toBeGreaterThan(0);

    rerender(panel(null, "service unavailable"));
    expect(screen.queryByText(en["tropical.noneTitle"])).toBeNull();
    expect(screen.getByText(/service unavailable/)).toBeTruthy();
  });

  it("shows the empty state after a successful empty response", () => {
    render(panel(Date.now(), null));
    expect(screen.getByText(en["tropical.noneTitle"])).toBeTruthy();
  });
});

describe("the link to the advisory", () => {
  it("opens the advisory the storm's own bin names", () => {
    render(panel(Date.now(), null, storms("at1")));
    const link = screen.getByRole("link", {
      name: en["tropical.readAdvisory"].replace("{name}", "Ida"),
    });
    expect(link.getAttribute("href")).toBe(
      "https://www.nhc.noaa.gov/graphics_at1.shtml",
    );
  });

  // What is NOT held here, said out loud: the panel puts this address through
  // the same check a map popup's link uses, and nothing the feed can send
  // makes that check refuse. The address is built from a hardcoded https
  // prefix, so the guard is there for the day somebody changes how it is
  // built. The invariant that makes it unreachable is pinned in
  // `tropical.test.ts` instead, where it belongs.

  it("renders no link when the feed named no advisory", () => {
    // The address is built from the storm's bin, so a record without one has
    // nothing to open, and a link that goes nowhere is worse than none.
    render(panel(Date.now(), null, storms("")));
    expect(screen.queryByRole("link")).toBeNull();
  });
});
