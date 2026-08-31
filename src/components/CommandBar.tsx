import {
  BellRing,
  CloudSun,
  Crosshair,
  Download,
  Ellipsis,
  Film,
  Globe2,
  Layers3,
  LocateFixed,
  Map,
  MapPin,
  MousePointer2,
  PanelLeftClose,
  Pencil,
  Radar,
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
} from "lucide-react";
import type { ComponentType } from "react";
import { useT } from "../i18n";

export type SurfaceId =
  | "search"
  | "alerts"
  | "tropical"
  | "history"
  | "commands"
  | "route"
  | "guidance"
  | "tides"
  | "map-type"
  | "layers"
  | "export"
  | "upload"
  | "forecast"
  | "settings"
  | "more"
  | null;

export type ToolMode = "draw" | "range" | "inspect" | null;

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
}

function CommandButton({
  icon: Icon,
  label,
  active,
  onClick,
  detail,
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
      <span>{label}</span>
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
  const toggleSurface = (surface: Exclude<SurfaceId, null>) =>
    onSurface(activeSurface === surface ? null : surface);
  const toggleTool = (tool: Exclude<ToolMode, null>) =>
    onTool(activeTool === tool ? null : tool);

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
          icon={Map}
          label={t("panel.mapType")}
          active={activeSurface === "map-type"}
          onClick={() => toggleSurface("map-type")}
        />
        <CommandButton
          icon={Layers3}
          label={t("panel.layers")}
          active={activeSurface === "layers"}
          onClick={() => toggleSurface("layers")}
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
      </div>

      <div className="command-spacer" />

      <div className="command-group command-group--secondary">
        <CommandButton
          icon={BellRing}
          label={t("panel.alerts")}
          active={activeSurface === "alerts"}
          onClick={() => toggleSurface("alerts")}
        />
        <CommandButton
          icon={Tornado}
          label={t("layer.tropical")}
          active={activeSurface === "tropical"}
          onClick={() => toggleSurface("tropical")}
        />
        <CommandButton
          icon={History}
          label={t("bar.history")}
          active={activeSurface === "history"}
          onClick={() => toggleSurface("history")}
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
        <CommandButton icon={Share2} label={t("bar.share")} onClick={onShare} />
        <CommandButton
          icon={Download}
          label={t("panel.upload")}
          active={activeSurface === "upload"}
          onClick={() => toggleSurface("upload")}
        />
        <CommandButton
          icon={CloudSun}
          label={t("panel.forecast")}
          active={activeSurface === "forecast"}
          onClick={() => toggleSurface("forecast")}
        />
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

      <div className="compact-command-group" aria-label={t("bar.compact")}>
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
