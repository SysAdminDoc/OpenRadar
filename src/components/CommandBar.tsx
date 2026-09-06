import {
  BellRing,
  CloudSun,
  Crosshair,
  Download,
  Ellipsis,
  Film,
  Globe2,
  Layers2,
  Layers3,
  LocateFixed,
  Map,
  MapPin,
  MousePointer2,
  PanelLeftClose,
  Pencil,
  Radar,
  ScrollText,
  Search,
  Send,
  Settings,
  Share2,
  Tornado,
  Route,
  History,
  Command,
  Rows3,
  Waves,
  Gauge,
  Wind,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useT } from "../i18n";

export type SurfaceId =
  | "search"
  | "alerts"
  | "nearby"
  | "tropical"
  | "history"
  | "commands"
  | "route"
  | "guidance"
  | "sounding"
  | "vwp"
  | "tides"
  | "map-type"
  | "layers"
  | "export"
  | "upload"
  | "forecast"
  | "settings"
  | "more"
  /** Opened by the cross-section tool rather than by a button of its own. */
  | "section"
  | null;

export type ToolMode = "draw" | "range" | "inspect" | "section" | null;

/**
 * What one button of the rail is worth, from the stylesheet's own rule.
 *
 * Only the paging step uses it, and only as a minimum and an overlap, so it
 * being a point or two out costs nothing: a rail with no room for a whole
 * button still scrolls by one.
 */
const RAIL_BUTTON_HEIGHT = 48;

/**
 * Where the tool list may come to rest, as offsets into its own content.
 *
 * Every button's top edge, and zero. A rail resting anywhere else shows a
 * button cut at one end or the other, whatever its height is fitted to.
 */
function restingOffsets(region: HTMLElement): number[] {
  return [
    0,
    // The far end. Without it the nearest button top is always a little short
    // of the bottom, so the last button could not be reached and the rail went
    // on saying there was more below when there was not. Nothing is cut there:
    // the content ends where the region does.
    Math.max(0, region.scrollHeight - region.clientHeight),
    ...[...region.querySelectorAll<HTMLElement>(".command-button")].map(
      (button) => button.offsetTop - region.offsetTop,
    ),
  ];
}

/** The one of those nearest a wanted offset. */
function nearestOffset(offsets: number[], wanted: number): number {
  return offsets.reduce((best, offset) =>
    Math.abs(offset - wanted) < Math.abs(best - wanted) ? offset : best,
  );
}

interface CommandBarProps {
  activeSurface: SurfaceId;
  activeTool: ToolMode;
  dualPane: boolean;
  projection: "mercator" | "globe";
  presets: boolean[];
  onSurface: (surface: SurfaceId) => void;
  onTool: (tool: ToolMode) => void;
  onLocate: () => void;
  onDualPane: () => void;
  onProjection: () => void;
  onPreset: (index: number) => void;
  onShare: () => void;
}

interface CommandButtonProps {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  onClick: () => void;
  detail?: string;
  /**
   * A shorter word for the strip, when the name will not fit in it.
   *
   * The rail gives a label sixty-eight pixels at eight point and cuts it off
   * with an ellipsis, and two of them were cut in English at the size the
   * README screenshot is taken: "Nearby we..." and "Cross-secti..." in the
   * app's own primary navigation. The name itself does not change: it is
   * still what the tooltip says and still what a screen reader is told.
   */
  short?: string;
}

function CommandButton({
  icon: Icon,
  label,
  active,
  onClick,
  detail,
  short,
}: CommandButtonProps) {
  return (
    <button
      className="command-button"
      type="button"
      aria-pressed={active}
      // Narrow windows hide the visible label, and without this the button
      // would be named after its tooltip instead.
      aria-label={label}
      title={detail ?? label}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.8} />
      <span>{short ?? label}</span>
    </button>
  );
}

