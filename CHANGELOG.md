# Changelog

## OpenRadar v0.3.0 (unreleased)

- A first launch says where everything is. There was no onboarding of any kind: the map opened and nothing on screen mentioned that Commands searches every product, place and setting by name, or that Layers is where the rest is switched on. One toast, once, and it is done with as soon as it has been shown.

- The severe probability layer says when it has nothing to show. Switch a layer on, see a blank map, and it looks like a quiet afternoon rather than a layer that could not read anything, which for guidance somebody might act on is the worst thing it could look like. The reason now appears beside the switch. Its freshness check also worked in one direction only, so a file stamped in the future passed forever and a stamp that was not a date at all rolled over into one: the twelfth of January 8034 was being drawn as the current reading. Both are refused now, and a listing that arrives cut short keeps the readings that came before the cut instead of being thrown away whole.

- The alert switches say what is under them. They are grouped by hazard rather than by product name, which is right, but it means a switch holds products whose names look nothing like its own: tsunami warnings, extreme wind and the civil emergencies sit with the tornado warnings because all of them are somebody telling you to move now. The switch was called "Tornado", so a reader in Honolulu could have turned off tsunami warnings while turning off weather that does not happen there. It is called "Take cover now" now, and every switch carries a line listing what it covers.

- A warning already in force when you open the app is announced once, with its damage threat on it. The threat comes from a second feed, and the first draw of a session did not wait for it, so every standing warning was announced without a threat and then announced a second time a minute later when the threat arrived, which read as the office saying it had got worse. The map was wrong about it too, quietly: a catastrophic tornado warning wore the ordinary outline for its first minute. The first draw waits for the threats now, up to three seconds. Nothing after it ever waits.

- Moving the map from one national grid to another loads that grid. Alaska, Hawaii, Guam, the Caribbean and the lower forty-eight are five separate grids, and the map only reloads its frame list when it decides the source has changed. It was not counting which of the five as a change, so panning from Honolulu to Anchorage kept Hawaii's frames and went on asking for Hawaii's tiles over Alaska, which come back empty, for up to five minutes.

- Clicking a warning drawn over a severe-probability polygon opens the warning. It opened the model's guess instead, everywhere the two overlapped, which is over every storm that carries a warning. The map draws guidance under the warnings on purpose; the click was asking a separate list that had drifted from it. There is one list now, so they cannot.

- Velocity unfolding now works on real sweeps. It grouped gates by which slice of the velocity range they fell in, and a real Doppler field is noisy enough that neighbouring gates a fraction of a metre per second apart kept landing on opposite sides of a slice boundary. A live cut came apart into nearly fourteen thousand pieces, most of them a gate or two, and pieces that small have no edge worth reading, so the folds stayed in. Gates are now grouped by whether the step between them could be a fold at all, which is the question the method is actually about. On the sweep this was measured against, the folds removed went from four per cent to forty-four. A fold over a small part of the picture is also fixed now rather than dropped: the old code threw the whole correction away unless half a per cent of the sweep had moved, which meant a fold sitting over one storm survived while everything around it was reported as the radar's own reading.

- The single-site view can draw the volume the radar is sweeping right now. An archive volume is only published once the radar has finished the whole thing, which means the picture is four to six minutes old before anyone can see it, and worst at the moment somebody is watching a storm turn. The same data is also published in pieces every eleven or twelve seconds, and switching on "Volume in progress" under the radar layer reads those instead: the sector the radar has reached is seconds old and drawn over the last finished volume, which still fills the rest of the circle. The legend says how many seconds. Where the new sweep found nothing, nothing is drawn, so a storm that has moved on comes off the picture rather than sitting there from five minutes ago. If the radar has not reached the tilt you are looking at yet, you get the finished volume and the legend does not claim to be live.

- Each overlay has its own opacity, so a layer can be faded rather than switched off, and you can say which one sits on top of which. Warnings are not in the arrangement: a warning is somebody telling you to take cover, and nothing should be able to put a wildfire perimeter over one.

- Severe probability, from the model the paid apps put their badges on. The National Severe Storms Laboratory reads the radar, the satellite, the lightning and the air around each storm and publishes, every couple of minutes, how likely that storm is to turn severe in the next hour, and separately for hail, wind and a tornado. Click one for the numbers and the measurements behind them. It is guidance, not a warning: it draws under the warnings and it says so.

