# Changelog

## OpenRadar v0.2.0 (unreleased)

- Share now copies an `openradar://` link that opens the running app on that view instead of an address that leads nowhere. A second launch hands its link to the window already open.
- The timeline chip now reports the radar age next to the source, not only once the loop has gone stale.
- RIDGE II is claimed only over the ground its mosaic covers, so the Gulf, Cuba, and the Bahamas fall back to a worldwide source instead of showing an empty layer.
- The radar source reader accepts the interval form of a WMS time dimension, not only a list of instants.
- Opening Alerts with the layer switched off now says so and offers to switch it back on.
- Fixed playback eating the radar request budget and faking a source outage. Tile traffic and source discovery are now counted separately.
- Fixed the radar layer landing on top of the alert, earthquake, and fire layers on a cold start.
- Fixed the Custom Overlay switch, which could add imported shapes but never remove them.
- Overlay data no longer lingers on screen after the map moves away from the area it was fetched for.
- Swapped the aerial basemap from Esri World Imagery, which needs an ArcGIS account outside Esri software, to public-domain USGS orthoimagery, and gave OpenTopoMap the exact credit line it asks for.
- Turned the More panel into Diagnostics: per-source radar health, the last dozen events, and a button that opens the log folder.
- Radar, overlay, and map failures now go to the desktop log file instead of the browser console.
- The radar playhead stays on the frame you scrubbed to when the loop refreshes, and it only follows the newest frame while playing or when you were already on the newest one.
- Changing the loop length now changes the timeline immediately instead of waiting for the next refresh.
- Gave the settings sliders proper labels for screen readers.
- Stopped the forecast panel from requesting a new forecast on every map move. It waits for the map to settle and ignores pans of under three miles, and the previous forecast stays on screen while a new one loads.
- Added an NWS watches and warnings layer with severity colouring, click-through detail, and an Alerts panel that lists what intersects the view and flies to any of it.
- Added USGS earthquake and NIFC wildfire perimeter overlays with popups that carry the source and how fresh the data is.
- Removed the ten radar and layer switches that had no data behind them. Stored settings from the first release still load, minus those keys.
- Fixed map layers that could fail to attach because the readiness check also waited on tiles.
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
