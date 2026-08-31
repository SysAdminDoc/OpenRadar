# OpenRadar Roadmap

Actionable work only. Completed items are deleted; blocked items live in Roadmap_Blocked.md.

## Research-Driven Additions

### P0

- [ ] P0 — `topmost` answers with the polygon underneath when two hits share a layer id
  Why: it compares stack heights with `>=`, so among equal heights the last hit wins. Every NWS alert is drawn by one fill layer, so a tornado warning inside a flood watch gives two hits at the same height and the watch is the one that opens. The code this replaced took `queryRenderedFeatures(...)[0]`, which was right: MapLibre returns the topmost feature first.
  Evidence: a test over the real `topmost` with two hits on `openradar-overlay-alerts-fill` picks "Flood Watch" while `hits[0]` is "Tornado Warning".
  Touches: src/lib/layerStack.ts, src/lib/layerStack.test.ts
  Acceptance: among hits at the same height the first one wins; a test with two features on one layer fails with `>=` and passes with `>`; the guidance-under-warning cases still hold.

- [ ] P0 — Nothing tests the click handler itself, so the original defect can be put straight back
  Why: `layerStack.test.ts` covers the new module, which did not exist before the fix, so it cannot go red against the old handler. Reinstating guidance-first inside `showOverlayPopup` leaves all 450 tests green, and no e2e touches the popup.
  Evidence: `const hit = hits.find((f) => f.layer.id === PROBSEVERE_FILL_LAYER_ID) ?? hits[0];` reinstated in MapViewport gives 58 files / 450 passed.
  Touches: src/components/MapViewport.tsx, e2e
  Acceptance: a test drives the real handler over overlapping polygons and reports the warning; reinstating guidance-first turns it red.

### P1

- [ ] P1 — `unfold_velocity` rewrites the field and then reports that it did not
  Why: it writes the corrected gates back and then decides what to answer by looking for a reading outside `nyquist * 1.01`. A genuine fold corrected to just inside that slack answers false, so the legend says the picture is the radar's own reading and the narrow ramp is chosen for a field that has been changed. The doc comment still says nothing is written when it answers no.
  Evidence: two flat regions at ±24.8 m/s with nyquist 25 come back at ±25.2, inside the 25.25 slack: "unfold_velocity answered false; 1800 of 3600 gates were rewritten".
  Touches: src-tauri/src/level2.rs
  Acceptance: the answer and the writing agree; a field that was changed never reports itself unchanged; the calm-sweep case that the old share gate existed for is still covered.

- [ ] P1 — A tilt is matched between the two volumes within 0.01 degrees, and real angles move further than that
  Why: `sweep_field_at` demands the angles agree to a hundredth of a degree, but a sweep's angle is the median of its radials' measured elevations and moves by a full VCP quantisation step between volumes. About one tilt in ten silently loses its live sweep and falls back to the archive with no message.
  Evidence: consecutive archive volumes: KTLX 3.08 to 3.12, KJAX 5.05 to 5.10, KOKX 4.04 to 4.00; 8 of 9, 8 of 9 and 14 of 15 cuts matched.
  Touches: src-tauri/src/level2.rs
  Acceptance: a live cut whose angle has drifted a quantisation step is still matched; two cuts a real tilt apart are still not; a test builds the two volumes at different angles rather than the same one.

- [ ] P1 — The live path re-downloads the whole volume every twenty seconds and turns the disk cache over every nine minutes
  Why: `newest_volume(station, None)` costs 43 listings because the `known` fast path is never used, and `assemble` fetches every chunk again on every refresh. About 7,700 listings and 6,300 objects an hour for one site, close to a gigabyte, and roughly 78 new cache entries a refresh against a 2,048-entry budget, which flushes the tiles and grids the offline view depends on.
  Evidence: census of 23,098 KTLX keys: 55 chunks / 7.53 MB a volume, 0.41 MB of listing XML a refresh, 43 LIST requests measured by replaying the walk.
  Touches: src-tauri/src/chunks.rs, src-tauri/src/level2.rs, src-tauri/src/cache.rs
  Acceptance: a refresh of a volume already partly held fetches only the chunks that are new; the folder number is remembered between refreshes so the ring walk is a handful of listings rather than 43; the chunk traffic does not evict the tile cache.

