import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "./settings";
import {
  createWorkspaceBackup,
  restoreWorkspace,
  WORKSPACE_BACKUP_VERSION,
} from "./workspaceBackup";

const overlay = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-96.8, 32.78] },
      properties: { label: "Home" },
    },
  ],
};

describe("workspace backups", () => {
  it("round-trips settings and the uploaded overlay together", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      layers: { ...DEFAULT_SETTINGS.layers, customOverlay: true },
    };
    const backup = createWorkspaceBackup(settings, overlay);
    expect(backup.backupVersion).toBe(WORKSPACE_BACKUP_VERSION);

    const restored = restoreWorkspace(JSON.parse(JSON.stringify(backup)));
    expect(restored.settings).toEqual(settings);
    expect(restored.customOverlay).toEqual(overlay);
    expect(restored.unread).toEqual([]);
  });

  it("keeps legacy settings imports usable without a blank overlay switch", () => {
    const restored = restoreWorkspace({
      ...DEFAULT_SETTINGS,
      layers: { ...DEFAULT_SETTINGS.layers, customOverlay: true },
    });
    expect(restored.customOverlay).toBeNull();
    expect(restored.settings.layers.customOverlay).toBe(false);
  });

  it("calls invalid or newer workspace parts a partial restore", () => {
    const restored = restoreWorkspace({
      type: "OpenRadarWorkspace",
      backupVersion: WORKSPACE_BACKUP_VERSION + 1,
      settings: { ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION },
      customOverlay: { type: "FeatureCollection", features: [] },
      futurePanel: { docked: true },
    });
    expect(restored.fromNewerBuild).toBe(true);
    expect(restored.customOverlay).toBeNull();
    expect(restored.settings.layers.customOverlay).toBe(false);
    expect(restored.unread).toEqual(["customOverlay", "workspace.futurePanel"]);
  });
});
