import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "./settings";
import {
  createWorkspaceBackup,
  restoreWorkspace,
  WORKSPACE_BACKUP_VERSION,
} from "./workspaceBackup";
import type { WorkspaceOverlayFile } from "./workspaceOverlays";

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

const overlayFile: WorkspaceOverlayFile = {
  id: "spotters.geojson",
  name: "spotters.geojson",
  enabled: true,
  opacity: 1,
  shapes: overlay,
};

describe("workspace backups", () => {
  it("round-trips settings and the whole imported set together", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      layers: { ...DEFAULT_SETTINGS.layers, customOverlay: true },
    };
    const files: WorkspaceOverlayFile[] = [
      overlayFile,
      {
        id: "counties.json",
        name: "counties.json",
        enabled: false,
        opacity: 0.4,
        shapes: overlay,
      },
    ];
    const backup = createWorkspaceBackup(settings, files);
    expect(backup.backupVersion).toBe(WORKSPACE_BACKUP_VERSION);

    const restored = restoreWorkspace(JSON.parse(JSON.stringify(backup)));
    expect(restored.settings).toEqual(settings);
    // The switch and the opacity travel with the shapes. A set restored with
    // everything switched back on would put a file somebody had deliberately
    // hidden back on the map.
    expect(restored.overlayFiles).toEqual(files);
    expect(restored.unread).toEqual([]);
  });

  it("reads a version 1 backup's single overlay as a set of one", () => {
    const restored = restoreWorkspace({
      type: "OpenRadarWorkspace",
      backupVersion: 1,
      settings: {
        ...DEFAULT_SETTINGS,
        layers: { ...DEFAULT_SETTINGS.layers, customOverlay: true },
      },
      customOverlay: overlay,
    });
    expect(restored.overlayFiles).toHaveLength(1);
    expect(restored.overlayFiles[0].shapes).toEqual(overlay);
    expect(restored.overlayFiles[0].enabled).toBe(true);
    expect(restored.settings.layers.customOverlay).toBe(true);
    expect(restored.unread).toEqual([]);
  });

  it("drops an unreadable member and says so rather than the whole set", () => {
    const restored = restoreWorkspace({
      type: "OpenRadarWorkspace",
      backupVersion: WORKSPACE_BACKUP_VERSION,
      settings: DEFAULT_SETTINGS,
      overlayFiles: [
        overlayFile,
        {
          name: "empty.geojson",
          shapes: { type: "FeatureCollection", features: [] },
        },
        { name: "", shapes: overlay },
        // The same file twice, which the set cannot hold.
        { ...overlayFile, opacity: 0.1 },
      ],
    });
    expect(restored.overlayFiles).toEqual([overlayFile]);
    expect(restored.unread).toContain("overlayFiles");
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
    const backup = createWorkspaceBackup(settings, []);
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
    const backup = createWorkspaceBackup(settings, []);
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
    expect(restored.overlayFiles).toEqual([]);
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
    expect(restored.overlayFiles).toEqual([]);
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