- [ ] P1 — One failed chunk download abandons the whole live volume
  Why: the fetch uses `?`, so a 404 or a timeout on any chunk gives up on the volume, while the comment three lines below says one unreadable chunk out of fifty is a gap in the picture rather than a reason to show nothing. The `continue` only covers a parse failure.
  Evidence: src-tauri/src/chunks.rs:270.
  Touches: src-tauri/src/chunks.rs
  Acceptance: a volume with one chunk that will not download still assembles from the rest; a volume where the start chunk is missing still refuses; a test covers both.

- [ ] P1 — The live legend reads its age off a clock that ticks once a minute
  Why: `sweepEyebrow` is given the minute clock, so every cut collected since the last tick prints "0 S OLD" whatever its real age, and a stalled radar climbs in sixty-second steps. The acceptance for the live view asked for "live, N s old".
  Evidence: a minute of the feature working as designed prints ages [0,0,0,0,0] against real ages [2,2,2,2,2].
  Touches: src/hooks/useClock.ts, src/components/WorkspaceChrome.tsx, src/App.tsx
  Acceptance: the age on screen is within a few seconds of the real one while a live sweep is drawn, and nothing else starts re-rendering every second.

- [ ] P1 — The live unfolding test asserts a share that one real station does not reach
  Why: it demands a quarter of the broken pairs come back, which KDMX and four others manage and KFWS does not (13 per cent). It is hard-coded to KDMX, so it passes only because of which station it asks.
  Evidence: parameterised over five stations on 2026-08-31: KDMX 22457 to 9342 ok, KFWS 3766 to 3270 FAILED, KTLX 7911 to 5072 ok, KAMX 40248 to 18750 ok, KTBW 24114 to 8176 ok.
  Touches: src-tauri/src/level2.rs
  Acceptance: the test states what it measures over more than one station and passes on all of them, or says plainly which claim it is making about which; it must still fail against the grower it replaced.

- [ ] P1 — The claim that unfolding went from four per cent to forty-four does not reproduce
  Why: the figure came from the absolute-recovery measure the same commit discards as wrong. Under the differential measure the two growers are within a few points on most stations, identical on KDMX for folds actually put back, and the old one is better on KTBW.
  Evidence: nine stations, both growers, folds put back new/old: KDMX 27/27, KTLX 42/2, KJAX 16/2, KTBW 60/65, KGRR 74/71, KAMX 22/0, KFWS 16/11, KLOT 56/55, KOKX 83/0.
  Touches: CHANGELOG.md, CLAUDE.md
  Acceptance: what the docs claim is what was measured, including the station where the change is a loss.

- [ ] P1 — `broken_pairs` cannot tell a gate recovered from a gate recovered onto the wrong branch
  Why: it is a differential measure, so a whole region shifted a full interval off scores perfectly. On KJAX it read 84 per cent while only 16 per cent of gates were on the right branch. The `invented == 0` guard only rules out shifts that are not a whole number of intervals.
  Evidence: the nine-station table above, where the two columns disagree by up to 68 points.
  Touches: src-tauri/src/level2.rs
  Acceptance: the live test reports both what the picture looks like and how many gates are actually on the branch they started on, and says which of the two it is asserting.

- [ ] P1 — The fixture declares half-degree radials and writes whole-degree ones
  Why: `fixture.rs` writes an azimuth resolution byte of 1, which means 0.5 degrees, while `flat_cut` and `sector` place radials a degree apart. `swept_pixels` sizes each wedge from the declared spacing, so 29 per cent of the swept sector keeps the previous volume and the sector tests pass against a striped picture. A mutation shrinking the mask to a tenth of a degree survives, because both sample bearings land on a radial.
  Evidence: "inside the swept quarter at 40 km: 497 took the new sweep, 203 kept the old one, of 700 comparable".
  Touches: src-tauri/src/fixture.rs, src-tauri/src/level2.rs
  Acceptance: what the fixture declares is what it writes; the whole swept sector takes the new sweep; shrinking the mask turns a test red.

