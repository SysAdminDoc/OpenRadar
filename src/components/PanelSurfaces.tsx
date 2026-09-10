import type { VwpColumn } from "../lib/vwp";
import type { Palette } from "../lib/palette";
import type { SpcHazard } from "../lib/overlays/registry";
import { lazy } from "react";
import { useT } from "../i18n";
import type { SurfaceId } from "./CommandBar";
import type { WorkspaceOverlayFile } from "../lib/workspaceOverlays";
import type { GeoPoint } from "../lib/geo";
import type { LogEntry } from "../lib/log";
import type { OverlayBounds, OverlayLegend } from "../lib/overlays";
import type { ProviderHealth } from "../lib/providers";
import type {
  AppSettings,
  LayerSettings,
  MapStyleId,
  ProjectionMode,
  RadarSettings,
} from "../lib/settings";
import type { Storm } from "../lib/hurdat";
import type { CommandAction } from "../lib/commands";
import type { PlaceResult } from "../lib/weather";
import type { OverlayStates } from "../hooks/useOverlays";
import type { ExportState } from "../hooks/useExport";
import type { SingleSiteState } from "../hooks/useSingleSiteRadar";
import type { UpdateState } from "../lib/updates";
import { CommandPalette } from "./CommandPalette";
import { LazyPanel } from "./LazyPanel";
import type { WatchHealth } from "../lib/watch";
import type { NotifyPermission } from "../lib/notify";
import type { UndoableRemoval } from "./ToastHost";
import { CrossSectionPanel } from "../panels/CrossSectionPanel";
/**
 * The sounding is its own chunk.
 *
 * A Skew-T carries a chart, a hodograph and the thermodynamics behind both,
 * which is twenty kilobytes nobody who never opens it should download. Every
 * other panel here is opened by most readers at some point; this one is for
 * the ones who came looking for it.
 */
const VwpPanel = lazy(async () => {
  const module = await import("../panels/VwpPanel");
  return { default: module.VwpPanel };
});

const SoundingPanel = lazy(async () => {
  const module = await import("../panels/SoundingPanel");
  return { default: module.SoundingPanel };
});

/**
 * The map's own options, on their own, for the same reason.
 *
 * Settings is the largest panel by a distance: the watch, the layers' own options,
 * the themes, the record with its figures, the year card, the sounds, the
 * curiosities and the incident packs are all in it. A reader opening Alerts
 * should not fetch any of that, and the panel chunk was over its budget
 * carrying it.
 *
 * All three of that module's panels are asked for this way rather than one,
 * because a module that is also imported normally cannot be split out: the
 * dynamic import is quietly ignored and everything stays where it was.
 */
const SettingsPanel = lazy(async () => {
  const module = await import("../panels/SettingsPanel");
  return { default: module.SettingsPanel };
});

const LayersPanel = lazy(async () => {
  const module = await import("../panels/LayersPanel");
  return { default: module.LayersPanel };
});

/**
 * Five more that most readers never open, for the same reason.
 *
 * The panels chunk sat on both its budgets with nothing left, so every change
 * to any panel had to find its own bytes back somewhere else before it could
 * land. That is a budget doing its job right up until it starts failing the
 * next honest change, and the answer to it is a smaller chunk rather than a
 * larger number.
 *
 * These five are the ones a reader either wants or never thinks about: the
 * forecast models, the storm archive, the tides, the hurricane season and a
 * route along a drive. None of them is on the way to anything else, and each
 * brings its own reading of a service with it.
 */
const GuidancePanel = lazy(async () => {
  const module = await import("../panels/GuidancePanel");
  return { default: module.GuidancePanel };
});

const HistoryPanel = lazy(async () => {
  const module = await import("../panels/HistoryPanel");
  return { default: module.HistoryPanel };
});

const TidesPanel = lazy(async () => {
  const module = await import("../panels/TidesPanel");
  return { default: module.TidesPanel };
});

const TropicalPanel = lazy(async () => {
  const module = await import("../panels/TropicalPanel");
  return { default: module.TropicalPanel };
});

const RoutePanel = lazy(async () => {
  const module = await import("../panels/RoutePanel");
  return { default: module.RoutePanel };
});

