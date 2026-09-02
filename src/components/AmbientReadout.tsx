import { X } from "lucide-react";
import { useT } from "../i18n";
import { formatClock } from "../lib/units";
import { ambientOpacity, drift } from "../lib/ambientScreen";

/**
 * What the second monitor says: the time, the place, the source, the age.
 *
 * Everything somebody glances at from across a room, and nothing they would
 * have to walk over to read. It drifts a few pixels every few minutes and
 * fades after a while unattended, both for the monitor's sake, and neither is
 * visible to a person.
 *
 * Nothing here is pure white. A bright static rectangle is the worst case for
 * both a panel's health and for a room somebody is asleep in.
 */
export function AmbientReadout({
  clock,
  place,
  source,
  frameAgeMinutes,
  idleMs,
  onLeave,
}: {
  /** Ticks once a minute, which is all a wall clock needs. */
  clock: number;
  place: string;
  source: string;
  frameAgeMinutes: number | null;
  /** How long since anybody touched the machine. */
  idleMs: number;
  onLeave: () => void;
}) {
  const t = useT();
  const at = drift(idleMs);
  return (
    <div
      className="ambient-readout"
      data-ambient-readout
      style={{
        transform: `translate(${at.x}px, ${at.y}px)`,
        opacity: ambientOpacity(idleMs),
      }}
    >
      <strong>
        {formatClock(clock, { hour: "numeric", minute: "2-digit" })}
      </strong>
      {place ? <span>{place}</span> : null}
      <small>
        {frameAgeMinutes === null
          ? source
          : t("ambientScreen.age", {
              source,
              minutes: frameAgeMinutes,
            })}
      </small>
      {/* The way out. The command bar this was reached from is one of the
          things the mode hides, so without this there is no way back that is
          not a keyboard shortcut, and this project does not have those. It
          sits at a tenth opacity until it is pointed at, so a monitor left
          on a wall is not showing a button all night. */}
      <button
        type="button"
        className="ambient-readout__leave"
        onClick={onLeave}
        aria-label={t("ambientScreen.leave")}
      >
        <X size={18} />
      </button>
    </div>
  );
}
