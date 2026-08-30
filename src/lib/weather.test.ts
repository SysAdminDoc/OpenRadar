import { describe, expect, it } from "vitest";
import { shouldRefetchForecast, weatherCodeLabel } from "./weather";

describe("forecast refetch threshold", () => {
  const dallas = { lat: 32.78, lon: -96.8 };

  it("always fetches the first time", () => {
    expect(shouldRefetchForecast(null, dallas)).toBe(true);
  });

  it("ignores a pan that lands within a few miles", () => {
    expect(shouldRefetchForecast(dallas, { lat: 32.79, lon: -96.81 })).toBe(
      false,
    );
    expect(shouldRefetchForecast(dallas, dallas)).toBe(false);
  });

  it("fetches once the map has moved a real distance", () => {
    expect(shouldRefetchForecast(dallas, { lat: 32.9, lon: -96.8 })).toBe(true);
    expect(shouldRefetchForecast(dallas, { lat: 29.76, lon: -95.36 })).toBe(
      true,
    );
  });
});

describe("weather codes", () => {
  it("names the bands the panel shows", () => {
    expect(weatherCodeLabel(0)).toBe("Clear");
    expect(weatherCodeLabel(48)).toBe("Fog");
    expect(weatherCodeLabel(65)).toBe("Rain");
    expect(weatherCodeLabel(96)).toBe("Thunderstorms");
  });
});
