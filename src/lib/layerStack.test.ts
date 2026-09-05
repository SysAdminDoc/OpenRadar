import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MRMS_PRODUCT_IDS } from "./providers/mrms";
import {
  CELL_LAYER_IDS,
  COUNTY_LAYER_ID,
  CUSTOM_LAYER_IDS,
  layerStackOrder,
  MRMS_LAYER_IDS,
  MRMS_SOURCE_PREFIX,
  RADAR_LANE_LAYER_IDS,
  NIGHT_LAYER_ID,
  SATELLITE_LAYER_ID,
  stackHeight,
  SWEEP_LAYER_ID,
  TOOL_LAYER_IDS,
  topmost,
} from "./layerStack";
import { OVERLAY_ADAPTERS } from "./overlays/index";

/** A hit test result, cut down to the part that decides which one wins. */
const hitOn = (id: string) => ({ layer: { id } });

describe("which layer a click answers with", () => {
  it("picks the one drawn on top, whichever order the hits arrive in", () => {
    const order = ["bottom", "middle", "top"];
    const hits = [hitOn("bottom"), hitOn("top"), hitOn("middle")];
    expect(topmost(hits, order)?.layer.id).toBe("top");
    expect(topmost([...hits].reverse(), order)?.layer.id).toBe("top");
  });

  it("keeps the first of two hits on the same layer", () => {
    // A hit test hands its results back nearest the viewer first, so among
    // features at the same height the earlier one is the one on top. Every
    // alert in the country is drawn by a single fill layer, so a tornado
    // warning inside a flood watch arrives as two hits at the same height.
    const order = ["bottom", "alerts"];
    const first = { layer: { id: "alerts" }, what: "warning" };
    const second = { layer: { id: "alerts" }, what: "watch" };
    expect(topmost([first, second], order)?.what).toBe("warning");
    expect(topmost([second, first], order)?.what).toBe("watch");
    // And a genuinely higher layer still wins over both.
    const above = { layer: { id: "tools" }, what: "tool" };
    expect(topmost([first, above, second], order)?.what).toBe("tool");
  });

  it("has nothing to say about an empty click", () => {
    expect(topmost([], ["a", "b"])).toBeNull();
  });

  it("lets a layer nobody placed answer rather than making it unreachable", () => {
    // The same miss the insertion anchor makes, and the safer one: a layer
    // added without being put in the order is drawn on top, so it should be
    // clickable rather than silently deaf.
    const order = ["bottom", "top"];
    expect(topmost([hitOn("top"), hitOn("brand-new")], order)?.layer.id).toBe(
      "brand-new",
    );
    expect(stackHeight(order, "brand-new")).toBeGreaterThan(
      stackHeight(order, "top"),
    );
  });
});

describe("guidance never sits in front of a decision", () => {
  // The real overlay layer ids, in their default arrangement, so the test
  // measures the order the map is actually built with.
  const order = layerStackOrder(
    OVERLAY_ADAPTERS.flatMap((adapter) =>
      adapter
        .layers(`openradar-overlay-${adapter.id}`)
        .map((layer) => layer.id),
    ),
  );

  it("draws severe probability under every warning", () => {
    // A warning is somebody telling you to take cover. A model's guess at what
    // a storm might do is not, and it is drawn underneath for that reason. The
    // click handler reads this same order, so the two cannot drift: it used to
    // ask the guidance layer first, and a tornado warning was then unreachable
    // by click anywhere the model had drawn over the same storm.
    const guidance = order.filter((id) => id.includes("probsevere"));
    const warnings = order.filter((id) => id.includes("overlay-alerts"));
    expect(guidance.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
    for (const guess of guidance) {
      for (const warning of warnings) {
        expect(stackHeight(order, guess)).toBeLessThan(
          stackHeight(order, warning),
        );
      }
    }
  });

  it("answers a click over both with the warning", () => {
    const guidance = order.find((id) => id.includes("probsevere-fill"));
    const warning = order.find((id) => id.includes("overlay-alerts"));
    expect(guidance).toBeDefined();
    expect(warning).toBeDefined();
    expect(
      topmost([hitOn(guidance as string), hitOn(warning as string)], order)
        ?.layer.id,
    ).toBe(warning);
  });

  it("puts every storm cell above the pictures it was found in", () => {
    // Same rule, the other way up: the radar's own reading of a storm should
    // not be hidden by a model's guess about it.
    const cells = order.filter((id) => id.includes("cell-"));
    const guidance = order.filter((id) => id.includes("probsevere"));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      for (const guess of guidance) {
        expect(stackHeight(order, cell)).toBeGreaterThan(
          stackHeight(order, guess),
        );
      }
    }
  });
});