const MapTypePanel = lazy(async () => {
  const module = await import("../panels/MapTypePanel");
  return { default: module.MapTypePanel };
});
import { AlertsPanel } from "../panels/AlertsPanel";
import { ExportPanel, type DataExportOffer } from "../panels/ExportPanel";
import { ForecastPanel } from "../panels/ForecastPanel";
import { RadarProductPanel } from "../panels/RadarProductPanel";
import type { SiteStatus } from "../lib/radarStatus";
import type { GaugeQpePeriod } from "../lib/gaugeQpe";
import type {
  IsothermLevel,
  LightningForecast,
  LightningJump,
  LightningWindow,
} from "../lib/lightningGrids";
import type { AzShearLevel, RotationPeriod } from "../lib/rotationTrack";
import type { CappiField, CubeLevel } from "../lib/cappi";
import type { PlaceLightning } from "../lib/lightningWatch";
import { SearchPanel } from "../panels/SearchPanel";
import { NearbyPanel, type NearbyPlaceOption } from "../panels/NearbyPanel";
import { MorePanel, UploadPanel } from "../panels/UtilityPanels";
import type { SurgeCategory } from "../lib/surge";
import type { SnowfallWindow } from "../lib/snowfall";
import {
  spacecraftFor,
  type SatelliteBandId,
} from "../lib/providers/satellite";
import type { StormCellState } from "../hooks/useStormCells";
import type { CellJump } from "../lib/lightningJump";
import type { MeltingLayer, NoLayer } from "../lib/melting";
import type { NearbyCell, NearbyWarning } from "../lib/nearby";
import type { Approach } from "../lib/approach";
import { cellsAvailable } from "../lib/cells";
import type { AlertType } from "../lib/alertTypes";