export function CommandBar({
  activeSurface,
  activeTool,
  dualPane,
  projection,
  presets,
  onSurface,
  onTool,
  onLocate,
  onDualPane,
  onProjection,
  onPreset,
  onShare,
}: CommandBarProps) {
  const t = useT();
  const advancedRef = useRef<HTMLDivElement>(null);
  const toggleSurface = (surface: Exclude<SurfaceId, null>) =>
    onSurface(activeSurface === surface ? null : surface);
  const toggleTool = (tool: Exclude<ToolMode, null>) =>
    onTool(activeTool === tool ? null : tool);

  useEffect(() => {
    if (
      activeSurface === "map-type" ||
      activeSurface === "route" ||
      activeSurface === "guidance" ||
      activeSurface === "tides" ||
      activeSurface === "export" ||
      activeSurface === "upload" ||
      activeSurface === "tropical"
    ) {
      return;
    }
    if (advancedRef.current) advancedRef.current.scrollTop = 0;
  }, [activeSurface]);

  /**
   * Whether there is more of the rail above or below what is on screen, and
   * where the region may end.
   *
   * The region scrolls with its scrollbar hidden, so the only sign that
   * eleven tools are below the fold was a twelve-pixel fade and, at 1440 by
   * 900, the Range button cut through the middle: an icon with no caption,
   * which reads as a layout fault rather than as "there is more". Export and
   * Upload, the two a reader looks for first, were among the hidden.
   *
   * Two things happen here. The height is floored to the bottom edge of a
   * whole button, so the region never ends part-way through one: a button is
   * either wholly there or wholly not, and the fade lands on a boundary
   * instead of on a word. And the two edges are held as state rather than as
   * bare attributes, because the chevron below is rendered from them.
   */
  const [edges, setEdges] = useState({ above: false, below: false });
  /** What the region was last fitted to, so paging does not shrink with it. */
  const pageStep = useRef(RAIL_BUTTON_HEIGHT);
  const refit = useRef(() => {});
  useEffect(() => {
    const region = advancedRef.current;
    if (!region) return;

    /**
     * The height, and only when the room changes.
     *
     * Deliberately not on scroll. Writing a height from inside a scroll
     * handler made the rail breathe: the region's own height fed the paging
     * step, which fed the next scroll, which re-fitted the height, and five
     * wheel ticks walked it from 353 to 321 and back while the footer moved
     * under the reader's pointer. Worse, the step shrank with it until the
     * chevron was scrolling by a single button and then by nothing at all,
     * with eighteen tools still below and the control still on screen.
     */
    const fit = () => {
      // Clearing the cap makes the region taller for a moment, which shrinks
      // how far it can scroll, and the browser pulls the offset back to suit.
      // A rail scrolled to its last button came back one page short and said
      // there was more below when there was not. Put it back afterwards; the
      // browser clamps it if the content really did change.
      const held = region.scrollTop;
      region.style.maxHeight = "";
      // Asking a flex box for a height is not getting it: the rest of the rail
      // has its own claims, so a cap it will not grant leaves the region
      // shorter than the boundary that was chosen and the button at that
      // boundary cut anyway. Re-measure and floor again until the two agree.
      // The room only ever shrinks, so three passes is generous.
      for (let pass = 0; pass < 3; pass += 1) {
        const room = region.clientHeight;
        let fits = 0;
        for (const button of region.querySelectorAll<HTMLElement>(
          ".command-button",
        )) {
          const bottom =
            button.offsetTop - region.offsetTop + button.offsetHeight;
          if (bottom <= room && bottom > fits) fits = bottom;
        }
        // Nothing fits whole in a very short rail: leave the room alone rather
        // than collapsing the region to nothing.
        if (fits === 0 || fits === room) break;
        region.style.maxHeight = `${fits}px`;
      }
      if (Math.abs(region.scrollTop - held) > 1) region.scrollTop = held;
      pageStep.current = Math.max(
        RAIL_BUTTON_HEIGHT,
        region.clientHeight - RAIL_BUTTON_HEIGHT,
      );
    };

    /** Where it rests and what it says about its edges, on every scroll. */
    const mark = () => {
      // Chromium's scroll anchoring parks a scroller it has just shrunk at an
      // arbitrary offset, and no height fits a rail resting mid-button. Zero
      // and the far end are resting places too, and the nearest one wins so
      // this never fights a reader who scrolled on purpose. Setting it fires
      // another scroll, which finds it aligned and stops.
      const nearest = nearestOffset(restingOffsets(region), region.scrollTop);
      if (Math.abs(nearest - region.scrollTop) > 1) region.scrollTop = nearest;

      const top = region.scrollTop;
      const more = region.scrollHeight - region.clientHeight;
      // One pixel of slack: a fractional layout leaves a hair of scroll that
      // nothing can reach, and a fade over a dead edge is a lie.
      const above = top > 1;
      const below = more - top > 1;
      region.toggleAttribute("data-more-above", above);
      region.toggleAttribute("data-more-below", below);
      setEdges((held) =>
        held.above === above && held.below === below ? held : { above, below },
      );
    };

    const both = () => {
      fit();
      mark();
    };
    refit.current = both;
    both();
    region.addEventListener("scroll", mark, { passive: true });
    // Guarded the way `matchMedia` is elsewhere: a plain jsdom has no
    // ResizeObserver, and a fade at the edge of a rail is not worth taking
    // the whole workspace down over.
    const watcher =
      typeof ResizeObserver === "function" ? new ResizeObserver(both) : null;
    // The rail itself rather than the region: the region's own height is what
    // this writes, so watching it would answer its own change for ever.
    if (watcher && region.parentElement) watcher.observe(region.parentElement);
    if (watcher) for (const child of region.children) watcher.observe(child);
    return () => {
      region.removeEventListener("scroll", mark);
      watcher?.disconnect();
      refit.current = () => {};
    };
  }, []);

  // The chevrons take room from the region, and they are rendered from the
  // edges the fit works out, so the first fit runs without them and the second
  // has to account for them. One extra pass, only when the pair changes.
  useEffect(() => {
    refit.current();
  }, [edges.above, edges.below]);

  /**
   * Pages the tool list by what is on screen, less one button of overlap.
   *
   * Straight to a resting offset rather than smoothly by a distance: the
   * effect above snaps the rail back to a boundary on every scroll event, so
   * an animation would spend its whole length being pulled back to where it
   * started. In a rail this size there is nothing for an animation to explain.
   *
   * The step is what the region was fitted to rather than what it measures
   * now, because a height read here is a height this scroll is about to
   * change.
   */
  const pageRail = (direction: 1 | -1) => {
    const region = advancedRef.current;
    if (!region) return;
    const at = region.scrollTop;
    // Only offsets the press would actually move to. Taking the nearest to
    // where a page lands can be the one it started from, and then the chevron
    // is on screen doing nothing with eighteen tools still below it: measured
    // at 1024 by 680, where a press walked 0, 65, 113, 178, 178, 178.
    const ahead = restingOffsets(region).filter((offset) =>
      direction === 1 ? offset > at + 1 : offset < at - 1,
    );
    if (ahead.length === 0) return;
    region.scrollTop = nearestOffset(ahead, at + pageStep.current * direction);
  };

  return (
    <nav className="command-bar" aria-label={t("bar.label")}>
      <div className="command-group command-group--primary">
        <CommandButton
          icon={LocateFixed}
          label={t("bar.location")}
          onClick={onLocate}
        />
        <CommandButton
          icon={Command}
          label={t("bar.commands")}
          active={activeSurface === "commands"}
          detail={t("bar.commandsDetail")}
          onClick={() => toggleSurface("commands")}
        />
        <CommandButton
          icon={Search}
          label={t("panel.search")}
          active={activeSurface === "search"}
          onClick={() => toggleSurface("search")}
        />
        <CommandButton
          icon={Layers3}
          label={t("panel.layers")}
          active={activeSurface === "layers"}
          onClick={() => toggleSurface("layers")}
        />
        <CommandButton
          icon={BellRing}
          label={t("panel.alerts")}
          active={activeSurface === "alerts"}
          onClick={() => toggleSurface("alerts")}
        />
        <CommandButton
          icon={CloudSun}
          label={t("panel.forecast")}
          active={activeSurface === "forecast"}
          onClick={() => toggleSurface("forecast")}
        />
        <CommandButton
          icon={History}
          label={t("bar.history")}
          active={activeSurface === "history"}
          onClick={() => toggleSurface("history")}
        />
      </div>

      <div ref={advancedRef} className="command-scroll-region">
        <div className="command-divider" />
        <div className="command-group command-group--workspace">
          {/* The readout leads the scrolling half rather than joining the
              fixed one above it. In the fixed group it cost the scrolling
              region a button's height at every text scale, and at 1024 by 720
              with the text at 130 percent that took the region to nothing at
              all: twenty controls inside a box with no height to show them
              in. Reachability is the point of putting it on the rail. */}
          <CommandButton
            icon={ScrollText}
            label={t("panel.nearby")}
            short={t("bar.nearbyShort")}
            active={activeSurface === "nearby"}
            onClick={() => toggleSurface("nearby")}
          />
          <CommandButton
            icon={Map}
            label={t("panel.mapType")}
            short={t("bar.mapTypeShort")}
            active={activeSurface === "map-type"}
            onClick={() => toggleSurface("map-type")}
          />
          <CommandButton
            icon={PanelLeftClose}
            label={t("bar.dualPane")}
            active={dualPane}
            onClick={onDualPane}
          />
        </div>

        <div className="command-divider" />

        <div className="command-group command-group--scenes">
          <CommandButton
            icon={projection === "globe" ? Globe2 : Radar}
            label={
              projection === "globe" ? t("mapType.flat") : t("mapType.globe")
            }
            onClick={onProjection}
            detail={projection === "globe" ? t("bar.toFlat") : t("bar.toGlobe")}
          />
          {presets.map((saved, index) => (
            <button
              className="preset-button"
              type="button"
              key={index}
              aria-label={
                saved
                  ? t("bar.openPreset", { number: index + 1 })
                  : t("bar.savePreset", { number: index + 1 })
              }
              title={
                saved
                  ? t("bar.openPreset", { number: index + 1 })
                  : t("bar.savePreset", { number: index + 1 })
              }
              onClick={() => onPreset(index)}
            >
              <span>{index + 1}</span>
              <i className={saved ? "is-saved" : ""} />
            </button>
          ))}
        </div>

        <div className="command-divider" />

        <div className="command-group command-group--tools">
          <CommandButton
            icon={Pencil}
            label={t("tool.draw")}
            active={activeTool === "draw"}
            onClick={() => toggleTool("draw")}
          />
          <CommandButton
            icon={Crosshair}
            label={t("tool.range")}
            active={activeTool === "range"}
            onClick={() => toggleTool("range")}
          />
          <CommandButton
            icon={MousePointer2}
            label={t("tool.inspect")}
            active={activeTool === "inspect"}
            onClick={() => toggleTool("inspect")}
          />
          <CommandButton
            icon={Layers2}
            label={t("tool.section")}
            short={t("bar.sectionShort")}
            active={activeTool === "section"}
            onClick={() => toggleTool("section")}
          />
          <CommandButton
            icon={Wind}
            label={t("panel.sounding")}
            short={t("bar.soundingShort")}
            active={activeSurface === "sounding"}
            onClick={() => toggleSurface("sounding")}
          />
          <CommandButton
            icon={Gauge}
            label={t("panel.vwp")}
            short={t("bar.vwpShort")}
            active={activeSurface === "vwp"}
            onClick={() => toggleSurface("vwp")}
          />
        </div>

        <div className="command-divider" />

        <div className="command-group command-group--secondary">
          <CommandButton
            icon={Tornado}
            label={t("layer.tropical")}
            active={activeSurface === "tropical"}
            onClick={() => toggleSurface("tropical")}
          />
          <CommandButton
            icon={Route}
            label={t("panel.route")}
            active={activeSurface === "route"}
            onClick={() => toggleSurface("route")}
          />
          <CommandButton
            icon={Rows3}
            label={t("panel.guidance")}
            active={activeSurface === "guidance"}
            onClick={() => toggleSurface("guidance")}
          />
          <CommandButton
            icon={Waves}
            label={t("panel.tides")}
            active={activeSurface === "tides"}
            onClick={() => toggleSurface("tides")}
          />
          <CommandButton
            icon={Film}
            label={t("panel.export")}
            active={activeSurface === "export"}
            onClick={() => toggleSurface("export")}
          />
          <CommandButton
            icon={Share2}
            label={t("bar.share")}
            onClick={onShare}
          />
          <CommandButton
            icon={Download}
            label={t("panel.upload")}
            short={t("bar.uploadShort")}
            active={activeSurface === "upload"}
            onClick={() => toggleSurface("upload")}
          />
        </div>
      </div>

      {/* Something is down there, and a fade is not a control. Eleven tools
          sat below the fold with nothing to press: the scrollbar is hidden,
          this project has no keyboard shortcuts, and a reader who has never
          dragged inside a 68px rail has no reason to think there is more.
          Rendered only when there is somewhere to go, so the rail is not
          carrying a dead button on a tall window. */}
      {/* Rendered always and empty when there is nowhere to go: the stylesheet
          takes an empty one out of the flow, and the fit runs again whenever
          the pair changes, so the region is measured against the room these
          actually leave rather than the room before them. */}
      <div className="command-page">
        {edges.above ? (
          <button
            type="button"
            className="command-page__step"
            aria-label={t("bar.scrollUp")}
            onClick={() => pageRail(-1)}
          >
            <ChevronUp size={16} strokeWidth={2} />
          </button>
        ) : null}
        {edges.below ? (
          <button
            type="button"
            className="command-page__step"
            aria-label={t("bar.scrollDown")}
            onClick={() => pageRail(1)}
          >
            <ChevronDown size={16} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <div className="command-spacer" />

      <div className="command-group command-group--footer">
        <CommandButton
          icon={Settings}
          label={t("panel.settings")}
          active={activeSurface === "settings"}
          onClick={() => toggleSurface("settings")}
        />
        <CommandButton
          icon={Ellipsis}
          label={t("panel.more")}
          active={activeSurface === "more"}
          onClick={() => toggleSurface("more")}
        />
      </div>

      <div
        className="compact-command-group"
        role="group"
        aria-label={t("bar.compact")}
      >
        <CommandButton
          icon={MapPin}
          label={t("bar.locate")}
          onClick={onLocate}
        />
        <CommandButton
          icon={Command}
          label={t("bar.commands")}
          active={activeSurface === "commands"}
          detail={t("bar.commandsDetail")}
          onClick={() => toggleSurface("commands")}
        />
        <CommandButton
          icon={Layers3}
          label={t("panel.layers")}
          active={activeSurface === "layers"}
          onClick={() => toggleSurface("layers")}
        />
        <CommandButton icon={Send} label={t("bar.share")} onClick={onShare} />
      </div>
    </nav>
  );
}
