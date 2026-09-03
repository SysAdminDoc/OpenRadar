/**
 * Cutting a placefile's icon sheet into the images a map can draw.
 *
 * The format ships one picture holding a grid of icons and numbers the cells
 * left to right and then top to bottom, and names a hotspot inside the cell
 * that is the point which actually sits on the coordinate. A map has no notion
 * of a hotspot: it anchors an image by one of nine keywords, and the only one
 * that is exact for an arbitrary hotspot is the centre. So the cell is copied
 * into a canvas large enough that its hotspot lands in the middle of it, and
 * the map anchors the result at its centre. The padding is transparent and
 * costs nothing to draw.
 *
 * Everything here works on plain pixel arrays. The fetching and the decoding
 * belong to whoever has a canvas; this is the part that has to be right.
 */

import type { IconRef } from "./placefile";

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Where one icon sits in its sheet, or null when the sheet has no such cell. */
export function iconCell(
  sheet: { width: number; height: number },
  ref: IconRef,
): { x: number; y: number } | null {
  const columns = Math.floor(sheet.width / ref.iconWidth);
  if (columns < 1 || ref.index < 1) return null;
  const at = ref.index - 1;
  const x = (at % columns) * ref.iconWidth;
  const y = Math.floor(at / columns) * ref.iconHeight;
  if (y + ref.iconHeight > sheet.height) return null;
  return { x, y };
}

/**
 * The box the cell is copied into so its hotspot is the centre of it.
 *
 * Always an odd number of pixels across, because a centre only exists on one
 * pixel when there is an odd number of them, and a hotspot half a pixel out
 * on an icon drawn at a storm's location is not worth the tidier arithmetic.
 */
export function hotspotBox(ref: IconRef): {
  width: number;
  height: number;
  dx: number;
  dy: number;
} {
  const hotX = Math.min(Math.max(Math.round(ref.hotX), 0), ref.iconWidth - 1);
  const hotY = Math.min(Math.max(Math.round(ref.hotY), 0), ref.iconHeight - 1);
  const halfX = Math.max(hotX, ref.iconWidth - 1 - hotX);
  const halfY = Math.max(hotY, ref.iconHeight - 1 - hotY);
  return {
    width: halfX * 2 + 1,
    height: halfY * 2 + 1,
    dx: halfX - hotX,
    dy: halfY - hotY,
  };
}

/**
 * Whether a sheet carries an alpha channel that says anything.
 *
 * The format's own rule: a sheet with no transparency of its own draws black
 * as transparent. A PNG decoded into a canvas always has an alpha byte, so
 * "has no alpha channel" has to be read as "every pixel is fully opaque".
 */
export function hasAlpha(pixels: Pixels): boolean {
  for (let at = 3; at < pixels.data.length; at += 4) {
    if (pixels.data[at] !== 255) return true;
  }
  return false;
}

/** One icon out of a decoded sheet, centred on its hotspot. */
export function sliceIcon(
  sheet: Pixels,
  ref: IconRef,
  blackIsTransparent: boolean,
): Pixels | null {
  const cell = iconCell(sheet, ref);
  if (!cell) return null;
  const box = hotspotBox(ref);
  const data = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < ref.iconHeight; y += 1) {
    for (let x = 0; x < ref.iconWidth; x += 1) {
      const from = ((cell.y + y) * sheet.width + cell.x + x) * 4;
      const to = ((box.dy + y) * box.width + box.dx + x) * 4;
      const red = sheet.data[from];
      const green = sheet.data[from + 1];
      const blue = sheet.data[from + 2];
      const alpha = sheet.data[from + 3];
      data[to] = red;
      data[to + 1] = green;
      data[to + 2] = blue;
      data[to + 3] =
        blackIsTransparent && red === 0 && green === 0 && blue === 0
          ? 0
          : alpha;
    }
  }
  return { width: box.width, height: box.height, data };
}

/** Every distinct icon a drawn collection asks for. */
export function iconsWanted(data: unknown): string[] {
  const features = (data as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const wanted = new Set<string>();
  for (const feature of features) {
    const icon = (feature as { properties?: { icon?: unknown } }).properties
      ?.icon;
    if (typeof icon === "string") wanted.add(icon);
  }
  return [...wanted];
}
