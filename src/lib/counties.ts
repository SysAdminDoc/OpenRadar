/**
 * The county and state outlines the app ships with.
 *
 * Warnings and storm reports are read by county. "A tornado warning for Polk,
 * Dallas and Story" means nothing on a map with no county lines on it, and
 * every other radar application draws them.
 *
 * Bundled rather than fetched, the way the storm archive and the tide stations
 * are: the lines do not change between Census vintages, and a map that stops
 * telling you which county you are in when the network goes is worse than one
 * that never told you.
 *
 * Built by `scripts/build-counties.mjs`.
 */

import { translate } from "../i18n";

/** What the file holds: one feature, every outline in it. */
export interface CountyOutlines {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { source: string };
    geometry: { type: "MultiLineString"; coordinates: number[][][] };
  }>;
}

let loading: Promise<CountyOutlines> | null = null;

/** The bundled outlines, read once and kept. */
export function loadCounties(): Promise<CountyOutlines> {
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}counties.json`)
      .then((response) => {
        if (!response.ok) throw new Error(translate("counties.failed"));
        return response.json() as Promise<CountyOutlines>;
      })
      .catch((error: unknown) => {
        // A failed read must not be remembered as an empty map, or the switch
        // goes on once and never draws again for the life of the window.
        loading = null;
        throw error;
      });
  }
  return loading;
}

/** Only for tests, which need a fresh read between cases. */
export function resetCounties() {
  loading = null;
}
