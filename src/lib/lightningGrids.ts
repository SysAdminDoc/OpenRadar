/**
 * Which lightning grid, and which isothermal reflectivity, a switch is
 * pointing at.
 *
 * Here rather than in `settings.ts` so the provider can name its products
 * against these without the provider and the settings importing each other.
 * Same shape as `rotationTrack.ts`, for the same reason.
 */

/**
 * How long a window the cloud-to-ground density is averaged over.
 *
 * All four are the same unit, a flash rate, so a reader can step between them
 * and compare what they see. The five-minute one is the default because it is
 * the one that moves with a storm rather than trailing behind it.
 */
export const LIGHTNING_WINDOWS = ["1m", "5m", "15m", "30m"] as const;

export type LightningWindow = (typeof LIGHTNING_WINDOWS)[number];

export function isLightningWindow(value: unknown): value is LightningWindow {
  return LIGHTNING_WINDOWS.includes(value as LightningWindow);
}

/**
 * How far ahead the chance of lightning is forecast.
 *
 * A forecast, not an observation, and everything the workspace says about
 * these two has to carry that: the grid covers ground no flash has struck yet.
 */
export const LIGHTNING_FORECASTS = ["30m", "60m"] as const;

export type LightningForecast = (typeof LIGHTNING_FORECASTS)[number];

export function isLightningForecast(
  value: unknown,
): value is LightningForecast {
  return LIGHTNING_FORECASTS.includes(value as LightningForecast);
}

/**
 * Whether the jump grid shows this minute or the largest of the past five.
 *
 * A jump is momentary, so the instantaneous grid is empty far more often than
 * it is not; the five-minute maximum is what holds a jump on screen long
 * enough to be seen.
 */
export const LIGHTNING_JUMPS = ["now", "max"] as const;

export type LightningJump = (typeof LIGHTNING_JUMPS)[number];

export function isLightningJump(value: unknown): value is LightningJump {
  return LIGHTNING_JUMPS.includes(value as LightningJump);
}

/**
 * Which temperature the reflectivity is sampled at.
 *
 * Named for the temperature rather than a height because the height moves with
 * the air mass: the whole point of the grid is that it follows the level where
 * ice is, wherever that happens to be today.
 */
export const ISOTHERM_LEVELS = ["minus10", "minus20"] as const;

export type IsothermLevel = (typeof ISOTHERM_LEVELS)[number];

export function isIsothermLevel(value: unknown): value is IsothermLevel {
  return ISOTHERM_LEVELS.includes(value as IsothermLevel);
}
