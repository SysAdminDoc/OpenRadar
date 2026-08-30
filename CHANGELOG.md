# Changelog

## OpenRadar v0.2.0 (unreleased)

- A wind layer, animated. Sixty-five thousand particles follow the GFS wind at ten metres, on the flat map and on the globe, with a banner saying which model run they came from and how old it is. Turn it on in Layers. If your device is set to show less movement it stays off and says so, because animation for its own sake is exactly what that setting is about.

- Load a GRLevelX `.pal` colour table and the radar is drawn with it. Drop one on the Upload panel and it colours the single-site sweep and the MRMS products, which are the ones OpenRadar decodes itself and so the ones a palette has raw values to act on. The scale beside the map is rebuilt from the table's own stops, so the bar you read is the bar the map was painted with. It says how many colours it found, what the table is for, and what it skipped. Clearing it puts the built-in ramp back.

- Canada has radar now. The American mosaics stop at the border, so a Canadian view used to fall through to a feed licensed for personal use only. Environment and Climate Change Canada publishes its own one kilometre composite every six minutes, and that is what the map shows over Canada, with three hours of it to scrub through. It measures rain rate in millimetres an hour rather than reflectivity, so the scale beside it changes to match rather than describing the wrong thing.

- A Commands button opens one list with every layer, radar product, map type, panel, and tool in it. Type what you call the thing rather than what it is labelled: meso finds rotation tracks, mesh finds hail size, debris finds correlation coefficient. Switches show whether they are already on, so you are not toggling something to find out.

- Two lightning layers, from the two things that actually watch for it. Lightning Density is the national grid of cloud-to-ground flashes over the past five minutes. Lightning Flashes is what the GOES-East satellite sees, cloud flashes included, with the newest drawn brightest so you can tell which way a storm is moving. Neither is a strike report, and the legend says so.

- OpenRadar can update itself. Diagnostics has a button that checks the project's own releases, tells you what is new, and installs it if you say so. Nothing downloads on its own, because an app that decides to update itself in the middle of a storm is not much use to anyone. Every release carries a checksum file and a signature, and a build that is not signed by the project's key is refused.

- MRMS now leads the radar. NOAA builds it by merging every radar in the network onto a one kilometre national grid every two minutes, and it is cleaner and finer than the picture services. The grids are GRIB2, so OpenRadar decodes them here and hands the map ordinary tiles: scrubbing, the loop, dual panes, and export all work on them the way they always did.
- Two more products from the same grids. Rotation Tracks shows where the air has been turning over the past hour, and Hail Size shows the largest hail the network thinks a storm has produced. Each is a switch in the Layers panel with its own scale drawn from the same colours the tiles use.

- Zoom past 8 over the United States and the map switches from the national mosaic to the nearest NEXRAD site's own Level II radar, decoded on this machine. The site, the tilt, and the moment are yours to pick in the radar product sheet: reflectivity, velocity, spectrum width, differential reflectivity, and correlation coefficient, on every elevation the volume holds. Zoom back out and the mosaic takes over again.
- The legend follows what is on screen. It names the site and the tilt during a single-site view, and swaps to the velocity scale when velocity is what is drawn.

- New Storm history panel. Search any Atlantic or eastern Pacific storm back to 1851 by name, year, or both, and its best track draws on the map with every six-hourly fix coloured by the wind it carried. The panel shows the peak intensity, the accumulated cyclone energy, and how many fixes the record holds.
- Storms from 2003 onward replay the radar. Pick one and OpenRadar loads the national mosaic for three hours either side of its peak from the Iowa State archive, so you can watch a landfall the way it happened. The timeline credits the archive while a replay is running and hands the map back to live radar when you close it.

- Fixed a drawn route re-tracing whole loops wherever the road crosses itself, and a departure time past the forecast being answered with the nearest hour it had rather than nothing.
- A stretch of road with no forecast reading is drawn in its own colour instead of the colour for no rain.
- Fixed an alert being announced twice when one check overran the next.
- Following a storm now keeps the view in the first free preset slot and says which one.

- You can watch one place for warnings. Pick a point and a radius in Settings and OpenRadar checks it every forty-five seconds even when the map is looking somewhere else, raising a system notification on the desktop and an in-app one in a browser. It says each alert once per session, and moving the watch starts the list over.

- Added export. Save the view as a PNG or record the whole loop as a WebM, both with the frame time, the source, and the credits burned into the corner, and both written straight to your downloads folder.
- Replaced the Videos placeholder, which only ever promised a feature, with the Export panel.

- Fixed playback jumping hours ahead into the forecast tail every five minutes when future radar was on.
- Fixed the Diagnostics panel clearing a real HRRR outage as soon as the radar refreshed.
- Every map layer now has one declared place in the stack, so warnings draw above tropical and fire context no matter which feed answers first, and a drawn route is never buried by radar or satellite.
- The compare pane shows the satellite image for its own frame rather than the one the primary map is on.
- Fixed the dBZ labels sitting over the wrong colours, and gave the ramp a description for screen readers.
- A tropical record with no forecast hour is no longer read as a storm's current position.

- The Upload panel now reads GRLevelX placefiles as well as GeoJSON, drawing their lines, polygons, and points in the colours and widths the file asks for, stepping over object blocks whose contents are positioned in screen pixels, and reporting the refresh interval, anything left out, and whether the file was cut off.
- Added route weather. Give it two places and a departure time and it draws the drive coloured by the chance of rain when you would reach each stretch, with a table of arrival time, temperature, and conditions.
- Added a GOES-East GeoColor satellite layer under the radar. It follows the frame you are looking at, holds back to the newest image the archive has published, and says which image it is showing.
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
