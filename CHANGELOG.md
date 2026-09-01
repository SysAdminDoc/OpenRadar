# Changelog

## Unreleased

- There is a layout for streaming it now. People composite radar into OBS by cropping a window and hoping the panels stay out of shot, or by running a separate dashboard project beside the app; no radar application ships a mode for it, and nobody has even asked the nearest competitor for one. One command from the list takes away everything you operate, which is everything nobody watching can use, and leaves a strip across the top with the four things they need: the time, where the map is, the worst warning on it, and the credits. All of it is sized to survive being scaled to 720 and compressed, and the bottom of the frame is left clear because that is where a streamer puts their own overlay. It is ordinary window content: no second window, no always-on-top, no keyboard shortcut, and nothing about the map itself changes. Leaving it puts the workspace back as it was, because nothing was unmounted to begin with. The credits are the one thing that cannot be switched off: these services publish for nothing and a stream is where the credit reaches people who will never see the app.

- A corrupt lightning file can no longer take the window down without a word. The GOES feed is NetCDF-4, which is HDF5 underneath, and the reader for it is a library walking a container format designed for scientific archives. Fuzzing that path found a 215-byte file that works the element count out as a product of dimension sizes that overflows, so the whole read now sits behind a guard: a corrupt download comes back as a file that could not be read, which is what it is. A second file, 202 bytes, sends the reader into unbounded recursion instead, and a stack overflow is not something any guard can catch. That one is upstream to fix and is written down as such, with both files kept beside the code and checked on every test run, the second in a child process so it cannot take the suite down with it.

- Exporting a loop no longer takes as long as the loop. It used to play the timeline through at its real speed with a recorder attached, so a twenty-second loop cost twenty seconds and held the workspace for every one of them. Each frame now goes to the video encoder the moment it is drawn, which costs whatever the map and the encoder need and nothing for waiting. The compressed frames go into a WebM this app writes itself, with a cue index so the file can be scrubbed, and the caption and credits are burned in exactly as before. The old recorder is still there for builds that cannot encode video, and taking that path now says so, because it is the slow one and there is no reason to leave somebody guessing why this export is different. The canvas the video is encoded from is rounded to even sides, since several encoders refuse an odd one and that is a strange way for an export to fail on one window size and work on the next; a still and a GIF keep the size they actually are.

- Imported files are a set now, not a file. There was one slot: import a second placefile and the first one silently vanished, which is no use to anybody keeping a spotter network in one file and county lines in another. Up to eight coexist, each with its own name, its own switch, its own opacity and its own place in the order, and importing a file you already have replaces that file in place rather than adding a second copy or shuffling it to the end. Its switch and its fade survive the replacement, because re-importing an edited file is an update to what you arranged, not a new thing to arrange. The whole set travels in a workspace backup, and a backup written by the old build still restores: its single overlay comes back as a set of one. A file that will not read is dropped with a note rather than taking the rest of the set down with it.

- Imported shapes no longer draw over warnings. The layers panel refuses to let anyone put an overlay above a warning, and the imported layer sat above the entire overlay band regardless, so dropping a placefile on the window produced exactly the arrangement the panel exists to prevent. They now sit under everything a service published and over the radar they are context for.

- An exported picture now credits whoever actually served it, and carries the whole record beside it. The credit burned into the corner was the literal words "OpenRadar · OpenStreetMap · NOAA", which is right for a live American mosaic and wrong for a German or Canadian one, and badly wrong for a 2005 hurricane replayed out of the Iowa State archive. It comes from the layer's own provenance record now. Every provider states its credit as an HTML anchor, because that is what the map's attribution control renders, so the words are pulled out of the markup before anything draws them. That fixes the diagnostics block too, which had been pasting raw tags into bug reports. Beside each exported file there is now a small JSON record, one entry per frame that reached the file, in timeline order: the source, the credit and its link, whether the frame was observed or forecast, when it was measured and when it was fetched, which model run produced it, and whether the disk cache served it during an outage. A loop is not one source, so a loop gets one entry per frame rather than one for the file. The format is written down in the README. If the record cannot be written the picture is still saved, because an export that destroys what it was asked for to protect a footnote is worse than a missing footnote.

## OpenRadar v0.6.0

