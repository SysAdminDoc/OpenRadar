# Research: OpenRadar

Date: 2026-09-07. Replaces all prior research. Repository snapshot: `eb4b1e5` on `main`, manifests at v0.11.0, `CHANGELOG.md` carrying an unreleased `v0.11.0` section, published release still v0.4.0 (2026-08-31). Eighth pass; the seventh ran on 2026-09-04 at `75e44f7`. Sixty-five commits landed between the two, shipping v0.10.0, the 2026-09-05 audit repairs `AUD-318` to `AUD-331`, the unfolded and per-zoom MRMS grids, the day and night terminator, the map key, and the live-sweep projection from the radar's own coverage pattern. The working tree at the time of this pass also carried the uncommitted `AUD-332` batch (three swallowed rejections caught at their source, a fixture stub for the Tauri event plugin, a spec-level gate).

## Executive Summary

OpenRadar remains the most complete keyless desktop radar workstation in the open-source field, and the only one that decodes MRMS, Level II, Level III, GLM and the model fields itself with no server in the loop. The competitor that matters most is HookEcho, which merged 26 commits in the seven days to 2026-09-07, ships a Windows MSI and a portable zip, and now leads on spoken warnings with a priority queue, per-layer freshness on every row, an alert-rule backtest over a replayed day, and a frame-time brake with hysteresis. Nothing found this pass changes the direction, which is a local-first incident workstation that explains its evidence. What this pass found first is that three of the twenty-six live contracts are red for reasons inside the tests, that an advisory the blocked list says cannot be cleared can be, and that the single-site sweep has the same pixellation defect the national grids had until 2026-09-05.

Top opportunities, in order:

