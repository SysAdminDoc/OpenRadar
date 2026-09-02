import { describe, expect, it } from "vitest";
import { allCommands, searchCommands } from "./commands";
import { DEFAULT_SETTINGS } from "./settings";
import { ensureLanguage } from "../i18n";

const commands = allCommands();

function find(query: string): string[] {
  return searchCommands(commands, query).map((command) => command.id);
}

describe("what the palette offers", () => {
  it("covers every layer, product, map type, panel, tool and layout", () => {
    // Written out rather than derived, deliberately: a group appearing that
    // nobody meant to add is the thing this catches, so adding one is meant
    // to be a decision somebody made here.
    const groups = new Set(commands.map((command) => command.group));
    expect([...groups].sort()).toEqual([
      "Layer",
      "Layout",
      "Map type",
      "Panel",
      "Radar product",
      "Tool",
    ]);
    // Nothing is listed twice, which a palette built from several registries
    // is one careless spread away from.
    expect(new Set(commands.map((command) => command.id)).size).toBe(
      commands.length,
    );
    expect(commands.every((command) => command.label.trim().length > 1)).toBe(
      true,
    );

    const layerIds = commands
      .filter((command) => command.action.kind === "layer")
      .map((command) =>
        command.action.kind === "layer" ? command.action.layer : "",
      )
      .sort();
    expect(layerIds).toEqual(Object.keys(DEFAULT_SETTINGS.layers).sort());
    expect(commands.map((command) => command.id)).toContain(
      "surface:radar-product",
    );
  });

  it("offers everything when nothing has been typed", () => {
    expect(searchCommands(commands, "")).toHaveLength(commands.length);
    expect(searchCommands(commands, "   ")).toHaveLength(commands.length);
  });
});

describe("finding a command by what people call it", () => {
  it("finds rotation tracks from meso", () => {
    expect(find("meso")).toContain("layer:rotationTracks");
    expect(find("mesocyclone")).toContain("layer:rotationTracks");
    // And from the word the panel actually shows.
    expect(find("rotation")[0]).toBe("layer:rotationTracks");
  });

  it("finds the other things nobody types the label for", () => {
    expect(find("mesh")).toContain("layer:hail");
    expect(find("quake")).toContain("layer:earthquakes");
    expect(find("hurricane")).toContain("layer:tropical");
    expect(find("hurdat")).toContain("surface:history");
    expect(find("doppler")).toContain("product:velocity");
    expect(find("debris")).toContain("product:correlation-coefficient");
    expect(find("pal")).toContain("surface:upload");
    expect(find("storm cell")).toContain("layer:stormCells");
    expect(find("hydrometeor")).toContain("layer:classification");
    expect(find("hrrr")).toContain("layer:forecastSmoke");
    expect(find("probsevere")).toContain("layer:probSevere");
    expect(find("wind particles")).toContain("layer:wind");
    expect(find("radar products")).toContain("surface:radar-product");
  });

  it("puts a label match ahead of a keyword match", () => {
    // Tropical is a layer and a panel; both should come back, and the one
    // whose label starts with the word should lead.
    const tropical = find("tropical");
    expect(tropical[0]).toBe("layer:tropical");
    expect(tropical).toContain("surface:tropical");
  });

  it("needs every word to land somewhere", () => {
    expect(find("rotation tracks")).toContain("layer:rotationTracks");
    // The second word matches nothing on that entry, so it is not offered.
    expect(find("rotation biscuits")).not.toContain("layer:rotationTracks");
    expect(find("nonsense")).toEqual([]);
  });

  it("ignores case and surrounding space", () => {
    expect(find("  MESO  ")).toContain("layer:rotationTracks");
    expect(find("HaIl")).toContain("layer:hail");
  });
});

describe("finding a command without holding a dead key", () => {
  // Every French and Spanish label in the palette carries an accent, and
  // nobody types one on the way to a command bar.
  const strip = (text: string) =>
    text.normalize("NFD").replace(/\p{Diacritic}/gu, "");

  it.each([
    ["es", "Pronóstico", "surface:forecast"],
    ["es", "Satélite", "layer:satellite"],
    ["fr", "Réglages", "surface:settings"],
    ["fr", "Prévisions", "surface:forecast"],
    ["fr", "Séismes", "layer:earthquakes"],
  ] as const)("finds %s's %s typed either way", async (which, label, id) => {
    await ensureLanguage(which);
    const list = allCommands(which);
    const word = label.split(" ")[0];
    expect(word).not.toBe(strip(word));
    // The same rank either way, not merely a match: a reader who does type
    // the accent must not be offered a worse list than one who does not.
    const accented = searchCommands(list, word).map((one) => one.id);
    const plain = searchCommands(list, strip(word)).map((one) => one.id);
    expect(accented).toContain(id);
    expect(plain).toEqual(accented);
  });

  it("carries no keyword that is only a label word with its accents off", () => {
    // Those entries existed to stand in for the folding the matcher now
    // does. Leaving them would mean every new label needs a shadow copy
    // beside it for ever.
    const offenders: string[] = [];
    // The English aliases are the same list in every language, so a French
    // label that happens to be the accented spelling of one of them is not a
    // keyword somebody added to fake folding.
    const english = new Map(
      allCommands("en").map((command) => [command.id, command.keywords]),
    );
    for (const which of ["en", "es", "fr"] as const) {
      for (const command of allCommands(which)) {
        const words = command.label.toLowerCase().split(/\s+/);
        for (const keyword of command.keywords) {
          const plain = keyword.toLowerCase();
          // A keyword that repeats a label word exactly is fine and often
          // useful, since a two-word query needs both halves to land. What
          // has no reason to exist any more is one that differs from a label
          // word only by its accents.
          const faking =
            !english.get(command.id)?.includes(keyword) &&
            words.some(
              (word) => word !== plain && strip(word) === strip(plain),
            );
          if (faking) offenders.push(`${which} ${command.id}: ${keyword}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
