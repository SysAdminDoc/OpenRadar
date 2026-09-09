import type { Page } from "@playwright/test";

/**
 * How many pixels of one exact colour the map canvas is drawing.
 *
 * A mark that chooses its colour from the basemap is only worth the choosing
 * if the colour reaches the screen, and the layer paint is not reachable from
 * a page script: MapLibre keeps the map object to itself. Counting pixels of
 * the exact ink is the read that does not need it, and in `testMode` the
 * basemap is a flat background, so the only thing wearing a lane's ink is
 * that lane.
 *
 * Both directions are worth asking. "The dark ink is on screen" passes with
 * the pale one drawn beside it; "the pale one is gone" is what says the mark
 * changed rather than gained a friend.
 */
export async function inkPixels(
  page: Page,
  want: [number, number, number],
  tolerance = 5,
) {
  return page.evaluate(
    ([rgb, slack]) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return 0;
      const target = document.createElement("canvas");
      target.width = canvas.width;
      target.height = canvas.height;
      const context = target.getContext("2d");
      if (!context) return 0;
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        target.width,
        target.height,
      ).data;
      let found = 0;
      for (let at = 0; at < pixels.length; at += 4) {
        if (
          Math.abs(pixels[at] - rgb[0]) <= slack &&
          Math.abs(pixels[at + 1] - rgb[1]) <= slack &&
          Math.abs(pixels[at + 2] - rgb[2]) <= slack
        ) {
          found += 1;
        }
      }
      return found;
    },
    [want, tolerance] as const,
  );
}