1. **Two live contracts are red and both are wrong about the world, not the code.** The GFS cross-check compares the app's 0.25 degree grid point over the water off Sydney with the land cell Open-Meteo prefers by default (11.8 against 7.8 m/s; the sea cell reads 12.0). The tide contract demands at least eight extremes in three days from a station NOAA lists as diurnal, which published two on 2026-09-07. Verified live, `AUD-335`, `AUD-336`.
2. **The `lru` advisory stays where the blocked list put it, with two updates.** `lru` 0.18.4 shipped on 2026-09-03 (the fix landed in 0.18.2), and roteiro-gis/netcdf-rust still has no issue or pull request asking `hdf5-reader` off `lru ^0.16.3`. The blocked note's own analysis holds: the unsoundness is unreachable through the three caches' key and value types, a fork of a ten-thousand-line HDF5 decoder is the wrong trade for it, and filing upstream is a person's act. Verified.
3. **The `.orb` reader is the one untrusted-file decoder without a fuzz target.** `bundles::read_bundle(&[u8])` is a pure function; the header injection fixed on 2026-09-05 was found by reading, not by fuzzing. Verified, `AUD-338`.
4. **The single-site sweep is a 1,024 pixel picture over a 460 km disc**, 449 m per pixel against 250 m gates, stretched by one image source. At zoom 12 a raster pixel is about fifteen screen pixels. The national grids had exactly this defect until `a9407d4`. Verified, `AUD-339`.
5. **An installed copy never learns about an update unless somebody presses the button.** The design refuses downloads on its own, rightly; a daily check that only says so is a different thing, and the West Palm Beach radar was dark for 33 days in every installed copy. Verified, `AUD-341`.
6. **Eight files hand-roll the same "ignore an older reply" guard**, and the 2026-09-05 refutation found two of them missing. One helper with a test, and a scan for the pattern. Verified, `AUD-342`.
7. **MapLibre 6.7.0 can colour a value-encoded raster on the GPU** through the `color-relief` layer over a `raster-dem` source with a custom encoding; MapLibre has no `raster-color` and the request for one has been open since 2024-07-31. Today every palette load, threshold and contrast toggle re-renders and re-fetches every MRMS tile. Verified, `AUD-340`.
8. **Trust surfaces HookEcho shipped this week and the app lacks**: fresh, fetching, stale, failed and an age on every layer row (#306, merged 2026-09-05), and a backtest that replays a day through the alert rules (v0.12.0-beta.2). The app has the status and the replay; neither is joined to the rows or the rules. Verified, `AUD-344`, `AUD-345`.
9. **Dates that matter**: PNS26-62 and PNS26-63 comments close 2026-09-21; the Probabilistic Precipitation Portal replaces PWPF on 2026-10-01; RRFS and REFS go operational 2026-10-06 and land on NOMADS only, with NAM, SREF, HREF and HiresW retired the same day; WSR-88D Build 25.0 adds the LTR message to Level II on or about 2027-02-15. SCN26-67 (Level II off NOMADS on 2026-09-15) does not touch the app, which reads the Unidata buckets. Verified.
10. **The fold-cost live gate is an absolute three-second wall clock.** It tripped at 3.38 s with six research processes on the machine and passed at 316 ms alone an hour later. A gate that reports the machine's load rather than the decoder's cost is a gate the next audit has to triage. Verified, `AUD-343`.

## Product Map

- Core workflows: watch live radar over a place with a two-hour national loop and a nearest-site Level II view looping across up to thirty volumes, with the office's own word on whether each radar is running and the next one offered when a held site stops; interrogate a storm (tilts, six moments, dealiased and storm-relative velocity, smoothing, a wind profile read from the radar's own NVW product first, cross-sections, gate readout, beam height, cell tracks, hydrometeor class, ProbSevere, MRMS grids across five domains including rotation, shear, hail, lightning, FLASH, gauge-corrected rain and a chosen height of the 3D reflectivity, drawn unfolded and per zoom); understand the day (the whole SPC outlook set, WPC rain and winter outlooks, mesoscale discussions, warnings from three countries filtered by hazard, reports from two sources, rivers, tides, surge, a key for every banded layer, day and night at the frame's own time); replay a past event with that day's warnings, outlook and reports, or from a `.orb` bundle offline; be told (ten watched places with arrival, lightning age and distance, warning radius, quiet hours, calm mode, and a line saying when Windows refuses notifications); leave it running (tray, autostart, glance, wallpaper, a full-screen view that keeps the screen on and leaves on Escape); take it away (PNG, WebM, MP4, GIF, CSV, GeoTIFF with a provenance sidecar, incident packs).
- Personas: the subscription-refusing enthusiast, the chaser with palettes and placefiles, the anxious monitor, the second-monitor ambient reader, the flood-prone reader, the winter-weather reader, the streamer, the screen-reader user.
- Platform and distribution: Windows x64 only, NSIS current-user installer, minisign-signed updater, no Authenticode; ARM64 blocked on a C compiler this account cannot install. Release gate in `scripts/release.mjs`; the live contracts (`npm run check:live`) are a documented check but not part of that gate.
- Data flow: every native request through `src-tauri/src/http.rs` (31 hosts); page CSP for the browser-side fetches; 26 live contracts in `scripts/live-contracts-lib.mjs`; overlay adapters in `src/lib/overlays/registry.ts` (13); MRMS products in `src-tauri/src/mrms.rs` over the `CONUS`, `ALASKA`, `HAWAII`, `GUAM` and `CARIB` domains; six fuzz targets under `src-tauri/fuzz/fuzz_targets`.

## Competitive Landscape

### Open source

- **HookEcho, and StormDesk beside it** (d4vid87, Rust wgpu, MIT, 57 stars, pushed 2026-09-07). Twenty-six commits in the window. #298 spoken warnings with the tone before the words and county, towns in path, bearing and distance from a saved place (merged 2026-09-04); #302 emergencies pre-empt the speech queue (2026-09-05); #304 a motion brake that engages after 30 frames over 33 ms, caps playback at 8 fps and wind repaints at 10, shows a "Visual quality reduced" chip, and recovers only after 300 frames under 28 ms (2026-09-05); #306 fresh, fetching, stale, failed and waiting with an age on every network layer row, a popover with attempts and the last error, and stale imagery kept on screen marked degraded (2026-09-05). v0.12.0-beta.2 (2026-08-31) added native DWD decoding with dual-pol, OPERA through a WMS bridge, ECCC GeoMet, MeteoAlarm ranked on its own scale, maximum-spanning-tree dealiasing, local cell tracking with 15 and 30 minute extrapolation, Level III digital base velocity, headless rendering, MQTT with Home Assistant discovery, offline chase packs, and "alert-rule backtests run in the browser". Ships an MSI and a portable zip for Windows. StormDesk v4.1.0 (2026-09-07) adds a Health Center of self-checks with a secret-free support report and a single-file `.wdbak` backup. Learn: the backtest (`AUD-344`), the per-row freshness (`AUD-345`), the pre-empting queue (`AUD-270`). Avoid: the always-on voice, the headless server, MQTT, the Drive sync, and OPERA through a bridge somebody else hosts. Verified.
- **Anvil** (jhammon88219, C# WinUI 3, AGPL). `0f5972d` (2026-09-04) measured renderer memory instead of estimating it: the ceiling is a per-renderer V8 heap cap of about 4,192 MB unrelated to machine RAM, a fully built 26-frame replay retains 2,178 MB, a 39-frame loop 3,427 MB; on that evidence the dual-pol prefetch is capped at 12 frames and inspector grids are built only for the products a pane shows, taking the 39-frame peak to 2,042 MB. A theme system that owns the chrome and the basemap but never the data ramps landed 2026-09-06 and 09-07, with a debug-only style editor that exports by position so the shipped style stays diffable. Learn: the sampler is the shape of `AUD-166`'s answer. Avoid: nothing to reuse under AGPL. Verified.
- **FX-Net-NextGen** (Cuevman81, MapLibre, MIT). `7eed8f1` (2026-09-04): the national mosaic moved to NCEP's `conus_bref_qcd` with MRMS's own time dimension for loops under two hours, and Level II super-resolution CC and ZDR are fetched by HTTP range, "only as far as the wanted surveillance cut (0.5° = first ~1.4 MB of ~9 MB)", 1.6 to 1.9 s for the lowest cut, the cut chosen by median radial elevation because first-radial headers are written while the antenna settles. Learn: the first-cut range read (`AUD-347`). Verified.
- **Supercell Wx** (dpaulat). No commits since 2026-09-01 and no release since v0.6.1 (2026-07-19); the renderer is mid Vulkan rewrite (#650, draft). The open asks are the market's wishlist: #691 free layer order, #689 hail, mesocyclone and TVS icon overlays from Level III, #685 SPS as a layer, #675 settings export writing empty files, #647 no window at all on Windows 11 25H2 with OpenFreeMap, #617 sound only on a real upgrade rather than every polygon update, #480 a reflectivity gate filter and filled placefile polygons, #435 manual storm motion, dealiasing, city search, tooltips clipping the window. The app already has the storm motion vector (`settings.ts:168`), dealiasing, the threshold, city search, and hides current warnings on a replay. Verified.
- **pi-weather-station "Sweep"** (Aryeh95, MIT): 2.6.0 (2026-09-06) adds a third noise-filter state that reads NWS's own hydrometeor classifier as a mask, holds the last clean frame rather than flashing bloom, and stops the legend claiming a mask that did not run. Learn: the legend honesty and the mask (`AUD-348`). Verified.
- **New this pass**, all Verified from the repository unless marked. **wxaccess** (w9fyi, Swift, VoiceOver-first): click-to-probe read aloud, the canvas hidden from the screen reader, and sonification of radar values along a bearing; feeds `AUD-229`. **omastorm** (wesleygrimes, MIT, created 2026-09-04): draws missing, range-folded and below-threshold gates distinctly from measured ones, pins its engine binary by sha256. **nexrad-aws-notifier** (USA-RedDragon, MIT): the NEXRAD SNS topics over a websocket, push instead of polling; a long-lived socket, rejected below. **ZWeather** (GPL-3.0): the closest stack twin (Tauri 2, React 19, Rust, no account, no telemetry) with five languages and three platforms. **aether**: forecast receipts scored against observations, a storm ledger. **gribtract** (Apache-2.0): a pure-Rust GRIB2 decoder verified field by field against eccodes and wgrib2 over a corpus of real NOAA products, a conformance oracle worth borrowing for `mrms.rs`, `gfs.rs` and `hrrr.rs`. **mapbox-exif-layer**: GeoTIFF drawn directly on MapLibre; the app exports GeoTIFF and cannot read one. **LibreWXR** merged a storm-cell REST endpoint on 2026-09-03 (#31). **weather-mcp** 1.28.0 (2026-09-05) puts a life-threatening alert banner before the forecast body. **joshua-tee/wX returns 404** as of 2026-09-07; only the ELY M. fork survives (pushed 2026-08-27), and it is still AlternativeTo's top RadarScope alternative. Quiet since 2026-09-01: ClassicRadar, nexrad-workbench, danielway/nexrad, level2-browser, stormscape, dras, RadrView, backscatter, OpenStorm, azimuth, BowEcho, GenericRadar.
- Table stakes across the field (three or more projects): keyless Level II and Level III from the buckets; an explicit age or staleness on screen; dealiasing; near-real-time from the chunk bucket; GRLevelX placefiles; SPC outlook with reports over it; cell tracking; loop export without external tooling; themes that hold the data ramps out. The app has all nine. Striking once: sonification (wxaccess), the first-cut range read (FX-Net), the measured memory ceiling (Anvil), the speech queue with pre-emption (HookEcho), the classifier as a mask (Sweep).

### Commercial

- **RadarScope** 5.6.2 (about 2026-09-03) fixed a crash on rainfall accumulation products; nothing since. Windows base price is $29.99 against $9.99 on iOS. Tier 2 ($99.99 a year) still sells 30-year Level II and 6-year Level III archives that are the public `unidata-nexrad-level2` bucket, RTMA, 50-frame loops and device sync. Verified (App Store, Microsoft Store).
- **GRLevel3 3.0** is the shipping product at $79.95 (2.97 support ended 2025-10-04); **GR2Analyst 3.3.0.x** at $250. The stale FAQ everyone cites still says 3.0.0.1. Likely (grlevelx.com root 403s; forum read).
- **RadarOmega** 5.8.0, 3.5 of 5 on 901 ratings: lag on 3D, "one second you're looking at the radar and the next you're looking at a black screen", duplicate misaligned county lines, double-charging on first subscription. Verified. **Windy** premium user in Rio Grande do Sul: months of radar showing nothing during heavy rain while satellite showed the cloud, coverage "keeps changing location"; the moderator gave a geometry explanation and no fix. Verified. **Storm Radar** 4.0.19 (2026-08-30) added CarPlay and a 72-hour global radar. **WSV3** V7.11 at $25 a month; Tactical V1 now 2027. **WeatherWise** Pro $159.99 a year. **WeatherFront**, **CARROT**, **MyRadar**, **Baron**, **Weather Radar Pro** unchanged. Verified or Likely per Sources.
- What the paid tier buys that this app lacks, once the wrong entries are removed: archive depth as a browser (the app already reads the bucket by site and time; the wedge is discoverability), 250-frame loops, a model field viewer (carried, after `AUD-218`), 3D, the RapidSweep one-minute sub-volume, aviation charts (`AUD-194`), chaser feeds.
- **Willingness to pay, and resentment at paying**: "I just paid $10 to get the pro tier of the radar app that shows lightning" (2026-09-04); "got tired of paying MyRadar extra just to track hurricanes because I found out all the data was public" (Hacker News, 2026-08-28); Unstar's 2026 ranking puts subscription creep at 19 per cent of weather-app complaints and notification spam at 12. Verified.

### Community signal

- **Feed loss is still the complaint of the season.** RadarScope and RadarOmega both lost their feed on 2026-09-03; five WSR-88Ds were down at once in July 2026 (KAKQ, KIWX, KVWX, KFCX, KILX) and KFTG for about seven days from 2026-08-25. The app's held-site fallback shipped in v0.10.0; what is still missing is the per-row freshness (`AUD-345`). Verified.
- **Overlay density**: "I can't see the rain levels for some of those areas because of all the lightning strike symbols" (Bluesky, 2026-08-27). The flash layer draws circles at a constant radius (`MapViewport.tsx:1255`). Verified, `AUD-354`.
- **Colour tables are the community's currency**: 151 of the 225 mods on grlevelxusers are colour tables, and Patrick Marsh asked publicly for better MESH palettes on 2026-09-06. The app loads GRLevelX tables and cannot write one. Verified, `AUD-337`.
- **Always-on displays**: a 24/7 in-house weather channel from one FFmpeg command (Hacker News 49512373, 2026-08-31); the Home Assistant card thread's standing ask for auto full-screen during active weather. Verified.
- **The IEM maintainer on 2026-09-01**: CAP is now emitted beside the text product rather than downstream of it, measured 14 s behind on an FSD severe warning; "the other major shoe just dropped, retirement of noaaport next year"; a per-UTC-hour CAP archive at `mtarchive.geol.iastate.edu` for replay fixtures. A malformed product crashed some LDMs on 2026-09-05. Verified.
- Reddit, Stormtrack and wxforum were unreachable from this machine by every route (403, 429, a JavaScript wall); `public.api.bsky.app` returns 403 while `api.bsky.app` answers and rate-limits after about five queries.

### Adjacent

- **QGIS 3.44 Temporal Controller**: a "source timestamps" step that walks the actual frame times, a cumulative range where the start is pinned and the end advances, per-layer temporal flags; the reference for accumulating flashes or reports across an event in a replay. **OBS projectors**: a full-screen projector on a named display, saved on exit and reopened next launch; **Sunshine** persists a monitor by device id because indices reorder; feeds `AUD-351`. **PowerToys**: settings backed up before every update and restored on detected corruption, a bug-report package with progress and a prefilled issue; feeds `AUD-353`, `AUD-357`. **Windows app notifications**: `scenario="urgent"` is the only Do Not Disturb breakthrough and the user grants it; a toast's timestamp can be the observation time; tag plus group plus a sequence updates a live warning in place; `Expiration` clears it when the polygon lapses; elevated apps cannot post at all; Microsoft now recommends `AppNotificationManager` for unpackaged Win32. All of that needs a screen to prove, so it stays with the blocked rich-toast item, with the evidence updated. **Breezy Weather** 6.2.2 re-notifies when an alert's priority changes rather than deduping it; the app already keys re-announcement on severity (`useAlertWatch.ts:106`). **Earth Networks** draws a range ring green when clear and red-filled when under alert; the app has the quiet notice and no ring state. **KB5120998** (2026-08-27) lets the taskbar sit on any edge; nothing here hard-codes a corner. Verified.
- **Windows Widgets Board** still admits packaged apps only (doc 2026-08-19); rejected below. **Grafana kiosk** disables background throttling so refresh timers survive an unfocused window; the app already measures its frame budget only while visible (`useAmbient.ts`).

### Techniques and literature

- **Deterministic products a viewer can ship, each with the paper behind it**: Mahalik et al. 2019 for AzShear and DivShear (kernels of 2,500 by 750 m and 750 by 1,500 m, a 3 by 3 median prefilter, a 51-radial cap, every off-diagonal term kept); Snyder and Ryzhkov 2015 with the WDTD warning guidance for a debris flag (reflectivity over 30 dBZ, correlation under 0.85 to 0.90, differential reflectivity near zero, a collocated couplet, AzShear dilated by its 95th percentile over 4 radials by 8 gates); Murillo and Homeyer 2019 for MESH refit on 5,897 reports; VIL density as VIL over the 18 dBZ echo top; Lemon 1998 for the three-body scatter spike; the WDTD dual-pol quality-control thresholds (`AUD-348`); the Central Region four-panel flash-flood method with its published thresholds (`AUD-350`); the AWIPS snow-squall colour tables (`AUD-349`). NROT has no published algorithm. Range folding cannot be undone by a viewer, since MPDA and SZ-2 are the radar's own job, so the distinct colour the app already draws is the honest answer. Verified (read) or Likely per Sources; the specifics are noted on `AUD-189` and `AUD-190`.
- **Rendering**: MapLibre has no `raster-color` (#4479, open since 2024-07-31) and does have `color-relief` over a custom-encoded `raster-dem` (`AUD-340`). WebGL2 float textures are not filterable without `OES_texture_float_linear`, and `texelFetch` is how a shader reads the number that is in the file. Tauri's own discussion #11915 measured 10 MB over IPC at about 200 ms on Windows, which is the reason tiles go through custom protocols here and should keep doing so. `gribtract` verifies a Rust GRIB2 decoder field by field against eccodes and wgrib2 over real NOAA products, a conformance oracle `mrms.rs`, `gfs.rs` and `hrrr.rs` could borrow. Verified.
- **NWS and NSSL in 2026**: MRMS v12.3 (2025-08-05) moved ProbSevere to v3 and let MPDA improve rotation tracks; LightningCast v2 adds MRMS reflectivity at minus 10 C as a predictor; the March 2026 technical report on the 2023 and 2024 Hazardous Weather Testbed experiments covers PHI plumes and the WoFS viewer; WoFS is in a 2025 to 2026 demonstration; NSSL notes that stratiform lightning breaks the 30-30 rule; Environment Canada relaunched its thunderstorm and tornado warnings on 2026-08-12 to fight alert fatigue; the AMS First Symposium on Weather Radar met in January 2026 and NWA meets in Omaha on 2026-10-17. Verified or Likely per Sources.
- **Accessibility and display**: Sherman et al. 2024 built perceptually uniform, colour-vision-tested radar ramps, shipped as `cmweather`; WCAG 2.2 adds 2.5.7 (a non-drag alternative for every drag), 2.5.8 (24 px targets) and 2.4.11 (focus not obscured), and the Maps4HTML manual audit is the checklist axe cannot be; the glanceable-display rule is a glyph subtending about nineteen arcminutes from the furthest viewer (`AUD-352`); sonified weather maps have been evaluated with blind users (`AUD-229`). Verified or Likely per Sources.

## Reported Issues

The tracker holds zero issues, zero pull requests and no discussions (`gh`, 2026-09-07). The effective tracker is the live contracts, the refutation passes on the drain's own work (nineteen commits since 2026-08-25 titled "what a refutation found"), and the asks on competitors' trackers.

Live contracts, run 2026-09-07 at 14:21 local: 22 passed, 3 failed, 1 skipped.

- `gfs::tests::agrees_with_a_second_reading_of_the_same_model` (`src-tauri/src/gfs.rs:760-822`) failed on "Sydney: this decode says 11.8 m/s and Open-Meteo says 7.8". Open-Meteo answers `gfs_global` for -33.9, 151.2 from a cell at -33.914734, 151.17188 (not the 0.25 degree grid), with `cell_selection` defaulting to `land`, which "finds a suitable grid-cell on land with similar elevation"; the `sea` cell reads 12.01 m/s and `gfs025` returns null at the analysis hour. The app's nearest 0.25 degree point, -34.0, 151.25, is over the water. Des Moines and London passed. The test compares two different places. Verified live.
- `tides` (`src/lib/tides.test.ts:170-207`) failed `expect(reading.extremes.length).toBeGreaterThanOrEqual(8)` under a comment saying "roughly two of each a day". `nearestStation` picks 8761927 New Canal Station on Lake Pontchartrain, which NOAA's metadata API lists as `tideType: "Diurnal"` and which published two extremes for the 72 hours from 2026-09-07. NOAA's own tutorial: "Some areas, such as the Gulf of Mexico, have only one high and one low tide each day." Verified live.
- `mrms::tests::a_finer_grid_is_folded_and_costs_what_a_coarse_one_does` (`src-tauri/src/mrms.rs:3327-3440`) panicked on "az-shear-low took 3.3796143s to decode" against an absolute three-second budget, with six research processes running on the machine. Re-run alone at 9 per cent CPU: az-shear-low decoded in 316 ms and az-shear-mid in 314 ms, tiles in 4 ms, test green. The decoder is fine; the gate measures load. Verified live.

Seams found in this pass, with the code:

- `src-tauri/src/level2/mod.rs:50` `IMAGE_SIZE: usize = 1024` and `:52` `MAX_RANGE_KM: f64 = 230.0`; `render_sweep` (`render.rs:23-70`) samples the polar field once into that raster; `MapViewport.tsx:1693` places it as a single `image` source. 449 m per pixel, stretched at every zoom. Verified.
- `src/hooks/useUpdates.ts:22-26`: "Nothing happens on its own"; `checkForUpdate` runs only from the button. Verified.
- `let alive = true` guards hand-rolled in `useAmbient.ts`, `useDisplayAwake.ts`, `useExport.ts`, `useSettings.ts`, `useWelcomeHint.ts`, `useWorkspaceActions.ts`, `JournalSection.tsx`, `SettingsPanel.tsx`, with 38 matches for the wider pattern; the 2026-09-05 refutation found `IncidentPackManager.tsx` and `SettingsPanel.tsx` missing theirs. Verified.
- `src-tauri/src/bundles.rs:468` `read_bundle(bytes: &[u8])` with no fuzz target; `src-tauri/fuzz/fuzz_targets` holds `grib_complex`, `grib_message`, `level2_volume`, `level3_message`, `mrms_grib`, `netcdf_flashes`. Verified.
- `src/panels/LayersPanel.tsx` carries no fresh, stale or failed state on any row; `src/hooks/useOverlays.ts` knows it per adapter. Verified.
- `src/components/MapViewport.tsx:1255` `"circle-radius": 3 * heavier` for flashes at every zoom. Verified.
- `src/lib/palette.ts` parses GRLevelX tables; nothing writes one. Verified.
- `src-tauri/src/exports.rs` writes no text chunk; the provenance is a sidecar the README says is "named after" the picture, which is the file that gets separated from it. `png` 0.18.1 exposes `add_text_chunk`, `add_ztxt_chunk`, `add_itxt_chunk`. Verified.
- No `availableMonitors` or `currentMonitor` anywhere in `src` or `src-tauri`; the full-screen view takes whichever monitor the window is on. Verified.
- `src/lib/settings.ts:2033,2104` parse the store and fall to defaults; no earlier copy is kept. Verified.
- Clean: `Excessive Heat Warning` (gone from `api.weather.gov/alerts/types`, now 127 types) appears only in a hazard-family description; the MRMS domains already cover `ALASKA`, `HAWAII`, `GUAM` and `CARIB` (`mrms.rs:2070`); the storm-motion vector, the threshold, dealiasing, city search and hidden current warnings on a replay already answer Supercell Wx #435 and #480; the unknown Level II message type is skipped and tested (`level2/decode_tests.rs:349`), which is what SCN26-54 needs.
- Adjacent-tracker asks still unmet here: Supercell Wx #480 filled placefile polygons (the reader emits `Polygon` geometry, `placefile.ts:256`; whether the map fills it is unverified), #617 sound only on a real upgrade (the app keys on severity; whether a geometry-only update stays silent is unverified), #691 free layer order (rejected for warnings).

## Security, Privacy, and Reliability

- **Dependency state, 2026-09-07.** `npm audit`: 0 with and without dev. `npm outdated`: `@playwright/test` 1.62.1 → 1.63.0 (2026-09-04), `@types/node` 26.5.0, `eslint` 10.10.0 (2026-09-04), `lucide-react` 1.42.0, `typescript` held at 5.8.3 while `latest` is 7.0.2. `cargo audit` 0.22.2: 0 vulnerabilities, 3 warnings (`unic-ucd-ident` and `unic-ucd-version` unmaintained, `lru 0.16.4` unsound), 17 allowed. Verified.
- **`lru`, unchanged in substance.** RUSTSEC-2026-0253 carries `patched = [">= 0.18.2"]` (lru-rs #238); 0.18.4 shipped 2026-09-03. `hdf5-reader 0.9.1` requires `lru ^0.16.3`; `netcdf-reader 0.9.1` requires `hdf5-reader ^0.9.1`; roteiro-gis/netcdf-rust has no open issue or pull request for the bump. `Roadmap_Blocked.md` already weighed the three routes (ask upstream, carry a fork, a dated ignore) and its reasoning stands; the only thing that has moved is the date. Verified.
- **TypeScript 7.0** (2026-07-08, 7.0.2 on 2026-08-20) is the Go compiler: no programmatic API until 7.1, `types: []` by default, `strict` forced, `baseUrl` and `moduleResolution: node` removed. `typescript-eslint` 8.70.0 declares `typescript >=4.8.4 <6.1.0`. Stay on 5.8, or 5.9.3 as a cheap step. Verified.
- **New advisories 2026-09-01 to 09-07**: RUSTSEC-2026-0273 to 0281 (manzana, rtrb, azure_core, apimock, zbus_polkit, rojo, greentic-setup); none in the tree. No Tauri advisory since GHSA-7gmj-67g7-phm9 (2026-05-06). Verified.
- **Chromium 152.0.7977.82 (2026-09-03)** fixed CVE-2026-85042 to 85053, with the V8 type confusion (85046) exploited in the wild and an out-of-bounds write in WebGL (85050). **WebView2 stable is 152.0.4191.53 (2026-08-28)**; 153.0.4234.6 is preview only, and 153 stable had not shipped by 2026-09-07 though the two-week cadence starts with it. Which Chromium build the shipped WebView2 carries needs live validation on a machine. Verified (versions), Needs live validation (the fix).
- **WebView2 152 regressions filed since 2026-09-04**: #5696 CSS inheritance on `app-region: drag` (the app uses native decorations, so not affected); **#5695 composition hosting loses mouse and keyboard after repeated off-screen drags**, which is the mode Tauri's pending `noRedirectionBitmap` would put the app in. Do not adopt it on first availability. Verified.
- **Tauri 2.12 is still unreleased** with about sixty pending change files, now including `fix-unlisten-guard-missing-entry` (merged 2026-09-07) and `fix-js-listeners-leak-on-webview-close`, both in the family of the `unlisten` rejection the `AUD-332` batch stubs in the browser fixture; `msrv-1.90` will raise the floor from the tree's `rust-version = 1.85` while stable is 1.98.1 (2026-09-03). Verified.
- **MapLibre 6.7.0** (2026-09-02) is current; `main` carries unreleased fixes for HTTP 204 tiles and a render throw that froze the map. The custom protocol path already serves tiles as bytes; Tauri's own discussion #11915 measured 10 MB over IPC at about 200 ms on Windows, the reason to keep it that way. Verified.
- **Service changes.** SCN26-67 (2026-07-17): Level II leaves `nomads.ncep.noaa.gov` for `tgftp.nws.noaa.gov` on 2026-09-15 at 1200 UTC; the app reads `unidata-nexrad-level2` and its chunks, so no path changes. SCN26-54 (2026-06-11): Build 25.0 adds the hourly LTR message to Level II on or about 2027-02-15; the decoder skips unknown types and a test says so. PNS26-63 (2026-09-01): NOAAPort and the satellite NWWS retire as early as 2027-08-31, which is IEM's upstream for the archive warnings the replay reads; comments to 2026-09-21. SCN26-48 updated 2026-08-24: RRFS and REFS operational 2026-10-06, on NOMADS only (`noaa-rrfs-bdp-pds` does not exist); NAM, SREF, HREF and HiresW retire the same day; HRRR survives as two REFS members. PNS26-64 and SCN26-75: PWPF and PQPF move to the Probabilistic Precipitation Portal on 2026-10-01; the app never read either. PNS26-65: the SIGWX low-level chart retires about 2026-12-15; not read here. NEXRAD Build 24.1 at 150 of 159 sites. `api.weather.gov/alerts/types` now lists 127 types. Verified.
- **Buckets, probed anonymously 2026-09-07.** `noaa-goes19` GLM at a 20 s cadence and 17 to 25 s delivery; the AWS registry page for `noaa-goes` still calls GOES-19 non-operational and is wrong. `noaa-himawari9` carries imagery and no lightning. `noaa-mrms-pds` top level is `ALASKA CARIB CONUS CONUS_5KM ConvectProb GUAM HAWAII ProbSevere unsupported`; `CONUS_5KM` holds only the composite and the lowest-altitude reflectivity; `ProbSevere` declares `"product": "ProbSevere 3.0"` with 29 per-cell fields including `MESH`, `VIL`, `FLASH_RATE`, `MAXLLAZ` and `EchoTop_50`. `unidata-nexrad-level3` is a flat key space with three-letter site codes, about 25 to 30 s behind the scan. HRRR and GFS current with `.idx` sidecars. GOES GRB delivery anomalies on 2026-09-03 and 09-05 are gaps in any replay of those hours. IEM lost 2026-09-05 13:00 to 14:50 CDT to an unrepairable archive hole. `mrms.agron.iastate.edu` is cutting its hourly MRMS zips to a 30-day rolling archive; the app does not read it. Verified.
- **MeteoAlarm** deprecated its legacy RSS feeds on 2026-01-14 in favour of `meteoalarm-legacy-atom-<country>`; `AUD-227` should target the Atom feeds. OGC API EDR is at 1.1.0 with no 1.2. Verified.
- **Privacy posture holds**: nothing proposed adds a socket, an account or telemetry. The daily update check (`AUD-341`) asks the same GitHub endpoint the button already asks.

## Architecture Assessment

- **Pressure points by size**: `mrms.rs` 6,237 lines with three test modules inside it (`AUD-330`), `App.tsx` 3,047 (`AUD-272`), `level3.rs` 2,763, `incident_packs.rs` 2,597, `MapViewport.tsx` 2,522, each translation about 2,200, `settings.ts` 2,121, `LayersPanel.tsx` 1,440. **By churn since 2026-09-04** (65 commits): the three catalogues 27 touches each, `App.tsx` 17, `index.css` 12, `settings.ts` 9, `PanelSurfaces.tsx` 8. Verified.
- **The recurring defect classes in the refutation commits** since 2026-08-25 are three: an older async reply overwriting a newer one (`AUD-313`, `-314`, `-324`, `-329`, and the two found on 2026-09-05), an error swallowed with no copy (`AUD-261`, the SPC hatch, the three in `AUD-332`), and a hand-written list drifting from the table it mirrors (recorded four times in `CLAUDE.md`). The first has no shared helper (`AUD-342`); the second has a source scan for empty catches; the third has no gate at all beyond the two `EVERY_CHOICE` fixtures.
- **The sweep pipeline** draws one 1,024 pixel Mercator raster per sweep in Rust and hands it to the page as an image source; the national grids moved to per-zoom tiles on 2026-09-05 through the `mrms` scheme, and the sweep can take the same road (`AUD-339`). Colour is applied in Rust for both, which is why a palette or threshold change carries a generation into every tile address (`AUD-340`).
- **Tests**: 201 vitest files and 1,968 tests; 706 browser specs across three projects; 500 native tests of which 9 talk to the network; six fuzz targets, none for the `.orb` container or the PMTiles packs (`AUD-338`). The live contracts are documented in `SECURITY.md` and not run by the release gate. The fold-cost gate borrows the composite's absolute three-second budget.
- **Documentation**: the seventh pass cited `inside.nssl.noaa.gov/hwtblog/2026/`, which now returns 404 for the whole URL family; the HWT findings it drew on stand, the link does not. `docs/architecture.md` is current to the 2026-09-05 module split.

## Rejected Ideas

Carried, all still correct: cloud accounts, telemetry, sync (HookEcho's Drive folder, StormDesk's guest view); mobile clients; plugin marketplace; arbitrary remote placefile URLs without a trusted-host decision (PlacefileNation's 54-file catalogue and the ktrue generators fall here); RainViewer as primary; generative nowcasting; commercial feed scraping; a headless or hosted server (HookEcho `--serve` and `/national.png`, LibreWXR's tile API); MCP servers; NWWS-OI; Blitzortung; 3D volume before cross-section is fast; a second MapLibre instance per pane; Spotter Network before the owner contacts them; optical-flow frames; a tracker of its own; ML tornado detection before `AUD-189`'s deterministic AzShear.

| Idea | Decision and evidence |
| --- | --- |
| Repoint Level II to `tgftp.nws.noaa.gov` before 2026-09-15 (SCN26-67) | No action. The app reads `unidata-nexrad-level2` and the chunks bucket, neither of which the notice touches. Recorded so the next pass does not re-investigate. |
| `tgftp.nws.noaa.gov` as a second live Level II source | Under consideration, Needs live validation. A probe on 2026-09-07 saw `KTLX_20260907_182718.bz2` written at 18:29Z, which reads as one to two minutes behind the volume start, but whether the file is complete at that moment or appended to is unknown, and it is a new host for the ledger. The chunk bucket already gives the live sector. |
| NEXRAD SNS push over a websocket (nexrad-aws-notifier) | Reject. A long-lived socket is the server class; the chunk listing at the radar's own cadence is the deliberate alternative. |
| MQTT with Home Assistant discovery, headless render endpoints (HookEcho v0.12.0-beta.2) | Reject. Both are a listening service on the machine. |
| Windows Widgets Board widget | Reject. Providers must be packaged (doc 2026-08-19); the app is an unpackaged NSIS install by design. |
| TypeScript 7.0 | Hold. No programmatic API until 7.1, and `typescript-eslint` 8.70.0 caps at `<6.1.0`. |
| `noRedirectionBitmap` when Tauri 2.12 ships | Hold. WebView2Feedback #5695 loses input in that hosting mode on 152. Validate on 153 stable first. |
| More than two panes (Supercell Wx nine-pane, RadarOmega quad) | Reject. Each pane is a MapLibre instance; two was the measured limit and the compare seam is the dual-pane's own. |
| Recover the ambient effects after a run of fast frames (HookEcho #304) | Under consideration. `useAmbient.ts` deliberately never brings an effect back in the session ("the same bug with a stutter"); HookEcho's 300 fast frames of hysteresis is the argument against that reading. The case is made here and not on the roadmap, because it reverses a recorded decision. |
| GeoTIFF as an import layer (mapbox-exif-layer) | Later, L. The exporter exists; a reader needs a bounded GeoTIFF parser in Rust and a value-encoded raster path, which `AUD-340` builds. |
| A cross-section through the MRMS 3D reflectivity stack | Later, L. Thirty-three levels from 0.5 to 19 km on the bucket; `AUD-218` reads a level and the Level II section draws a slice. Not before the sweep and the grids share a rendering path. |
| LTR as a clutter-residue layer | Later. The message arrives in Level II from about 2027-02-15 (SCN26-54); nothing to read before Build 25.0 deploys. |
| RRFS and REFS after 2026-10-06 | Hold, as before, with the date now fixed. NOMADS only, no NODD bucket; a new host for the ledger. |
| Super-resolution recombination toggle, an NROT clone | Reject. Nobody asked for the first; the second is a proprietary fit where Mahalik's range-corrected AzShear (`AUD-189`) is citable. |
| `scenario="urgent"` toasts, observation-time timestamps, in-place toast updates | With the blocked rich-toast item. Every clause ends at a window somebody has to look at; the evidence there is updated with the unpackaged `AppNotificationManager` path. |
| cmweather ramps as the built-in colour-vision-safe set (Sherman et al. 2024) | Under consideration. The app already ships measured ramps behind a contrast gate; the paper is the citation the palette documentation should carry. |
| A curated placefile catalogue in the app (PlacefileNation, ktrue) | Carried rejection. Each entry is a remote host the ledger would have to name. |
| `image` 0.25.9 metadata on exported frames | Folded into `AUD-346`, which uses the `png` crate the exporter already has. |
| A portable zip beside the installer (HookEcho ships one) | Later. The app writes settings, the cache and the packs to the app-data directory and the updater assumes the installer; a portable build needs a settings location beside the executable and an updater that declines, and nobody has asked for it here. |
| Multi-user or profile support | Excluded. One reader, one machine, one settings file is the product; a second profile is a second Windows account. |
| Mobile clients | Carried rejection; Windows only is a rule. |

## Sources

### Repository and release state
- https://github.com/SysAdminDoc/OpenRadar/releases
- https://github.com/SysAdminDoc/OpenRadar/commit/eb4b1e5

### Competitors and community
- https://github.com/d4vid87/hookecho (pulls 298, 302, 304, 306; releases/tag/v0.12.0-beta.2; commits)
- https://github.com/d4vid87/stormdesk/releases
- https://github.com/jhammon88219/Anvil/commit/0f5972d
- https://github.com/Cuevman81/FX-Net-NextGen/commit/7eed8f1
- https://github.com/dpaulat/supercell-wx/issues (435, 480, 617, 629, 647, 675, 685, 689, 691) and /releases
- https://github.com/Aryeh95/pi-weather-station/commits/main
- https://github.com/w9fyi/wxaccess
- https://github.com/wesleygrimes/omastorm
- https://github.com/USA-RedDragon/nexrad-aws-notifier
- https://github.com/TheHolyOneZ/ZWeather
- https://github.com/jedarden/gribtract
- https://github.com/zwang-geog/mapbox-exif-layer
- https://github.com/iamthegreatdestroyer/aether
- https://github.com/JoshuaKimsey/LibreWXR/issues/31
- https://github.com/weather-mcp/weather-mcp/releases
- https://github.com/ELY3M/wX---modded-by-ELY-M
- https://github.com/danielway/nexrad-workbench/issues/145
- https://apps.apple.com/us/app/radarscope/id288419283
- https://apps.microsoft.com/detail/9mw4stn492s0
- https://apps.apple.com/us/app/radaromega/id1439881811?see-all=reviews
- https://grlevelx.com/grlevel3_3/
- https://grlevelxusers.com/community/gr2analyst/gr2analyst-current-versions-downloads-and-purchase-information/
- https://grlevelxusers.com/grlevelx-goodies/categories/placefiles/
- https://wsv3.com/ and https://wsv3.com/Tactical/
- https://community.windy.com/topic/44326/weather-radar-constantly-malfunctioning
- https://www.meetcarrot.com/weather/presskit.html
- https://unstar.app/blog/weather-apps-ranked-by-user-complaints-2026
- https://alternativeto.net/software/radarscope/
- https://balancedweather.substack.com/p/recent-nexrad-outages-show-the-importance
- https://stormtrack.org/threads/decent-radar-software-thats-free.31804/
- https://bsky.app/profile/pmarshwx.com/post/3muum2aigec2a
- https://bsky.app/profile/zakalwe2024.bsky.social/post/3mu3ovquftc2t
- https://bsky.app/profile/acasto.bsky.social/post/3muofpfseqk2g
- https://bsky.app/profile/ontariowedges.bsky.social/post/3mul7suzxzc23
- https://news.ycombinator.com/item?id=49512373
- https://news.ycombinator.com/item?id=49482461
- https://placefilenation.com/

### Data sources verified live
- https://api.open-meteo.com/v1/gfs?latitude=-33.9&longitude=151.2&hourly=wind_speed_10m&wind_speed_unit=ms&models=gfs_global&cell_selection=sea
- https://open-meteo.com/en/docs
- https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8761927.json
- https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=8761927&date=today&range=72&interval=hilo&datum=MLLW&units=english&time_zone=gmt&format=json
- https://oceanservice.noaa.gov/education/tutorial_tides/tides07_cycles.html
- https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&delimiter=/
- https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS_5KM/&delimiter=/
- https://noaa-goes19.s3.amazonaws.com/?list-type=2&prefix=GLM-L2-LCFA/
- https://unidata-nexrad-level2-chunks.s3.amazonaws.com/?list-type=2&prefix=KCRI/
- https://api.weather.gov/alerts/types
- https://api.weather.gov/radar/stations/KTLX
- https://mapservices.weather.noaa.gov/eventdriven/rest/services
- https://tgftp.nws.noaa.gov/data/radar/nexrad_level2/

### Service change notices and platform status
- https://www.weather.gov/notification/
- https://www.weather.gov/media/notification/pdf_2026/scn26-67_NEXRAD_Level_%202_radar_data_move_NOMADS_to_TGFTP.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-54_WSR-88D_Level2_Add_LTR.pdf
- https://www.weather.gov/media/notification/pdf_2026/PNS26-62_CAP_Transition.pdf
- https://www.weather.gov/media/notification/pdf_2026/pns26-63_NOAAPort_retire_feedback.pdf
- https://www.weather.gov/media/notification/pdf_2026/pns26-65_Proposed_SIGWX_LLFP_retirement.pdf
- https://www.roc.noaa.gov/build-loaded.php
- https://www.roc.noaa.gov/interface-control-documents.php
- https://www.ospo.noaa.gov/operations/goes/status.html
- https://www.nco.ncep.noaa.gov/status/messages/
- https://mesonet.agron.iastate.edu/onsite/news.phtml
- https://feeds.meteoalarm.org/feeds/
- https://ogcapi.ogc.org/edr/
- https://www.unidata.ucar.edu/blogs/news/entry/important-changes-to-noaa-nexrad

### Algorithms and design research
- https://repository.library.noaa.gov/view/noaa/25111/noaa_25111_DS1.pdf (Mahalik et al. 2019, LLSD)
- https://journals.ametsoc.org/view/journals/apme/54/9/jamc-d-15-0138.1.xml (Snyder and Ryzhkov 2015, TDS)
- https://training.weather.gov/wdtd/courses/rac/warnings/IBW-content/story_content/external_files/IBW%20Tornado%20Guidance.pdf
- https://vlab.noaa.gov/web/wdtd/-/dual-pol-quality-control
- https://vlab.noaa.gov/web/wdtd/-/maximum-estimated-size-of-hail-mes-2
- https://zenodo.org/records/13887225 (Murillo and Homeyer 2019 MESH fits)
- https://vlab.noaa.gov/web/snow-squalls-and-snow-squall-warnings/radar-color-tables
- https://www.weather.gov/media/crh/publications/TA/TA_2303.pdf (flash flood four-panel thresholds)
- https://journals.ametsoc.org/view/journals/wefo/13/2/1520-0434_1998_013_0327_trtbss_2_0_co_2.xml (Lemon 1998, TBSS)
- https://repository.library.noaa.gov/view/noaa/72847/noaa_72847_DS1.pdf (HWT 2023 and 2024 report, 2026-03)
- https://journals.ametsoc.org/view/journals/bams/105/8/BAMS-D-23-0056.1.xml (Sherman et al. 2024) and https://github.com/openradar/cmweather
- https://www.w3.org/TR/WCAG22/ and https://github.com/Malvoz/web-maps-wcag-evaluation
- https://www.rocketcom.com/insights/designing-ux-for-giant-screens/
- https://uxpajournal.org/development-and-evaluation-of-two-prototypes-for-providing-weather-map-data-to-blind-users-through-sonification/
- https://docs.qgis.org/3.44/en/docs/user_manual/map_views/map_view.html
- https://obsproject.com/kb/power-of-projectors
- https://github.com/LizardByte/Sunshine/releases/tag/v2026.906.222525
- https://learn.microsoft.com/en-us/windows/powertoys/general
- https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-content
- https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/manage-app-notifications
- https://github.com/breezy-weather/breezy-weather/blob/main/CHANGELOG.md
- https://www.earthnetworks.com/blog/sferic-maps-update-lightning-range-rings/
- https://github.com/orgs/tauri-apps/discussions/11915

### Dependencies, platform, security
- https://maplibre.org/maplibre-style-spec/sources/ (raster-dem custom encoding, 3.4.0)
- https://maplibre.org/maplibre-gl-js/docs/examples/add-a-color-relief-layer/
- https://github.com/maplibre/maplibre-gl-js/issues/4479
- https://maplibre.org/maplibre-gl-js/docs/API/classes/ImageSource/
- https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md
- https://docs.rs/png/latest/png/struct.Encoder.html
- https://raw.githubusercontent.com/rustsec/advisory-db/main/crates/lru/RUSTSEC-2026-0253.md
- https://github.com/jeromefroe/lru-rs/pull/238
- https://crates.io/api/v1/crates/hdf5-reader/0.9.1/dependencies
- https://github.com/roteiro-gis/netcdf-rust
- https://github.com/RustSec/advisory-db/commits/main
- https://github.com/tauri-apps/tauri/tree/dev/.changes
- https://github.com/tauri-apps/tauri/security/advisories
- https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/CHANGELOG.md
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.70.0
- https://github.com/microsoft/playwright/releases/tag/v1.63.0
- https://chromereleases.googleblog.com/2026/09/stable-channel-update-for-desktop_01882797386.html
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/runtime
- https://github.com/MicrosoftEdge/WebView2Feedback/issues?q=is%3Aissue+created%3A%3E2026-09-01
- https://blogs.windows.com/msedgedev/2026/08/24/webview2-is-moving-to-a-2-week-release-cadence/
- https://learn.microsoft.com/en-us/windows/release-health/status-windows-11-25h2
- https://github.com/rust-lang/rust/releases
- https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-cs

## Open Questions

1. Does the owner want to comment on PNS26-62 (CAP primary, VTEC retired) and PNS26-63 (NOAAPort retirement, which is IEM's upstream for the archive warnings the replay reads) by 2026-09-21? Both are a person's act under a person's identity.
2. Is `tgftp.nws.noaa.gov` wanted in the ledger? It is the only public Level II path outside AWS, and the one RRFS will share with NOMADS after 2026-10-06. Nothing depends on it today.
3. Carried unchanged: Spotter Network contact; a `127.0.0.1` endpoint under "nothing new leaves the machine"; ODIN's unstated licence; the upstream `hdf5-reader` issue for `lru` (still unfiled by anyone on 2026-09-07); the publish of 0.5 through 0.11, the isolated desktop session, the clean VM, the code-signing purchase, all in `Roadmap_Blocked.md`.
