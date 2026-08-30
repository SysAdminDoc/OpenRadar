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
} from "lucide-react";
import type { ComponentType } from "react";

export type SurfaceId =
  | "search"
  | "alerts"
  | "tropical"
  | "route"
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
  const toggleSurface = (surface: Exclude<SurfaceId, null>) =>
    onSurface(activeSurface === surface ? null : surface);
  const toggleTool = (tool: Exclude<ToolMode, null>) =>
    onTool(activeTool === tool ? null : tool);

  return (
    <nav className="command-bar" aria-label="Map commands">
      <div className="command-group command-group--primary">
        <CommandButton icon={LocateFixed} label="Location" onClick={onLocate} />
        <CommandButton
          icon={Search}
          label="Search"
          active={activeSurface === "search"}
          onClick={() => toggleSurface("search")}
        />
        <CommandButton
          icon={Map}
          label="Map Type"
          active={activeSurface === "map-type"}
          onClick={() => toggleSurface("map-type")}
        />
        <CommandButton
          icon={Layers3}
          label="Layers"
          active={activeSurface === "layers"}
          onClick={() => toggleSurface("layers")}
        />
        <CommandButton
          icon={PanelLeftClose}
          label="Dual Pane"
          active={dualPane}
          onClick={onDualPane}
        />
      </div>

      <div className="command-divider" />

      <div className="command-group command-group--scenes">
        <CommandButton
          icon={projection === "globe" ? Globe2 : Radar}
          label={projection === "globe" ? "Flat" : "Globe"}
          onClick={onProjection}
          detail={`Switch to ${projection === "globe" ? "flat" : "globe"} map`}
        />
        {presets.map((saved, index) => (
          <button
            className="preset-button"
            type="button"
            key={index}
            aria-label={
              saved ? `Open preset ${index + 1}` : `Save preset ${index + 1}`
            }
            title={
              saved ? `Open preset ${index + 1}` : `Save preset ${index + 1}`
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
          label="Draw"
          active={activeTool === "draw"}
          onClick={() => toggleTool("draw")}
        />
        <CommandButton
          icon={Crosshair}
          label="Range"
          active={activeTool === "range"}
          onClick={() => toggleTool("range")}
        />
        <CommandButton
          icon={MousePointer2}
          label="Inspector"
          active={activeTool === "inspect"}
          onClick={() => toggleTool("inspect")}
        />
      </div>

      <div className="command-spacer" />

      <div className="command-group command-group--secondary">
        <CommandButton
          icon={BellRing}
          label="Alerts"
          active={activeSurface === "alerts"}
          onClick={() => toggleSurface("alerts")}
        />
        <CommandButton
          icon={Tornado}
          label="Tropical"
          active={activeSurface === "tropical"}
          onClick={() => toggleSurface("tropical")}
        />
        <CommandButton
          icon={Route}
          label="Route"
          active={activeSurface === "route"}
          onClick={() => toggleSurface("route")}
        />
        <CommandButton
          icon={Film}
          label="Export"
          active={activeSurface === "export"}
          onClick={() => toggleSurface("export")}
        />
        <CommandButton icon={Share2} label="Share" onClick={onShare} />
        <CommandButton
          icon={Download}
          label="Upload"
          active={activeSurface === "upload"}
          onClick={() => toggleSurface("upload")}
        />
        <CommandButton
          icon={CloudSun}
          label="Forecast"
          active={activeSurface === "forecast"}
          onClick={() => toggleSurface("forecast")}
        />
        <CommandButton
          icon={Settings}
          label="Settings"
          active={activeSurface === "settings"}
          onClick={() => toggleSurface("settings")}
        />
        <CommandButton
          icon={Ellipsis}
          label="Diagnostics"
          active={activeSurface === "more"}
          onClick={() => toggleSurface("more")}
        />
      </div>

      <div className="compact-command-group" aria-label="Compact commands">
        <CommandButton icon={MapPin} label="Locate" onClick={onLocate} />
        <CommandButton
          icon={Layers3}
          label="Layers"
          active={activeSurface === "layers"}
          onClick={() => toggleSurface("layers")}
        />
        <CommandButton icon={Send} label="Share" onClick={onShare} />
        <CommandButton
          icon={Settings}
          label="Settings"
          active={activeSurface === "settings"}
          onClick={() => toggleSurface("settings")}
        />
      </div>
    </nav>
  );
}
