import type { SurfaceId } from "./CommandBar";
import type { WorkspaceOverlayFile } from "../lib/workspaceOverlays";
import type { GeoPoint } from "../lib/geo";
import type { LogEntry } from "../lib/log";
import type { OverlayBounds } from "../lib/overlays";
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
import { CrossSectionPanel } from "../panels/CrossSectionPanel";
import { AlertsPanel } from "../panels/AlertsPanel";
import { ExportPanel } from "../panels/ExportPanel";
import { ForecastPanel } from "../panels/ForecastPanel";
import { GuidancePanel } from "../panels/GuidancePanel";
import { TidesPanel } from "../panels/TidesPanel";
import { HistoryPanel } from "../panels/HistoryPanel";
import {
  LayersPanel,
  MapTypePanel,
  SettingsPanel,
} from "../panels/MapOptionsPanels";
import { RadarProductPanel } from "../panels/RadarProductPanel";
import { RoutePanel } from "../panels/RoutePanel";
import { SearchPanel } from "../panels/SearchPanel";
import { TropicalPanel } from "../panels/TropicalPanel";
import { MorePanel, UploadPanel } from "../panels/UtilityPanels";
import type { SurgeCategory } from "../lib/surge";
import type { StormCellState } from "../hooks/useStormCells";
import type { AlertType } from "../lib/alertTypes";

interface PanelSurfacesProps {
  activeSurface: SurfaceId;
  productOpen: boolean;
  settings: AppSettings;
  overlays: OverlayStates;
  viewport: OverlayBounds | null;
  centerPoint: GeoPoint;
  frameCount: number;
  sourceLabel: string | null;
  mapReady: boolean;
  health: ProviderHealth[];
  log: LogEntry[];
  exportState: ExportState;
  singleSite: SingleSiteState | null;
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
  onClose: () => void;
  onCloseProduct: () => void;
  onLayers: (layers: LayerSettings) => void;
  onEnableLayer: (layer: keyof LayerSettings) => void;
  onSettings: (settings: AppSettings) => void;
  onMapStyle: (style: MapStyleId) => void;
  onProjection: (projection: ProjectionMode) => void;
  onRadar: (radar: RadarSettings) => void;
  onPlace: (place: PlaceResult) => void;
  onAlertSelect: (bounds: OverlayBounds) => void;
  onFollowStorm: (point: GeoPoint, name: string) => void;
  onCommand: (action: CommandAction) => void;
  onClearPalette: () => void;
  onAlertTypes: (types: Partial<Record<AlertType, boolean>>) => void;
  onOverlayOpacity: (opacity: Record<string, number>) => void;
  onOverlayOrder: (order: string[]) => void;
  overlayFiles: WorkspaceOverlayFile[];
  onOverlayFiles: (files: WorkspaceOverlayFile[]) => void;
  /** What the radar's tracking algorithm is following, for the radar panel. */
  stormCells: StormCellState;
  onSurgeCategory: (category: SurgeCategory) => void;
  onHistoryStorm: (storm: Storm | null) => void;
  onReplayStorm: (storm: Storm) => void;
  onStopReplay: () => void;
  onRoute: (route: Record<string, unknown> | null) => void;
  onUpload: (file: File) => void;
  onWatchHere: () => void;
  onAddWatchPlace: () => void;
  onSendWatchTest: () => void;
  onOpenLogFolder: () => void;
  onCopyDiagnostics: (withPlace: boolean) => void;
  hasWatchedPlace: boolean;
  onReset: () => void;
  onExportSettings: () => Promise<void>;
}

