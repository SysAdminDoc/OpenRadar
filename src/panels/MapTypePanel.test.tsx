import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapTypePanel } from "./MapTypePanel";
import { MAP_STYLE_OPTIONS } from "../lib/mapStyles";
import { en } from "../i18n/en";

afterEach(cleanup);

function panel(
  overrides: {
    mapStyle?: (typeof MAP_STYLE_OPTIONS)[number]["id"];
    projection?: "mercator" | "globe";
    onMapStyle?: (style: (typeof MAP_STYLE_OPTIONS)[number]["id"]) => void;
    onProjection?: (projection: "mercator" | "globe") => void;
  } = {},
) {
  return (
    <MapTypePanel
      mapStyle={overrides.mapStyle ?? MAP_STYLE_OPTIONS[0].id}
      projection={overrides.projection ?? "mercator"}
      onMapStyle={overrides.onMapStyle ?? vi.fn()}
      onProjection={overrides.onProjection ?? vi.fn()}
      onClose={vi.fn()}
    />
  );
}

/**
 * Which map is under the weather, and which shape the world is.
 *
 * Two controls and nothing else, which is why what matters here is that both
 * of them say what is currently chosen: a panel that offers eight basemaps
 * and marks none of them leaves a reader pressing the one already on.
 */
describe("choosing a map", () => {
  it("offers both projections and marks the one in use", () => {
    render(panel({ projection: "globe" }));
    const control = screen.getByRole("group", {
      name: en["mapType.projection"],
    });
    const chosen = within(control).getByRole("button", { pressed: true });
    expect(chosen.textContent).toContain(en["mapType.globe"]);
    expect(within(control).getAllByRole("button")).toHaveLength(2);
  });

  it("asks for the projection that was pressed", () => {
    const onProjection = vi.fn();
    render(panel({ projection: "mercator", onProjection }));
    fireEvent.click(
      within(
        screen.getByRole("group", { name: en["mapType.projection"] }),
      ).getByRole("button", { name: en["mapType.globe"] }),
    );
    expect(onProjection).toHaveBeenCalledWith("globe");
  });

  it("offers every basemap the app ships and marks the one in use", () => {
    // Derived from the list rather than a number written here: a basemap
    // added to `mapStyles.ts` and not to the panel is a card nobody can
    // reach, and this is the only thing that would notice.
    const second = MAP_STYLE_OPTIONS[1];
    render(panel({ mapStyle: second.id }));
    const cards = [...document.querySelectorAll(".map-style-card")];
    expect(cards).toHaveLength(MAP_STYLE_OPTIONS.length);
    const marked = cards.filter(
      (card) => card.getAttribute("aria-pressed") === "true",
    );
    // Exactly one, and it is the one that was handed in.
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain(en[second.key]);
  });

  it("asks for the basemap that was pressed", () => {
    const onMapStyle = vi.fn();
    const other = MAP_STYLE_OPTIONS[2] ?? MAP_STYLE_OPTIONS[1];
    render(panel({ mapStyle: MAP_STYLE_OPTIONS[0].id, onMapStyle }));
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(en[other.key]) }),
    );
    expect(onMapStyle).toHaveBeenCalledWith(other.id);
  });
});