/** A stamp the tracker gave us, or nothing when it gave us something else. */
function observedAt(iso: string | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

import type { AmbientState } from "../hooks/useAmbient";

interface PanelSurfacesProps {
  activeSurface: SurfaceId;
  /** Whether the layers panel was opened by the palette's find command. */
  layersToFind?: boolean;
  productOpen: boolean;
  settings: AppSettings;
  overlays: OverlayStates;
  /** The keys for the banded layers on screen, which the export can carry. */
  overlayKeys: OverlayLegend[];
  viewport: OverlayBounds | null;
  centerPoint: GeoPoint;
  frameCount: number;
  sourceLabel: string | null;
  mapReady: boolean;
  health: ProviderHealth[];
  log: LogEntry[];
  exportState: ExportState;
  /** The readings behind the picture, one entry per dataset drawn. */
  dataExports: DataExportOffer[];
  singleSite: SingleSiteState | null;
  /** What the office says about every radar, for the site picker. */
  siteStatus: readonly SiteStatus[];
  /**
   * What a switched-on layer has to say for itself when it is not drawing.
   *
   * It belongs beside the switch rather than in a toast: somebody who turns a
   * layer on and sees nothing is looking at the switch, and a layer that fails
   * in silence looks like a quiet afternoon.
   */
  layerNotes: Partial<Record<keyof LayerSettings, string | null>>;
  clock: number;
  update: UpdateState;
  onUpdate: (() => void) | null;
  historyStormId: string | null;
  replayId: string | null;
  /** The line the cross-section tool put down, or null before both ends are. */
  sectionLine: { from: GeoPoint; to: GeoPoint } | null;
  /** Which convective outlook the reader has chosen, and its hazard. */
  spcDay: number;
  spcHazard: SpcHazard;
  onSpcDay: (day: number) => void;
  onSpcHazard: (hazard: SpcHazard) => void;
  /** The volume times the held site is looping, oldest first. */
  vwpTimes: string[];
  /** Asks the native side for a wind profile, or null in a browser preview. */
  readVwp: ((station: string, times: string[]) => Promise<VwpColumn[]>) | null;
  onClose: () => void;
  onCloseProduct: () => void;
  onLayers: (layers: LayerSettings) => void;
  onEnableLayer: (layer: keyof LayerSettings) => void;
  onSettings: (next: AppSettings | ((now: AppSettings) => AppSettings)) => void;
  onMapStyle: (style: MapStyleId) => void;
  onProjection: (projection: ProjectionMode) => void;
  onRadar: (radar: RadarSettings) => void;
  onPlace: (place: PlaceResult) => void;
  /** A storm chosen by name in the search, handed to Storm history. */
  onSearchStorm: (id: string) => void;
  onAlertSelect: (bounds: OverlayBounds) => void;
  onFollowStorm: (point: GeoPoint, name: string) => void;
  onCommand: (action: CommandAction) => void;
  onAssignPalette: (unit: string, name: string | null) => void;
  onRemovePalette: (name: string) => void;
  onExportPalette: (palette: Palette) => void;
  onAlertTypes: (types: Partial<Record<AlertType, boolean>>) => void;
  onOverlayOpacity: (opacity: Record<string, number>) => void;
  onOverlayOrder: (order: string[]) => void;
  onOrderSaid: (said: string) => void;
  overlayFiles: WorkspaceOverlayFile[];
  onOverlayFiles: (files: WorkspaceOverlayFile[]) => void;
  /** What the radar's tracking algorithm is following, for the radar panel. */
  stormCells: StormCellState;
  cellJumps: Map<string, CellJump>;
  melting: MeltingLayer | NoLayer | null;
  /** The map in words, computed once so the panel and the live region agree. */
  nearby: {
    warnings: NearbyWarning[];
    cells: NearbyCell[];
    /** What the reader calls each of them, by the algorithm's identifier. */
    cellNames: ReadonlyMap<string, string>;
    onNameCell: (id: string, name: string) => void;
    summary: string;
  };
  /** True while archived radar from another day is on the map. */
  replaying: boolean;
  nearbyPlaces: NearbyPlaceOption[];
  nearbyPlaceId: string;
  onNearbyPlace: (id: string) => void;
  /** The soonest storm heading for each watched place, soonest first. */
  approaching: Approach[];
  /** What the lightning watch counted for each watched place. */
  placeLightning: PlaceLightning[];
  onSurgeCategory: (category: SurgeCategory) => void;
  onSnowfallWindow: (window: SnowfallWindow) => void;
  /** The moment a sounding is asked for, which is the timeline's own. */
  soundingAt: number;
  onSatelliteBand: (band: SatelliteBandId) => void;
  onGaugeQpePeriod: (period: GaugeQpePeriod) => void;
  onRotationPeriod: (period: RotationPeriod) => void;
  onLightningWindow: (window: LightningWindow) => void;
  onLightningForecastWindow: (window: LightningForecast) => void;
  onLightningJumpWindow: (window: LightningJump) => void;
  onIsothermLevel: (level: IsothermLevel) => void;
  onAzShearLevel: (level: AzShearLevel) => void;
  onCappiField: (field: CappiField) => void;
  onCappiLevel: (level: CubeLevel) => void;
  onWpcDay: (day: number) => void;
  onWssiDay: (day: number) => void;
  onHistoryStorm: (storm: Storm | null) => void;
  onReplayStorm: (storm: Storm) => void;
  onStopReplay: () => void;
  /** Keeps the replay on screen as one file, with or without the workspace. */
  onSaveReplayBundle: (includeWorkspace: boolean) => void;
  onOpenReplayBundle: () => void;
  /** False in a browser preview, where nothing can write or read a file. */
  bundlesAvailable: boolean;
  onRoute: (route: Record<string, unknown> | null) => void;
  onUpload: (file: File) => void;
  onWatchHere: () => void;
  onAddWatchPlace: () => void;
  onSendWatchTest: () => void;
  watchHealth: WatchHealth;
  notifications: NotifyPermission;
  /** What the chrome is drawing, so the switch can name its source. */
  ambient: AmbientState;
  onJournalSaved: (path: string | null) => void;
  onJournalCleared: (undo: () => void) => void;
  onJournalRemoved: (undo: () => void) => void;
  /** Something removed in a panel, offered back as a held toast. */
  onRemoved: (removal: UndoableRemoval) => void;
  /** Whether the app starts with the machine, as the machine reports it. */
  autostart: boolean | null;
  onAutostart: (on: boolean) => void;
  /** Whether the almanac card is drawn: off by choice, or quiet during danger. */
  almanac: boolean;
  onFlyTo: (point: { lon: number; lat: number }) => void;
  onJournalFailed: (why: string) => void;
  onImportSettings: (file: File) => void;
  onStorageCleared: (freed: string) => void;
  onStorageFailed: (why: string) => void;
  onOpenLogFolder: () => void;
  onCopyDiagnostics: (withPlace: boolean) => void;
  onReportIssue: (withPlace: boolean) => void;
  hasWatchedPlace: boolean;
  onReset: () => void;
  onExportSettings: () => Promise<void>;
  onChooseSound: () => Promise<void>;
}

/** Every surface the command bar opens, and the radar product sheet. */
export function PanelSurfaces(props: PanelSurfacesProps) {
  const { activeSurface, settings, overlays, onClose } = props;
  // Only for the frames the lazy panels are drawn in before they arrive. Each
  // panel still names itself once it is here.
  const t = useT();

  return (
    <>
      {activeSurface === "commands" ? (
        <CommandPalette
          settings={settings}
          onRun={props.onCommand}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "search" ? (
        <SearchPanel
          onClose={onClose}
          onSelect={props.onPlace}
          onSelectStorm={props.onSearchStorm}
        />
      ) : null}

      {activeSurface === "map-type" ? (
        <LazyPanel
          title={t("mapType.title")}
          className="surface-panel--left surface-panel--wide"
          onClose={onClose}
        >
          <MapTypePanel
            mapStyle={settings.mapStyle}
            projection={settings.projection}
            onMapStyle={props.onMapStyle}
            onProjection={props.onProjection}
            onClose={onClose}
          />
        </LazyPanel>
      ) : null}

      {activeSurface === "layers" ? (
        <LazyPanel
          title={t("layers.title")}
          className="surface-panel--left"
          onClose={onClose}
        >
          <LayersPanel
            layers={settings.layers}
            layerNotes={props.layerNotes}
            overlayStates={overlays}
            now={props.clock}
            overlayOpacity={settings.overlayOpacity}
            onOverlayOpacity={props.onOverlayOpacity}
            overlayOrder={settings.overlayOrder}
            onOverlayOrder={props.onOverlayOrder}
            onOrderSaid={props.onOrderSaid}
            overlayFiles={props.overlayFiles}
            onOverlayFiles={props.onOverlayFiles}
            onRemoved={props.onRemoved}
            alertTypes={settings.alertTypes}
            surgeCategory={settings.surgeCategory}
            snowfallWindow={settings.snowfallWindow}
            onLayers={props.onLayers}
            onAlertTypes={props.onAlertTypes}
            onSurgeCategory={props.onSurgeCategory}
            onSnowfallWindow={props.onSnowfallWindow}
            satelliteBand={settings.satelliteBand}
            spacecraft={spacecraftFor(settings.camera.center[0])}
            gaugeQpePeriod={settings.gaugeQpePeriod}
            onGaugeQpePeriod={props.onGaugeQpePeriod}
            smoothGrids={settings.radar.smoothGrids}
            onSmoothGrids={(smoothGrids) =>
              props.onSettings((now) => ({
                ...now,
                radar: { ...now.radar, smoothGrids },
              }))
            }
            rotationPeriod={settings.rotationPeriod}
            onRotationPeriod={props.onRotationPeriod}
            lightningWindow={settings.lightningWindow}
            onLightningWindow={props.onLightningWindow}
            lightningForecastWindow={settings.lightningForecastWindow}
            onLightningForecastWindow={props.onLightningForecastWindow}
            lightningJumpWindow={settings.lightningJumpWindow}
            onLightningJumpWindow={props.onLightningJumpWindow}
            isothermLevel={settings.isothermLevel}
            onIsothermLevel={props.onIsothermLevel}
            azShearLevel={settings.azShearLevel}
            onAzShearLevel={props.onAzShearLevel}
            cappiField={settings.cappiField}
            onCappiField={props.onCappiField}
            cappiLevel={settings.cappiLevel}
            onCappiLevel={props.onCappiLevel}
            spcDay={props.spcDay}
            spcHazard={props.spcHazard}
            onSpcDay={props.onSpcDay}
            onSpcHazard={props.onSpcHazard}
            wpcDay={settings.wpcDay}
            onWpcDay={props.onWpcDay}
            wssiDay={settings.wssiDay}
            onWssiDay={props.onWssiDay}
            onSatelliteBand={props.onSatelliteBand}
            openedToFind={props.layersToFind}
            onClose={onClose}
          />
        </LazyPanel>
      ) : null}

      {activeSurface === "alerts" ? (
        <AlertsPanel
          calm={settings.calm}
          alerts={overlays.alerts.data}
          viewport={props.viewport}
          fetchedAt={overlays.alerts.fetchedAt}
          error={overlays.alerts.error}
          layerOn={settings.layers.weatherAlerts}
          replaying={props.replaying}
          onEnableLayer={() => props.onEnableLayer("weatherAlerts")}
          onSelect={props.onAlertSelect}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "nearby" ? (
        <NearbyPanel
          approaching={props.approaching}
          placeLightning={props.placeLightning}
          clock={props.clock}
          places={props.nearbyPlaces}
          placeId={props.nearbyPlaceId}
          onPlace={props.onNearbyPlace}
          warnings={props.nearby.warnings}
          cells={props.nearby.cells}
          cellNames={props.nearby.cellNames}
          onNameCell={props.nearby.onNameCell}
          cellsNote={
            !cellsAvailable()
              ? "unavailable"
              : !settings.layers.stormCells
                ? "off"
                : props.stormCells.error
                  ? "failed"
                  : props.stormCells.loading && !props.stormCells.report
                    ? "loading"
                    : null
          }
          alertsNote={
            !settings.layers.weatherAlerts
              ? "off"
              : overlays.alerts.error
                ? "failed"
                : overlays.alerts.fetchedAt === null
                  ? "loading"
                  : null
          }
          alertsError={overlays.alerts.error ?? null}
          station={props.stormCells.report?.station ?? null}
          observed={observedAt(props.stormCells.report?.observed)}
          alertsFetchedAt={overlays.alerts.fetchedAt}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "tropical" ? (
        <LazyPanel
          title={t("tropical.title")}
          className="surface-panel--right"
          onClose={onClose}
        >
          <TropicalPanel
            products={overlays.tropical.data}
            fetchedAt={overlays.tropical.fetchedAt}
            error={overlays.tropical.error}
            layerOn={settings.layers.tropical}
            onEnableLayer={() => props.onEnableLayer("tropical")}
            onFollow={props.onFollowStorm}
            onClose={onClose}
          />
        </LazyPanel>
      ) : null}

      {activeSurface === "route" ? (
        <LazyPanel
          title={t("route.title")}
          className="surface-panel--right surface-panel--settings"
          onClose={onClose}
        >
          <RoutePanel onRoute={props.onRoute} onClose={onClose} />
        </LazyPanel>
      ) : null}

      {activeSurface === "forecast" ? (
        <ForecastPanel point={props.centerPoint} onClose={onClose} />
      ) : null}

      {activeSurface === "guidance" ? (
        <LazyPanel
          title={t("guidance.title")}
          className="surface-panel--right surface-panel--settings"
          onClose={onClose}
        >
          <GuidancePanel point={props.centerPoint} onClose={onClose} />
        </LazyPanel>
      ) : null}

      {activeSurface === "tides" ? (
        <LazyPanel
          title={t("tides.title")}
          className="surface-panel--right"
          onClose={onClose}
        >
          <TidesPanel
            point={props.centerPoint}
            clock={props.clock}
            onClose={onClose}
          />
        </LazyPanel>
      ) : null}

      {activeSurface === "settings" ? (
        <LazyPanel
          title={t("settings.title")}
          className="surface-panel--right surface-panel--settings"
          onClose={onClose}
        >
          <SettingsPanel
            settings={settings}
            bounds={props.viewport}
            onSettings={props.onSettings}
            onWatchHere={props.onWatchHere}
            onAddWatchPlace={props.onAddWatchPlace}
            onSendWatchTest={props.onSendWatchTest}
            watchHealth={props.watchHealth}
            notifications={props.notifications}
            ambient={props.ambient}
            onJournalSaved={props.onJournalSaved}
            onJournalFailed={props.onJournalFailed}
            onImportSettings={props.onImportSettings}
            onStorageCleared={props.onStorageCleared}
            onStorageFailed={props.onStorageFailed}
            onJournalCleared={props.onJournalCleared}
            onJournalRemoved={props.onJournalRemoved}
            onRemoved={props.onRemoved}
            autostart={props.autostart}
            onAutostart={props.onAutostart}
            clock={props.clock}
            onReset={props.onReset}
            onExportSettings={props.onExportSettings}
            onChooseSound={props.onChooseSound}
            placeLightning={props.placeLightning}
            onClose={onClose}
          />
        </LazyPanel>
      ) : null}

      {activeSurface === "history" ? (
        <LazyPanel
          title={t("history.title")}
          className="surface-panel--right"
          onClose={onClose}
        >
          <HistoryPanel
            selectedId={props.historyStormId}
            replayId={props.replayId}
            onSelect={props.onHistoryStorm}
            onReplay={props.onReplayStorm}
            onStopReplay={props.onStopReplay}
            onSaveBundle={props.onSaveReplayBundle}
            onOpenBundle={props.onOpenReplayBundle}
            bundlesAvailable={props.bundlesAvailable}
            almanac={props.almanac}
            onFlyTo={props.onFlyTo}
            onClose={onClose}
          />
        </LazyPanel>
      ) : null}

      {activeSurface === "export" ? (
        <ExportPanel
          frameCount={props.frameCount}
          busy={props.exportState.busy}
          progress={props.exportState.progress}
          dataExports={props.dataExports}
          keyCount={props.overlayKeys.length}
          keysInExport={settings.exportKeys}
          onKeysInExport={(exportKeys) =>
            props.onSettings((now) => ({ ...now, exportKeys }))
          }
          onExportImage={props.exportState.exportImage}
          onExportPostcard={props.exportState.exportPostcard}
          placeName={settings.watch.name?.trim() ?? ""}
          onExportLoop={props.exportState.exportLoopVideo}
          onExportMp4={props.exportState.exportLoopMp4File}
          mp4Ready={props.exportState.mp4Ready}
          onExportGif={props.exportState.exportLoopGifFile}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "upload" ? (
        <UploadPanel
          onClose={onClose}
          onFile={props.onUpload}
          palettes={settings.palettes}
          paletteAssignments={settings.paletteAssignments}
          onAssignPalette={props.onAssignPalette}
          onRemovePalette={props.onRemovePalette}
          onExportPalette={props.onExportPalette}
        />
      ) : null}

      {activeSurface === "more" ? (
        <MorePanel
          update={props.update}
          onUpdate={props.onUpdate}
          mapReady={props.mapReady}
          radarReady={props.frameCount > 0}
          activeSource={props.sourceLabel}
          health={props.health}
          log={props.log}
          onOpenLogFolder={props.onOpenLogFolder}
          onRemoved={props.onRemoved}
          onCopyDiagnostics={props.onCopyDiagnostics}
          onReportIssue={props.onReportIssue}
          hasWatchedPlace={props.hasWatchedPlace}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "sounding" ? (
        <LazyPanel
          title={t("sounding.title")}
          className="surface-panel--right surface-panel--wide"
          onClose={onClose}
        >
          <SoundingPanel
            center={settings.camera.center}
            at={props.soundingAt}
            onClose={onClose}
          />
        </LazyPanel>
      ) : null}

      {activeSurface === "vwp" ? (
        <LazyPanel
          title={t("vwp.title")}
          className="surface-panel--right"
          onClose={onClose}
        >
          <VwpPanel
            // A different site is a different question, and mounting fresh
            // for it is what lets "no answer yet" be where the panel starts.
            // The volume list is deliberately not in the key: it grows a new
            // entry every few minutes, and remounting on that swapped the
            // chart for a spinner while three volumes were read again. The
            // panel's own effect already re-asks when the list changes.
            key={props.singleSite?.station ?? ""}
            // No station while the site is held on a volume from another day.
            // A historical hold publishes no volume list, and an empty list
            // means "whatever the radar put out last", so the panel drew this
            // afternoon's wind under a map showing 2011 and labelled the
            // column with a clock time from today.
            station={
              props.singleSite?.historical
                ? null
                : (props.singleSite?.station ?? null)
            }
            // Which of the two silences it is. "Hold a site" is wrong advice
            // under a map that plainly has one held.
            quiet={
              props.singleSite?.historical ? "historical" : ("noSite" as const)
            }
            times={props.vwpTimes}
            read={props.readVwp}
            // Turns single site on and keeps the product the reader is
            // already looking at, which is the same action the palette runs
            // and the same one the product panel's own switch does.
            onHoldSite={() =>
              props.onCommand({
                kind: "product",
                product: settings.radar.product,
              })
            }
            onClose={onClose}
          />
        </LazyPanel>
      ) : null}

      {activeSurface === "section" && props.sectionLine ? (
        <CrossSectionPanel
          // A new line is a new question, and mounting fresh for it is what
          // lets "no answer yet" be where the panel starts.
          key={`${props.sectionLine.from.lon},${props.sectionLine.from.lat},${props.sectionLine.to.lon},${props.sectionLine.to.lat}`}
          line={props.sectionLine}
          take={props.singleSite?.crossSection ?? null}
          onHoldSite={() =>
            props.onCommand({
              kind: "product",
              product: settings.radar.product,
            })
          }
          onClose={onClose}
        />
      ) : null}

      {props.productOpen ? (
        <RadarProductPanel
          radar={settings.radar}
          singleSite={props.singleSite}
          stormCells={props.stormCells}
          cellJumps={props.cellJumps}
          melting={props.melting}
          watch={settings.watch}
          siteStatus={props.siteStatus}
          clock={props.clock}
          onRadar={props.onRadar}
          onClose={props.onCloseProduct}
        />
      ) : null}
    </>
  );
}
