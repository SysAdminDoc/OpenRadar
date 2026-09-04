import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalSection } from "./JournalSection";
import { RecapSection } from "./RecapSection";
import * as journal from "../lib/journal";
import { en } from "../i18n/en";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * A read that has not landed yet, which is the state every one of these
 * panels is in for its first frame and the one none of them drew for.
 */
function pending<T>(): { promise: Promise<T>; land: (value: T) => void } {
  let land!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    land = resolve;
  });
  return { promise, land };
}

const ROW: journal.JournalRow = {
  id: "row-1",
  at: "2026-09-04T12:05:00Z",
  place: "Polk County",
  kind: "alert",
  source: "Des Moines",
  observed: "2026-09-04T12:00:00Z",
  obtained: "From the warning feed",
  text: "Severe thunderstorm warning",
  note: "",
  thumb: "",
};

describe("a record that has not been read yet", () => {
  beforeEach(() => {
    vi.spyOn(journal, "journalAvailable").mockReturnValue(true);
    vi.spyOn(journal, "journalPath").mockResolvedValue("C:/journal.jsonl");
  });

  it("says nothing rather than saying the journal is empty", async () => {
    // "Nothing recorded yet." is the one sentence that must not be shown to
    // somebody whose record is full, and starting the rows at an empty array
    // showed it for a frame on every single open.
    const read = pending<journal.JournalRow[]>();
    vi.spyOn(journal, "journalRows").mockReturnValue(read.promise);

    render(
      <JournalSection
        clock={0}
        writing={true}
        onWriting={vi.fn()}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
        onCleared={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );

    expect(screen.queryByText(en["journal.empty"])).toBeNull();

    await act(async () => {
      read.land([ROW]);
      await read.promise;
    });

    // And still nothing, because the record was never empty.
    expect(screen.queryByText(en["journal.empty"])).toBeNull();
  });

  it("says the journal is empty once it knows that it is", async () => {
    const read = pending<journal.JournalRow[]>();
    vi.spyOn(journal, "journalRows").mockReturnValue(read.promise);
    render(
      <JournalSection
        clock={0}
        writing={true}
        onWriting={vi.fn()}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
        onCleared={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );

    await act(async () => {
      read.land([]);
      await read.promise;
    });

    expect(screen.getAllByText(en["journal.empty"]).length).toBeGreaterThan(0);
  });

  it("holds the year card back until the record has been read", async () => {
    const read = pending<journal.JournalRow[]>();
    vi.spyOn(journal, "journalRows").mockReturnValue(read.promise);
    render(
      <RecapSection
        clock={Date.parse("2026-09-04T12:00:00Z")}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    expect(screen.queryByText(en["recap.empty"])).toBeNull();

    await act(async () => {
      read.land([]);
      await read.promise;
    });

    expect(screen.getByText(en["recap.empty"])).toBeTruthy();
  });
});

describe("the ages on the diagnostics panel", () => {
  it("are driven by a clock rather than by whatever re-renders next", () => {
    // `ageLabel` reads `Date.now()` at render and the panel subscribed to
    // nothing, so a quiet source sat on "3 minutes ago" until something
    // unrelated moved. Read from the source, because a test that mounted the
    // panel and advanced a timer would pass on any hook that happens to
    // re-render, including one that does not tick.
    const source = readFileSync(
      join(import.meta.dirname, "UtilityPanels.tsx"),
      "utf8",
    );
    const at = source.indexOf("export function MorePanel");
    expect(at).toBeGreaterThan(-1);
    const rest = source.slice(at);
    const body = rest.slice(0, rest.search(/\n(export |function )/));
    expect(body).toContain("useMinuteClock()");
  });
});

describe("a record the panel cannot read", () => {
  beforeEach(() => {
    vi.spyOn(journal, "journalAvailable").mockReturnValue(true);
    vi.spyOn(journal, "journalPath").mockResolvedValue("C:/journal.jsonl");
  });

  it("says the record is empty rather than showing nothing at all", async () => {
    // Holding the empty sentence back until the read lands is right, and it
    // has to end. An uncaught rejection left `read` undefined for good, so
    // the panel drew no rows, no sentence and no error: a silent blank card,
    // which is worse than the one frame of wrong copy it replaced.
    vi.spyOn(journal, "journalRows").mockRejectedValue(
      new Error("the bridge is not there"),
    );
    render(
      <JournalSection
        clock={0}
        writing={true}
        onWriting={vi.fn()}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
        onCleared={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getAllByText(en["journal.empty"]).length).toBeGreaterThan(0);
  });

  it("does the same for the year card", async () => {
    vi.spyOn(journal, "journalRows").mockRejectedValue(
      new Error("the bridge is not there"),
    );
    render(
      <RecapSection
        clock={Date.parse("2026-09-04T12:00:00Z")}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(en["recap.empty"])).toBeTruthy();
  });
});
