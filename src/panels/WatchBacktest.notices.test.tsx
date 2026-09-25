import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { DEFAULT_APPROACH } from "../lib/approach";
import type { FlashReplay } from "../lib/lightningReplay";
import { DEFAULT_LIGHTNING_RULE } from "../lib/lightningWatch";
import { formatClock } from "../lib/units";
import type { WatchPlace } from "../lib/watch";
import { WatchBacktest } from "./WatchBacktest";

const fetchArchiveWarnings = vi.fn();
vi.mock("../hooks/useArchiveWarnings", () => ({
  fetchArchiveWarnings: (...args: unknown[]) => fetchArchiveWarnings(...args),
}));
const fetchFlashReplay = vi.fn();
vi.mock("../lib/lightningReplay", async (original) => ({
  ...(await original<typeof import("../lib/lightningReplay")>()),
  fetchFlashReplay: (...args: unknown[]) => fetchFlashReplay(...args),
}));
const fetchCellsReplay = vi.fn();
vi.mock("../lib/cells", async (original) => ({
  ...(await original<typeof import("../lib/cells")>()),
  cellsAvailable: () => true,
  fetchCellsReplay: (...args: unknown[]) => fetchCellsReplay(...args),
}));
vi.mock("../hooks/useLightning", async (original) => ({
  ...(await original<typeof import("../hooks/useLightning")>()),
  lightningAvailable: () => true,
}));

// Everything that could reach the reader, so a backtest that did would show.
const delivered = vi.fn();
vi.mock("../lib/notify", () => ({
  announceOnDesktop: (...args: unknown[]) => delivered("desktop", ...args),
  speak: (...args: unknown[]) => delivered("voice", ...args),
}));
vi.mock("../lib/sound", () => ({
  playAlertTone: (...args: unknown[]) => delivered("tone", ...args),
}));
vi.mock("../lib/journal", () => ({
  appendJournalRow: (...args: unknown[]) => delivered("record", ...args),
}));

const home: WatchPlace = {
  id: "home",
  name: "Home",
  named: false,
  enabled: true,
  center: [-96.8, 32.78],
  radiusMiles: 30,
  minSeverity: "moderate",
  sound: true,
  voice: true,
};

const from = new Date(2026, 4, 20, 13, 30).getTime();
const to = new Date(2026, 4, 20, 16, 0).getTime();
const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** A flash over home in every file from two o'clock to twenty past. */
function stormyAfternoon(): FlashReplay {
  const files = [];
  const flashes = [];
  const start = new Date(2026, 4, 20, 14).getTime() / 1000;
  for (let time = from / 1000 - 300; time <= to / 1000; time += 20) {
    files.push({ time, read: true, flashes: 50 });
    if (time >= start && time <= start + 1200) {
      flashes.push({
        latitude: 32.8,
        longitude: -96.8,
        energyJoules: 1,
        areaSquareKm: 1,
        time,
        order: 0,
      });
    }
  }
  return {
    satellite: "GOES-19 East",
    windowMinutes: 5,
    fileSeconds: 20,
    maxFiles: 15,
    maxFlashes: 20_000,
    files,
    flashes,
  };
}

const lightningOn = { ...DEFAULT_LIGHTNING_RULE, enabled: true, count: 3 };
const approachOn = { ...DEFAULT_APPROACH, enabled: true };

beforeEach(() => {
  fetchArchiveWarnings.mockReset();
  fetchArchiveWarnings.mockResolvedValue({
    data: { type: "FeatureCollection", features: [] },
    short: 0,
  });
  fetchFlashReplay.mockReset();
  fetchCellsReplay.mockReset();
  delivered.mockReset();
});

afterEach(cleanup);

function replay(props: Partial<Parameters<typeof WatchBacktest>[0]> = {}) {
  render(
    <WatchBacktest
      places={[home]}
      kinds={{}}
      lightning={DEFAULT_LIGHTNING_RULE}
      approach={DEFAULT_APPROACH}
      station={null}
      from={from}
      to={to}
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Replay the watch/ }));
}

