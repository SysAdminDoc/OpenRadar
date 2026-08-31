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
) {
  return (
    <AlertsPanel
      alerts={alerts}
      viewport={null}
      fetchedAt={fetchedAt}
      error={error}
      layerOn
      onEnableLayer={vi.fn()}
      onSelect={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

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
});
