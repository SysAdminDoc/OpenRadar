import { describe, expect, it } from "vitest";
import { allCommands, searchCommands } from "./commands";
import { DEFAULT_SETTINGS } from "./settings";

const commands = allCommands();

function find(query: string): string[] {
  return searchCommands(commands, query).map((command) => command.id);
}

describe("what the palette offers", () => {
  it("covers every layer, product, map type, panel, and tool", () => {
    const groups = new Set(commands.map((command) => command.group));
    expect([...groups].sort()).toEqual([
      "Layer",
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
