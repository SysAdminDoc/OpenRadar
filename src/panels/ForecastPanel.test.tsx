import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForecastPanel } from "./ForecastPanel";
import * as weather from "../lib/weather";

const forecast: weather.ForecastData = {
  currentTemperature: 88,
  apparentTemperature: 94,
  precipitation: 0,
  windSpeed: 7,
  weatherCode: 1,
  updatedAt: "2026-08-30T06:00",
  days: [
    {
      date: "2026-08-30",
      high: 92,
      low: 74,
      precipitationChance: 20,
      weatherCode: 1,
    },
  ],
};

let fetchForecast: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchForecast = vi
    .spyOn(weather, "fetchForecast")
    .mockResolvedValue(forecast);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ForecastPanel", () => {
  it("issues one request for a burst of small map moves", async () => {
    const { rerender } = render(
      <ForecastPanel point={{ lat: 32.78, lon: -96.8 }} onClose={() => {}} />,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchForecast).toHaveBeenCalledTimes(1);

    // Ten seconds of dragging around the same neighbourhood.
    for (let step = 1; step <= 20; step += 1) {
      rerender(
        <ForecastPanel
          point={{ lat: 32.78 + step * 0.001, lon: -96.8 - step * 0.001 }}
          onClose={() => {}}
        />,
      );
      await vi.advanceTimersByTimeAsync(500);
    }
    // Past the debounce window: a request would have fired by now.
    await vi.advanceTimersByTimeAsync(weather.FORECAST_DEBOUNCE_MS + 100);

    expect(fetchForecast).toHaveBeenCalledTimes(1);
  });

  it("debounces a real move into a single request", async () => {
    const { rerender } = render(
      <ForecastPanel point={{ lat: 32.78, lon: -96.8 }} onClose={() => {}} />,
    );
    await vi.advanceTimersByTimeAsync(0);

    for (const lat of [34, 36, 38, 40]) {
      rerender(
        <ForecastPanel point={{ lat, lon: -96.8 }} onClose={() => {}} />,
      );
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(weather.FORECAST_DEBOUNCE_MS);

    expect(fetchForecast).toHaveBeenCalledTimes(2);
    expect(fetchForecast.mock.lastCall?.[0]).toEqual({ lat: 40, lon: -96.8 });
  });

  it("keeps the last forecast on screen while a new one loads", async () => {
    const { getByText, rerender } = render(
      <ForecastPanel point={{ lat: 32.78, lon: -96.8 }} onClose={() => {}} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getByText("88°")).toBeTruthy();

    fetchForecast.mockReturnValue(new Promise(() => {}));
    rerender(
      <ForecastPanel point={{ lat: 40, lon: -96.8 }} onClose={() => {}} />,
    );
    await vi.advanceTimersByTimeAsync(weather.FORECAST_DEBOUNCE_MS);

    expect(getByText("88°")).toBeTruthy();
  });
});
