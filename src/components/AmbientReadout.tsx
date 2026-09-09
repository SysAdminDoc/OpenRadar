import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { formatClock } from "../lib/units";
import { ambientOpacity, ambientTypeScale, drift } from "../lib/ambientScreen";

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
  overLight,
  metres,
  onLeave,
}: {
  /** Ticks once a minute, which is all a wall clock needs. */
  clock: number;
  place: string;
  source: string;
  frameAgeMinutes: number | null;
  /** How long since anybody touched the machine. */
  idleMs: number;
  /** Whether the basemap under this is a light one. */
  overLight: boolean;
  /** How far away the reader said the screen is, in metres. */
  metres: number;
  onLeave: () => void;
}) {
  const t = useT();

  /**
   * The way out takes the focus when this mounts, and hands it back on the
   * way out.
   *
   * The mode hides the rail, the panels and the toasts, so whatever the
   * reader had focused is out of the tab order and the focus falls to the
   * body: the next Tab starts again from the top of an empty window, and the
   * only control left sits at a tenth opacity. Focus-visible is what draws a
   * ring, so a pointer user entering this sees nothing appear.
   *
   * Leaving has the same problem in reverse. Pressing the leave button
   * unmounts the thing holding the focus, so without the second half of this
   * the exit dropped the focus exactly where the entrance used to.
   */
  const leaveRef = useRef<HTMLButtonElement>(null);
  const cameFromRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const opener = document.activeElement;
    cameFromRef.current =
      opener instanceof HTMLElement && opener !== document.body ? opener : null;
    leaveRef.current?.focus();
    return () => {
      // Only if it is still on the page. Everything in here is hidden while
      // the mode is on, so a control that has since gone is nothing to
      // return to.
      const back = cameFromRef.current;
      if (back?.isConnected) back.focus();
    };
  }, []);

  const at = drift(idleMs);
  const shown = formatClock(clock, { hour: "numeric", minute: "2-digit" });
  const beneath =
    frameAgeMinutes === null
      ? source
      : t("ambientScreen.age", { source, minutes: frameAgeMinutes });

  /**
   * How big the readout comes out at its design size, measured rather than
   * worked out from the strings.
   *
   * A glyph is not half an em, and in some scripts it is nowhere near: a
   * forty-five character place name ran a hundred pixels off the right edge
   * and sixteen characters of Japanese stood a hundred and forty above the
   * top. The element knows what it comes to, so it is asked, at its design
   * size, before anything is scaled.
   *
   * The room is divided by the reader's text size, which is a `zoom` on the
   * root. Everything measured here is in the layout's own pixels, which zoom
   * multiplies on the way to the screen, and neither `window.innerWidth` nor
   * `documentElement.clientWidth` is divided by it. The stylesheet keeps
   * `--screen-width` for exactly this and says so; at 130 per cent, reading
   * the undivided number put the readout off the edge.
   */
  const readoutRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const node = readoutRef.current;
    if (!node) return;
    node.style.setProperty("--ambient-scale", "1");
    const natural = { width: node.offsetWidth, height: node.offsetHeight };
    node.style.removeProperty("--ambient-scale");
    const zoom =
      Number(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--text-scale",
        ),
      ) || 1;
    setScale(
      ambientTypeScale(
        metres,
        {
          width: document.documentElement.clientWidth / zoom,
          height: document.documentElement.clientHeight / zoom,
        },
        natural,
      ),
    );
  }, [beneath, metres, place, shown]);

  return (
    <div
      ref={readoutRef}
      // Keyed on the basemap rather than on the theme, the way the county
      // lines are. The clock is drawn straight onto the map with nothing
      // behind it, so what it has to stay legible against is whatever the
      // reader chose to look at, not what the chrome is painted in.
      className="ambient-readout"
      data-over-light={overLight ? "1" : undefined}
      data-ambient-readout
      style={
        {
          transform: `translate(${at.x}px, ${at.y}px)`,
          opacity: ambientOpacity(idleMs),
          // One number for the whole readout, which the stylesheet multiplies
          // each line by.
          "--ambient-scale": scale,
        } as CSSProperties
      }
    >
      <strong>{shown}</strong>
      {place ? <span>{place}</span> : null}
      <small>{beneath}</small>
      {/* The way out. The command bar this was reached from is one of the
          things the mode hides, so without this there is no way back that is
          not a keyboard shortcut, and this project does not have those. It
          sits at a tenth opacity until it is pointed at, so a monitor left
          on a wall is not showing a button all night. */}
      <button
        type="button"
        ref={leaveRef}
        className="ambient-readout__leave"
        onClick={onLeave}
        aria-label={t("ambientScreen.leave")}
      >
        <X size={18} />
      </button>
    </div>
  );
}