/** Every surface the command bar opens, and the radar product sheet. */
export function PanelSurfaces(props: PanelSurfacesProps) {
  const { activeSurface, settings, overlays, onClose } = props;

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
        <SearchPanel onClose={onClose} onSelect={props.onPlace} />
      ) : null}

      {activeSurface === "map-type" ? (
        <MapTypePanel
          mapStyle={settings.mapStyle}
          projection={settings.projection}
          onMapStyle={props.onMapStyle}
          onProjection={props.onProjection}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "layers" ? (
        <LayersPanel
          layers={settings.layers}
          layerNotes={props.layerNotes}
          overlayOpacity={settings.overlayOpacity}
          onOverlayOpacity={props.onOverlayOpacity}
          overlayOrder={settings.overlayOrder}
          onOverlayOrder={props.onOverlayOrder}
          overlayFiles={props.overlayFiles}
          onOverlayFiles={props.onOverlayFiles}
          alertTypes={settings.alertTypes}
          surgeCategory={settings.surgeCategory}
          onLayers={props.onLayers}
          onAlertTypes={props.onAlertTypes}
          onSurgeCategory={props.onSurgeCategory}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "alerts" ? (
        <AlertsPanel
          alerts={overlays.alerts.data}
          viewport={props.viewport}
          fetchedAt={overlays.alerts.fetchedAt}
          error={overlays.alerts.error}
          layerOn={settings.layers.weatherAlerts}
          onEnableLayer={() => props.onEnableLayer("weatherAlerts")}
          onSelect={props.onAlertSelect}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "tropical" ? (
        <TropicalPanel
          products={overlays.tropical.data}
          fetchedAt={overlays.tropical.fetchedAt}
          error={overlays.tropical.error}
          layerOn={settings.layers.tropical}
          onEnableLayer={() => props.onEnableLayer("tropical")}
          onFollow={props.onFollowStorm}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "route" ? (
        <RoutePanel onRoute={props.onRoute} onClose={onClose} />
      ) : null}

      {activeSurface === "forecast" ? (
        <ForecastPanel point={props.centerPoint} onClose={onClose} />
      ) : null}

      {activeSurface === "guidance" ? (
        <GuidancePanel point={props.centerPoint} onClose={onClose} />
      ) : null}

      {activeSurface === "tides" ? (
        <TidesPanel
          point={props.centerPoint}
          clock={props.clock}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "settings" ? (
        <SettingsPanel
          settings={settings}
          bounds={props.viewport}
          onSettings={props.onSettings}
          onWatchHere={props.onWatchHere}
          onAddWatchPlace={props.onAddWatchPlace}
          onSendWatchTest={props.onSendWatchTest}
          onReset={props.onReset}
          onExportSettings={props.onExportSettings}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "history" ? (
        <HistoryPanel
          selectedId={props.historyStormId}
          replayId={props.replayId}
          onSelect={props.onHistoryStorm}
          onReplay={props.onReplayStorm}
          onStopReplay={props.onStopReplay}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "export" ? (
        <ExportPanel
          frameCount={props.frameCount}
          busy={props.exportState.busy}
          progress={props.exportState.progress}
          onExportImage={props.exportState.exportImage}
          onExportLoop={props.exportState.exportLoopVideo}
          onExportGif={props.exportState.exportLoopGifFile}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "upload" ? (
        <UploadPanel
          onClose={onClose}
          onFile={props.onUpload}
          palette={settings.palette}
          onClearPalette={props.onClearPalette}
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
          onCopyDiagnostics={props.onCopyDiagnostics}
          hasWatchedPlace={props.hasWatchedPlace}
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "section" && props.sectionLine ? (
        <CrossSectionPanel
          // A new line is a new question, and mounting fresh for it is what
          // lets "no answer yet" be where the panel starts.
          key={`${props.sectionLine.from.lon},${props.sectionLine.from.lat},${props.sectionLine.to.lon},${props.sectionLine.to.lat}`}
          line={props.sectionLine}
          take={props.singleSite?.crossSection ?? null}
          onClose={onClose}
        />
      ) : null}

      {props.productOpen ? (
        <RadarProductPanel
          radar={settings.radar}
          singleSite={props.singleSite}
          stormCells={props.stormCells}
          watch={settings.watch}
          clock={props.clock}
          onRadar={props.onRadar}
          onClose={props.onCloseProduct}
        />
      ) : null}
    </>
  );
}
