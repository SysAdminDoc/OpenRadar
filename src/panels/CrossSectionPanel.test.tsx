import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrossSectionPanel } from "./CrossSectionPanel";
import type { CrossSection } from "../lib/crossSection";
import { en } from "../i18n/en";

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
    unplacedShare: 0,
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

  it("says how much of the slice the unfolding could not place", async () => {
    // The map's own legend has carried this for a while. A slice through the
    // same volume said only that the velocity had been unfolded, which tells a
    // reader it was worked on and not how much of what they are looking at is
    // still a guess.
    render(
      <CrossSectionPanel
        line={line}
        take={() =>
          Promise.resolve(sliceOf({ dealiased: true, unplacedShare: 0.34 }))
        }
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("img");
    // The volume, not the slice. The share is measured over every cut the
    // slice was taken from, and the map legend's wording ("34% still folded")
    // read as a fact about the picture on screen: a clean slice through a
    // volume whose far side would not unfold was described as a third folded.
    expect(
      screen.getByText(/34% of the volume this slice was taken from/),
    ).toBeTruthy();
  });

  it("says nothing about it when there is nothing to say", async () => {
    // Rounded to whole per cent and silent at nought, the same way the legend
    // is: a slice with a handful of gates nothing could place is not a line.
    render(
      <CrossSectionPanel
        line={line}
        take={() =>
          Promise.resolve(sliceOf({ dealiased: true, unplacedShare: 0.001 }))
        }
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("img");
    expect(screen.queryByText(/still folded/)).toBeNull();
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

  it("offers a way to hold a site when there is none to cut", async () => {
    // The panel named a precondition and gave no way to meet it: 55 pixels of
    // sentence in a 756 pixel panel, with the controls that would satisfy it
    // in another panel and on the map. The Upload panel in the same shell has
    // always ended its empty state with the one button that starts the thing.
    const holdSite = vi.fn();
    render(
      <CrossSectionPanel
        line={line}
        take={null}
        onHoldSite={holdSite}
        onClose={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: en["section.holdSite"] });
    button.click();
    expect(holdSite).toHaveBeenCalledTimes(1);
  });

  it("does not offer it once there is a volume to cut", async () => {
    // The positive control: a button that is always there is not an empty
    // state, it is a control in the wrong place.
    render(
      <CrossSectionPanel
        line={line}
        take={async () => sliceOf()}
        onHoldSite={() => {}}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByText(en["section.noSite"])).toBeNull(),
    );
    expect(
      screen.queryByRole("button", { name: en["section.holdSite"] }),
    ).toBeNull();
  });
});
