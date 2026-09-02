import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drawRecapCard, RECAP_HEIGHT, RECAP_WIDTH } from "./recapCard";

/**
 * What a picture of the recap is allowed to leave out.
 *
 * jsdom has no 2D context, so this drives the drawing through a stand-in that
 * records what was asked of it. That is enough to hold the one rule that
 * matters: the credits go on the picture whole, whoever the reader watches.
 */
interface Drawn {
  text: string;
  x: number;
  y: number;
  font: string;
}

function fakeCanvas(charWidth = 10) {
  const drawn: Drawn[] = [];
  let font = "";
  const context = {
    set font(value: string) {
      font = value;
    },
    get font() {
      return font;
    },
    textBaseline: "",
    fillStyle: "",
    fillRect: () => undefined,
    // A monospace stand-in: every character the same width, so what fits is
    // arithmetic rather than a font metric that differs by machine.
    measureText: (text: string) => ({ width: text.length * charWidth }),
    fillText: (text: string, x: number, y: number) =>
      drawn.push({ text, x, y, font }),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (give: (blob: Blob) => void) =>
      give(new Blob(["png"], { type: "image/png" })),
  };
  return { canvas, drawn };
}

function withCanvas<T>(charWidth: number, run: () => T): [T, Drawn[]] {
  const { canvas, drawn } = fakeCanvas(charWidth);
  const made = document.createElement.bind(document);
  document.createElement = ((tag: string) =>
    tag === "canvas" ? canvas : made(tag)) as typeof document.createElement;
  try {
    return [run(), drawn];
  } finally {
    document.createElement = made;
  }
}

const CREDITS =
  "Built from your own record. Readings by KAMA, KBOI, KDAL, KDYX, KEWX, KFWS, KGRK, KHGX, KLBB, KMAF, KSHV, KTLX. Made with OpenRadar.";

describe("a picture of the recap", () => {
  it("keeps the whole of the credits on the canvas", async () => {
    const [promise, drawn] = withCanvas(10, () =>
      drawRecapCard({
        title: "Your year in weather",
        lines: ["Sep 2 2025 to Sep 2 2026", "12 warnings and 40 observations"],
        credits: CREDITS,
      }),
    );
    await promise;

    const width = RECAP_WIDTH - 128;
    const credits = drawn.filter((one) => one.font.startsWith("18px"));
    expect(credits.length).toBeGreaterThan(1);
    // Every piece fits, and together they are the whole sentence. `fillText`
    // neither wraps nor clips: a credits line wider than the canvas is simply
    // drawn off the edge and lost, and the credits are the one line on this
    // picture that is not optional.
    for (const line of credits) {
      expect(line.text.length * 10).toBeLessThanOrEqual(width);
    }
    expect(credits.map((one) => one.text).join(" ")).toBe(CREDITS);
    // And they are on the canvas, not below it.
    for (const line of credits) {
      expect(line.y).toBeGreaterThan(0);
      expect(line.y).toBeLessThan(RECAP_HEIGHT - 18);
    }
  });

  it("drops figures rather than writing them over the credits", async () => {
    const [promise, drawn] = withCanvas(10, () =>
      drawRecapCard({
        title: "Your year in weather",
        lines: Array.from({ length: 40 }, (_, index) => `Line ${index}`),
        credits: CREDITS,
      }),
    );
    await promise;

    const credits = drawn.filter((one) => one.font.startsWith("18px"));
    const figures = drawn.filter((one) => one.font.startsWith("24px"));
    const lowest = Math.min(...credits.map((one) => one.y));
    for (const figure of figures) {
      expect(figure.y).toBeLessThan(lowest);
    }
    // It really did have to drop some, or this proves nothing.
    expect(figures.length).toBeLessThan(40);
  });

  it("is drawn on a canvas, never on the page", () => {
    // The picture is composed rather than screenshotted, so nothing here
    // reads the workspace and nothing about the reader's window can leak
    // into a file they are about to send somebody.
    const source = readFileSync(
      join(import.meta.dirname, "recapCard.ts"),
      "utf8",
    );
    for (const reach of ["document.body", "querySelector", "getElementById"]) {
      expect(source, reach).not.toContain(reach);
    }
    expect(RECAP_WIDTH).toBeGreaterThan(RECAP_HEIGHT);
  });
});