- Snow is drawn as snow. The app painted everything on the rain scale, so a winter storm looked like rain falling hard, and the network has published what is actually falling all along: MRMS PrecipFlag, on the same bucket, every two minutes, in the same packing the other grids already use. The new layer lists its categories by name rather than as a scale, because six is not more than three, it is convection rather than snow. The colours were searched rather than picked: every pair of them stays 17 apart under all three colour-vision simulations, against the 10 the ramps are held to, and none is dark enough to read as a hole in the map. A value the published table does not name is left undrawn, and the legend says the classification is the network's own rather than a report from the ground.

- Model guidance now says when each model last ran, and how far it has moved since. Two models disagreeing is one thing; one of them being twelve hours behind the other is another, and the table could not tell you which. Each model's initialisation time and its age sit above the table, and a model whose reported run is older than its own schedule is marked rather than quietly averaged in with the rest. There is also a switch that puts yesterday's run beside today's on the same valid hours, with the change under each reading. An hour the earlier run had nothing for says so instead of reading as no change.

- You can watch more than one place. Home is still home, and beside it there is room for nine more: a school, a relative's house, the far end of tomorrow's drive. Each carries its own radius, its own severity floor, its own sound and its own quiet hours, because the answer to "wake me for this" is not the same everywhere. One warning covering two of them is announced once and names both, and a place that has already heard about a warning does not hear it again when you add another place. All ten are asked about in a single request rather than ten, and none of it goes anywhere: the list lives in the same settings file as everything else.

- Opening a file that is not a radar volume no longer leaves the panel waiting forever. The NEXRAD library slices past the Archive II header without checking the file is that long, so anything under 24 bytes panicked inside the command rather than returning an error, and a panic there never settles: the panel just sits. The length is checked once now, on the way in to every path, and the file is refused with a sentence saying why. It was found by a new corpus that walks every corrupt byte and every truncation of a volume through the decoder, which is what the Level III reader has had for a while. There is also a golden test now writing down the geometry, the units and the cuts a known volume decodes to, so a library update cannot quietly redraw the map.

- The diagnostics block is a report you can send now rather than a log dump. It carries what is held on disk, which is what half of a radar app's problems turn out to be about: whether the loop on screen came off the cache and how old it was, how many offline packs are installed and how much of the ceiling they take. It counts the recent warnings and errors by area before listing them, and the log is capped at forty lines with the count of what was left out. The redaction contract is written down and tested against the three shapes a Windows profile path actually takes, including a redirected profile root and a roaming one on a share. Your watched place is not in it at all unless you tick the box beside the Copy button, and that box is off again the next time the panel opens. The repository has an issue form that asks for the steps and the block, and the README says exactly what the block does and does not carry.

- The command rail now uses the room a tall window gives it. It was capped at 210 pixels whatever the screen, so on a 1080-pixel window the drawing, range, inspector and cross-section tools sat behind a scrollbar with a third of the rail empty below them. They are all simply on screen now, and the rail still shrinks and scrolls on a short window. A label a third longer than the English also stopped pushing two pixels past the rail's edge.

- The build now ends on a size gate, so the app cannot quietly get heavier a few kilobytes at a time. Each chunk is measured raw and gzipped against a budget written down beside it, and `npm run check` fails when one grows past it. The measurement that set the budgets is worth writing down too: the main chunk is 77 per cent MapLibre GL and React DOM, both of which have to be there before the map can be used, so splitting them out would only put the map behind a second download. Everything optional already loads when it is opened.

- Draw a line between two points and the volume is cut along it, so a storm can be read from the side as well as from above. Every cut the radar made is asked what it holds at each place along the line, and each height goes to the beam that actually passes through it. The bands between tilts stay empty, because a radar looking at 1.5 km and again at 6 km has said nothing about 4 km, and filling that in from the nearest cut would be inventing weather. The panel labels how long the line is, how far up the picture reaches, which cuts contributed and how many the volume holds, the site, the product, the units and when the volume was collected. A line with an end outside the radar's reach is refused rather than drawn half empty. It works on a live site, on a volume from the public archive, and on a file you opened yourself.

- More contrast now reaches the rest of the map. The nine MRMS grids get scales built the same way the single-site ones were: measured under three kinds of colour blindness, held ten apart at their closest neighbours, and climbing steadily in lightness so the reading survives on a bad screen or in sunlight. The shared ladder they used before was readable enough, it just never said which way was more, because its yellow is lighter than the red and the magenta above it. The composite was worse, since it ran on the NWS reflectivity scale that brings 40 and 45 dBZ within 4.9 of each other. The choice travels in the tile address, so a picture drawn one way is never served to somebody who asked for the other, and the bar beside the map is built from whichever scale actually painted what you are looking at. Warning outlines and storm tracks are stroked heavier, with the four warning weights kept apart so a tagged warning still reads as the heavier one. A colour table you loaded yourself is left exactly as you supplied it, and the Upload panel says so rather than quietly changing somebody else's scale.

