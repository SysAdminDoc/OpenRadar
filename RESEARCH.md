# Research: OpenRadar

Date: 2026-09-04. Replaces all prior research. Repository snapshot: `75e44f7` on `main`, manifests at v0.9.0, `CHANGELOG.md` carrying an unreleased `v0.10.0` section, published release still v0.4.0 (2026-08-31). Seventh pass; the sixth ran on 2026-09-03 at `f64b0ac`. Fifty commits landed between the two, shipping five of the sixth pass's top ten (autostart, the full SPC outlook set, replay-time outlooks and reports, the lightning grids, forced-colors), plus the wind profile, MP4 export, placefile icons and time ranges, KML, and twenty-two audit repairs.

## Executive Summary

OpenRadar is the most complete keyless desktop radar workstation in the open-source field and the only one that reads a wind profile out of the radar's own velocity, corrects rain totals against gauges, draws the whole SPC outlook set with its hatched areas, and answers a replayed afternoon with that day's outlook and reports. Its closest open competitor, HookEcho, merged thirty pull requests in the four days since the last pass and now leads on spoken warnings, Europe-wide MeteoAlarm, county power outages and a headless server; its closest commercial competitor, RadarScope, added a Tier 2 model field viewer on 2026-09-02. Nothing found this pass changes the strongest direction, which is a local-first incident workstation that explains its evidence, but three defects and one dated service change need to land before anything new does.

Top opportunities, in order:

1. **The West Palm Beach terminal radar has been unreachable since 2026-08-03.** SCN26-61 renamed TPBI to TDJT; `src/lib/tdwrSites.json:38` still says `TPBI`. Verified live: chunks, archive and Level III all publish under TDJT and nothing under TPBI. Verified.
2. **Publish.** `gh release list` shows nothing newer than v0.4.0; the tree is five releases ahead and the release gate's own one-release lag rule would refuse it. Owner's act, in `Roadmap_Blocked.md`. Verified.
3. **Two diagnostics claims with nothing behind them.** `CHANGELOG.md:53` says the report names how autostart is set; `src/lib/diagnostics.ts:244-300` never does. A denied notification permission (`src/lib/notify.ts:31`) reaches no surface at all, which is exactly the "why did I not hear about last night's warning" case that block exists for. Verified.
4. **A failed hatch layer is dropped silently** (`src/lib/overlays/spc.ts:449-452`): the bands draw, the significant area does not, and nothing says the hatch was asked for. The one swallowed error in `src/` without copy. Verified.
5. **Level III NVW as the first wind-profile source.** Every WSR-88D and TDWR publishes a VAD wind profile product (354 a day at DMX, 235 at TDJT, verified on the bucket); Anvil reads it first and fits Level II only as a fallback, cutting first paint of storm-relative velocity from 19.7 to 5.9 s. The app fits every ring itself and never reads the product. Verified.
6. **Time since the last flash, per watched place.** The 2026 Hazardous Weather Testbed found forecasters wanted the "Lightning Stoplight" (colour by time since the last strike, with a slow decay) beside any probability, and never an all-clear from probabilities alone. The app has the flashes, the places and a 30-minute quiet rule; it shows neither the age nor the distance. Verified.
7. **A link that carries the held site, product, tilt and threshold.** `openradar://view` carries the camera only (`src/lib/deepLink.ts:23-33`); HookEcho #71 is a dashboard user asking for exactly the rest. Verified.
8. **Vitest 5.0.0** (2026-09-03) is the one dependency change with work in it; `npm audit` and `cargo audit` are otherwise unchanged at zero vulnerabilities. Verified.
9. **Feed resilience is the thing chasers posted about this week**: RadarScope and RadarOmega both lost their feed during a storm on 2026-09-03 while WeatherFront stayed up; KLWX went down inside a tornado warning on 2026-08-17. The app has failover for mosaics and site status for picking; a held site that stops publishing, and a second live source for storm reports, are the gaps. Verified (posts), Needs live validation (held-site behaviour).
10. **The four hottest files are four of the six largest**: `App.tsx` and `MapOptionsPanels.tsx` were each touched over eighty times since 2026-08-25 and are 2,814 and 2,847 lines; only `level2.rs` has a split item. Verified.

## Product Map