describe("every grid the panel can switch on has a lane to draw in", () => {
  it("names one per product, less the composite", () => {
    // The sync loop only visits the lanes in this list, so a product without
    // one fetches its frames, builds a tile address, and draws nothing at
    // all. Three were written out by hand when there were three, and every
    // grid added since was invisible: the other four rotation windows, both
    // shear heights, the hail figures, the accumulations, the flash flood
    // grids, precipitation type, and the merged grid at a height.
    const drawn = new Set(
      MRMS_LAYER_IDS.filter((id) => id.startsWith(MRMS_SOURCE_PREFIX)).map(
        (id) => id.slice(MRMS_SOURCE_PREFIX.length),
      ),
    );
    for (const product of MRMS_PRODUCT_IDS) {
      if (product === "composite") continue;
      expect(drawn.has(product), `${product} has no lane`).toBe(true);
    }
    // And nothing in the list that is not a product.
    for (const product of drawn) {
      expect(
        (MRMS_PRODUCT_IDS as readonly string[]).includes(product),
        `${product} is not a product`,
      ).toBe(true);
    }
    expect(drawn.has("composite")).toBe(false);
  });

  it("splits them the way the decoder does", () => {
    // Which grids are scattered cells and which cover the country is one
    // decision written in two languages: here it decides what is drawn over
    // what, and in `mrms.rs` it decides whether a tile is sampled per pixel
    // or walked cell by cell. Nothing else would notice them drifting,
    // because a scattered grid buried under a continuous field still draws.
    //
    // Read out of the Rust test that already writes the verdict per product,
    // the way `tiles.rs` is read by the sweep gate: the table itself is a
    // hundred lines of struct literals, and its verdicts are a list.
    const rust = readFileSync(
      join(import.meta.dirname, "..", "..", "src-tauri", "src", "mrms.rs"),
      "utf8",
    );
    const verdicts = rust.slice(
      rust.indexOf("fn every_product_is_drawn_the_way_its_data_is_shaped"),
    );
    const table = verdicts.slice(0, verdicts.indexOf("assert_eq!(expected."));
    const cells = new Set<string>();
    const fields = new Set<string>();
    for (const [, id, sampling] of table.matchAll(
      /\("([a-z0-9-]+)",\s*Sampling::(Cells|Nearest)\)/g,
    )) {
      (sampling === "Cells" ? cells : fields).add(id);
    }
    // The read itself has to be worth something: an expression that matched
    // nothing would make every assertion below vacuous.
    expect(cells.size + fields.size).toBe(MRMS_PRODUCT_IDS.length);
    expect(cells.size).toBeGreaterThan(5);

    // The property, which is about order rather than membership: every grid
    // the decoder walks cell by cell is drawn over every grid that covers the
    // map, so a hail core is not buried under the rain around it.
    const order = layerStackOrder([]);
    const lane = (product: string) =>
      stackHeight(order, `${MRMS_SOURCE_PREFIX}${product}`);
    const lowestScattered = Math.min(...[...cells].map(lane));
    for (const product of fields) {
      if (product === "composite") continue;
      expect(lane(product), `${product} covers the map`).toBeLessThan(
        lowestScattered,
      );
    }
  });

  it("keeps the scattered grids over the fields that cover the map", () => {
    // A hail core is a smaller target than the rain around it, and a
    // continuous field drawn over one buries it.
    const order = layerStackOrder([]);
    const lane = (product: string) =>
      stackHeight(order, `${MRMS_SOURCE_PREFIX}${product}`);
    for (const scattered of ["mesh", "rotation-240", "lightning-jump"]) {
      for (const field of ["qpe-day", "precip-type", "cappi-reflectivity"]) {
        expect(lane(scattered), `${scattered} over ${field}`).toBeGreaterThan(
          lane(field),
        );
      }
    }
  });
});

