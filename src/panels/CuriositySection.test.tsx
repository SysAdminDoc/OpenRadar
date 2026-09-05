import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CuriositySection } from "./CuriositySection";
import { en } from "../i18n/en";

/**
 * The places somebody has found, and what the list says before the file that
 * names them has arrived.
 *
 * The rule this feature was built under is that it never becomes a thing to
 * complete: no total, no progress, nothing counting up. What that leaves is a
 * list of real places, which has to read correctly in three states, and only
 * one of them has the names in it.
 */

/** One entry shaped the way `readCuriosities` insists on. */
const CURIOSITIES = [
  {
    id: "hoh",
    title: {
      en: "The Hoh Rainforest",
      es: "El bosque lluvioso Hoh",
      fr: "La foret pluviale Hoh",
    },
    story: { en: "It rains.", es: "Llueve.", fr: "Il pleut." },
    source: "Olympic National Park",
    url: "https://example.test/hoh",
    place: { lon: -123.9, lat: 47.86 },
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(CURIOSITIES),
      } as unknown as Response),
    ),
  );
});

describe("the places somebody has found", () => {
  it("says so plainly when there are none", () => {
    // Not "0 of 12", which is the shape this must not take.
    render(<CuriositySection found={[]} onForget={() => undefined} />);
    expect(screen.getByText(en["curiosity.foundEmpty"])).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(en["curiosity.forget"])).toBeNull();
  });

  it("shows the identifier while the set is still loading", async () => {
    // The list is never empty while a file loads: a reader who found
    // something sees it immediately, under whatever name is available.
    render(<CuriositySection found={["hoh"]} onForget={() => undefined} />);
    expect(screen.getByText("hoh")).toBeTruthy();

    await waitFor(() =>
      expect(screen.getByText("The Hoh Rainforest")).toBeTruthy(),
    );
    // And the source it came from, as a link out.
    expect(
      screen.getByRole("link", { name: "Olympic National Park" }),
    ).toBeTruthy();
  });

  it("keeps the identifier when the set cannot be read", async () => {
    // A file that will not load costs the names and nothing else. Losing the
    // row would be telling somebody they had not found a place they had.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    render(<CuriositySection found={["hoh"]} onForget={() => undefined} />);
    await waitFor(() => expect(screen.getByText("hoh")).toBeTruthy());
    expect(screen.queryByText("The Hoh Rainforest")).toBeNull();
    // The way to end it is still there, because the list is still there.
    expect(screen.getByText(en["curiosity.forget"])).toBeTruthy();
  });

  it("keeps the row when the service answers with a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve([]),
        } as unknown as Response),
      ),
    );
    render(<CuriositySection found={["hoh"]} onForget={() => undefined} />);
    await waitFor(() => expect(screen.getByText("hoh")).toBeTruthy());
    expect(screen.queryByRole("link")).toBeNull();
  });
});