- The national grid now covers Alaska, Hawaii, Guam and the Caribbean, not just the lower forty-eight. Those four are published on the same bucket at the same cadence and are read by the same decoder; the map simply never asked for them, and fell through to a personal-use tier for everybody in them. Each is its own grid at its own resolution, so the view picks the one it is over.

- Alerts can be filtered by kind. Eight switches under the alert layer, grouped the way people think about them rather than as a list of a hundred product names, and anything the list has never heard of shows up under "Everything else" instead of quietly disappearing. There is also an optional sound: one short tone when a new or upgraded alert reaches the place you watch, off until you ask for it.

- Warnings say when the office expects worse than usual. A tornado or thunderstorm warning can carry a damage threat of considerable, destructive or catastrophic, and those are now drawn with a heavier outline, badged in the alerts panel, and named in the popup along with the hail size the office gave. If you have a watched place, an upgrade to a warning already in force interrupts you a second time, once, and says which tag it was given: that is the office saying the thing got worse, and it should not read like the same sentence you saw an hour ago.

- Storm cells, from the radar's own tracking algorithm. It says which blobs are one storm rather than several, which way each is going and how fast, and where it will be in a quarter of an hour, half an hour, three quarters and an hour. The track is drawn as one dashed line through where the storm has been, where it is and where it is going, and a storm with rotation in it is ringed in red. If you have set a watched place, the radar panel names the storm that reaches it and how many minutes away it is, counting only the part of the motion actually pointing at you: a storm going past, or away, gets no arrival time rather than a made-up one.
- Hail probability and tornado vortex signatures are not part of this. The two products that carried them stopped publishing in May 2022 and nothing has replaced them.

- The window comes back where you left it, at the size you left it. If the monitor it was on has gone, the system places it somewhere you can see instead of restoring it off the edge of the desktop.

- Every locally decoded product takes a "hide below" value, in the product's own unit, kept separately for each. Velocity hides by how fast rather than which way, since both directions are the storm, and the national mosaic has its own floor because it is the strongest return anywhere in the column rather than one tilt of it.

- The basemap follows the theme unless you have chosen one. Picking Light used to leave the dark map under white panels.

- Clearing a colour table and stopping a replay can both be undone.

- Diagnostics can be copied for a bug report: what you are running, the renderer, which sources answered and what they said when they did not, and the last of the log. Nothing in it says where you are to better than about a kilometre, and no folder in it is named after you.

- Six more national grids, decoded here like the rest: how high the storms reach, how much water the column is holding, how hard it is raining right now, how much has fallen in the last hour and the last day, and where the biggest hail has been since this time yesterday.
- Rotation tracks are drawn correctly for the first time. The grid arrives in thousandths of a reciprocal second and the colours were written as though it were whole ones, so every cell with any rotation in it sat past the end of the scale and the layer was one flat colour. It has a range again.

- Storm relative velocity, which is the product rotation is actually read from. A radar measures only the part of the wind coming at it, so in a sixty knot flow a couplet is buried under the ambient wind and you are guessing. OpenRadar reads what the sweep is moving in off the sweep itself, the way a Velocity Azimuth Display always has, and subtracts it: what is left is the picture as if the whole storm were standing still. It shows what it worked out, in your units, and if you would rather say than have it read, type the speed and direction and it uses yours.

- Settings can be saved to a file and dropped back in. Everything travels: saved views, layers, the watched place, units, the colour table. Drop the file on the Upload panel to put it back, with an Undo on the notification if it was the wrong one. The file is plain readable JSON, and it comes back through the same checks the stored settings do, so a hand-edited one cannot ask for anything the sliders could not.

- Units, clock and text size are yours to pick. Metres and Celsius throughout, or feet and Fahrenheit; the forecast is asked for in the units it will be read in rather than converted after the fact, and the word beside a number always matches the number. The clock reads UTC if you want it, which is what every weather product is stamped in, and it says so with a Z rather than leaving you to wonder. Text size goes to 115 or 130 percent and takes the whole workspace with it, panels and all.
- The radar's own scales stay as they are. Reflectivity is in dBZ and velocity in metres a second wherever you are, because that is what the products are.

- Storm Reports puts what people on the ground actually saw on the map: hail with the size someone measured, wind damage, tornadoes, flooding, for the last twenty-four hours, with the remark whoever called it in wrote. It sits over the outlook and under the warnings, because a report is what happened rather than what might. Reports with nothing measured say nothing rather than nought.

