import {
  restoreSettings,
  type AppSettings,
  type RestoredSettings,
} from "./settings";
import {
  isWorkspaceOverlay,
  overlayFileId,
  MAX_WORKSPACE_OVERLAY_FILES,
  type WorkspaceOverlayFile,
} from "./workspaceOverlays";

/**
 * Version 2 carries a set of imported files where version 1 carried one.
 *
 * A version 1 backup is still read: its single overlay becomes a set of one,
 * named for the layer it used to be, so a reader restoring an older backup
 * gets their shapes back rather than an explanation.
 */
export const WORKSPACE_BACKUP_VERSION = 2;

export interface WorkspaceBackup {
  type: "OpenRadarWorkspace";
  backupVersion: number;
  settings: AppSettings;
  overlayFiles: WorkspaceOverlayFile[];
}

export interface RestoredWorkspace extends RestoredSettings {
  overlayFiles: WorkspaceOverlayFile[];
}

export function createWorkspaceBackup(
  settings: AppSettings,
  overlayFiles: WorkspaceOverlayFile[],
): WorkspaceBackup {
  return {
    type: "OpenRadarWorkspace",
    backupVersion: WORKSPACE_BACKUP_VERSION,
    settings,
    overlayFiles,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidWorkspaceEnvelope(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "OpenRadarWorkspace") return false;
  if (
    !Number.isInteger(value.backupVersion) ||
    (value.backupVersion as number) < 1 ||
    !isRecord(value.settings) ||
    !Number.isInteger(value.settings.schemaVersion)
  ) {
    return false;
  }
  if (
    value.overlayFiles !== undefined &&
    value.overlayFiles !== null &&
    !Array.isArray(value.overlayFiles)
  ) {
    return false;
  }
  return (
    value.customOverlay === undefined ||
    value.customOverlay === null ||
    isWorkspaceOverlay(value.customOverlay)
  );
}

/**
 * One entry of a version 2 backup's overlay set, or null when it is not one.
 *
 * A file whose shapes will not pass the same check an import passes is dropped
 * rather than repaired. Half a set restored with no word about the rest would
 * be worse than a set restored with a note saying what could not be read.
 */
function readOverlayFile(value: unknown): WorkspaceOverlayFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  if (!isWorkspaceOverlay(raw.shapes)) return null;
  const opacity = typeof raw.opacity === "number" ? raw.opacity : 1;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : overlayFileId(name),
    name,
    // Absent means on, the way it arrives from an import.
    enabled: raw.enabled !== false,
    opacity: Math.min(Math.max(opacity, 0), 1),
    shapes: raw.shapes as Record<string, unknown>,
  };
}

export function restoreWorkspace(value: unknown): RestoredWorkspace {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const isEnvelope = raw.type === "OpenRadarWorkspace";
  if (isEnvelope && !isValidWorkspaceEnvelope(value)) {
    throw new Error("workspace.invalid");
  }
  const restored = restoreSettings(isEnvelope ? raw.settings : value);
  const unread = [...restored.unread];
  let overlayFiles: WorkspaceOverlayFile[] = [];

  if (isEnvelope) {
    const known = new Set([
      "type",
      "backupVersion",
      "settings",
      "customOverlay",
      "overlayFiles",
    ]);
    unread.push(
      ...Object.keys(raw)
        .filter((key) => !known.has(key))
        .map((key) => `workspace.${key}`),
    );
    if (Array.isArray(raw.overlayFiles)) {
      for (const entry of raw.overlayFiles) {
        const file = readOverlayFile(entry);
        if (!file) {
          unread.push("overlayFiles");
        } else if (overlayFiles.length >= MAX_WORKSPACE_OVERLAY_FILES) {
          // A backup written by a build that allowed more of them, or one
          // edited by hand. The ceiling is what the rest of the app is built
          // to, so it holds here rather than being trusted from the file.
          unread.push("overlayFiles");
        } else if (overlayFiles.some((held) => held.id === file.id)) {
          unread.push("overlayFiles");
        } else {
          overlayFiles.push(file);
        }
      }
    }
    // A version 1 backup carried one overlay and no name for it. It becomes a
    // set of one, called what the layer was called, so the shapes come back.
    if (
      !overlayFiles.length &&
      raw.customOverlay !== null &&
      raw.customOverlay !== undefined
    ) {
      if (isWorkspaceOverlay(raw.customOverlay)) {
        overlayFiles = [
          {
            id: overlayFileId("Custom Overlay"),
            name: "Custom Overlay",
            enabled: true,
            opacity: 1,
            shapes: raw.customOverlay as Record<string, unknown>,
          },
        ];
      } else {
        unread.push("customOverlay");
      }
    }
  }

  const settings = overlayFiles.length
    ? restored.settings
    : {
        ...restored.settings,
        layers: { ...restored.settings.layers, customOverlay: false },
      };
  const backupVersion = raw.backupVersion;

  return {
    settings,
    overlayFiles,
    unread: [...new Set(unread)].sort(),
    fromNewerBuild:
      restored.fromNewerBuild ||
      (isEnvelope &&
        typeof backupVersion === "number" &&
        backupVersion > WORKSPACE_BACKUP_VERSION),
  };
}