## OpenRadar v0.5.0

- A map region can now be prepared before the network disappears. Choose its zoom range in Settings, see the final and temporary size estimates, then pause or resume the download as needed. Each tile is checked before it enters a PMTiles archive, and the archive is read back and hashed before the map will use it. Recovered archives must match that stored hash again before serving their first tile. A separate disk ceiling bounds the library, with one write gate stopping simultaneous downloads from spending the same remaining bytes. Cancelling or deleting removes the whole pack, while workspace backups keep only a small reference to it.

- Archive II volumes can now come from a file on the computer with no network connection, or from NOAA's public archive by NEXRAD site and UTC time. Tilt and product controls keep working on the selected volume. Its actual time and source replace the live timeline, while current warnings, reports, satellite pictures, lightning, wind, MRMS grids and storm guidance stay off the historical view. A bad file leaves the picture already on screen alone. Archive searches compare the UTC day on either side of the requested time, so a scan just before midnight is not missed just after it.

- The live provider gate now covers the layer that matters most. NWS watches and warnings have their own contract, checked against the service itself and treated as required, because a schema change there is worth more than a picture going missing. Every other host the app can reach either has a contract or a written reason it does not, and a test fails when a new host arrives with neither.

- Two timers that nobody owned now have an owner. A dismissed message no longer leaves its own dismissal running behind it, one pushed off the end by newer messages goes with its timer, and closing the workspace takes every pending one with it. Opening two saved views quickly now leaves you looking at the second one: the delay before the camera moves meant two flights were in the air at once, and the one that landed second won rather than the one you asked for second.

- The radar layer now reports whether its picture came off the disk and how old it was when it did, which is the first thing worth knowing about a loop that looks wrong. It also carries how long a loop stays fresh, taken from the gap between its own frames, so a stale one says so. And a layer record that does not meet the contract is now reported as malformed in a diagnostics block instead of being written out as though it were sound.

- Asking Windows for more contrast now changes the radar itself, not just the panels around it. The single-site reflectivity and velocity pictures switch to scales built for it, and "built for it" means measured rather than asserted: the app simulates each scale under the three kinds of colour blindness and checks how far apart neighbouring steps stay. The familiar NWS reflectivity scale brings 40 and 45 dBZ within 4.9 of each other for the commonest of them, which is about twice the point at which two colours can be told apart at all. The replacement holds every step at 11 or more and climbs steadily in lightness, so the reading survives even where colour does not. Velocity is worse and more important: green toward and red away land 14 apart, so the one thing the layer exists to say stops being said. Blue against orange holds them 39 apart for the same eyes.

- Every layer you can switch on now says where it came from, not just the seven that had adapters. The MRMS grids, both lightning layers, wind, satellite, storm cells and severe probability all carry a source, a credit, and an answer to whether they are something measured, something a model expects, or something worked out from a measurement. The ones that are worked out say what was done to them, so rotation tracks report accumulated shear rather than passing as an observation. A layer added later cannot arrive without any of that, because a test compares the list of switches against the list of sources and fails when they disagree.

- Walking up the tilts of one radar volume, or switching between reflectivity and velocity, no longer decodes the volume again each time. A volume is turned into a scan once and kept, along with every cut's folding velocity, which used to mean a second pass over the whole file for each cut asked about. A live sweep benefits twice over: the finished volume underneath it was being decoded again every few seconds. Three volumes are held, under a byte ceiling, oldest out first.

- The watched place has quiet hours now. Set a window, pick the severity that still gets through, and ordinary warnings are held back overnight while anything at or above that severity still wakes you. There is also a button that sends one harmless test alert, with the tone if you have it on, because a notification nobody has ever seen work is a notification nobody trusts. Every announcement now records why it fired: the kind of alert, the threshold it cleared, how far away it reached, and whether it was a warning you had already been told about that the office has since escalated.

- Route weather now asks the FOSSGIS public routing service instead of the OSRM demo server. The reason is a rule the old one could not be kept: OSRM asks every request to carry an identifying User-Agent, and a browser will not let a page set that header, so route requests went out anonymous whether they wanted to or not. The new service asks instead for a header a page can send, and says so in its own policy. Routes are still spaced a second apart, and a drive still falls back to a labelled straight-line estimate when the router cannot be reached.

