import type { SurfaceId } from "./CommandBar";
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
import type { PlaceResult } from "../lib/weather";
import type { OverlayStates } from "../hooks/useOverlays";
import type { ExportState } from "../hooks/useExport";
import { AlertsPanel } from "../panels/AlertsPanel";
import { ExportPanel } from "../panels/ExportPanel";
import { ForecastPanel } from "../panels/ForecastPanel";
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
  onFollowStorm: (point: GeoPoint) => void;
  onRoute: (route: Record<string, unknown> | null) => void;
  onUpload: (file: File) => void;
  onWatchHere: () => void;
  onOpenLogFolder: () => void;
  onReset: () => void;
}

/** Every surface the command bar opens, and the radar product sheet. */
export function PanelSurfaces(props: PanelSurfacesProps) {
  const { activeSurface, settings, overlays, onClose } = props;

  return (
    <>
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
          onLayers={props.onLayers}
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

      {activeSurface === "settings" ? (
        <SettingsPanel
          settings={settings}
          onSettings={props.onSettings}
          onWatchHere={props.onWatchHere}
          onReset={props.onReset}
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
          onClose={onClose}
        />
      ) : null}

      {activeSurface === "upload" ? (
        <UploadPanel onClose={onClose} onFile={props.onUpload} />
      ) : null}

      {activeSurface === "more" ? (
        <MorePanel
          mapReady={props.mapReady}
          radarReady={props.frameCount > 0}
          activeSource={props.sourceLabel}
          health={props.health}
          log={props.log}
          onOpenLogFolder={props.onOpenLogFolder}
          onClose={onClose}
        />
      ) : null}

      {props.productOpen ? (
        <RadarProductPanel
          radar={settings.radar}
          onRadar={props.onRadar}
          onClose={props.onCloseProduct}
        />
      ) : null}
    </>
  );
}