- The Inspector says how high the beam is. Click anywhere inside a single-site view and it gives the height above the radar in feet along with the tilt, worked out the way the beam actually travels through the air. The same picture at the same tilt means something different eighty miles out, because by then the beam is a mile up and looking over the top of what is happening underneath it.

- Two new layers from the Storm Prediction Center. Severe Outlook draws today's risk of severe storms in the Center's own colours, weakest area underneath so a High sits on top of the Moderate around it, with the hours it is valid for. Mesoscale Discussions draws what forecasters are watching right now, which is usually an hour or two ahead of any warning, with what they wrote. Both sit under the warnings, because guidance about what may happen belongs under what is happening, and both say so when you click them.

- Storm history opens straight away. It used to read the whole record, nearly three megabytes of six-hourly positions going back to 1851, before the search box would answer anything. The names and years now come on their own, a sixth of the size, and a storm's track arrives when you pick it, a decade at a time, kept for the rest of the session.

- Panels behave like panels for anyone not using a mouse. Each one is announced by name when it opens, the focus moves into it rather than staying wherever it was, Escape closes it, and closing puts the focus back on the button that opened it instead of dropping it at the top of the window. In the command list the arrow keys move between results, so finding something twenty rows down is one gesture rather than twenty.

- Route weather asks the road router gently, and has an answer when it says no. The roads come from the OSRM demo server, which is run as a courtesy, asks for at most one request a second, and promises no uptime. Requests now queue behind each other instead of going out together. When it refuses anyway, the panel offers to use the straight line between the two places instead, and says plainly that there is no road shape and the times assume a steady 55 mph. The weather along it is real either way.

- A machine that cannot draw the map now says so. MapLibre needs WebGL2 and there is no fallback, so a window without it used to fail from somewhere inside the renderer and report that the interface could not finish drawing, which is true and no help. OpenRadar asks before it starts, and if the answer is no it names the likely cause: hardware acceleration switched off, a virtual machine with no graphics passthrough, or a remote desktop session. Diagnostics lists the graphics card as well.

- Velocity is unfolded before it is drawn. A radar can only measure wind up to a limit of its own, and anything faster wraps around: a sixty knot outbound gust is reported as an inbound one, so a green streak turns red in the middle of a straight wind and rotation that is not there appears to be. OpenRadar now splits the sweep into patches of air that plainly belong together, works out how many folds separate each patch from its neighbours, and shifts whole patches back. The tilt line beside the map says UNFOLDED while it is on, and the switch in the radar product sheet turns it off for the radar's own reading.

- A close-in view is handed to a site that is actually publishing. The nearest radar was chosen by distance alone, so one down for maintenance took the view and showed an error where the site next to it would have shown weather. The nearest few are now asked whether they have published anything in the last twenty minutes, and the first that has takes the view. If none of them has, the nearest is still named, so what you see is that site's own trouble rather than an empty map.

## OpenRadar v0.2.0

- Three new things for the coast and for the day after tomorrow.

  Guidance puts four forecast models next to each other for the middle of the map: GFS, ECMWF, ICON, and GEM, each from its own centre's run rather than blended into an average. Temperature, rain, and wind every three hours, with a line saying whether they agree. Where they do not, none of them knows yet, and that is worth seeing.

  Tides finds the nearest NOAA station, says whether the water is coming in or going out, and lists the next high and low waters with their heights. The station list is bundled, so finding the nearest one works with no network.

  Storm Surge Risk draws how far the water could reach for a hurricane of each category, from the National Hurricane Center's own maps, with a picker for the category and a legend for the depth. It is not a forecast and the panel says so twice: NOAA built it by running thousands of simulated hurricanes at every stretch of coast and keeping the worst water each one made, at high tide.

- The whole workspace speaks Spanish. Pick it in Settings and every panel, button, legend, popup, and notification changes where you are standing, with no restart and nothing lost from the view you had. Weather terms follow the National Weather Service's own Spanish, so a warning is an aviso and a watch is a vigilancia. Searching the command list works in either language: type huracán or hurricane and you land on the same thing.

- Open it with no network and the map is still a map. Tiles, radar frames, and alert polygons are kept on disk as they arrive, and when a request fails the last copy is served instead. The timeline says "Showing the last view" with the age of the frames rather than passing them off as live, and the first refresh that gets through puts it back on live radar. The cache holds a few hundred megabytes and drops the oldest first.

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
