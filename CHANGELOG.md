# Changelog

## OpenRadar v0.2.0 (unreleased)

- Replaced RainViewer as the default radar with the NWS RIDGE II mosaic, added NOAA nowCOAST as the failover, and kept RainViewer for viewports outside NOAA coverage.
- Added a rolling request budget per radar source and per-source health in the More panel.
- Named the active radar source in the timeline and in the map credits.
- Fixed the stale-radar warning, which measured whichever frame was on screen instead of the newest one in the feed.
- Linked the dual panes so panning, zooming, rotating, or tilting either one moves the other, and gave the second pane its own frame offset for comparing the current loop against an earlier one.

## OpenRadar v0.1.0 (2026-08-30)

- Started the Tauri 2 desktop application with React, TypeScript, Vite, and MapLibre.
- Added map camera state for center, zoom, bearing, pitch, and flat or globe projection.
- Added live composite radar playback, map tools, layers, presets, dual pane, forecast, search, GeoJSON import, and JSON settings.
- Added an original OpenRadar application icon, dark and light themes, in-app notifications, crash logging, and guarded network sources.
- Fixed camera restoration when a shared-view query is absent and reduced radar requests with 512 pixel tiles.
- Verified 10 unit tests, four end-to-end workflows, the browser build, Rust checks, and the NSIS installer.
