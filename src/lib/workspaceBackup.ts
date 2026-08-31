import {
  restoreSettings,
  type AppSettings,
  type RestoredSettings,
} from "./settings";

export const WORKSPACE_BACKUP_VERSION = 1;
export const MAX_WORKSPACE_OVERLAY_FEATURES = 5000;

export interface WorkspaceBackup {
  type: "OpenRadarWorkspace";
  backupVersion: number;
  settings: AppSettings;
  customOverlay: Record<string, unknown> | null;
}

export interface RestoredWorkspace extends RestoredSettings {
  customOverlay: Record<string, unknown> | null;
}

export function createWorkspaceBackup(
  settings: AppSettings,
  customOverlay: Record<string, unknown> | null,
): WorkspaceBackup {
  return {
    type: "OpenRadarWorkspace",
    backupVersion: WORKSPACE_BACKUP_VERSION,
    settings,
    customOverlay,
  };
}

export function looksLikeWorkspaceBackup(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      !!parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).type === "OpenRadarWorkspace"
    );
  } catch {
    return false;
  }
}

/** Accept only bounded, non-empty GeoJSON that the map can draw. */
export function isWorkspaceOverlay(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type === "Feature") return true;
  if (record.type !== "FeatureCollection") return false;
  return (
    Array.isArray(record.features) &&
    record.features.length > 0 &&
    record.features.length <= MAX_WORKSPACE_OVERLAY_FEATURES
  );
}

export function restoreWorkspace(value: unknown): RestoredWorkspace {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const isEnvelope = raw.type === "OpenRadarWorkspace";
  const restored = restoreSettings(isEnvelope ? raw.settings : value);
  const unread = [...restored.unread];
  let customOverlay: Record<string, unknown> | null = null;

  if (isEnvelope) {
    const known = new Set([
      "type",
      "backupVersion",
      "settings",
      "customOverlay",
    ]);
    unread.push(
      ...Object.keys(raw)
        .filter((key) => !known.has(key))
        .map((key) => `workspace.${key}`),
    );
    if (raw.customOverlay !== null && raw.customOverlay !== undefined) {
      if (isWorkspaceOverlay(raw.customOverlay)) {
        customOverlay = raw.customOverlay as Record<string, unknown>;
      } else {
        unread.push("customOverlay");
      }
    }
  }

  const settings = customOverlay
    ? restored.settings
    : {
        ...restored.settings,
        layers: { ...restored.settings.layers, customOverlay: false },
      };
  const backupVersion = raw.backupVersion;

  return {
    settings,
    customOverlay,
    unread: [...new Set(unread)].sort(),
    fromNewerBuild:
      restored.fromNewerBuild ||
      (isEnvelope &&
        typeof backupVersion === "number" &&
        backupVersion > WORKSPACE_BACKUP_VERSION),
  };
}