describe("replaying the lightning and approach notices", () => {
  it("no longer says they can't be replayed", () => {
    render(
      <WatchBacktest
        places={[home]}
        kinds={{}}
        lightning={lightningOn}
        approach={approachOn}
        station="KFWS"
        from={from}
        to={to}
      />,
    );
    const note = document.querySelector(
      "[data-watch-backtest] .source-note",
    )?.textContent;
    expect(note).toBe(en["backtest.note"]);
    expect(note).not.toMatch(/can't be replayed/);
  });

  it("lists when lightning started and when it went quiet, and tells nobody", async () => {
    fetchFlashReplay.mockResolvedValue(stormyAfternoon());
    replay({ lightning: lightningOn });
    const place = await screen.findByText("Home");
    const lines = [
      ...(place
        .closest("[data-backtest-place]")
        ?.querySelectorAll("[data-backtest-kind='lightning']") ?? []),
    ];
    expect(
      lines.map((line) => line.querySelector("time")?.textContent),
    ).toEqual([
      formatClock(new Date(2026, 4, 20, 14, 1).getTime(), WHEN),
      formatClock(new Date(2026, 4, 20, 14, 50).getTime(), WHEN),
    ]);
    expect(lines[0].textContent).toContain(en["lightningWatch.titleHome"]);
    expect(lines[1].textContent).toContain(en["lightningWatch.quietBody"]);
    // Asked for the places being watched, at the radius the reader chose.
    expect(fetchFlashReplay).toHaveBeenCalledWith(
      from,
      to,
      [home],
      lightningOn.radiusMiles,
    );
    // The place asked for a tone and a voice, and a backtest gives neither.
    expect(delivered).not.toHaveBeenCalled();
  });

  it("asks nothing of an archive for a notice that is off, and says so", async () => {
    replay();
    expect(await screen.findByText(en["backtest.lightningOff"])).toBeTruthy();
    expect(screen.getByText(en["backtest.approachOff"])).toBeTruthy();
    expect(fetchFlashReplay).not.toHaveBeenCalled();
    expect(fetchCellsReplay).not.toHaveBeenCalled();
  });

  it("asks for a held site before replaying its storm tracking", async () => {
    replay({ approach: approachOn });
    expect(
      await screen.findByText(en["backtest.approachNoStation"]),
    ).toBeTruthy();
    expect(fetchCellsReplay).not.toHaveBeenCalled();
  });

  it("reads the held site's tracking, and says which site it was", async () => {
    fetchCellsReplay.mockResolvedValue({ reports: [], unread: 0 });
    replay({ approach: approachOn, station: "KFWS" });
    expect(
      await screen.findByText(
        en["backtest.approachNoArchive"].replace("{station}", "KFWS"),
      ),
    ).toBeTruthy();
    expect(fetchCellsReplay).toHaveBeenCalledWith("KFWS", from, to);
  });

  it("keeps the warnings when an archive for the other two fails", async () => {
    fetchFlashReplay.mockRejectedValue("the flash listing could not be read");
    fetchCellsReplay.mockRejectedValue("no answer");
    replay({ lightning: lightningOn, approach: approachOn, station: "KFWS" });
    expect(
      await screen.findByText(en["backtest.lightningFailed"]),
    ).toBeTruthy();
    expect(
      screen.getByText(
        en["backtest.approachFailed"].replace("{station}", "KFWS"),
      ),
    ).toBeTruthy();
    // The warnings still answered, so every place is still listed.
    expect(screen.getByText(en["backtest.nothing"])).toBeTruthy();
  });

  it("says the archive has nothing rather than calling the sky quiet", async () => {
    fetchFlashReplay.mockResolvedValue({
      ...stormyAfternoon(),
      files: [],
      flashes: [],
    });
    replay({ lightning: lightningOn });
    expect(
      await screen.findByText(en["backtest.lightningNoArchive"]),
    ).toBeTruthy();
  });
});