- The asset ledger now accounts for everything the app actually reaches, and a test keeps it that way. Three hosts it had been fetching from without saying so are named, including the German radar composite and both live NEXRAD buckets, a bundled file that stopped existing two releases ago is corrected, and every runtime source now states whether its bytes are kept on disk and what that service learns about you.

- There is now a security policy. It names which versions get fixes, points at GitHub's private reporting so there is no address to publish, says plainly what to expect from a project with one maintainer, and writes down the boundaries that matter: the native host allowlist, the separate webview policy, how remote input and local files are parsed, and how an update is verified before it replaces anything.

- One command now asks every live provider whether it still answers. `npm run check:live` walks the browser and native halves together, spaces the requests out, times each one, and prints whether each source passed, failed, or was skipped, with a JSON form for anything reading it. A source a release depends on is the only thing that can fail the run, a missing toolchain is reported as skipped rather than blamed on the weather services, and it refuses to run on shared build infrastructure.

- Every layer on the map can now say where it came from and what it is claiming: the source, the credit, when it was observed, when it is valid, when it was fetched, how long it stays fresh, whether it came off the disk cache, and which model run produced it. Diagnostics writes the record for each drawn layer into the block you paste into a report, and an exported picture takes its caption from the same record, so a forecast cannot be labelled as something an instrument saw.

## OpenRadar v0.4.0

- The workspace has been rebuilt around the map. A fixed status bar, compact command rail, docked panels, and one shared playback band keep weather data visible while every existing surface stays directly reachable. The layout holds at compact sizes, larger text settings, light mode, and increased contrast.

- GIF encoding now runs in a worker instead of freezing the map while it reduces colours and compresses frames. Shared GIFs use a 960-pixel cap, bounded palette sampling, and chunked byte storage, which cuts the peak memory held for a full loop while keeping the radar scale and burned-in caption readable.

- The release command now runs the frontend, native, and headless browser gates before it builds. It verifies the updater signature against the configured public key, records the exact commit and artifact hashes, refuses a stale skipped build, and creates the version tag from that proved commit when publishing.

- The compact layout keeps Commands visible, including at 130 percent text size. Commands now reaches Storm Cells, ProbSevere, Wind, and radar products, so a control hidden to make the window fit does not make that part of the app unreachable.

- Layer and panel states tell the truth while data is loading or unavailable. Enabled-layer failures appear in Layers, Alerts and Tropical no longer show a false empty result, stale forecast, search, tide, route, and history results are cleared when the question changes, and only a road-router failure offers a straight-line estimate.

- Map tools work from the keyboard at the map centre and report results through a live status region. Reduced-motion preferences now remove camera animation, radar legends scroll inside short windows, alert severity is written as text, and the timeline slider announces the selected timestamp.

- Radar and export controls now preserve what they say they control. Loop export restores the prior frame and playback state even after a failure, Composite Reflectivity leaves single-site mode, a comparison with too little history says so instead of relabelling the first frame, and a guidance comparison cannot be reduced below two models.

- Lightning refreshes share one in-flight native request, and the latest history selection wins if two archive files finish in reverse order. Forecast icons now match the reported weather. Startup, notification actions, and large counts also follow the saved language and locale.

- GIF loops can now be saved by the installed app. Every export is written beside its destination, flushed, and then replaced in one step, so a failed save cannot truncate the last good file. Disk-cache work also runs away from the async workers that carry network replies and desktop commands.

- Workspace backups now include an imported GeoJSON overlay as well as settings. Restoring one moves the map to the saved camera, and Undo puts both the settings and the prior overlay back. Files from newer builds also name unfamiliar nested settings instead of quietly dropping them.

- A colour table is not reported as applied until the desktop renderer accepts it. Empty GeoJSON collections are refused instead of enabling a blank layer and calling the upload successful.

- German radar now works in the installed app, not only in a browser preview. The desktop cache route knew to send DWD tiles through the native side, but that side refused the same host when the request arrived.

- Weather files, byte-range replies, and compressed grids are bounded while they are being read. Truncated or hostile provider data is refused with an error instead of being allowed to panic, overflow, or grow memory until the whole reply has arrived.

- The desktop window no longer receives unused permissions for opening web addresses or changing unrelated store keys. It keeps only the file reveal and settings operations the interface calls.

- Camera moves no longer save an older copy of the rest of the settings a moment later. A theme, layer, or unit changed while the map was settling now remains changed after restart.

- Forecast opens correctly under React's development safeguards. Its first request used to be cancelled and then mistaken for one that had already finished, leaving the panel on its loading line forever.

