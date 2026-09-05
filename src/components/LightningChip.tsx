import { Zap } from "lucide-react";
import { useT } from "../i18n";
import { compassPoint } from "../lib/nearby";
import { formatAge, formatDistance, useMeasurements } from "../lib/units";
import { lightningStep, type PlaceLightning } from "../lib/lightningWatch";

interface LightningChipProps {
  /** What the watch counted for this place, or nothing while it has no feed. */
  lightning: PlaceLightning | null | undefined;
  /** Ticks, so the minutes on it age without a new flash window. */
  clock: number;
}

/**
 * How long it has been since the last flash near a place, and how close it
 * came.
 *
 * The colour is elapsed time and nothing else. The 2026 Hazardous Weather
 * Testbed put a stoplight in front of forecasters for exactly this, and the
 * finding worth carrying is the negative one: a probability that has trended
 * clear is not an all-clear while a strike six miles out is ten minutes old.
 * So this never reads clear from a count, a probability or an empty window,
 * only from half an hour of quiet.
 *
 * Nothing at all for a place with no flashes in the window the app is
 * holding. That is not the same statement as "it is clear", and saying the
 * second from the first is the mistake the testbed warned about.
 */
export function LightningChip({ lightning, clock }: LightningChipProps) {
  const t = useT();
  // The distance below is the reader's own measure, and without this the chip
  // goes on saying miles after the switch until something else redraws it.
  useMeasurements();
  const step = lightningStep(
    lightning?.newest ?? null,
    clock,
    lightning?.checkedAt ?? null,
  );
  if (!lightning || step === null || lightning.newest === null) return null;
  const since = formatAge(Math.max(0, clock - lightning.newest) / 60_000);
  return (
    <p className="lightning-chip" data-step={step}>
      <Zap size={13} aria-hidden="true" />
      <span>
        {t(
          step === "clear"
            ? "lightningWatch.chipClear"
            : "lightningWatch.chipSince",
          { since },
        )}
        {lightning.nearestMiles !== null &&
        lightning.nearestBearing !== null ? (
          <small>
            {t("lightningWatch.chipNearest", {
              distance: formatDistance(lightning.nearestMiles),
              direction: compassPoint(lightning.nearestBearing),
            })}
          </small>
        ) : null}
      </span>
    </p>
  );
}