- Core workflows: watch live radar over a place with a two-hour national loop and a nearest-site Level II view that loops across up to thirty volumes, with the office's own word on whether each radar is running; interrogate a storm (tilts, six moments, dealiased and storm-relative velocity, a wind profile per volume, cross-section, gate readout, beam height, cell tracks, hydrometeor class, ProbSevere, 43 MRMS grids including rotation, hail, lightning density, probability and jump, isotherm reflectivity, FLASH and gauge-corrected rain); understand the day (the whole SPC outlook set, WPC rain and winter outlooks, mesoscale discussions, warnings filtered by hazard, reports, rivers, tides, surge); replay a past event with that day's warnings, outlook and reports, or from a `.orb` bundle offline; be told (up to ten watched places with arrival, lightning, warning radius, quiet hours, calm mode); leave it running (tray, autostart, glance, wallpaper, capture layout); take it away (PNG, WebM, MP4, GIF, CSV, GeoTIFF, incident packs).
- Personas: the subscription-refusing enthusiast, the chaser with palettes and placefiles, the anxious monitor, the second-monitor ambient reader, the flood-prone reader, the winter-weather reader, the streamer, the screen-reader user.
- Platform and distribution: Windows x64 only, NSIS current-user installer, minisign-signed updater, no Authenticode; ARM64 is buildable today (the NSIS bundler maps `aarch64` to `arm64` and the updater accepts `windows-aarch64`). Release gate in `scripts/release.mjs`.
- Data flow: every native request through `src-tauri/src/http.rs` (35 hosts); page CSP for the browser-side fetches; 24 live contracts in `scripts/live-contracts-lib.mjs`; overlay adapters in `src/lib/overlays/registry.ts`; MRMS products in `src-tauri/src/mrms.rs` (43 rows, one decoder, fold path for finer grids).

## Competitive Landscape

### Open source

