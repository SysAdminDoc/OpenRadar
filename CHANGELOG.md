# Changelog

## OpenRadar v0.2.0 (unreleased)

- The radar legend now shows the National Weather Service reflectivity ramp with dBZ labels instead of an unlabelled gradient.
- Added a high-contrast pass for readers whose system asks for one.
- Fixed command bar buttons being named after their tooltip in narrow windows, where the visible label is hidden.
- Fixed low-contrast text on the command bar in the light theme and on the Diagnostics timestamps.
- The end-to-end suite now runs at 1024 by 720 as well, covers every layer switch and the preset save, recall, and undo path, and fails on any serious accessibility violation in either theme.
- Fixed a refresh throwing away the playhead when it was parked on a forecast frame, and a shrinking loop jumping to the far end of the forecast instead of the nearest surviving frame.
- Fixed the forecast tail anchoring on the wall clock instead of the newest observation, which could open a gap or double back over a frame that had since been observed.
- Fixed future radar offering a tail over Alaska, Hawaii, Puerto Rico, and Guam, where the model has no data.
- Fixed future radar hiding the stale-radar warning, which is measured on the newest observation again.
- Observed and forecast radar keep separate map sources, so scrubbing across the boundary no longer throws away every cached tile.
- Fixed a half-written share link knocking the map out of globe projection instead of being refused.
- Fixed a long WMS time interval yielding only its oldest instants, which read as no radar at all.
- Put a host allowlist in front of anything the desktop side may fetch, before the first native request exists. It refuses a host that is not on the list, a plain-text address, and a redirect that would leave the list.
- Added tropical products: forecast cones, tracks, and Saffir-Simpson coloured forecast points, coastal watches, and the development outlook areas, with a panel that lists active storms strongest first and flies the map to any of them.
- Added future radar. Switch it on over the lower forty-eight and the scrubber carries up to six hours past the newest observation in quarter-hour steps, with the model run and lead named on the timeline.
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
