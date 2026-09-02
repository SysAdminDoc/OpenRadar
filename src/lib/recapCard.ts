import { translate } from "../i18n";

/**
 * The recap as a picture, composed rather than screenshotted.
 *
 * Sized for sharing and drawn from the same lines the panel shows, so a
 * picture cannot say something about the record that the app does not.
 *
 * Nothing here decides what goes on it. The lines arrive already made, place
 * names included or left out by the reader, and the credits arrive with them,
 * because a picture of somebody's own record still carries the names of the
 * offices and stations whose readings it counts.
 */
export const RECAP_WIDTH = 1200;
export const RECAP_HEIGHT = 630;

/** The margin both sides, so a line has this much less than the full width. */
const MARGIN = 64;

/**
 * One string as however many lines it needs at this width.
 *
 * Measured rather than guessed. A reader who watches several places has a
 * dozen stations in the credits, and `fillText` neither wraps nor clips: it
 * simply draws past the edge of the canvas and the tail is gone. The credits
 * are the one line on this picture that is not optional.
 */
function wrapped(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    // A word wider than the whole line has to be broken inside itself, or it
    // is emitted as one over-wide line and drawn off the edge of the canvas.
    // A place somebody named after a German compound is all it takes.
    let rest = word;
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
  return lines.length ? lines : [""];
}

export async function drawRecapCard(options: {
  title: string;
  lines: readonly string[];
  credits: string;
}): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = RECAP_WIDTH;
  canvas.height = RECAP_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(translate("export.noCanvas"));
  const width = RECAP_WIDTH - MARGIN * 2;

  context.fillStyle = "#090b10";
  context.fillRect(0, 0, RECAP_WIDTH, RECAP_HEIGHT);

  context.fillStyle = "#4c8dff";
  context.fillRect(0, 0, RECAP_WIDTH, 6);

  context.fillStyle = "#e7edf7";
  context.font = "600 44px 'Segoe UI', system-ui, sans-serif";
  context.textBaseline = "top";
  context.fillText(options.title, MARGIN, 72, width);

  // The credits are measured and placed first, so the figures above them have
  // whatever room is left rather than the other way round.
  context.font = "18px 'Segoe UI', system-ui, sans-serif";
  const credits = wrapped(context, options.credits, width);
  const creditsTop = RECAP_HEIGHT - 40 - credits.length * 24;

  context.font = "24px 'Segoe UI', system-ui, sans-serif";
  context.fillStyle = "#c8d3e4";
  let y = 168;
  for (const line of options.lines) {
    for (const part of wrapped(context, line, width)) {
      // A card that runs out of room drops what will not fit rather than
      // writing over its own credits. The panel has all of it either way.
      if (y > creditsTop - 42) break;
      // `maxWidth` as well as the wrapping, so a font that measures wider on
      // one machine than another squeezes rather than overflows.
      context.fillText(part, MARGIN, y, width);
      y += 34;
    }
    if (y > creditsTop - 42) break;
    y += 8;
  }

  context.font = "18px 'Segoe UI', system-ui, sans-serif";
  context.fillStyle = "#8b97ab";
  credits.forEach((line, index) => {
    context.fillText(line, MARGIN, creditsTop + index * 24, width);
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error(translate("export.notEncoded"));
  return blob;
}
