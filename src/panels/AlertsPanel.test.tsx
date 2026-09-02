import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertsPanel } from "./AlertsPanel";
import { EMPTY_OVERLAY, type OverlayData } from "../lib/overlays";
import { en } from "../i18n/en";

afterEach(cleanup);

function panel(
  alerts: OverlayData,
  fetchedAt: number | null,
  error: string | null,
  replaying = false,
) {
  return (
    <AlertsPanel
      alerts={alerts}
      viewport={null}
      fetchedAt={fetchedAt}
      error={error}
      layerOn
      calm={false}
      replaying={replaying}
      onEnableLayer={vi.fn()}
      onSelect={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

function withUrl(url: unknown): OverlayData {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-97, 32],
              [-96, 32],
              [-96, 33],
              [-97, 33],
              [-97, 32],
            ],
          ],
        },
        properties: {
          headline: "Tornado Warning",
          severity: "severe",
          issued: Date.now(),
          expires: Date.now() + 60_000,
          url,
        },
      },
    ],
  } as OverlayData;
}

describe("the link to the office's own page", () => {
  /**
   * The address comes out of the feed, which is remote input, and the panel
   * puts it straight into an href. Every other feed-driven link in the app
   * goes through the same check a map popup's does, and this one did not.
   */
  it("opens the office's page when the feed gives a real address", () => {
    render(
      panel(
        withUrl("https://api.weather.gov/alerts/urn:oid:2.49.0.1"),
        Date.now(),
        null,
      ),
    );
    const link = screen.getByRole("link", { name: en["alerts.openProduct"] });
    expect(link.getAttribute("href")).toBe(
      "https://api.weather.gov/alerts/urn:oid:2.49.0.1",
    );
  });

  it("renders no link at all for an address it will not open", () => {
    // Not https, so nothing in the app is willing to open it, and an anchor
    // that does nothing when clicked is worse than no anchor.
    for (const url of [
      "javascript:alert(1)",
      "http://api.weather.gov/alerts/1",
      "data:text/html,<script>1</script>",
      "https://user:pass@api.weather.gov/alerts/1",
      "not a url at all",
      "",
    ]) {
      cleanup();
      render(panel(withUrl(url), Date.now(), null));
      expect(
        screen.queryByRole("link", { name: en["alerts.openProduct"] }),
        url || "an empty address",
      ).toBeNull();
    }
  });
});

describe("the alerts feed state", () => {
  it("does not call a pending or failed request an empty result", () => {
    const { rerender } = render(panel(EMPTY_OVERLAY, null, null));
    expect(screen.queryByText(en["alerts.noneTitle"])).toBeNull();
    expect(
      screen.getAllByText(en["alerts.noteLoading"]).length,
    ).toBeGreaterThan(0);

    rerender(panel(EMPTY_OVERLAY, null, "service unavailable"));
    expect(screen.queryByText(en["alerts.noneTitle"])).toBeNull();
    expect(screen.getByText(/service unavailable/)).toBeTruthy();
  });

  it("writes severity as text as well as colour", () => {
    render(
      panel(
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [-97, 32],
                    [-96, 32],
                    [-96, 33],
                    [-97, 33],
                    [-97, 32],
                  ],
                ],
              },
              properties: {
                headline: "Tornado Warning",
                severity: "severe",
                issued: Date.now(),
                expires: Date.now() + 60_000,
              },
            },
          ],
        },
        Date.now(),
        null,
      ),
    );

    expect(screen.getByText(en["alerts.severity.severe"])).toBeTruthy();
  });

  it("does not claim a live check on a replay frame that held nothing", () => {
    // A frame of an archived day with no warning in force is an answer, and
    // deriving "this is history" from the polygons alone meant the footer
    // fell through to "checked just now" over a picture of 2022.
    render(panel(EMPTY_OVERLAY, Date.now(), null, true));
    expect(screen.queryByText(/checked/)).toBeNull();
    expect(screen.getByText(/from the Iowa State archive/)).toBeTruthy();
  });
});
