import { useCallback, useMemo, useState, type RefObject } from "react";
import { MapViewport, type MapViewportHandle } from "./MapViewport";
import type { ToolMode } from "./CommandBar";
import type { GeoPoint } from "../lib/geo";
import type { MrmsLayer } from "../hooks/useMrmsOverlays";
import type { SweepImage } from "../lib/level2";
import type { ClassStyle } from "../lib/classification";
import type { PinnedImage } from "../lib/mapLayers/image";
import {
  SATELLITE_STEP_SECONDS,
  satelliteBand,
  satelliteProduct,
  satelliteProductId,
  spacecraftFor,
  type Spacecraft,
} from "../lib/providers/satellite";
import type { WindField } from "../lib/wind";
import type { OverlayData, OverlayId } from "../lib/overlays";
import { formatFrameTime, type RadarFrame } from "../lib/radar";
import type { AppSettings, CameraState } from "../lib/settings";
import { useT, type StringKey } from "../i18n";
import { resolvedMapStyle } from "../lib/mapStyles";
import { nightMoment } from "../lib/terminator";
import { formatRadarTime } from "../lib/radar";
import { formatAge, formatClock, useMeasurements } from "../lib/units";

/** How many frames back the compare pane can be held. */
const COMPARE_OFFSETS = [0, 3, 6, 12];

interface MapStageProps {
  settings: AppSettings;
  /**
   * The minute on the workspace clock.
   *
   * What the day and night wash falls back to, for a workspace with no frames
   * yet. Where there is a frame the wash follows that instead, through
   * `nightMoment`: each pane draws the sun where it stood at the moment that
   * pane is showing, which is not the same moment in the two of them and is
   * not now during a replay.
   */
  clock: number;
  mapRef: RefObject<MapViewportHandle | null>;
  secondMapRef: RefObject<MapViewportHandle | null>;
  activeFrame: RadarFrame | undefined;
  compareFrame: RadarFrame | undefined;
  /**
   * The held site's volume for the compare moment, when there is one.
   *
   * The second pane used to be handed the first pane's sweep along with
   * everything else in `shared`, so with a site held the two panes drew one
   * volume between them and the offset meant nothing.
   */
  compareSweep: SweepImage | null;
  satelliteTime: number | null;
  compareSatelliteTime: number | null;
  /** Minutes between the satellite image and now, for its readout. */
  satelliteAgeMinutes: number | null;
  overlays: Partial<Record<OverlayId, OverlayData | null>>;
  route: Record<string, unknown> | null;
  customOverlay: Record<string, unknown> | null;
  stormTrack: Record<string, unknown> | null;
  /** One site's own sweep, drawn in place of the mosaic when it is set. */
  sweep: SweepImage | null;
  mrmsLayers: MrmsLayer[];
  flashes: Record<string, unknown> | null;
  /** Storm cells with their tracks, from the radar's own algorithm. */
  cells: Record<string, unknown> | null;
  /** What the same algorithm says is falling, with its own legend. */
  classification: {
    features: Record<string, unknown>;
    legend: ClassStyle[];
  } | null;
  /** The model's smoke for the primary pane's frame, or null off the tail. */
  forecastSmoke: PinnedImage | null;
  /** What the severe-probability model expects of each storm. */
  probSevere: Record<string, unknown> | null;
  /** How solid each overlay is drawn, as a fraction of its own design. */
  overlayOpacity: Record<string, number>;
  /** The order the overlays are drawn in, bottom first. */
  overlayOrder: string[];
  /** The flash window and the moment the fade is measured against. */
  flashWindowMinutes: number;
  flashClock: number;
  wind: WindField | null;
  activeTool: ToolMode;
  dualPane: boolean;
  compareOffset: number;
  onCompareOffset: (offset: number) => void;
  onCameraChange: (camera: CameraState) => void;
  onPrimaryMove: (camera: CameraState) => void;
  onSecondaryMove: (camera: CameraState) => void;
  onCursorChange: (point: GeoPoint | null) => void;
  onToolResult: (render: (() => string) | null) => void;
  /** The two ends of a cross-section, once the tool has both. */
  onSection: (from: GeoPoint, to: GeoPoint) => void;
  /** The one action a popup offered about what it describes. */
  onOverlayAction: (id: string) => void;
  onMapStatus: (status: "loading" | "ready" | "error" | "nogpu") => void;
}

/** How far back a missing slot may walk the lane: one hour. */
const MAX_MISSED_SLOTS = 6;

