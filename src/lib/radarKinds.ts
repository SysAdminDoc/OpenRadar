import sites from "./tdwrSites.json";
import {
  LEVEL2_PRODUCTS,
  type Level2ProductId,
  type RadarKind,
} from "./level2";

/**
 * What a held radar can be asked for, before it is asked.
 *
 * A WSR-88D and an airport's terminal radar are different instruments. The
 * terminal radar has no Level II volume, publishes reflectivity and velocity
 * only, reaches 48 nautical miles (with a long range reflectivity to 225) on
 * three tilts, and is read from its Level III products. Hard-coding product
 * strings would let the panel offer a terminal radar a differential
 * reflectivity it cannot produce, and the request would fail somewhere far
 * from the switch that asked for it. This is the one place the difference is
 * written down for the page, and the list of terminal radars is the same
 * file the native side reads, so the two cannot disagree about which is
 * which.
 */

export type { RadarKind } from "./level2";

export interface TdwrSite {
  /** Four letters starting with T, which is how the feed spells them. */
  id: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  elevationFeet: number;
}

/** NCEI's station file for the network, the forty-seven rows typed TDWR. */
export const TDWR_SITES: readonly TdwrSite[] = sites;

export function isTdwrStation(station: string | null | undefined): boolean {
  if (!station) return false;
  const wanted = station.trim().toUpperCase();
  return TDWR_SITES.some((site) => site.id === wanted);
}

export const WSR88D_RANGE_KM = 230;
/** 48 nautical miles: 592 gates of 150 m. */
export const TDWR_RANGE_KM = 88.8;
/** 225 nautical miles: 1390 gates of 300 m. */
export const TDWR_LONG_RANGE_KM = 417;

const TDWR_PRODUCTS: readonly Level2ProductId[] = [
  "reflectivity",
  "velocity",
  "long-range-reflectivity",
];

export interface RadarCapabilities {
  radar: RadarKind;
  /** The products this radar has, in the order the panel lists them. */
  products: readonly Level2ProductId[];
  /** How far the base products reach, in kilometres. */
  rangeKm: number;
  /** How far the long range product reaches, or null where there is none. */
  longRangeKm: number | null;
}

/**
 * What a station can be asked for. A station nobody has named yet, which
 * is the map being followed, is a WSR-88D: that is the only kind the
 * nearest-site search ever hands over.
 */
export function radarCapabilities(
  station: string | null | undefined,
): RadarCapabilities {
  if (isTdwrStation(station)) {
    return {
      radar: "TDWR",
      products: TDWR_PRODUCTS,
      rangeKm: TDWR_RANGE_KM,
      longRangeKm: TDWR_LONG_RANGE_KM,
    };
  }
  return {
    radar: "WSR-88D",
    products: LEVEL2_PRODUCTS.map((product) => product.id).filter(
      (id) => id !== "long-range-reflectivity",
    ),
    rangeKm: WSR88D_RANGE_KM,
    longRangeKm: null,
  };
}

/**
 * The product to ask a station for, given the one the reader chose.
 *
 * Reflectivity is what every radar has, so a product this one does not have
 * becomes that rather than a request that fails: the picker shows which
 * products are off, and the map keeps drawing something true meanwhile.
 */
export function supportedProduct(
  station: string | null | undefined,
  product: Level2ProductId,
): Level2ProductId {
  return radarCapabilities(station).products.includes(product)
    ? product
    : "reflectivity";
}