- **HookEcho** (d4vid87, Rust wgpu, MIT, 54 stars, pushed 2026-09-04). Thirty PRs merged 2026-09-01 to 09-04: spoken warnings on by default with county, towns in path, distance and bearing from a saved place, a tone then speech, a queue (#298); MeteoAlarm for all of Europe through the OGC EDR API with CAP fetched after (#293); ODIN county power outages as a cross-hatched choropleth (#271, #273, #275); high-contrast colour maps (#276); reopen at last size (#287). Roadmap now: macOS, store submissions; next: GOES from source, surface obs, difference layers. Not planned: iOS, ML nowcasting, Blitzortung, velocity mosaic, hosted service. Learn: the voice path and the EDR route into MeteoAlarm (`AUD-227`). Avoid: the always-on voice default, the `--serve` class, Google Drive sync. Verified.
- **Anvil** (jhammon88219, C# WinUI 3, AGPL, 26 commits 2026-09-01 to 09-04). Level III NVW as the primary VAD source with Level II fallback (`9783bf8`); VAD RMS gate 2.0 to 5.0 m/s (`8dec1f5`); VWP tilts chosen by target height (`cc43dec`); a per-worker decode queue after three replay frames inherited a neighbour's velocity field (`d3cf2b3`); a retained-geometry memory sampler showing a 26-frame replay holding 2,178 MB and dual-pol prefetch capped at 12 frames (`0f5972d`); archive-day reports and outlook keyed to the replay (the same idea as `AUD-216`). Learn: NVW first, the memory sampler as the shape of `AUD-166`'s answer. Avoid: nothing to reuse under AGPL. Verified.
- **Supercell Wx** (v0.6.1 unchanged). New: #691 (2026-08-26) every layer freely orderable including basemap, symbology and colour table; #454 derived-products interface updated 2026-08-29 with an SRV deriver. Standing asks unmet here: #685 SPS as a first-class layer. Verified.
- **New this pass** (all Verified from README): **FX-Net-NextGen** (Cuevman81, MapLibre, MIT): 1/2/4/8 panes with time-matched loops across differing cadences, workspace tabs with autosave, per-pane data-health monitor, a national SCIT table from IEM `nexrad_attr.py`. **ClassicRadar** (extrosy-sys): SCIT/EET/DVL attribute table, winds aloft at 850/700/500/250 mb, a 24-hour time-machine pin shared across products. **Sweep** (Aryeh95): nearest radar follows the map view, composite crossfading into super-res by zoom, per-layer age. **RadrView** (cwdaniel, MIT): biological layer from correlation coefficient, live sweep-wedge streaming. **backscatter** (kbennett2000, MIT): continuous Level II collection with retention, a DVR. **nexrad-workbench** (danielway, Rust/WASM): availability timeline, IndexedDB cache. **level2-browser** (ra397): RHI cross-sections with a terrain profile. **stormscape** (scottwmccoy, MIT): radar-versus-gauge residuals, RQI gating, Atlas 14 recurrence. **dras** (jacaudi, Go): alerts when a WSR-88D's status changes. **storm-ar.com** (Stormtrack 2026-08-13): browser 3D point cloud, sixty seconds a volume, the one reply complained about the wait. Learn: the time-matched multi-cadence loop (the dual-pane seam from the sixth pass), terrain under the cross-section, the availability timeline. Avoid: the DVR and the sweep-wedge stream (a listening or long-lived socket class), 3D before it is fast.
- **LibreWXR** added a storm-cells REST endpoint (2026-09-03, #31). **AtmosphericX** event-product-parser: NWWS-OI ingest, eight commits. **weather-mcp** 1.27.1: JMA warnings, UK river levels. **Quiet since 2026-09-01**: BowEcho, GenericRadar, azimuth, mesoview, mrms-viewer, OpenStorm, danielway/nexrad (the negative-elevation fix still unreleased), netcdf-rust. Verified.

### Commercial

- **RadarScope** 5.6.1 (2026-09-02) and 5.6.2 (2026-09-03): Tier 2 gains a forecast model viewer (GFS, HRRR, HRW, NAM, ECMWF HRES), street-map caching; Tier 1 gains Day 3 probabilistic categories; all users get localised impact tags and TDWR mode labels. Prices unchanged. Bluesky 2026-08-30: the free tier "only showing warnings unless you get a subscription". Verified.
- **WSV3** Tactical V1 slipped to 2027 (page dated 2026-08-31). **RadarOmega** unchanged at 5.8.0. **WeatherFront** unchanged at 1.23.0. **Storm Radar** 4.0.19, Android still "coming later". **Windy** 51.1.2 (2026-08-30): icing and turbulence with flight-level range, hourly fire danger. **CARROT** Ultra paywalls super-res radar and SPC outlooks. **WeatherWise** Plus paywalls 3D and smoothing; free tier carries chaser streams. **Baron Threat Net**: lightning proximity at five radii with a 30-minute all-clear timer. **Weather Radar Pro** (Windows Store): all tilts, dual-pol, Skew-T behind a subscription. Verified or Likely per Sources.
- What the paid tier buys that this app lacks, once the wrong entries are removed (soundings, route weather, smoothing, dual pane, GOES, non-US radar and future radar are already here): a model field viewer, per-cell hail size and rotation flags (`AUD-189`, `AUD-190`), time since the last flash and the nearest one, an ETA from a warning's own motion vector, a chase HUD, 3D, an archive verification lab, historical tornado tracks, aviation layers (`AUD-194`), NOHRSC snow (`AUD-195`), user-defined derived products.

### Community signal

- Bluesky (api.bsky.app, 2026-08-15 to 09-04): RadarScope and RadarOmega lost their feed during a storm on 2026-09-03 while WeatherFront stayed up; KLWX went down inside a tornado warning on 2026-08-17; RadarScope kept for being "the lightest running, and easiest to read" (2026-08-26); a reader paid ten dollars for a lightning tier to know when to unplug (2026-09-04); UK Met Office radar wished for (2026-08-27); the IEM maintainer measured CAP lagging text by 14 s (2026-09-01). Verified.
- Hacker News: **LiteRadar** (2026-07-22, missed last pass): MRMS to PMTiles with GPU optical-flow interpolation for 60 fps loops; the one comment asked for forecast frames. **linecast** (2026-08-23): a stdlib-only terminal weather tool, praised for no account. "I don't have a smartphone" (2026-09-02): open-source weather apps called inaccurate; wX recommended for reading NWS directly. Verified.
- Home Assistant radar card thread (replies 2026-09-02 and 09-03): auto full-screen during active weather on a wall display, markers driven by external state, the Carto key break again. Verified.
- PlacefileNation launched **MesoPulse** on 2026-09-01: hourly ML tornado, wind, hail and flood probabilities as free placefiles. The app can load them by drop; a catalogue of remote URLs stays a trusted-host decision. Verified.
- Hazardous Weather Testbed 2026: forecasters wanted the Lightning Stoplight's time-since-strike colouring with a slow decay beside LightningCast, asked for parallax correction, and were told never to message an all-clear from probabilities alone after a strike six miles out while both tools trended clear. Verified.
- Reddit unreachable from this machine by every route (403 or 429). Stormtrack, wxforum and grlevelxusers carried nothing new beyond the 3D viewer thread.

### Adjacent

- **FMI graph-based cell tracking** (AMT 19:1853, 2026-03-16, code MIT): splits and merges as event nodes. The app draws the radar's own SCIT tracks and runs no tracker of its own; reference only. Verified.
- **TorDet** (IEEE TGRS 2026, code and weights MIT): a two-stage single-radar tornado detector on three tilts of Z, V and SW; CPU-feasible. Same verdict as TorNet: `AUD-189`'s deterministic AzShear first. Verified (repo), Likely (metrics).
- **Py-ART 2.2.1** (2026-05-12): CAPPI now corrects for refraction; a check against the cross-section's beam-height maths. **deck.gl-community 9.4**: WebGPU particle and wind layers; a second renderer, rejected. **KomuraSoft tray guide** (2026-07-16): handle `TaskbarCreated` to survive an Explorer restart, dispose the icon or it ghosts; the tray code should be read against it. Verified.

## Reported Issues

The tracker holds zero issues, zero pull requests and no discussions (`gh`, 2026-09-04). The effective tracker is the refutation passes on the drain's own work: `c4fd6f2` (five defects in `AUD-238`, `-241`, `-242`) and `75e44f7` (ten in `AUD-185`, `-215`, `-216`, including a wind profile that drew the oldest six volumes, an outlook keyed by calendar date when the outlook day runs from noon, a parked replay re-asking an immutable archive every five minutes, and a self-consistent test that could not see a level read off the wrong ring).

Seams found in this pass, with the code:

- `src/lib/tdwrSites.json:38` `TPBI` for a radar the bucket has published as `TDJT` since 2026-08-03 (SCN26-61). Verified live: `unidata-nexrad-level2-chunks/TDJT/` active, `TPBI/` empty; archive `2026/09/03/TDJT/` one key, `TPBI/` none; Level III `DJT_TZL_2026_09_03` and `DJT_TV0` present, `PBI_` none. `src-tauri/src/tdwr.rs:80` strips the leading letter for the Level III prefix, so every product for the site asks for `PBI_`. Verified.
- `CHANGELOG.md:53` claims diagnostics names the autostart setting; `src/lib/diagnostics.ts:244-300` has no such line. Verified.
- `src/lib/notify.ts:31` returns false on a denied permission; the three watches fall back to a toast and no surface says Windows notifications are blocked. Verified.
- `src/lib/overlays/spc.ts:449-452` swallows a failed hatch query. Verified.
- README parity: "SPC convective outlooks" (line 59) for what is now all 26 layers with day and hazard controls; "Lightning two ways" (line 87) for what is now ten grids; popups on imported shapes, smoothing greyed on a TDWR and replay-day outlooks and reports are absent; "Seven map styles" (line 93) against "five of the eight" (line 380) and `MAP_STYLES` with eight entries; `SECURITY.md:9-10` skips 0.8.x; `docs/architecture.md:45` and `scripts/unused-exports.mjs:14-16` say a hundred and fifty exports where the count is 205 test-only and 148 file-local; the changelog carries no dates; `assets/screenshots/openradar-main.png` is from 2026-08-31 (`AUD-200`). Verified.
- `openradar://view` carries `lon`, `lat`, `zoom`, `bearing`, `pitch`, `projection` and nothing about what is drawn (`src/lib/deepLink.ts:23-33`). Verified.
- `src/lib/settings.ts:79` declares a `"dark"` map style id that `MAP_STYLES` never offers; resolved at `src/lib/mapStyles.ts:244` as a legacy path. Verified.
- Clean: all 58 registered Tauri commands are invoked and all 44 invoke strings resolve; all 89 catalogue keys without a literal reference are template-built; every one of the 56 settings keys and 43 layer keys has a reader outside `settings.ts`; no bare empty catch in `src/`; no `confirm(` anywhere, every destructive action is undo-based. Verified.
- Adjacent-tracker asks still unmet: Supercell Wx #685 SPS as a first-class layer (the WWA feed's significance `S` rows are read at `src/lib/overlays/alerts.ts:291`; whether a watch announces one is unverified), #691 free layer order, HookEcho #71 deep-linkable state.

## Security, Privacy, and Reliability

- **Dependency state, 2026-09-04.** `npm outdated`: `@types/react-dom` 19.2.5 → 19.2.7, `lucide-react` 1.39.0 → 1.41.0, `vitest` and `@vitest/coverage-v8` 4.1.11 → 5.0.0, `typescript` held. `npm audit`: 0 with and without dev. `cargo audit`: 0 vulnerabilities, 17 warnings, unchanged; `lru 0.16.4` (RUSTSEC-2026-0253) still enters through `netcdf-reader` → `hdf5-reader`, whose `main` still pins `^0.16.3` with no open PR; `lru` 0.18.4 is out. Verified.
- **Vitest 5.0.0** (2026-09-03): `clearMocks` defaults on, `sequential` removed, `toHaveTextContent` exact-only, `vi.mock` must be top-level, artifacts under `.vitest/`, `expect.poll` rejects on timeout, unawaited `.resolves` fails. Scan of the tree: 0 `sequential`, 0 `toHaveTextContent`, all 38 `vi.mock` top-level, 62 explicit clear or reset calls become redundant. Verified.
- **New advisories 2026-09-01 to 09-03**: RustSec rtrb, azure_core, zbus_polkit, apimock, manzana; npm fast-uri, qs, toml, nanoid, browserslist, @humanfs/node and others. None of the Rust crates is in the tree; the three npm names present are already at or above the patched versions. Verified.
- **Chromium 152.0.7977.82 (2026-09-03)** fixes a V8 type confusion exploited in the wild (CVE-2026-85046) and an out-of-bounds write in WebGL (CVE-2026-85050). No Edge or WebView2 build after 152.0.4191.62 (2026-09-02) exists yet, so no shipped WebView2 carries it. WebView2 moves to a two-week cadence with 153 (week of 2026-09-10). Verified.
- **WebView2 152 regressions in the wild**: a hidden WPF host reports a roughly 70 by 39 viewport (#5689), an invisible cursor after a WebView closes (#5687), multi-second stalls on Lunar Lake Arc (#5684), an AMD shader-cache denial (#5693). The app's `ResizeObserver` (`MapViewport.tsx:2129`) should cover the first when the tray shows the window; the start-hidden path has never been watched on 152. Needs live validation.
- **MapLibre 6.7.0**'s `GPUInitializationError` is already caught (`MapViewport.tsx:1841, 2091`). **`unload`** ramp: the tree uses only `visibilitychange`. **Screen Wake Lock** is unsupported in WebView2, so the second-monitor view cannot hold the display awake from the page; `SetThreadExecutionState` from Rust can. Verified.
- **Tauri 2.12** (32 closed, 14 open on the milestone): brings tao 0.37 (exits cleanly on `WM_ENDSESSION`, the crash the autostart path is most exposed to) and wry 0.56 (WebView2 teardown crash fix), MSRV 1.90, `noRedirectionBitmap`, `bundle.windows.bundleVCRuntime`. The updater has no delta updates and nobody has asked. Verified.
- **Service changes.** SCN26-61 (TPBI → TDJT, effective 2026-08-03) is the one with a defect behind it. PNS26-62 (2026-09-01): NWS proposes CAP as the primary WWA format and the retirement of VTEC, comments to 2026-09-21; the live path reads the WWA map service by `event` and geometry and the only VTEC in the tree is the IEM archive API's own key (`src/lib/archiveWarnings.ts`), so no code depends on a VTEC string, but the map service itself is VTEC-derived and would be rebuilt. SCN26-75: the Probabilistic Precipitation Portal goes operational 2026-10-01 as the PWPF successor; the app never read PWPF. NEXRAD Build 24.1 at 134 of 159 sites, 24.2 not yet deploying. MRMS still v12.3.1, CONUS bucket 243 folders unchanged, ProbSevere flowing under today's prefix (a "prefix ends 2023" claim was a pagination artefact). GLM product anomalies 2026-08-24 and 09-03 are real gaps in a replay. FMI renames every radar layer in autumn 2026 and removes the old names at the end of November; KNMI rotated its anonymous key on 2026-06-30; DWD's old ICON paths end 2026-11-30 (the app uses DWD radar only). Verified.
- **Terms unchanged**: Spotter Network, ODIN's null licence, MeteoGate anonymous tier. **Privacy posture holds**: nothing proposed adds a socket, an account or telemetry; the voice item speaks through the page's own `speechSynthesis`, offline.

## Architecture Assessment

- **Pressure points by size**: `level2.rs` 7,019 (+552 in a day; `AUD-219` understates it), `mrms.rs` 4,467, `MapOptionsPanels.tsx` 2,847, `App.tsx` 2,814, `incident_packs.rs` 2,425, `MapViewport.tsx` 2,304. **By churn since 2026-08-25** (358 commits): `App.tsx` 143 touches, `MapOptionsPanels.tsx` 85, `settings.ts` 82, `MapViewport.tsx` 72. The four hottest code files are four of the six largest and only `level2.rs` has a split item. Verified.
- **Adding a switch group touches ten places** (recorded in `CLAUDE.md` after `AUD-217`): choice lists, `LayerSettings`, defaults, normaliser, product ids and map, `MRMS_LAYERS`, `LABEL_KEYS`, `productFor`, `MrmsChoices`, `LAYER_SOURCES`, commands, panel row and control, `PanelSurfaces`, `App.tsx`, three catalogues, and two test fixtures (`EVERY_CHOICE` in two files, `CHOOSING`). `AUD-218` will want the same shape as a family with a level parameter rather than rows.
- **The wind profile now has its own module** (`src-tauri/src/vwp.rs`) with a veering-wind fixture that fails when a level is read off the wrong ring; `vad.rs` distinguishes a lopsided ring from a disagreeing one. `level2.rs` holds `level2_vwp` beside `level2_cross_section`; both belong in the split.
- **Overlay refresh knows about replays** (`src/hooks/useOverlays.ts` `shouldRefetch`, now tested): a replayed window is never re-asked on the timer, a global adapter's archive path re-asks on pan, and a failed fetch after a variant change clears rather than keeps.
- **Tests**: 179 vitest files, 622 browser specs, 420 native tests; thirteen panels without a sibling test (`StorageSection` and `VwpPanel` new to the list, `IncidentPackManager` now covered; `AUD-220`'s list is stale). The placefile icon path still has no browser test (`AUD-247`).
- **Documentation**: the README lags two releases of features (above); `docs/architecture.md` and the export policy script carry a count from before the split of test-only and file-local exports.

## Rejected Ideas

Carried, all still correct: cloud accounts, telemetry, sync (HookEcho's Drive folder included); mobile clients; plugin marketplace; arbitrary remote placefile URLs without a trusted-host decision (MesoPulse's catalogue falls here); RainViewer as primary; generative nowcasting; commercial feed scraping; a headless or hosted server (LibreWXR's tile API, HookEcho `--serve`); MCP servers; NWWS-OI; Blitzortung; 3D volume before cross-section is fast; a second MapLibre instance per pane; Spotter Network before the owner contacts them; RRFS before it is dated.

| Idea | Decision and evidence |
| --- | --- |
| Optical-flow interpolated frames for 60 fps loops (LiteRadar, HN 2026-07-22) | Reject. Every frame the app draws was measured; the cross-section leaves unmeasured heights empty for the same reason. A tween between two mosaics is a picture nobody made. |
| A second storm tracker with split and merge handling (FMI graph model, AMT 19:1853) | Reject as an item. The cells are the radar's own SCIT output and the app says so; a tracker of its own is a second opinion with no office behind it. The paper is the reference if `AUD-224`'s per-cell join ever needs to follow a cell through a merge. |
| TorDet, TDA-DARKNet (single-radar ML tornado detection, 2026) | Defer, same as TorNet: `AUD-189`'s deterministic AzShear and debris flag first; an ML runtime is tens of megabytes for a model whose single-site skill is unlabelled on WSR-88D. |
| A model field viewer (RadarScope 5.6.1 Tier 2, WeatherFront) | Later, XL. HRRR reflectivity and smoke are already decoded from the bucket and `AUD-218` builds the level machinery; the field viewer is that machinery pointed at GFS and HRRR pressure levels. Not before `AUD-218`. |
| A national SCIT attribute table (FX-Net-NextGen, ClassicRadar) | Fold into `AUD-223`: the per-place thresholds need the same per-cell numbers, and a table of every cell in the country is not something a reader of one place asked for. |
| Winds aloft at pressure levels as particles (ClassicRadar) | Under consideration after the model field viewer; the particle layer already exists and the GFS bucket carries the levels. |
| A DVR of continuous Level II collection (backscatter) | Reject. A long-lived collector is the server class; incident packs and replay bundles are the deliberate alternative. |
| Live sweep-wedge streaming (RadrView) | Reject. The chunk bucket already gives "Volume in progress"; a socket is not needed for it. |
| deck.gl-community WebGPU particle and wind layers | Reject. A second renderer beside MapLibre; the particle layer already runs on the flat map and the globe. |
| Screen Wake Lock web API for the ambient view | Reject the web API (unsupported in WebView2, caniwebview); the native call is the item (`AUD-269`). |
| `sha2` 0.11 | Hold. The nexrad crates pin `digest` 0.10; bumping duplicates the crate. |
| Free reordering of the basemap and warnings (Supercell Wx #691) | Reject the warnings half deliberately: nothing should be able to put a wildfire perimeter over one, and the README says so. The basemap half is not asked for here. |
| An always-on spoken warning default (HookEcho #298) | Reject the default, keep the feature off by default (`AUD-270`), the way sound already is. |

## Sources

### Repository and release state
- https://github.com/SysAdminDoc/OpenRadar/releases
- https://github.com/SysAdminDoc/OpenRadar/commit/75e44f7

### Competitors and community
- https://github.com/d4vid87/HookEcho (pulls 271, 273, 275, 276, 287, 293, 298; ROADMAP.md; issues/71)
- https://github.com/jhammon88219/Anvil (commits 9783bf8, 8dec1f5, cc43dec, d3cf2b3, 0f5972d)
- https://github.com/dpaulat/supercell-wx/issues/691
- https://github.com/dpaulat/supercell-wx/issues/685
- https://github.com/dpaulat/supercell-wx/pull/454
- https://github.com/Cuevman81/FX-Net-NextGen
- https://github.com/extrosy-sys/ClassicRadar
- https://github.com/Aryeh95/pi-weather-station
- https://github.com/cwdaniel/RadrView
- https://github.com/kbennett2000/backscatter
- https://github.com/danielway/nexrad-workbench
- https://github.com/ra397/level2-browser
- https://github.com/scottwmccoy/stormscape
- https://github.com/jacaudi/dras
- https://github.com/JoshuaKimsey/LibreWXR/issues/31
- https://github.com/fmidev/convective-cell-graph-analysis
- https://github.com/Tornado-AI/TorDet
- https://apps.apple.com/us/app/radarscope/id288419283
- https://wsv3.com/Tactical/
- https://www.apkmirror.com/apk/windyty-se/windy-wind-waves-and-hurricanes-forecast/
- https://baronweather.com/baron-news/tag/baron-threat-net
- https://weatherai.com/Home/RadarPro
- https://stormtrack.org/threads/made-a-free-3d-nexrad-radar-viewer-real-level-ii-data-storm-cell-tracking-in-browser.33499/
- https://community.home-assistant.io/t/major-new-feature-release-of-the-weather-radar-card/1009431
- https://placefilenation.com/
- https://bsky.app/profile/ontariowedges.bsky.social/post/3mul7suzxzc23
- https://bsky.app/profile/dasos.bsky.social/post/3mucwlgyhms2a
- https://bsky.app/profile/akrherz.bsky.social/post/3muif3vlqhs2o
- https://news.ycombinator.com/item?id=49009554
- https://news.ycombinator.com/item?id=49408089
- https://inside.nssl.noaa.gov/ewp/topic/lightning-stoplight/
- https://inside.nssl.noaa.gov/hwtblog/2026/

### Data sources verified live
- https://unidata-nexrad-level2-chunks.s3.amazonaws.com/?list-type=2&prefix=TDJT/&delimiter=/
- https://unidata-nexrad-level2.s3.amazonaws.com/?list-type=2&prefix=2026/09/03/TDJT/
- https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=DJT_TZL_2026_09_03
- https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=DMX_NVW_2026_09_03
- https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=ProbSevere/20260904/
- https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS/&delimiter=/
- https://api.weather.gov/openapi.json
- https://mapservices.weather.noaa.gov/vector/rest/services?f=pjson
- https://mapservices.weather.noaa.gov/raster/rest/services?f=pjson

### Service change notices and platform status
- https://www.weather.gov/notification/
- https://www.weather.gov/media/notification/pdf_2026/scn26-61_Identifer_Change_PBI_to_DJT.pdf
- https://www.weather.gov/media/notification/pdf_2026/PNS26-62_CAP_Transition.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-75_expPPP_T2O.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-11_SPC_conditional-intensity.pdf
- https://www.roc.noaa.gov/build-status-completion.php?ID=20854
- https://www.roc.noaa.gov/interface-control-documents.php
- https://inside.nssl.noaa.gov/mrms/code-updates/
- http://www.ospo.noaa.gov/operations/goes/status.html
- https://www.nesdis.noaa.gov/news/retirement-of-goes-r-rainfall-ratequantitative-precipitation-estimation-grrqpe
- https://mesonet.agron.iastate.edu/onsite/news.phtml?id=1481
- https://www.ilmatieteenlaitos.fi/avoin-data-saatutkat
- https://developer.dataplatform.knmi.nl/news
- https://www.dwd.de/DE/leistungen/opendata/neuigkeiten/opendata_september2026_1.html
- https://github.com/wmo-im/GRIB2/releases
- https://www.eumetnet.eu/wp-content/uploads/2026/01/ODIM_H5_v2.4.2_final.pdf

### Algorithms and design research
- https://amt.copernicus.org/articles/19/1853/2026/
- https://egusphere.copernicus.org/preprints/2026/egusphere-2026-594/
- https://arxiv.org/abs/2605.24067
- https://arxiv.org/abs/2607.16080
- https://github.com/ARM-DOE/pyart/releases
- https://comcomponent.com/en/blog/windows-tray-icon-toast-notification-guide/
- https://visgl.github.io/deck.gl-community/docs/whats-new

### Dependencies, platform, security
- https://github.com/vitest-dev/vitest/releases/tag/v5.0.0
- https://vitest.dev/guide/migration.html
- https://github.com/maplibre/maplibre-gl-js/releases
- https://github.com/tauri-apps/tauri/milestones
- https://github.com/tauri-apps/tao/blob/dev/CHANGELOG.md
- https://github.com/tauri-apps/wry/blob/dev/CHANGELOG.md
- https://github.com/tauri-apps/plugins-workspace/releases
- https://github.com/roteiro-gis/netcdf-rust
- https://rustsec.org/advisories/RUSTSEC-2026-0253
- https://github.com/RustSec/advisory-db/commits
- https://chromereleases.googleblog.com/2026/09/stable-channel-update-for-desktop_01882797386.html
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/runtime/152
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/runtime/153
- https://blogs.windows.com/msedgedev/2026/08/24/webview2-is-moving-to-a-2-week-release-cadence/
- https://github.com/MicrosoftEdge/WebView2Feedback/issues/5689
- https://caniwebview.com/features/web-feature-screen-wake-lock/
- https://learn.microsoft.com/en-us/windows/release-health/status-windows-11-25h2

## Open Questions

1. Does the owner want to comment on PNS26-62 (CAP as the primary WWA format, VTEC retired) by 2026-09-21? A person's act under a person's identity. The code has no VTEC dependency, but the WWA map service the app reads is VTEC-derived and the comment is the moment to ask for polygon-first CAP and a stable event code.
2. Carried unchanged: Spotter Network contact; a `127.0.0.1` endpoint under "nothing new leaves the machine"; ODIN's unstated licence; the PNS26-63 feedback by 2026-09-21; the publish of 0.5 through 0.10, the isolated desktop session, the clean VM, the code-signing purchase, and the upstream `lru` pull request, all in `Roadmap_Blocked.md`.