- [ ] P1 — The fixture cannot say the radar looked and found nothing
  Why: `scaled` clamps to the first real count, so the two reserved counts, below threshold and range folded, are unreachable and no test covers either decode path. The test that says a storm has moved off the picture plants minus thirty dBZ, which is a real reading the ramp happens to draw clear.
  Evidence: "-30 dBZ came back as -30 with status Valid".
  Touches: src-tauri/src/fixture.rs, src-tauri/src/level2.rs
  Acceptance: a fixture gate can be below threshold or range folded and decodes as such; the moved-on test plants a gate the radar reports as nothing.

- [ ] P1 — `wrap(0)` panics
  Why: `((volume - 1) % VOLUMES) + 1` on an unsigned integer. Unreachable today only because the folder number is never fed back, which is exactly the path the type's own documentation describes.
  Evidence: "panicked: attempt to subtract with overflow".
  Touches: src-tauri/src/chunks.rs
  Acceptance: every input including zero returns a folder in the ring; a test covers it.

### P3

- [ ] P3 — Optical-flow radar nowcast for the next 60 minutes on the timeline tail
  Why: free at Windy and paywalled at RainViewer, Zoom Earth and CARROT; LibreWXR and HookEcho both ship Lucas-Kanade extrapolation; OpenRadar has HRRR for hours but nothing for the next hour.
  Evidence: https://github.com/pySTEPS/pysteps ; https://github.com/JoshuaKimsey/LibreWXR (and its #24 on blending erasing precipitation); https://community.windy.com/topic/31772 ; https://www.rainviewer.com/premium-features.html
  Touches: src-tauri/src/nowcast.rs (dense flow on consecutive MRMS composites, semi-Lagrangian advection), src/lib/providers/mrms.ts frame list, src/hooks/useRadarTimeline.ts (a "nowcast" segment before HRRR), timeline copy
  Acceptance: six 10-minute extrapolated frames follow the last observation and are drawn with a dotted timeline segment labelled as extrapolation; a Rust test advects a translating blob by the expected distance; pure extrapolation only, no model blend.
  Complexity: L

- [ ] P3 — Cross-section (RHI) between two clicked points from the Level II volume
  Why: the cheap half of the 3D ask; BowEcho draws it from two clicks and GR2Analyst charges for it.
  Evidence: https://github.com/FahrenheitResearch/bowecho ; http://www.grlevelx.com/gr2analyst_3/
  Touches: src-tauri/src/level2.rs (all tilts already decoded; sample along the segment), a new panel, MapViewport.tsx draw tool reuse
  Acceptance: choosing two points inside the site range shows a height-versus-distance image of reflectivity or dealiased velocity with beam heights labelled; a Rust test slices a synthetic volume.
  Complexity: L

- [ ] P3 — German composite radar from the DWD GeoServer where GeoMet and MRMS stop
  Why: RadarScope 4.0 added 17 German radars and LibreWXR serves the DWD composite; it is the one keyless European feed with a WMS view service.
  Evidence: https://www.dwd.de/EN/ourservices/geoservices/geodienste.html (`https://maps.dwd.de/geoserver/wms`, no availability guarantee); https://opendata.dwd.de/weather/radar/ ; https://www.dtn.com/radarscope-4-0/
  Touches: src/lib/providers/dwd.ts (WMS adapter like geomet.ts), providers/index.ts chain, http.rs and CSP hosts, credits
  Acceptance: a viewport over Germany draws the DWD composite with its own rain-rate legend and credit line; a unit test parses the capabilities time dimension; RainViewer no longer appears there.
  Complexity: M

- [ ] P3 — GIF export beside WebM
  Why: the most-reacted export ask on Supercell Wx (#414) and what RadarOmega advertises; WebM will not paste into most chats.
  Evidence: https://github.com/dpaulat/supercell-wx/issues/414 ; https://www.radaromega.com/
  Touches: src/lib/export.ts, src/panels/ExportPanel.tsx, src/i18n
  Acceptance: Export offers GIF with a frame cap of 24 and the same burned-in credits; the file opens in Windows Photos; `export.test.ts` covers the palette quantisation.
  Complexity: M
