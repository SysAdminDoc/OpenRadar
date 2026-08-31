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

  it("carries every watched place, not only home", () => {
    // The places are somebody's own list, and a backup that quietly dropped
    // them would be a backup that loses the point of making one.
    const settings = {
      ...DEFAULT_SETTINGS,
      watch: { ...DEFAULT_SETTINGS.watch, enabled: true },
      watchPlaces: [
        {
          id: "school",
          name: "School",
          enabled: true,
          center: [-96.75, 32.8] as [number, number],
          radiusMiles: 15,
          minSeverity: "moderate" as const,
          sound: true,
          quietHours: DEFAULT_SETTINGS.watch.quietHours,
        },
      ],
    };
    const backup = createWorkspaceBackup(settings, null);
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(backup)));
    expect(restored.settings.watchPlaces).toEqual(settings.watchPlaces);
    expect(restored.settings.watch.enabled).toBe(true);
  });

  it("backs up incident pack references without embedding PMTiles bytes", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      incidentPacks: {
        diskLimitMb: 8192,
        selectedId: "0123456789abcdef01234567",
        references: [
          {
            id: "0123456789abcdef01234567",
            name: "Storm response",
            bounds: { west: -94, south: 40, east: -93, north: 41 },
            minZoom: 5,
            maxZoom: 10,
            bytes: 450_000_000,
            sha256: "a".repeat(64),
            attribution: "USGS The National Map",
          },
        ],
      },
    };
    const backup = createWorkspaceBackup(settings, null);
    const text = JSON.stringify(backup);
    expect(text.length).toBeLessThan(10_000);
    expect(text).toContain("0123456789abcdef01234567");
    expect(text).toContain("450000000");
    expect(text).not.toContain("data:image");
    expect(text).not.toContain("basemap.pmtiles");
    expect(restoreWorkspace(JSON.parse(text)).settings.incidentPacks).toEqual(
      settings.incidentPacks,
    );
  });

  it("keeps legacy settings imports usable without a blank overlay switch", () => {
    const restored = restoreWorkspace({
      ...DEFAULT_SETTINGS,
      layers: { ...DEFAULT_SETTINGS.layers, customOverlay: true },
    });
    expect(restored.customOverlay).toBeNull();
    expect(restored.settings.layers.customOverlay).toBe(false);
  });

  it("calls newer workspace parts a partial restore", () => {
    const restored = restoreWorkspace({
      type: "OpenRadarWorkspace",
      backupVersion: WORKSPACE_BACKUP_VERSION + 1,
      settings: { ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION },
      customOverlay: null,
      futurePanel: { docked: true },
    });
    expect(restored.fromNewerBuild).toBe(true);
    expect(restored.customOverlay).toBeNull();
    expect(restored.settings.layers.customOverlay).toBe(false);
    expect(restored.unread).toEqual(["workspace.futurePanel"]);
  });

  it.each([
    { type: "OpenRadarWorkspace" },
    {
      type: "OpenRadarWorkspace",
      backupVersion: WORKSPACE_BACKUP_VERSION,
    },
    {
      type: "OpenRadarWorkspace",
      backupVersion: WORKSPACE_BACKUP_VERSION,
      settings: {},
    },
    {
      type: "OpenRadarWorkspace",
      backupVersion: WORKSPACE_BACKUP_VERSION,
      settings: DEFAULT_SETTINGS,
      customOverlay: { type: "FeatureCollection", features: [] },
    },
  ])("rejects a truncated or malformed envelope", (value) => {
    expect(() => restoreWorkspace(value)).toThrow("workspace.invalid");
  });
});
