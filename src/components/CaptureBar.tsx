import { Radar, X } from "lucide-react";
import { formatNumber, useT } from "../i18n";
import { formatClock } from "../lib/units";
import { useHighContrast } from "../hooks/useClock";
import type { OverlayData } from "../lib/overlays";

/**
 * The workspace as somebody streaming it wants it.
 *
 * Weather streamers composite radar into OBS today by cropping a window and
 * hoping the panels stay out of shot, or by running a separate dashboard
 * project beside the app. No radar application ships a mode for it, and
 * nobody has even asked the nearest competitor for one.
 *
 * What a capture needs is the opposite of what a workstation needs. The rail,
 * the panels, the scrubber and the zoom buttons are all things the streamer
 * operates before they go live and nobody watching can use. The four things
 * that matter are what time it is, where the map is, what is being warned
 * about, and who the data belongs to, and every one of them has to survive
 * being scaled down and compressed on somebody else's stream.
 *
 * So this is a strip, not a dashboard: large type, high contrast, and the
 * bottom of the frame left clear, because that is where a streamer puts their
 * own overlay. It is ordinary window content. There is no separate window, no
 * always-on-top, no keyboard shortcut, and nothing about the map itself
 * changes: the same frames are drawn from the same data at the same time.
 */
export interface CaptureBarProps {
  /** Where the map is looking, which is what a viewer is being shown. */
  center: [number, number];
  /** What the timeline calls its source, for the credit line. */
  sourceLabel: string | null;
  /** The credit the provider asks for. */
  attribution: string | null;
  /** The warnings on the map, most severe first, or null when the layer is off. */
  alerts: OverlayData | null;
  /** Milliseconds, ticking once a minute. */
  clock: number;
  onLeave: () => void;
}

/** Degrees as a person reads them off a map, rather than as a float. */
function degrees(value: number, positive: string, negative: string): string {
  const hemisphere = value >= 0 ? positive : negative;
  return `${formatNumber(Math.abs(value), 2)}°${hemisphere}`;
}

export function CaptureBar({
  center,
  sourceLabel,
  attribution,
  alerts,
  clock,
  onLeave,
}: CaptureBarProps) {
  const t = useT();
  // The same switch the rest of the app follows. A stream is somebody else's
  // display at somebody else's brightness, so if this reader has asked for
  // more contrast the capture is the last place to quietly drop it.
  const highContrast = useHighContrast();

  const features = (alerts?.features ?? []) as Array<{
    properties: Record<string, unknown>;
  }>;
  // Already sorted by severity and then by damage tag where the office set
  // one, so the first is the one a viewer needs to see.
  const worst = features[0]?.properties;
  const headline = typeof worst?.headline === "string" ? worst.headline : null;
  const severity = typeof worst?.severity === "string" ? worst.severity : "";
  const impact = typeof worst?.impact === "string" ? worst.impact : "";

  return (
    <div
      className={`capture-bar${highContrast ? " is-high-contrast" : ""}`}
      data-capture-bar
    >
      <div className="capture-bar__top">
        <span className="capture-bar__mark" aria-hidden="true">
          <Radar size={22} />
        </span>
        <strong className="capture-bar__clock">
          {formatClock(new Date(clock), {
            hour: "numeric",
            minute: "2-digit",
          })}
        </strong>
        <span className="capture-bar__place">
          {degrees(center[1], "N", "S")} {degrees(center[0], "E", "W")}
        </span>
        {headline ? (
          <span
            className="capture-bar__alert"
            data-severity={severity}
            role="status"
          >
            <strong>{headline}</strong>
            {impact ? <em>{t(`alerts.impact.${impact}` as never)}</em> : null}
          </span>
        ) : (
          <span className="capture-bar__alert is-quiet" role="status">
            {t("capture.noAlerts")}
          </span>
        )}
        {/* The way out. The command bar this was reached from is one of the
            things the mode hides, so without this there is no way back that is
            not a keyboard shortcut, and this project does not have those. It
            sits at a tenth opacity until it is pointed at, so a streamer who
            frames the strip in shot is not framing a button. */}
        <button
          type="button"
          className="capture-bar__leave"
          onClick={onLeave}
          aria-label={t("capture.leave")}
        >
          <X size={18} />
        </button>
      </div>
      {/* Never optional and never small. These services publish for nothing
          and ask to be credited, and a stream is the one place the credit
          reaches people who will never see the app. */}
      <div className="capture-bar__credit">
        OpenRadar · OpenStreetMap
        {sourceLabel ? ` · ${sourceLabel}` : ""}
        {attribution && attribution !== sourceLabel ? ` · ${attribution}` : ""}
      </div>
    </div>
  );
}
