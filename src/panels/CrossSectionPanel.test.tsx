import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrossSectionPanel } from "./CrossSectionPanel";
import type { CrossSection } from "../lib/crossSection";

const line = {
  from: { lon: -94.1, lat: 41.6 },
  to: { lon: -93.4, lat: 41.9 },
};

function sliceOf(overrides: Partial<CrossSection> = {}): CrossSection {
  return {
    station: "KDMX",
    siteName: "Des Moines, IA",
    productId: "reflectivity",
    product: "Reflectivity",
    unit: "dBZ",
    paletteApplied: false,
    highContrast: false,
    dealiased: false,
    from: [-94.1, 41.6],
    to: [-93.4, 41.9],
    distanceKm: 64,
    topKm: 18,
    lowestCut: 0.48,
    highestCut: 4.3,
    tilts: [0.48, 0.87, 1.31, 1.8, 4.3],
    collected: "2026-08-30T09:21:59.000Z",
    volume: "2026/08/30/KDMX/KDMX20260830_092159_V06",
    width: 720,
    height: 260,
    image: "data:image/png;base64,AA",
    source: {
      kind: "recent",
      label: "NOAA NEXRAD Level II",
      url: null,
    },
    ...overrides,
  };
}

afterEach(cleanup);

describe("the panel a slice is read in", () => {
  it("labels the distance, the height, the cuts and the volume", async () => {
    render(
      <CrossSectionPanel
        line={line}
        take={() => Promise.resolve(sliceOf())}
        onClose={vi.fn()}
      />,
    );

    const picture = await screen.findByRole("img");
    // Everything a reader cannot get off the map, because the picture is not
    // one: how long the line is and how far up it reaches.
    expect(picture.getAttribute("alt")).toMatch(/Reflectivity from KDMX/);
    expect(picture.getAttribute("alt")).toMatch(/40 mi/);
    expect(screen.getByText(/Reflectivity \(dBZ\)/)).toBeTruthy();
    expect(screen.getByText(/cuts between 0\.48° and 4\.30°/)).toBeTruthy();
    expect(screen.getByText(/out of 5 in the volume/)).toBeTruthy();
    // And the one thing a picture of a storm must not be read as: the empty
    // bands are places nothing looked.
    expect(screen.getByText(/no beam passed through/)).toBeTruthy();
  });

  it("says which cuts drew nothing rather than leaving the picture unexplained", async () => {
    render(
      <CrossSectionPanel
        line={line}
        take={() =>
          Promise.resolve(sliceOf({ lowestCut: null, highestCut: null }))
        }
        onClose={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(/No cut of this volume reaches the line/),
    ).toBeTruthy();
  });

  it("shows what the native side said went wrong", async () => {
    render(
      <CrossSectionPanel
        line={line}
        take={() =>
          Promise.reject({
            code: "outOfRange",
            args: ["KDMX"],
            text: "both ends have to be within range of KDMX",
          })
        }
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText(/within range of KDMX/)).toBeTruthy();
    // And nothing is drawn, rather than an empty picture that reads as a
    // clear sky.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("says there is nothing to cut when the map is on the mosaic", async () => {
    const take = vi.fn();
    render(<CrossSectionPanel line={line} take={null} onClose={vi.fn()} />);
    expect(screen.getByText(/Zoom in over a NEXRAD site/)).toBeTruthy();
    await waitFor(() => expect(take).not.toHaveBeenCalled());
  });

  it("keeps the newest line when an older slice answers last", async () => {
    // Two lines in flight is what happens when a reader draws again before
    // the first answer lands. The one on screen has to be the one they asked
    // for last, whichever the network finishes first.
    let settleOld: (value: CrossSection) => void = () => {};
    const take = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<CrossSection>((resolve) => {
            settleOld = resolve;
          }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(sliceOf({ product: "Velocity", unit: "m/s" })),
      );

    const view = render(
      <CrossSectionPanel line={line} take={take} onClose={vi.fn()} />,
    );
    view.rerender(
      <CrossSectionPanel
        line={{ from: line.from, to: { lon: -93.0, lat: 42.1 } }}
        take={take}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Velocity \(m\/s\)/)).toBeTruthy();

    settleOld(sliceOf({ product: "Reflectivity" }));
    await waitFor(() =>
      expect(screen.getByText(/Velocity \(m\/s\)/)).toBeTruthy(),
    );
    expect(screen.queryByText(/Reflectivity \(dBZ\)/)).toBeNull();
  });
});