- Alert monitoring keeps its national damage-threat read alive when the map moves, starts at a new watched place without waiting for the next poll, and falls back to an in-app notice if Windows notifications fail.

- The newest radar refresh wins when two requests overlap. A cached reply from a failed source also stays with that source instead of making a live fallback say it came from the last-view cache.

- Links supplied by remote overlay data are opened only when they are credential-free HTTPS addresses. Removing an imported overlay from its notification now switches the layer off as well as clearing its shapes.

## OpenRadar v0.3.0

- Germany has radar. Europe had none: the American mosaics stop at the coast, the Canadian service is Canada, and everywhere else fell through to a feed licensed for personal use only. The German weather service publishes a composite of its seventeen radars every five minutes, keyless, and that is what a map over Germany now draws, with the colours the service paints it in rather than the American ones. Past fifty decibels it turns blue and then magenta, which is the German convention for hail and not a fault. The service is offered with no availability guarantee, so what was there before is still behind it.

- A loop can be exported as a GIF as well as a video. The video is the better picture, but it will not paste into most chats, and a loop nobody can send is a loop that stays on your own screen. The GIF carries the same burned-in time and credit, takes the last two dozen frames because every one of them is a full picture before it is squeezed, and loops for ever the way a GIF should.

- A first launch says where everything is. There was no onboarding of any kind: the map opened and nothing on screen mentioned that Commands searches every product, place and setting by name, or that Layers is where the rest is switched on. One toast, once, and it is done with as soon as it has been shown.

- The severe probability layer says when it has nothing to show. Switch a layer on, see a blank map, and it looks like a quiet afternoon rather than a layer that could not read anything, which for guidance somebody might act on is the worst thing it could look like. The reason now appears beside the switch. Its freshness check also worked in one direction only, so a file stamped in the future passed forever and a stamp that was not a date at all rolled over into one: the twelfth of January 8034 was being drawn as the current reading. Both are refused now, and a listing that arrives cut short keeps the readings that came before the cut instead of being thrown away whole.

- The alert switches say what is under them. They are grouped by hazard rather than by product name, which is right, but it means a switch holds products whose names look nothing like its own: tsunami warnings, extreme wind and the civil emergencies sit with the tornado warnings because all of them are somebody telling you to move now. The switch was called "Tornado", so a reader in Honolulu could have turned off tsunami warnings while turning off weather that does not happen there. It is called "Take cover now" now, and every switch carries a line listing what it covers.

- A warning already in force when you open the app is announced once, with its damage threat on it. The threat comes from a second feed, and the first draw of a session did not wait for it, so every standing warning was announced without a threat and then announced a second time a minute later when the threat arrived, which read as the office saying it had got worse. The map was wrong about it too, quietly: a catastrophic tornado warning wore the ordinary outline for its first minute. The first draw waits for the threats now, up to three seconds. Nothing after it ever waits.

- Moving the map from one national grid to another loads that grid. Alaska, Hawaii, Guam, the Caribbean and the lower forty-eight are five separate grids, and the map only reloads its frame list when it decides the source has changed. It was not counting which of the five as a change, so panning from Honolulu to Anchorage kept Hawaii's frames and went on asking for Hawaii's tiles over Alaska, which come back empty, for up to five minutes.

- Clicking a warning drawn over a severe-probability polygon opens the warning. It opened the model's guess instead, everywhere the two overlapped, which is over every storm that carries a warning. The map draws guidance under the warnings on purpose; the click was asking a separate list that had drifted from it. There is one list now, so they cannot.

- Velocity unfolding now works on real sweeps. It grouped gates by which slice of the velocity range they fell in, and a real Doppler field is noisy enough that neighbouring gates a fraction of a metre per second apart kept landing on opposite sides of a slice boundary. A live cut came apart into nearly fourteen thousand pieces, most of them a gate or two, and pieces that small have no edge worth reading, so the folds stayed in. Gates are now grouped by whether the step between them could be a fold at all, which is the question the method is actually about. Measured over six sites, roughly half of the folded readings come back to the reading the radar would have made without the fold, against a fifth before, and on two of the six the old grouping put back essentially none. It is not better everywhere: on a quiet site the two are close, and there are afternoons where the old one does slightly more. A fold over a small part of the picture is also fixed now rather than dropped: the old code threw the whole correction away unless half a per cent of the sweep had moved, which meant a fold sitting over one storm survived while everything around it was reported as the radar's own reading.

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
