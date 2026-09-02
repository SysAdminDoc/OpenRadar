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

  context.fillStyle = "#090b10";
  context.fillRect(0, 0, RECAP_WIDTH, RECAP_HEIGHT);

  context.fillStyle = "#4c8dff";
  context.fillRect(0, 0, RECAP_WIDTH, 6);

  context.fillStyle = "#e7edf7";
  context.font = "600 44px 'Segoe UI', system-ui, sans-serif";
  context.textBaseline = "top";
  context.fillText(options.title, 64, 72);

  context.font = "24px 'Segoe UI', system-ui, sans-serif";
  let y = 168;
  for (const line of options.lines) {
    // A card that runs out of room drops the last lines rather than writing
    // over its own credits. The panel has all of them either way.
    if (y > RECAP_HEIGHT - 140) break;
    context.fillStyle = "#c8d3e4";
    context.fillText(line, 64, y);
    y += 42;
  }

  context.font = "18px 'Segoe UI', system-ui, sans-serif";
  context.fillStyle = "#8b97ab";
  context.fillText(options.credits, 64, RECAP_HEIGHT - 72);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error(translate("export.notEncoded"));
  return blob;
}