const SATELLITE_NAME: Record<Spacecraft, StringKey> = {
  east: "satellite.east",
  west: "satellite.west",
  himawari: "satellite.himawari",
};

export function MapStage({
  settings,
  mapRef,
  secondMapRef,
  activeFrame,
  compareFrame,
  compareSweep,
  satelliteTime,
  compareSatelliteTime,
  satelliteAgeMinutes,
  overlays,
  route,
  customOverlay,
  stormTrack,
  sweep,
  mrmsLayers,
  flashes,
  cells,
  classification,
  forecastSmoke,
  probSevere,
  overlayOpacity,
  overlayOrder,
  flashWindowMinutes,
  flashClock,
  wind,
  activeTool,
  dualPane,
  compareOffset,
  onCompareOffset,
  onCameraChange,
  onPrimaryMove,
  onSecondaryMove,
  onCursorChange,
  onToolResult,
  onSection,
  onOverlayAction,
  onMapStatus,
  clock,
}: MapStageProps) {
  const t = useT();
  // Redraws when the units or the clock change, since this is on screen the
  // whole time and would otherwise keep showing the old ones.
  useMeasurements();
  const incidentPack =
    settings.incidentPacks.references.find(
      (pack) => pack.id === settings.incidentPacks.selectedId,
    ) ?? null;
  // While the model's smoke has the primary pane, the analysis comes off
  // it: not faded, off. A faded layer still answers clicks and still counts
  // as drawn, and a plume must be one kind of statement at a time. The
  // compare pane follows its own frame and keeps whatever it has.
  const primaryOverlays = useMemo(
    () => (forecastSmoke ? { ...overlays, smoke: null } : overlays),
    [forecastSmoke, overlays],
  );
  // Which satellite is looking down at the middle of the view, and which of
  // its bands the reader asked for. The satellite is not a setting: it comes
  // from where the map is pointed, because a picture of the Pacific taken
  // from over Brazil is a picture of the edge of a disk.
  const satelliteId = satelliteProductId(
    spacecraftFor(settings.camera.center[0]),
    settings.satelliteBand,
  );
  const chosenSatellite = satelliteProduct(satelliteId);

  // GIBS leaves gaps in these series, and not the same gaps in each band: on
  // 2026-09-03 GOES-West air mass had no 17:30 slot while every other band
  // did. A slot that is not there answers 404 for every tile, which paints
  // nothing and leaves the clock claiming a picture four minutes old. So the
  // lane steps back a slot at a time until one answers, and the chip’s own
  // age line says how far back that is.
  // Counted against the picture it belongs to, so a change of band or of
  // slot starts again at the newest one rather than staying an hour behind
  // for ever. Held as one value rather than reset from an effect, which is a
  // second render for something the first one already knows.
  const satelliteSlot = `${satelliteId}@${satelliteTime ?? 0}`;
  const [missed, setMissed] = useState({ slot: satelliteSlot, steps: 0 });
  const missedSlots = missed.slot === satelliteSlot ? missed.steps : 0;
  const shownSatelliteTime =
    satelliteTime === null
      ? null
      : satelliteTime - missedSlots * SATELLITE_STEP_SECONDS;
  const noteMissingSatellite = useCallback(() => {
    setMissed((held) => {
      const steps = held.slot === satelliteSlot ? held.steps : 0;
      // Bounded: an hour back is well past any gap GIBS has published, and
      // without a bound a layer that is down entirely would walk the lane
      // into last week one 404 at a time.
      return {
        slot: satelliteSlot,
        steps: Math.min(MAX_MISSED_SLOTS, steps + 1),
      };
    });
  }, [satelliteSlot]);
  const chosenBand = satelliteBand(chosenSatellite.band);
  const shared = {
    projection: settings.projection,
    satelliteProductId: satelliteId,
    // Auto is resolved here rather than in the viewport, so everything that
    // reads the drawn style, the compare pane included, agrees on one answer.
    mapStyle: resolvedMapStyle(settings.mapStyle, settings.theme),
    incidentPack,
    radarVisible: settings.radar.enabled,
    radarOpacity: settings.radar.opacity,
    overlays,
    route,
    counties: settings.layers.counties,
    night: settings.layers.night,
    customOverlay: settings.layers.customOverlay ? customOverlay : null,
    stormTrack,
    sweep,
    mrmsLayers,
    flashes,
    cells,
    classification,
    probSevere,
    overlayOpacity,
    overlayOrder,
    flashWindowMinutes,
    flashClock,
    wind,
    surgeCategory: settings.layers.surge ? settings.surgeCategory : null,
    toolMode: activeTool,
  };

  return (
    <div className="map-stage">
      <MapViewport
        ref={mapRef}
        camera={settings.camera}
        radarFrame={activeFrame}
        satelliteTime={shownSatelliteTime}
        onSatelliteMissing={noteMissingSatellite}
        forecastSmoke={forecastSmoke}
        onCameraChange={onCameraChange}
        onCameraMove={onPrimaryMove}
        onCursorChange={onCursorChange}
        onToolResult={onToolResult}
        onSection={onSection}
        onOverlayAction={onOverlayAction}
        onMapStatus={onMapStatus}
        {...shared}
        overlays={primaryOverlays}
        // Stated per pane rather than shared, because the two panes are
        // showing two moments and the sun was not in the same place at both.
        nightAt={nightMoment(activeFrame?.time, clock)}
      />
      {dualPane ? (
        <MapViewport
          ref={secondMapRef}
          label={t("stage.secondary")}
          camera={settings.camera}
          radarFrame={compareFrame}
          satelliteTime={compareSatelliteTime}
          onCameraChange={onCameraChange}
          onCameraMove={onSecondaryMove}
          onToolResult={onToolResult}
          onSection={onSection}
          onOverlayAction={onOverlayAction}
          {...shared}
          // Never the first pane's. Falling back to it drew that pane's
          // volume under this pane's timestamp, which is the whole defect
          // this compare path was built to fix, and it happened on every
          // change of offset while the volume was being fetched and for good
          // whenever the fetch failed. The mosaic underneath is the honest
          // answer while there is no volume to draw.
          sweep={compareSweep}
          nightAt={nightMoment(compareFrame?.time, clock)}
        />
      ) : null}

      {shownSatelliteTime !== null ? (
        <div className="satellite-chip" data-satellite={satelliteId}>
          <strong>
            {t("stage.satellite", {
              product: t(chosenBand.key),
              satellite: t(SATELLITE_NAME[chosenSatellite.spacecraft]),
            })}
          </strong>
          <small>
            {formatClock(new Date(shownSatelliteTime * 1000))}
            {satelliteAgeMinutes === null
              ? ""
              : t("stage.satelliteAge", {
                  // The clock and the age are the slot on screen, not the one
                  // that was asked for: a gap in the series steps the lane
                  // back, and saying otherwise would put a five-minute label
                  // on an hour-old picture.
                  age: formatAge(
                    satelliteAgeMinutes +
                      (missedSlots * SATELLITE_STEP_SECONDS) / 60,
                  ),
                })}
          </small>
          {/* GeoColor is a rendering and the infrared band is a measurement
              with a scale. A picture of cloud tops that does not say which it
              is invites somebody to read a temperature off a colour that has
              none. */}
          {/* Said when it is true and not otherwise: a reader looking at an
              hour-old picture because the service skipped four slots cannot
              tell that from a service that is simply behind. */}
          {missedSlots > 0 ? (
            <small className="satellite-chip__legend" data-satellite-stepped>
              {t("satellite.stepped")}
            </small>
          ) : null}
          <small className="satellite-chip__legend">
            {t(chosenBand.legendKey)}
          </small>
        </div>
      ) : null}

      {dualPane ? (
        <div className="pane-compare">
          <strong>{t("stage.compare")}</strong>
          <div
            className="segmented-control"
            role="group"
            aria-label={t("stage.compareOffset")}
          >
            {COMPARE_OFFSETS.map((offset) => (
              <button
                type="button"
                key={offset}
                className={compareOffset === offset ? "is-active" : ""}
                aria-pressed={compareOffset === offset}
                onClick={() => onCompareOffset(offset)}
              >
                {offset === 0
                  ? t("stage.live")
                  : t("stage.back", { count: offset })}
              </button>
            ))}
          </div>
          <small>
            {/* The volume on that pane when a site is held, and the mosaic's
                step otherwise. Naming the step while drawing a volume from
                four minutes either side of it is a precise label on a
                different moment, which is the mistake this chip already
                existed to avoid. */}
            {compareSweep && Number.isFinite(Date.parse(compareSweep.collected))
              ? formatRadarTime(Date.parse(compareSweep.collected) / 1000)
              : compareFrame
                ? formatFrameTime(compareFrame)
                : t("stage.compareUnavailable")}
          </small>
        </div>
      ) : null}
    </div>
  );
}
