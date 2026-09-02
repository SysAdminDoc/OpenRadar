import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuidancePanel } from "./GuidancePanel";
import { RoutePanel } from "./RoutePanel";
import { SearchPanel } from "./SearchPanel";
import { TidesPanel } from "./TidesPanel";
import * as guidance from "../lib/guidance";
import * as route from "../lib/route";
import * as tides from "../lib/tides";
import * as weather from "../lib/weather";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("search result truthfulness", () => {
  beforeEach(() => vi.useFakeTimers());

  it("removes the old query as soon as a new search starts or fails", async () => {
    const search = vi
      .spyOn(weather, "searchPlaces")
      .mockResolvedValueOnce([
        {
          id: 1,
          name: "Dallas",
          region: "Texas",
          country: "United States",
          lat: 32.78,
          lon: -96.8,
        },
      ])
      .mockRejectedValueOnce(new Error("service unavailable"));
    render(
      <SearchPanel
        onClose={() => {}}
        onSelect={() => {}}
        onSelectStorm={() => {}}
      />,
    );
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "Dallas" } });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(search).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Dallas")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Miami" } });
    expect(screen.queryByText("Dallas")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/search is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText("Dallas")).not.toBeInTheDocument();
  });
});

describe("tide location changes", () => {
  it("removes the prior station while the new coast is loading", async () => {
    const dallas = {
      id: "dallas",
      name: "Dallas Coast",
      state: "TX",
      lat: 32.78,
      lon: -96.8,
    };
    const newYork = {
      id: "new-york",
      name: "New York Harbor",
      state: "NY",
      lat: 40.7,
      lon: -74.01,
    };
    vi.spyOn(tides, "loadStations").mockResolvedValue([dallas, newYork]);
    let resolveSecond: ((reading: tides.TideReading) => void) | undefined;
    vi.spyOn(tides, "fetchTides")
      .mockResolvedValueOnce({
        station: dallas,
        distanceMiles: 2,
        extremes: [],
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const { rerender } = render(
      <TidesPanel
        point={{ lat: 32.78, lon: -96.8 }}
        clock={Date.now()}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/Dallas Coast/)).toBeInTheDocument();

    rerender(
      <TidesPanel
        point={{ lat: 40.7, lon: -74.01 }}
        clock={Date.now()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/Dallas Coast/)).not.toBeInTheDocument();
    expect(screen.getByText(/nearest tide station/i)).toBeInTheDocument();

    resolveSecond?.({
      station: newYork,
      distanceMiles: 1,
      extremes: [],
    });
  });
});

describe("guidance model selection", () => {
  it("keeps a real comparison by preventing fewer than two models", () => {
    vi.spyOn(guidance, "fetchGuidance").mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <GuidancePanel point={{ lat: 32.78, lon: -96.8 }} onClose={() => {}} />,
    );
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".segmented-control[aria-label='Models'] button",
      ),
    );
    expect(
      buttons.filter((button) => button.ariaPressed === "true"),
    ).toHaveLength(3);

    fireEvent.click(buttons[0]);
    const selected = buttons.filter((button) => button.ariaPressed === "true");
    expect(selected).toHaveLength(2);
    expect(selected.every((button) => button.disabled)).toBe(true);
    expect(screen.getByText(/at least two models/i)).toBeInTheDocument();
  });
});

describe("route fallback classification", () => {
  const start = {
    id: 1,
    name: "Dallas",
    region: "Texas",
    country: "United States",
    lat: 32.78,
    lon: -96.8,
  };
  const end = { ...start, id: 2, name: "Austin", lat: 30.27, lon: -97.74 };

  function fillAndPlan() {
    const fields = screen.getAllByRole("textbox");
    fireEvent.change(fields[0], { target: { value: "Dallas" } });
    fireEvent.change(fields[1], { target: { value: "Austin" } });
    fireEvent.click(screen.getByRole("button", { name: /plan the drive/i }));
  }

  it("offers a straight estimate only when the road router fails", async () => {
    vi.spyOn(weather, "searchPlaces")
      .mockResolvedValueOnce([start])
      .mockResolvedValueOnce([end]);
    vi.spyOn(route, "fetchRoute").mockRejectedValue(new Error("router down"));
    render(<RoutePanel onRoute={() => {}} onClose={() => {}} />);
    fillAndPlan();

    expect(
      await screen.findByRole("button", { name: /straight line instead/i }),
    ).toBeInTheDocument();
  });

  it("does not offer a straight estimate for a place-search failure", async () => {
    vi.spyOn(weather, "searchPlaces")
      .mockRejectedValueOnce(new Error("geocoder down"))
      .mockResolvedValueOnce([end]);
    const fetch = vi.spyOn(route, "fetchRoute");
    render(<RoutePanel onRoute={() => {}} onClose={() => {}} />);
    fillAndPlan();

    await waitFor(() =>
      expect(screen.getByText("geocoder down")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /straight line instead/i }),
    ).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
