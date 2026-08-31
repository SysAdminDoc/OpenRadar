import { describe, expect, it } from "vitest";
import {
  addOverlayFile,
  MAX_WORKSPACE_OVERLAY_FILES,
  mergedOverlayShapes,
  moveOverlayFile,
  overlayFileId,
  overlayShapeCount,
  type WorkspaceOverlayFile,
} from "./workspaceOverlays";

function shapes(...labels: string[]) {
  return {
    type: "FeatureCollection",
    features: labels.map((label) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-96.8, 32.78] },
      properties: { label },
    })),
  };
}

function labelsOf(merged: Record<string, unknown> | null): string[] {
  if (!merged) return [];
  return (merged.features as Array<{ properties: { label: string } }>).map(
    (feature) => feature.properties.label,
  );
}

describe("a set of imported files rather than one", () => {
  it("holds several files side by side", () => {
    let files: WorkspaceOverlayFile[] = [];
    for (const name of ["spotters.txt", "counties.geojson", "survey.json"]) {
      const added = addOverlayFile(files, name, shapes(name));
      expect(added.ok).toBe(true);
      if (added.ok) files = added.files;
    }
    expect(files.map((file) => file.name)).toEqual([
      "spotters.txt",
      "counties.geojson",
      "survey.json",
    ]);
  });

  it("replaces a file imported again instead of duplicating it", () => {
    const first = addOverlayFile([], "spotters.txt", shapes("old"));
    if (!first.ok) throw new Error("first import refused");
    // The reader has since hidden it and faded it, and moved another file
    // above it. Re-importing is an update to that arrangement, not a new file.
    const arranged: WorkspaceOverlayFile[] = [
      { ...first.files[0], enabled: false, opacity: 0.3 },
      {
        id: "counties.json",
        name: "counties.json",
        enabled: true,
        opacity: 1,
        shapes: shapes("county"),
      },
    ];
    const again = addOverlayFile(arranged, "Spotters.TXT", shapes("new"));
    if (!again.ok) throw new Error("re-import refused");

    expect(again.replaced).toBe(true);
    expect(again.files).toHaveLength(2);
    // Same place in the order, same switch, same opacity, new shapes.
    expect(again.files[0].id).toBe("spotters.txt");
    expect(again.files[0].enabled).toBe(false);
    expect(again.files[0].opacity).toBe(0.3);
    expect(again.files[0].name).toBe("Spotters.TXT");
    expect(labelsOf(again.files[0].shapes)).toEqual(["new"]);
  });

  it("treats a name that differs only in case or space as the same file", () => {
    expect(overlayFileId("  Spotters.TXT ")).toBe(
      overlayFileId("spotters.txt"),
    );
  });

  it("refuses a file past the ceiling rather than dropping somebody's", () => {
    let files: WorkspaceOverlayFile[] = [];
    for (let index = 0; index < MAX_WORKSPACE_OVERLAY_FILES; index += 1) {
      const added = addOverlayFile(files, `file-${index}.json`, shapes("x"));
      if (!added.ok) throw new Error("refused too early");
      files = added.files;
    }
    const overflow = addOverlayFile(files, "one-more.json", shapes("x"));
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.reason).toBe("full");

    // A full set still takes an update to a file it already holds.
    const update = addOverlayFile(files, "file-0.json", shapes("y"));
    expect(update.ok).toBe(true);
    if (update.ok) expect(update.files).toHaveLength(files.length);
  });
});

describe("what the map is handed", () => {
  const files: WorkspaceOverlayFile[] = [
    {
      id: "under",
      name: "under",
      enabled: true,
      opacity: 1,
      shapes: shapes("under-a", "under-b"),
    },
    {
      id: "off",
      name: "off",
      enabled: false,
      opacity: 1,
      shapes: shapes("off"),
    },
    {
      id: "over",
      name: "over",
      enabled: true,
      opacity: 0.4,
      shapes: shapes("over"),
    },
  ];

  it("draws the switched-on files in order, last on top", () => {
    expect(labelsOf(mergedOverlayShapes(files))).toEqual([
      "under-a",
      "under-b",
      "over",
    ]);
  });

  it("carries a faded file's opacity on its own shapes", () => {
    const merged = mergedOverlayShapes(files);
    const drawn = merged?.features as Array<{
      properties: Record<string, unknown>;
    }>;
    // Full is left off entirely, so the common case adds nothing for the map
    // to read and the paint expression's own default covers it.
    expect(drawn[0].properties.fileOpacity).toBeUndefined();
    expect(drawn[2].properties.fileOpacity).toBe(0.4);
  });

  it("does not touch the file's own shapes while stamping", () => {
    mergedOverlayShapes(files);
    const kept = files[2].shapes.features as Array<{
      properties: Record<string, unknown>;
    }>;
    expect(kept[0].properties.fileOpacity).toBeUndefined();
  });

  it("is nothing at all when every file is switched off", () => {
    const allOff = files.map((file) => ({ ...file, enabled: false }));
    expect(mergedOverlayShapes(allOff)).toBeNull();
    expect(mergedOverlayShapes([])).toBeNull();
  });

  it("takes a bare Feature as the one shape it is", () => {
    const bare = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { label: "alone" },
    };
    expect(overlayShapeCount(bare)).toBe(1);
    expect(
      labelsOf(
        mergedOverlayShapes([
          { id: "a", name: "a", enabled: true, opacity: 1, shapes: bare },
        ]),
      ),
    ).toEqual(["alone"]);
  });
});

describe("moving a file in the drawing order", () => {
  const files: WorkspaceOverlayFile[] = ["a", "b", "c"].map((id) => ({
    id,
    name: id,
    enabled: true,
    opacity: 1,
    shapes: shapes(id),
  }));

  it("puts it where it was asked for", () => {
    expect(moveOverlayFile(files, "a", 2).map((file) => file.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(moveOverlayFile(files, "c", 0).map((file) => file.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("clamps past either end and ignores a file it does not hold", () => {
    expect(moveOverlayFile(files, "a", 9).map((file) => file.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(moveOverlayFile(files, "a", -3).map((file) => file.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(moveOverlayFile(files, "missing", 0)).toBe(files);
  });
});
