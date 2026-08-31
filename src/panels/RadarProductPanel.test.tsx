import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { RadarProductPanel } from "./RadarProductPanel";

afterEach(cleanup);

describe("radar product mode", () => {
  it("shows the mosaic choice truthfully and leaves single-site mode", () => {
    const onRadar = vi.fn();
    const radar = {
      ...DEFAULT_SETTINGS.radar,
      enabled: false,
      singleSite: true,
    };
    render(
      <RadarProductPanel
        radar={radar}
        clock={Date.now()}
        singleSite={null}
        stormCells={{
          report: null,
          features: null,
          rotating: new Set(),
          loading: false,
          error: null,
        }}
        watch={DEFAULT_SETTINGS.watch}
        onRadar={onRadar}
        onClose={() => {}}
      />,
    );

    const mosaic = screen.getByRole("button", {
      name: /composite reflectivity/i,
    });
    expect(mosaic).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(mosaic);
    expect(onRadar).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, singleSite: false }),
    );
  });
});
