import { translate } from "../i18n";
import type { ExportCaption } from "./export";

/**
 * The map as something to send somebody, rather than as evidence.
 *
 * The plain export is accurate and slightly plain: the frame with the credits
 * burned into a corner, which is right for showing a neighbour what actually
 * happened and wrong for the thing somebody wants to send a relative. This is
 * a composed card, and the two jobs stay separate because they are different
 * jobs. Nothing here changes the plain export.
 *
 * What every variant carries, whatever the reader writes on it:
 *
 * - The observed time and the source credits. They are measured and placed
 *   first, before the picture is even sized, so a long caption runs out of
 *   room rather than pushing them off the card.
 * - The app's own name, and a line saying plainly that this is not an
 *   official product. A picture of a radar screen travels a long way from the
 *   person who made it, and the one thing it must never do is arrive looking
 *   like a warning from an office.
 * - The reader's own word for where they live, only when they put it there.
 */
export interface PostcardSize {
  id: "square" | "wide" | "tall";
  width: number;
  height: number;
}

/**
 * The three shapes, and why these three.
 *
 * Square for the places that crop everything to a square anyway, wide for a
 * link preview, tall for a phone screen held upright. Documented here rather
 * than in a comment somewhere else, and the layout is checked at each of them.
 */
export const POSTCARD_SIZES: PostcardSize[] = [
  { id: "square", width: 1080, height: 1080 },
  { id: "wide", width: 1200, height: 630 },
  { id: "tall", width: 1080, height: 1350 },
];

/** The longest a caption may be. Past this it is a paragraph, not a caption. */
export const MAX_CAPTION = 140;

const MARGIN = 48;

/** The least picture worth calling a picture of the map. */
const MIN_PICTURE = 120;

function wrapped(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    // A word wider than the line is broken inside itself, because `fillText`
    // neither wraps nor clips and would draw it off the edge.
    while (context.measureText(rest).width > width && rest.length > 1) {
      let take = rest.length;
      while (
        take > 1 &&
        context.measureText(rest.slice(0, take)).width > width
      ) {
        take -= 1;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(rest.slice(0, take));
      rest = rest.slice(take);
    }
    const next = line ? `${line} ${rest}` : rest;
    if (line && context.measureText(next).width > width) {
      lines.push(line);
      line = rest;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function drawPostcard(options: {
  /** The map as it stands, which is what the picture is of. */
  frame: HTMLCanvasElement;
  size: PostcardSize;
  caption: ExportCaption;
  /** The reader's own words, or empty. */
  written: string;
  /** Their name for the place, when they chose to include it. */
  place: string;
}): Promise<Blob> {
  const { width, height } = options.size;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(translate("export.noCanvas"));
  const inner = width - MARGIN * 2;

  context.fillStyle = "#090b10";
  context.fillRect(0, 0, width, height);
  // Set once, before anything is measured or drawn. Setting it inside the
  // caption's own branch meant a card with no caption drew every fact line
  // and the whole footer on the alphabetic baseline instead, about fourteen
  // pixels higher than the arithmetic below expects.
  context.textBaseline = "top";

  // Measured first, so the picture is given what is left rather than the
  // words being given what the picture did not want. A caption cannot
  // displace the credits, because the credits are placed before it exists.
  context.font = "16px 'Segoe UI', system-ui, sans-serif";
  const credits = wrapped(context, options.caption.attribution, inner);
  const disclaimer = wrapped(context, translate("postcard.notOfficial"), inner);
  const footer = (credits.length + disclaimer.length) * 22 + 20;

  context.font = "600 30px 'Segoe UI', system-ui, sans-serif";
  const written = options.written
    ? wrapped(context, options.written.slice(0, MAX_CAPTION), inner)
    : [];

  const facts = [...options.caption.lines, options.place].filter(Boolean);
  context.font = "18px 'Segoe UI', system-ui, sans-serif";
  const factLines = facts.flatMap((line) => wrapped(context, line, inner));

  // The words, and the gap between them and the credits. The gap is not
  // conditional: without a caption it used to be nothing at all, and the two
  // blocks touched.
  const words = written.length * 40 + factLines.length * 26 + 20;
  const pictureTop = MARGIN;
  const wanted = height - footer - words - MARGIN * 2;
  const pictureHeight = Math.max(MIN_PICTURE, wanted);

  // The map, cropped to the space rather than squashed into it: a stretched
  // radar picture is a picture of different weather.
  const scale = Math.max(
    inner / options.frame.width,
    pictureHeight / options.frame.height,
  );
  const takeWidth = inner / scale;
  const takeHeight = pictureHeight / scale;
  context.drawImage(
    options.frame,
    (options.frame.width - takeWidth) / 2,
    (options.frame.height - takeHeight) / 2,
    takeWidth,
    takeHeight,
    MARGIN,
    pictureTop,
    inner,
    pictureHeight,
  );

  // Where the footer starts, worked out once. Nothing above may cross it.
  const footerTop = height - MARGIN - (credits.length + disclaimer.length) * 22;

  let y = pictureTop + pictureHeight + 24;
  if (written.length) {
    context.font = "600 30px 'Segoe UI', system-ui, sans-serif";
    context.fillStyle = "#e7edf7";
    for (const line of written) {
      if (y + 40 > footerTop) break;
      context.fillText(line, MARGIN, y, inner);
      y += 40;
    }
    y += 8;
  }

  context.font = "18px 'Segoe UI', system-ui, sans-serif";
  context.fillStyle = "#c8d3e4";
  for (const line of factLines) {
    // The caption cannot displace the credits, and neither can the facts.
    // Whatever will not fit is dropped here rather than drawn over them.
    if (y + 26 > footerTop) break;
    context.fillText(line, MARGIN, y, inner);
    y += 26;
  }

  // The footer, at the bottom, whatever happened above it.
  context.font = "16px 'Segoe UI', system-ui, sans-serif";
  context.fillStyle = "#8b97ab";
  let bottom = footerTop;
  for (const line of [...credits, ...disclaimer]) {
    context.fillText(line, MARGIN, bottom, inner);
    bottom += 22;
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error(translate("export.notEncoded"));
  return blob;
}
