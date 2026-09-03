import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { RadarProductPanel } from "./RadarProductPanel";
import type { SingleSiteState } from "../hooks/useSingleSiteRadar";
import type { SiteStatus } from "../lib/radarStatus";

afterEach(cleanup);

const CELLS = {
  report: null,
  features: null,
  rotating: new Set<string>(),
  loading: false,
  error: null,
};

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
        siteStatus={[]}
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

describe("the site picker and what the office says", () => {
  /** Enough of the hook's answer for the picker to draw itself. */
  const singleSite = {
    sweep: null,
    station: "KDMX",
    loading: false,
    error: null,
    active: false,
    loop: null,
    volumes: [],
    historical: false,
    mode: "recent",
    openLocal: async () => false,
    openArchive: async () => false,
    resumeRecent: () => {},
    crossSection: null,
    exportValues: null,
  } as unknown as SingleSiteState;

  function picker(siteStatus: SiteStatus[], station: string | null = null) {
    render(
      <RadarProductPanel
        radar={{ ...DEFAULT_SETTINGS.radar, singleSite: true, station }}
        clock={Date.parse("2026-09-03T02:06:00Z")}
        singleSite={singleSite}
        siteStatus={siteStatus}
        stormCells={CELLS}
        watch={DEFAULT_SETTINGS.watch}
        onRadar={vi.fn()}
        onClose={() => {}}
      />,
    );
    return screen.getByRole("combobox", { name: /radar site/i });
  }

  function option(name: RegExp) {
    return screen
      .getAllByRole("option")
      .find((one) => name.test(one.textContent ?? ""));
  }

  it("leaves every site choosable when nobody has said otherwise", () => {
    // An empty answer is a feed that has not arrived, not a network with
    // nothing wrong, and it must never grey anything out.
    picker([]);
    expect(option(/^TBWI/)?.hasAttribute("disabled")).toBe(false);
  });

  it("greys a radar the office says is not running, and says why", () => {
    // Offered plainly, a radar that is restarting is a choice that draws an
    // empty map with no explanation anywhere on screen.
    //
    // The fault here is the RDA's own word rather than Level II silence,
    // because every site this picker lists is a terminal radar and the app
    // draws those from Level III. A TDWR is never judged by a feed it does
    // not publish to; `radar_status.rs` holds that end of it.
    picker([
      {
        station: "TSDF",
        status: "Start-Up",
        levelTwoAt: "2026-09-03T02:05:00+00:00",
        fault: "notOperating",
      },
    ]);
    const down = option(/^TSDF/);
    expect(down?.hasAttribute("disabled")).toBe(true);
    expect(down?.textContent).toContain("Start-Up");
    // Its neighbours are untouched.
    expect(option(/^TBWI/)?.hasAttribute("disabled")).toBe(false);
  });

  it("never greys the site the reader is already holding", () => {
    // A select whose selected option is disabled draws an empty box, so
    // greying the site on screen would take the name of what they are looking
    // at off the screen. The reason still shows.
    const held = option.bind(null, /^TSDF/);
    picker(
      [
        {
          station: "TSDF",
          status: "Start-Up",
          levelTwoAt: "2026-09-03T02:05:00+00:00",
          fault: "notOperating",
        },
      ],
      "TSDF",
    );
    expect(held()?.hasAttribute("disabled")).toBe(false);
    expect(held()?.textContent).toContain("Start-Up");
  });
});
