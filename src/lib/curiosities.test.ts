import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  foundAt,
  readCuriosities,
  FIND_MILES,
  FIND_ZOOM,
  type Curiosity,
} from "./curiosities";

const SHIPPED = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "..", "public", "curiosities.json"),
    "utf8",
  ),
) as unknown;

const SAID = (text: string) => ({ en: text, es: text, fr: text });

function one(over: Partial<Curiosity> = {}): Curiosity {
  return {
    id: "somewhere",
    title: SAID("Somewhere"),
    story: SAID("Something was measured here."),
    source: "An office",
    url: "https://example.invalid/story",
    place: { lon: -97, lat: 35 },
    ...over,
  };
}

const AT = (lon: number, lat: number, zoom = FIND_ZOOM) => ({
  center: [lon, lat] as [number, number],
  zoom,
});

describe("the set that ships with the app", () => {
  it("is every one of them, cited", () => {
    const read = readCuriosities(SHIPPED);
    expect(read.length).toBeGreaterThan(5);
    expect(read).toHaveLength((SHIPPED as unknown[]).length);
    for (const found of read) {
      // A story with nobody behind it is a story this app has no business
      // telling, so an uncited entry never reaches the screen.
      expect(found.source.length, found.id).toBeGreaterThan(0);
      expect(found.url, found.id).toMatch(/^https:\/\//);
      for (const which of ["en", "es", "fr"] as const) {
        // In every language the workspace is written in. A card that falls
        // back to English for a French reader is an untranslated surface,
        // and the stories are the whole of what these cards say.
        expect(
          found.story[which].length,
          `${found.id} ${which}`,
        ).toBeGreaterThan(40);
        expect(
          found.title[which].length,
          `${found.id} ${which}`,
        ).toBeGreaterThan(2);
      }
      // The story says who is speaking wherever the citation is the office's
      // front door rather than a page about that event, so a reader can check
      // it either way.
      // A page about the event, not just the office's front door: one path
      // segment is a landing page, which cites the publisher rather than the
      // claim.
      const deep =
        new URL(found.url).pathname.split("/").filter(Boolean).length > 1;
      // Any word of the office's name, other than the initials every one of
      // them shares. "The Portland forecast office" names NWS Portland.
      const names = found.source
        .split(/[\s,]+/)
        .filter((word) => word.length > 3 && word !== "NWS")
        .some((word) => found.story.en.includes(word));
      expect(deep || names, `${found.id} cites only a front door`).toBe(true);
    }
  });

  it("counts nobody's dead", () => {
    // These are places, and what happened at them is stated plainly. A body
    // count is not a curiosity, and this is the sort of rule that decays
    // quietly the first time somebody adds an entry without reading the
    // module it belongs to.
    const text = JSON.stringify(SHIPPED).toLowerCase();
    for (const word of [
      "killed",
      "deaths",
      "dead",
      "fatalities",
      "died",
      "casualt",
      "injur",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("keeps every place apart from every other", () => {
    // Two entries inside one another's find radius would mean one of them
    // could never be the nearest, and could never be found at all.
    const read = readCuriosities(SHIPPED);
    for (const found of read) {
      const others = read.filter((other) => other.id !== found.id);
      const near = foundAt(
        others,
        AT(found.place.lon, found.place.lat, FIND_ZOOM + 3),
        [],
      );
      expect(near, `${found.id} sits on top of ${near?.id}`).toBeNull();
    }
  });

  it("drops an entry that is not one", () => {
    expect(readCuriosities(null)).toEqual([]);
    expect(readCuriosities([{ id: "x" }])).toEqual([]);
    // No citation, no card.
    expect(readCuriosities([one({ url: "" })])).toEqual([]);
    expect(readCuriosities([one({ source: "" })])).toEqual([]);
    // And no card at all rather than one that falls back to English for a
    // French reader.
    expect(
      readCuriosities([
        one({ story: { en: "x".repeat(50), es: "", fr: "y" } as never }),
      ]),
    ).toEqual([]);
    // And a plain http link is not a citation this app will open.
    expect(readCuriosities([one({ url: "http://example.invalid" })])).toEqual(
      [],
    );
    // The same entry twice is one entry.
    expect(readCuriosities([one(), one()])).toHaveLength(1);
  });
});

describe("standing down during danger", () => {
  it("is gated where the card is drawn, not only where one is found", () => {
    // The card is state, and state outlives the condition that created it.
    // Gating only the detection left a note about a measurement taken in
    // 1934 sitting over a live warning: found in the quiet, still there when
    // the warning went up. Held by reading the source, because reproducing
    // it needs a second alerts poll to land mid-test.
    const app = readFileSync(
      join(import.meta.dirname, "..", "App.tsx"),
      "utf8",
    );
    // Across however many lines the condition takes: it grew a third
    // clause and a single-line read stopped seeing any of it.
    const drawn = app.slice(
      app.indexOf("{curiosity"),
      app.indexOf("<CuriosityCard"),
    );
    expect(drawn, "the card's own render condition").toContain("alertActive");
    expect(drawn).toContain("settings.curiosities");

    // And the detection is gated too, which is the half that was already
    // right: a card must not be found during a warning either.
    const hook = readFileSync(
      join(import.meta.dirname, "..", "App.tsx"),
      "utf8",
    );
    // The whole options object, however long the enabled clause grows.
    const at = hook.indexOf("useCuriosities({");
    const found = hook.slice(at, hook.indexOf("onFound:", at));
    expect(found).toContain("alertActive");
  });
});

describe("finding one", () => {
  const set = [
    one({ id: "near", place: { lon: -97, lat: 35 } }),
    one({ id: "far", place: { lon: -80, lat: 40 } }),
  ];

  it("needs somebody to have gone and looked at the place", () => {
    expect(foundAt(set, AT(-97, 35), [])?.id).toBe("near");
    // A reader looking at a whole continent has not explored to anywhere.
    expect(foundAt(set, AT(-97, 35, FIND_ZOOM - 1), [])).toBeNull();
    // And it has to be that place, not that half of the country.
    expect(foundAt(set, AT(-90, 35), [])).toBeNull();
  });

  it("answers with the nearest rather than the first in the file", () => {
    const two = [
      one({ id: "further", place: { lon: -97.3, lat: 35 } }),
      one({ id: "nearer", place: { lon: -97.05, lat: 35 } }),
    ];
    expect(foundAt(two, AT(-97, 35), [])?.id).toBe("nearer");
  });

  it("is found once and then left alone", () => {
    // A place that announced itself every time the map passed over it would
    // be a notification about the app rather than about the weather.
    expect(foundAt(set, AT(-97, 35), ["near"])).toBeNull();
  });

  it("holds its own radius", () => {
    const away = FIND_MILES / 69;
    expect(foundAt(set, AT(-97, 35 + away * 0.9), [])?.id).toBe("near");
    expect(foundAt(set, AT(-97, 35 + away * 1.2), [])).toBeNull();
  });
});
