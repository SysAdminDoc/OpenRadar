import { describe, expect, it } from "vitest";
import {
  awayFor,
  catchUpFrom,
  CATCH_UP_GAP_MS,
  CATCH_UP_LINES,
} from "./catchUp";
import type { JournalRow } from "./journal";
import { formatClock } from "./units";

const NOW = Date.parse("2026-09-02T13:00:00.000Z");
const AWAY = NOW - 3 * 86_400_000;

function row(over: Partial<JournalRow> = {}): JournalRow {
  return {
    id: "one",
    at: new Date(NOW).toISOString(),
    place: "Casa",
    kind: "alert",
    source: "NWS",
    observed: new Date(NOW - 86_400_000).toISOString(),
    obtained: "a warning that reached a place you watch",
    text: "Severe Thunderstorm Warning",
    note: "",
    thumb: "",
    ...over,
  };
}

describe("what happened while the app was closed", () => {
  it("covers the gap and nothing outside it", () => {
    const before = row({
      id: "before",
      observed: new Date(AWAY - 60_000).toISOString(),
    });
    const during = row({ id: "during" });
    const summary = catchUpFrom([before, during], AWAY, NOW);
    expect(summary?.lines.map((line) => line.id)).toEqual(["during"]);
    expect(summary?.total).toBe(1);
  });

  it("says nothing at all when the app was barely away", () => {
    // A restart to change a setting is not an absence, and a summary of it is
    // the app talking about itself.
    expect(catchUpFrom([row()], NOW - CATCH_UP_GAP_MS + 1_000, NOW)).toBeNull();
    // A first run has no gap to measure from.
    expect(catchUpFrom([row()], 0, NOW)).toBeNull();
  });

  it("tells an empty gap apart from no gap at all", () => {
    // Two different answers. One means the app was not away; the other means
    // it was away and nothing happened, which is worth its own line.
    const quiet = catchUpFrom([], AWAY, NOW);
    expect(quiet).not.toBeNull();
    expect(quiet?.lines).toHaveLength(0);
    expect(quiet?.total).toBe(0);
  });

  it("caps the lines and still says how many there were", () => {
    const many = Array.from({ length: CATCH_UP_LINES + 4 }, (_, index) =>
      row({
        id: `row-${index}`,
        observed: new Date(AWAY + (index + 1) * 3_600_000).toISOString(),
      }),
    );
    const summary = catchUpFrom(many, AWAY, NOW);
    expect(summary?.lines).toHaveLength(CATCH_UP_LINES);
    // Newest first, and the count is the whole gap rather than what fitted,
    // so the rest is findable rather than hidden.
    expect(summary?.lines[0].id).toBe(`row-${CATCH_UP_LINES + 3}`);
    expect(summary?.total).toBe(CATCH_UP_LINES + 4);
  });

  it("leaves out a row whose time it cannot read", () => {
    // Placing it inside the gap would be a guess, and a guess is the one
    // thing a summary of what happened must not make.
    const summary = catchUpFrom([row({ observed: "last Tuesday" })], AWAY, NOW);
    expect(summary?.lines).toHaveLength(0);
  });

  it("dates every line by when the weather happened", () => {
    // A warning that reached somewhere on Tuesday is not a warning now, and a
    // line carrying the wrong time reads like one. Asserting the string is
    // merely non-empty proves nothing: every row that reaches here has a
    // readable date already, so that could not fail.
    const observed = Date.parse("2026-08-31T15:20:00.000Z");
    const summary = catchUpFrom(
      [row({ observed: new Date(observed).toISOString() })],
      AWAY,
      NOW,
    );
    expect(summary?.lines[0].when).toBe(
      formatClock(observed, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    // And it is the observed time, not the time the row was written down,
    // which for a warning is the moment a poll came back.
    expect(summary?.lines[0].when).not.toBe(
      formatClock(Date.parse(row().at), {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  });

  it("measures the gap against when it was worked out", () => {
    // The card can sit on screen for hours, and it is held back entirely
    // while a warning stands. A figure read off the live clock grew the
    // longer it waited, while the lines under it covered the real gap.
    const summary = catchUpFrom([row()], AWAY, NOW);
    expect(summary?.at).toBe(NOW);
    expect(awayFor(summary!.since, summary!.at)).toBe(awayFor(AWAY, NOW));
  });

  it("says how long it was away in hours, then in days", () => {
    expect(awayFor(NOW - 5 * 3_600_000, NOW)).toContain("5");
    expect(awayFor(NOW - 5 * 86_400_000, NOW)).toContain("5");
  });
});
