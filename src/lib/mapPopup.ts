import { translate } from "../i18n";
import {
  OVERLAY_SOURCE_PREFIX,
  PROBSEVERE_FILL_LAYER_ID,
  topmost,
  type Placed,
} from "./layerStack";
import { OVERLAY_ADAPTERS } from "./overlays/index";

/** What a popup says. */
export interface PopupContent {
  title: string;
  lines: string[];
  url?: string;
}

/** A hit test result, cut down to what deciding the popup needs. */
export interface Hit extends Placed {
  properties: Record<string, unknown> | null;
}

/**
 * What a click on these features should open, or nothing.
 *
 * Which one answers is decided by the same order the map draws in, and by
 * nothing else. Asking one layer first and the rest afterwards is that order
 * written out twice, and the two drifted: the model's severe probability is
 * drawn under the warnings on purpose, because guidance belongs under a
 * decision somebody has taken responsibility for, and it was asked first
 * anyway. A tornado warning could not be clicked anywhere the model had drawn
 * a polygon over the same storm, which is every storm that carries one.
 *
 * Kept out of the map component so it can be driven without standing a map up.
 */
export function popupFrom(
  hits: readonly Hit[],
  order: readonly string[],
): PopupContent | null {
  const hit = topmost(hits, order);
  if (!hit) return null;
  const properties = hit.properties ?? {};

  if (hit.layer.id === PROBSEVERE_FILL_LAYER_ID) {
    const detail = String(properties.detail ?? "");
    return {
      title: translate("probSevere.title"),
      lines: [
        translate("probSevere.headline", {
          percent: String(properties.severe ?? 0),
        }),
        translate("probSevere.kinds", {
          hail: String(properties.hail ?? 0),
          wind: String(properties.wind ?? 0),
          tornado: String(properties.tornado ?? 0),
        }),
        ...(detail ? [detail] : []),
        translate("probSevere.note"),
      ],
    };
  }

  const adapter = OVERLAY_ADAPTERS.find((candidate) =>
    hit.layer.id.startsWith(`${OVERLAY_SOURCE_PREFIX}${candidate.id}`),
  );
  if (!adapter) return null;
  return adapter.describe(properties);
}
