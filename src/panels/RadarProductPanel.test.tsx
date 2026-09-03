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
    inReach: [
      { station: "KTLX", city: "Oklahoma City", state: "OK", distanceKm: 25.3 },
      { station: "KFDR", city: "Frederick", state: "OK", distanceKm: 142.8 },
    ],
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

  it("lists them nearest first, with how far away each one is", () => {
    // The picker offered three things and none of them was a radar near you:
    // follow the map, hold what is on screen, or name an airport. During an
    // outage there was no way to choose the second-nearest site short of
    // knowing its call sign and typing it.
    picker([]);
    const listed = screen
      .getAllByRole("option")
      .map((one) => one.textContent ?? "")
      .filter((text) => /^K(TLX|FDR)/.test(text));
    expect(listed).toHaveLength(2);
    // Nearest first: the nearest radar sees lowest into a storm, so the order
    // is the recommendation.
    expect(listed[0]).toContain("KTLX");
    expect(listed[0]).toContain("Oklahoma City, OK");
    expect(listed[1]).toContain("KFDR");
    // And how far, in the reader's own units.
    expect(listed[0]).toMatch(/\d+\s*mi/);
  });

  it("greys one the office says is not running, and says which", () => {
    // The whole point of listing them: during an outage this is where
    // somebody picks the next radar along, and a site that will draw nothing
    // should say so rather than look like any other choice.
    picker([
      {
        station: "KTLX",
        status: "Start-Up",
        levelTwoAt: "2026-09-03T02:05:00+00:00",
        fault: "notOperating",
      },
    ]);
    const options = screen.getAllByRole("option");
    const down = options.find((one) => /^KTLX/.test(one.textContent ?? ""));
    const up = options.find((one) => /^KFDR/.test(one.textContent ?? ""));
    expect(down?.hasAttribute("disabled")).toBe(true);
    expect(down?.textContent).toContain("Start-Up");
    expect(up?.hasAttribute("disabled")).toBe(false);
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
