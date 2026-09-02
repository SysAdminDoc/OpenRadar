import { describe, expect, it } from "vitest";
import {
  occasionOn,
  occasionTheme,
  occasionWindows,
  occasionYear,
} from "./occasions";
import { THEME_TOKENS } from "./theme";

/**
 * A local date, built the way the machine reads one.
 *
 * `new Date(year, month, day)` is local time by definition, which is what
 * every question here is about: a season is a thing about where somebody is,
 * not about the zone their data is stamped in. The tests below run under the
 * suite's own zone and would run the same under any other, which is the
 * point.
 */
const on = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour);

const DALLAS = 32.78;
const CHRISTCHURCH = -43.53;

describe("which occasion a day is in", () => {
  it("opens and closes on the days the window says", () => {
    for (const window of occasionWindows()) {
      const [fromMonth, fromDay] = window.from;
      const [toMonth, toDay] = window.to;
      // The year matters for the wrapping window: December 2026 into
      // January 2027.
      expect(occasionOn(on(2026, fromMonth, fromDay), DALLAS), window.id).toBe(
        window.id,
      );
      const endYear = toMonth < fromMonth ? 2027 : 2026;
      expect(occasionOn(on(endYear, toMonth, toDay), DALLAS), window.id).toBe(
        window.id,
      );
      // And the day before it opens is not in it.
      const before = new Date(
        on(2026, fromMonth, fromDay).getTime() - 86_400_000,
      );
      expect(occasionOn(before, DALLAS), `before ${window.id}`).not.toBe(
        window.id,
      );
      const after = new Date(
        on(endYear, toMonth, toDay).getTime() + 86_400_000,
      );
      expect(occasionOn(after, DALLAS), `after ${window.id}`).not.toBe(
        window.id,
      );
    }
  });

  it("leaves most of the year plain", () => {
    // The whole point of a pack is that it is not always on.
    expect(occasionOn(on(2026, 2, 14), DALLAS)).toBeNull();
    expect(occasionOn(on(2026, 5, 20), DALLAS)).toBeNull();
    expect(occasionOn(on(2026, 9, 12), DALLAS)).toBeNull();
    expect(occasionOn(on(2026, 11, 26), DALLAS)).toBeNull();
  });

  it("reads the same on either side of local midnight", () => {
    // A minute before and a minute after, on the day a window opens. The
    // clock is local, so the answer changes exactly once and at midnight.
    const opens = occasionWindows()[0];
    const [month, day] = opens.from;
    expect(occasionOn(on(2026, month, day, 0), DALLAS)).toBe(opens.id);
    const lastMinute = new Date(on(2026, month, day, 0).getTime() - 60_000);
    expect(occasionOn(lastMinute, DALLAS)).not.toBe(opens.id);
  });

  it("runs six months along south of the equator", () => {
    // October is autumn in Ontario and spring in Canterbury, and a reader in
    // Canterbury should not be handed a pack for the wrong half of the year.
    expect(occasionOn(on(2026, 10, 15), DALLAS)).toBe("autumn");
    expect(occasionOn(on(2026, 10, 15), CHRISTCHURCH)).toBe("spring");
    expect(occasionOn(on(2026, 4, 15), DALLAS)).toBe("spring");
    expect(occasionOn(on(2026, 4, 15), CHRISTCHURCH)).toBe("autumn");
    // Midwinter is the one that wraps, so its shifted twin does not.
    expect(occasionOn(on(2026, 12, 20), DALLAS)).toBe("midwinter");
    expect(occasionOn(on(2026, 6, 20), CHRISTCHURCH)).toBe("midwinter");
  });

  it("is answered the same on 29 February", () => {
    // The windows are counted in days from the start of a common year, so a
    // leap day shifts every date after it by one if the arithmetic is wrong.
    // February is in no window either way, and the days around the spring
    // window in a leap year have to land where they do in any other.
    expect(occasionOn(on(2028, 2, 29), DALLAS)).toBeNull();
    expect(occasionOn(on(2028, 3, 14), DALLAS)).toBeNull();
    expect(occasionOn(on(2028, 3, 15), DALLAS)).toBe("spring");
    expect(occasionOn(on(2028, 4, 30), DALLAS)).toBe("spring");
    expect(occasionOn(on(2028, 5, 1), DALLAS)).toBeNull();
    // And the far side of the year, which is where a one-day drift would show.
    expect(occasionOn(on(2028, 10, 1), DALLAS)).toBe("autumn");
    expect(occasionOn(on(2028, 11, 15), DALLAS)).toBe("autumn");
    expect(occasionOn(on(2028, 11, 16), DALLAS)).toBeNull();
  });
});

describe("the year an occasion belongs to", () => {
  it("is the year its window began", () => {
    expect(occasionYear(on(2026, 10, 5), "autumn", DALLAS)).toBe(2026);
    // Midwinter opens in December, so the January days belong to the year
    // before: somebody who sent it away on the twentieth does not get it back
    // on the first.
    expect(occasionYear(on(2026, 12, 20), "midwinter", DALLAS)).toBe(2026);
    expect(occasionYear(on(2027, 1, 3), "midwinter", DALLAS)).toBe(2026);
    // South of the equator midwinter is in June and wraps nothing.
    expect(occasionYear(on(2026, 6, 20), "midwinter", CHRISTCHURCH)).toBe(2026);
  });
});

describe("what a pack is allowed to be", () => {
  it("is a theme and can reach nothing a theme cannot", () => {
    for (const window of occasionWindows()) {
      for (const base of ["dark", "light"] as const) {
        const theme = occasionTheme(window.id, base, "x");
        expect(theme, `${window.id} ${base}`).not.toBeNull();
        expect(theme?.base).toBe(base);
        const directives = THEME_TOKENS.map((token) => token.directive);
        for (const key of Object.keys(theme!.tokens)) {
          expect(directives, `${window.id} ${key}`).toContain(key);
        }
      }
    }
  });

  it("changes the accent and nothing that carries a reading", () => {
    // Named rather than derived: a pack that started setting a surface or a
    // border would be a decision somebody made, and this is where it is made.
    const theme = occasionTheme("autumn", "dark", "x");
    expect(Object.keys(theme!.tokens).sort()).toEqual([
      "Accent",
      "AccentSoft",
      "AccentStrong",
    ]);
  });
});