describe("where it is dark", () => {
  it("sits under every layer there is", () => {
    // It is where the light is, not something that happened. A wash over a
    // warning would be the one arrangement the panel refuses to let anybody
    // make by hand, and this one is not on the panel's list at all.
    const order = layerStackOrder(["openradar-overlay-alerts"]);
    expect(stackHeight(order, NIGHT_LAYER_ID)).toBe(0);
    for (const over of order) {
      if (over === NIGHT_LAYER_ID) continue;
      expect(
        stackHeight(order, over),
        `${over} over the night wash`,
      ).toBeGreaterThan(stackHeight(order, NIGHT_LAYER_ID));
    }
  });
});

describe("reference geography is not weather", () => {
  it("draws county lines over every picture of the sky", () => {
    // The whole point of them: reading which county a storm is in. Under the
    // radar they are invisible wherever it matters.
    const order = layerStackOrder([]);
    for (const under of [
      SATELLITE_LAYER_ID,
      SWEEP_LAYER_ID,
      ...RADAR_LANE_LAYER_IDS,
      ...MRMS_LAYER_IDS,
    ]) {
      expect(
        stackHeight(order, COUNTY_LAYER_ID),
        `counties over ${under}`,
      ).toBeGreaterThan(stackHeight(order, under));
    }
  });

  it("keeps them under anything a person drew or a service published", () => {
    // A boundary that hid a warning polygon would be the one arrangement the
    // panel refuses to let anybody make by hand.
    const order = layerStackOrder(["openradar-overlay-alerts"]);
    for (const over of [
      "openradar-overlay-alerts",
      ...CUSTOM_LAYER_IDS,
      ...CELL_LAYER_IDS,
      ...TOOL_LAYER_IDS,
    ]) {
      expect(
        stackHeight(order, COUNTY_LAYER_ID),
        `counties under ${over}`,
      ).toBeLessThan(stackHeight(order, over));
    }
  });
});

describe("a file somebody imported is not a warning", () => {
  const order = layerStackOrder(
    OVERLAY_ADAPTERS.flatMap((adapter) =>
      adapter
        .layers(`openradar-overlay-${adapter.id}`)
        .map((layer) => layer.id),
    ),
  );

  it("draws every imported shape under every warning", () => {
    // The layer panel refuses to let anybody put an overlay above a warning.
    // Imported shapes used to sit above the whole overlay band, so dropping a
    // placefile on the window made the arrangement the panel will not make.
    const imported = order.filter((id) => CUSTOM_LAYER_IDS.includes(id));
    const warnings = order.filter((id) => id.includes("overlay-alerts"));
    expect(imported).toHaveLength(CUSTOM_LAYER_IDS.length);
    expect(warnings.length).toBeGreaterThan(0);
    for (const shape of imported) {
      for (const warning of warnings) {
        expect(stackHeight(order, shape)).toBeLessThan(
          stackHeight(order, warning),
        );
      }
    }
  });

  it("still draws them over the radar they are context for", () => {
    const imported = stackHeight(order, CUSTOM_LAYER_IDS[0]);
    for (const beneath of RADAR_LANE_LAYER_IDS) {
      expect(stackHeight(order, beneath)).toBeLessThan(imported);
    }
  });
});
