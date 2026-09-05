import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundingPanel } from "./SoundingPanel";
import { en } from "../i18n/en";

/**
 * The column of air over the middle of the map, and the three things it can
 * say before there is a chart.
 *
 * Two sources answer the same question here, an observed balloon and a model
 * column, and the panel has to keep "nobody launched one" apart from "the
 * service refused". The first is a fact about the afternoon and the second is
 * a fault, and a reader deciding whether to trust a forecast needs to know
 * which one they are looking at.
 */

const sounding = vi.hoisted(() => ({
  observed: vi.fn(),
  forecast: vi.fn(),
}));

vi.mock("../lib/sounding", async (original) => {
  const real = await original<typeof import("../lib/sounding")>();
  return {
    ...real,
    observedSounding: () => sounding.observed(),
    forecastSounding: () => sounding.forecast(),
  };
});

afterEach(() => {
  cleanup();
  sounding.observed.mockReset();
  sounding.forecast.mockReset();
});

/** Des Moines, which has a launch site near it either way. */
const CENTRE: [number, number] = [-93.6, 41.6];

function panel() {
  return <SoundingPanel center={CENTRE} at={1_756_747_800} onClose={vi.fn()} />;
}

describe("the column of air over the map", () => {
  it("says it is reading before either source has answered", () => {
    sounding.observed.mockReturnValue(new Promise(() => undefined));
    sounding.forecast.mockReturnValue(new Promise(() => undefined));
    render(panel());
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(document.querySelector(".spin")).toBeTruthy();
  });

  it("says nobody launched one rather than blaming the service", async () => {
    // A null answer is the sounding not existing, which is most afternoons
    // at most sites: balloons go up twice a day.
    sounding.observed.mockResolvedValue(null);
    sounding.forecast.mockResolvedValue(null);
    render(panel());
    await waitFor(() => expect(document.querySelector(".spin")).toBeNull());
    expect(screen.getByText(en["sounding.noneObserved"])).toBeTruthy();
  });

  it("says what the service said when it refused", async () => {
    sounding.observed.mockRejectedValue(new Error("the archive is busy"));
    sounding.forecast.mockRejectedValue(new Error("the archive is busy"));
    render(panel());
    await waitFor(() =>
      expect(screen.getAllByText("the archive is busy").length).toBeGreaterThan(
        0,
      ),
    );
    // Which is a different line from the one above: a fault, not a fact
    // about the afternoon.
    expect(screen.queryByText(en["sounding.noneObserved"])).toBeNull();
  });

  it("translates a refusal that carries no message of its own", async () => {
    // Anything that is not an Error came from the bridge rather than from the
    // service, and stringifying one puts [object Object] on the panel.
    sounding.observed.mockRejectedValue({ code: "nope" });
    sounding.forecast.mockRejectedValue({ code: "nope" });
    render(panel());
    await waitFor(() =>
      expect(
        screen.getAllByText(en["sounding.failedAny"]).length,
      ).toBeGreaterThan(0),
    );
  });
});
