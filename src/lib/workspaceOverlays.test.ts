import { describe, expect, it } from "vitest";
import {
  addOverlayFile,
  isWorkspaceOverlay,
  MAX_WORKSPACE_OVERLAY_FEATURES,
  MAX_WORKSPACE_OVERLAY_FILES,
  mergedOverlayShapes,
  moveOverlayFile,
  overlayFileId,
  overlayGates,
  overlayShapeCount,
  picturesWanted,
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

describe("one ceiling, not one per format", () => {
  function collection(count: number) {
    return {
      type: "FeatureCollection",
      features: Array.from({ length: count }, () => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: {},
      })),
    };
  }

  // The import used to check the cap in the GeoJSON branch only, so a
  // placefile past it imported, drew, and then vanished the first time a
  // backup was restored, because the restore ran the check the import had
  // skipped. Both sides count the same shapes against the same number now,
  // and this holds them together.
  it("counts what the backup reader judges, against the same number", () => {
    const over = collection(MAX_WORKSPACE_OVERLAY_FEATURES + 1);
    expect(overlayShapeCount(over)).toBe(MAX_WORKSPACE_OVERLAY_FEATURES + 1);
    expect(isWorkspaceOverlay(over)).toBe(false);

    const at = collection(MAX_WORKSPACE_OVERLAY_FEATURES);
    expect(overlayShapeCount(at)).toBe(MAX_WORKSPACE_OVERLAY_FEATURES);
    expect(isWorkspaceOverlay(at)).toBe(true);
  });

  it("agrees about an empty collection and a bare Feature", () => {
    expect(overlayShapeCount(collection(0))).toBe(0);
    expect(isWorkspaceOverlay(collection(0))).toBe(false);

    const bare = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {},
    };
    expect(overlayShapeCount(bare)).toBe(1);
    expect(isWorkspaceOverlay(bare)).toBe(true);
  });
});

describe("what a placefile asked to be shown at", () => {
  const gated = (
    properties: Record<string, unknown>,
  ): WorkspaceOverlayFile => ({
    id: "gated",
    name: "gated.txt",
    enabled: true,
    opacity: 1,
    shapes: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-96.8, 32.78] },
          properties,
        },
      ],
    },
  });

  const drawn = (
    file: WorkspaceOverlayFile,
    zoom?: number,
    at?: number | null,
  ) => {
    const merged = mergedOverlayShapes([file], zoom, at) as {
      features: unknown[];
    } | null;
    return merged?.features.length ?? 0;
  };

  it("hides a shape until the map is close enough for it", () => {
    const file = gated({ label: "close", minZoom: 8.76 });
    expect(drawn(file, 7)).toBe(0);
    expect(drawn(file, 9)).toBe(1);
  });

  it("shows a shape that named no range at any zoom", () => {
    const file = gated({ label: "anywhere" });
    expect(drawn(file, 0)).toBe(1);
    // And with nothing said about the view at all, which is every GeoJSON
    // file and most of the shapes in a placefile.
    expect(drawn(file)).toBe(1);
  });

  it("keeps the format's own rule about which end is included", () => {
    const from = Date.UTC(2026, 3, 27, 20);
    const to = Date.UTC(2026, 3, 27, 21);
    const file = gated({ label: "during", from, to });
    expect(drawn(file, 10, from - 1)).toBe(0);
    expect(drawn(file, 10, from)).toBe(1);
    expect(drawn(file, 10, to - 1)).toBe(1);
    // The end is exclusive, so the shape is gone the moment it arrives.
    expect(drawn(file, 10, to)).toBe(0);
    // And with no time being drawn, a time range decides nothing.
    expect(drawn(file, 10, null)).toBe(1);
  });

  it("says whether anything in the set is gated at all", () => {
    expect(overlayGates([gated({ label: "plain" })])).toEqual({
      zoomed: false,
      timed: false,
    });
    expect(overlayGates([gated({ label: "close", minZoom: 9 })])).toEqual({
      zoomed: true,
      timed: false,
    });
    expect(
      overlayGates([gated({ label: "during", from: 1, to: 2, minZoom: 9 })]),
    ).toEqual({ zoomed: true, timed: true });
  });
});

describe("how many pictures the set is asking for", () => {
  const withPictures = (id: string, count: number): WorkspaceOverlayFile => ({
    id,
    name: `${id}.txt`,
    enabled: true,
    opacity: 1,
    shapes: {
      type: "FeatureCollection",
      features: [
        ...Array.from({ length: count }, () => ({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[]] },
          properties: { kind: "image", image: "https://example.test/a.png" },
        })),
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { kind: "place", label: "not a picture" },
        },
      ],
    },
  });

  it("counts them across the switched-on files and no others", () => {
    // Four per file and eight files, so the set can ask for far more than
    // the map draws, and the import counts every one of them as a shape.
    const files = [withPictures("a", 3), withPictures("b", 2)];
    expect(picturesWanted(files)).toBe(5);
    expect(picturesWanted([files[0], { ...files[1], enabled: false }])).toBe(3);
    expect(picturesWanted([])).toBe(0);
  });
});
