import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLanguage, setLanguage } from "../i18n";
import { DEFAULT_APPROACH } from "../lib/approach";
import { DEFAULT_LIGHTNING_RULE } from "../lib/lightningWatch";
import type { OverlayData } from "../lib/overlays";
import { formatClock } from "../lib/units";
import { WATCH_POLL_MS, type WatchPlace } from "../lib/watch";
import { WatchBacktest } from "./WatchBacktest";

const fetchArchiveWarnings = vi.fn();
vi.mock("../hooks/useArchiveWarnings", () => ({
  fetchArchiveWarnings: (...args: unknown[]) => fetchArchiveWarnings(...args),
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

// The two notices that are not warnings, switched off as they ship.
const notOn = {
  lightning: DEFAULT_LIGHTNING_RULE,
  approach: DEFAULT_APPROACH,
  station: null,
};

const from = new Date(2026, 4, 20, 13, 30).getTime();
const to = new Date(2026, 4, 20, 16, 0).getTime();
const begin = new Date(2026, 4, 20, 14, 0).getTime();

const archived: OverlayData = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-96.9, 32.7],
            [-96.7, 32.7],
            [-96.7, 32.9],
            [-96.9, 32.9],
            [-96.9, 32.7],
          ],
        ],
      },
      properties: {
        headline: "Tornado Warning",
        severity: "extreme",
        kind: "tornado",
        impact: "",
        capId: "one",
        event: "FWD|2026|TO|W|1",
        issued: begin,
        expires: begin + 3_600_000,
        polygonBegin: begin,
        polygonEnd: begin + 3_600_000,
        historical: true,
      },
    },
  ],
};

beforeEach(() => {
  fetchArchiveWarnings.mockReset();
  delivered.mockReset();
});

afterEach(async () => {
  cleanup();
  setLanguage("en");
  await ensureLanguage("en");
});

describe("replaying the watch over a storm", () => {
  it("lists what each place would have been told and when, and tells nobody", async () => {
    fetchArchiveWarnings.mockResolvedValue({ data: archived, short: 0 });
    render(
      <WatchBacktest
        places={[home]}
        kinds={{}}
        {...notOn}
        from={from}
        to={to}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Replay the watch/ }));

    const place = await screen.findByText("Home");
    const list = place.closest("[data-backtest-place]");
    expect(list?.textContent).toContain("Tornado Warning");
    const said =
      from + Math.ceil((begin - from) / WATCH_POLL_MS) * WATCH_POLL_MS;
    expect(list?.querySelector("time")?.textContent).toBe(
      formatClock(said, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    expect(fetchArchiveWarnings).toHaveBeenCalledWith(
      from,
      to,
      expect.anything(),
    );
    // The place asked for a tone and a voice, and a backtest gives neither.
    expect(delivered).not.toHaveBeenCalled();
  });

  it("speaks the reader's language", async () => {
    await ensureLanguage("es");
    act(() => setLanguage("es"));
    render(
      <WatchBacktest
        places={[home]}
        kinds={{}}
        {...notOn}
        from={from}
        to={to}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Repetir la vigilancia/ }),
    ).toBeTruthy();
  });

  it("says there is nothing to replay when nowhere is watched", () => {
    render(
      <WatchBacktest
        places={[{ ...home, enabled: false }]}
        kinds={{}}
        {...notOn}
        from={from}
        to={to}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Replay the watch/ }),
    ).toBeNull();
    expect(screen.getByText(/You aren't watching anywhere yet/)).toBeTruthy();
  });

  it("says so when the archive does not answer", async () => {
    fetchArchiveWarnings.mockRejectedValue("no answer");
    render(
      <WatchBacktest
        places={[home]}
        kinds={{}}
        {...notOn}
        from={from}
        to={to}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Replay the watch/ }));
    expect(
      await screen.findByText(/The warnings archive didn't answer/),
    ).toBeTruthy();
  });
});
