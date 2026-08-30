import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import {
  distanceSlider,
  distanceUnit,
  distanceValue,
  forecastUnits,
  formatClock,
  formatDistance,
  formatHeight,
  formatReportMagnitude,
  formatTideHeight,
  setClockZone,
  setUnits,
  speedFromMetres,
  speedToMetres,
  speedUnit,
  useMeasurements,
} from "./units";

afterEach(() => {
  setUnits("imperial");
  setClockZone("local");
  setLanguage("en");
});

describe("the units the workspace reads in", () => {
  it("asks the service for what it is going to show", () => {
    // Converting a temperature twice is a rounding error waiting to happen,
    // and the service will answer in either.
    expect(forecastUnits()).toMatchObject({
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      precipitation_unit: "inch",
    });
    setUnits("metric");
    expect(forecastUnits()).toMatchObject({
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      precipitation_unit: "mm",
    });
  });

  it("names the unit alongside the number", () => {
    // The temperature has no unit of its own to show: the service is asked in
    // the scale it will be read in, so the number that arrives is already
    // right and the panel prints a bare degree sign.
    expect(speedUnit()).toBe("mph");
    setUnits("metric");
    expect(speedUnit()).toBe("km/h");
  });

  it("changes the size of the number as well as the word", () => {
    // The failure this guards against is a label that says kilometres over a
    // figure still counted in miles.
    expect(distanceValue(100)).toBe(100);
    expect(distanceUnit()).toBe("miles");
    setUnits("metric");
    expect(distanceValue(100)).toBe(161);
    expect(distanceUnit()).toBe("kilometres");
  });

  it("picks a small unit for a short distance", () => {
    expect(formatDistance(0.05)).toBe("264 ft");
    expect(formatDistance(3.25)).toBe("3.3 mi");
    expect(formatDistance(42)).toBe("42 mi");
    setUnits("metric");
    expect(formatDistance(0.05)).toBe("80 m");
    expect(formatDistance(3.25)).toBe("5.2 km");
    expect(formatDistance(42)).toBe("68 km");
  });

  it("converts a height and a tide", () => {
    expect(formatHeight(4800)).toBe("4,800 ft");
    expect(formatTideHeight(2.47)).toBe("2.47 ft");
    setUnits("metric");
    expect(formatHeight(4800)).toBe("1,463 m");
    expect(formatTideHeight(2.47)).toBe("0.75 m");
  });

  it("reads the clock in UTC when asked, and says that it has", () => {
    // Every weather product is stamped in UTC. Showing one without saying so
    // is how a forecast gets read four hours out.
    const at = Date.UTC(2026, 7, 30, 18, 5);
    setClockZone("utc");
    const shown = formatClock(at);
    expect(shown).toMatch(/^18:05Z$/);

    setClockZone("local");
    expect(formatClock(at)).not.toContain("Z");
  });

  it("marks a time and leaves a date alone", () => {
    // A Z after a bare weekday says nothing true. It belongs on a clock, and
    // on a format that already names the zone it would be said twice.
    const at = Date.UTC(2026, 7, 30, 18, 5);
    setClockZone("utc");
    expect(formatClock(at, { weekday: "short" })).not.toContain("Z");
    expect(
      formatClock(at, { hour: "numeric", timeZoneName: "short" }),
    ).not.toMatch(/Z$/);
    expect(formatClock(at, { hour: "numeric", minute: "2-digit" })).toMatch(
      /Z$/,
    );
  });

  it("tells anything that is still on screen that the choice changed", () => {
    // The map and the strip above it are mounted for the life of the window,
    // so a switch to metric has to reach them. They used to go on showing
    // miles until something unrelated happened to redraw them.
    const { result } = renderHook(() => useMeasurements());
    const before = result.current;
    act(() => setUnits("metric"));
    expect(result.current).not.toBe(before);
    expect(distanceUnit()).toBe("kilometres");

    const metric = result.current;
    act(() => setClockZone("utc"));
    expect(result.current).not.toBe(metric);

    // Setting the same choice again is not a change and must not redraw.
    const settled = result.current;
    act(() => setUnits("metric"));
    expect(result.current).toBe(settled);
  });

  it("puts a spotter's measurement in the reader's units", () => {
    // The report feed names its own unit per report, so a metric reader was
    // being shown hail in inches and wind in miles an hour.
    expect(formatReportMagnitude(1.75, "INCH")).toBe("1.75 INCH");
    expect(formatReportMagnitude(60, "MPH")).toBe("60 MPH");

    setUnits("metric");
    expect(formatReportMagnitude(1.75, "INCH")).toBe("4.4 cm");
    expect(formatReportMagnitude(60, "MPH")).toBe("97 km/h");
    expect(formatReportMagnitude(52, "KTS")).toBe("96 km/h");
    // A unit the feed uses that nothing converts is passed through rather than
    // relabelled as something it is not.
    expect(formatReportMagnitude(3, "E")).toBe("3 E");
  });

  it("takes a storm motion in the units it was typed in", () => {
    // The sweep is always handed metres a second. The box is not.
    expect(Math.round(speedFromMetres(10))).toBe(22);
    expect(speedToMetres(speedFromMetres(13.5))).toBeCloseTo(13.5, 5);

    setUnits("metric");
    expect(Math.round(speedFromMetres(10))).toBe(36);
    expect(speedToMetres(36)).toBeCloseTo(10, 5);
  });

  it("gives a slider round stops it can actually reach", () => {
    // Rounding the ends and then stepping between them left the metric
    // slider running 8, 18, 28 and its own maximum unreachable, while a
    // Spanish workspace picked the step by comparing a translated word to
    // the English "miles" and quietly changed grid.
    const imperial = distanceSlider(5, 200);
    expect(imperial).toEqual({ min: 5, max: 200, step: 5 });
    expect((imperial.max - imperial.min) % imperial.step).toBe(0);

    setUnits("metric");
    const metric = distanceSlider(5, 200);
    expect(metric.step).toBe(10);
    // Every stop is a round number of kilometres, the ends included.
    expect(metric.min % metric.step).toBe(0);
    expect(metric.max % metric.step).toBe(0);
    // The top of the range is always reachable. The bottom lands on the
    // nearest round stop, which for five miles is ten kilometres rather than
    // the eight it converts to: a slider whose first stop is 8 is not a
    // slider in round kilometres.
    expect(metric.max).toBeGreaterThanOrEqual(distanceValue(200));
    expect(Math.abs(metric.min - distanceValue(5))).toBeLessThan(metric.step);
  });

  it("picks the step from the units and not from a translated word", () => {
    // The step used to be chosen by comparing distanceUnit() to "miles",
    // which is "millas" in Spanish, so the imperial slider changed grid with
    // the language.
    setLanguage("es");
    expect(distanceSlider(5, 200).step).toBe(5);
    setUnits("metric");
    expect(distanceSlider(5, 200).step).toBe(10);
  });

  it("stops telling a component that has gone", () => {
    const listener = vi.fn();
    const { unmount } = renderHook(() => {
      listener();
      return useMeasurements();
    });
    unmount();
    listener.mockClear();
    act(() => setUnits("metric"));
    expect(listener).not.toHaveBeenCalled();
  });
});
