# Research: OpenRadar

Date: 2026-09-03. Replaces all prior research. Repository snapshot: `f64b0ac` on `main`, manifests at v0.8.0, `CHANGELOG.md` already carrying an unreleased `v0.9.0` section, published release still v0.4.0. This is the sixth pass; the fifth ran on 2026-09-02 at `49a3604`. Between the two, twelve commits shipped five of that pass's items (`AUD-173` site status from the NWS, `AUD-174` FLASH ratios and gauge-corrected QPE, `AUD-186` dependency refresh, `AUD-201` the loop's length and export, `AUD-203` sites in reach, plus `AUD-204` born and closed the same day) and two refutation passes fixed sixteen defects in them. A parallel drain session was mid-way through `AUD-180` (county boundaries) while this was written. Everything below was verified on 2026-09-03 unless labelled otherwise. Labels: Verified (fetched or read in the tree), Likely (documentation or search snippet only), Assumption, Needs live validation.

## Executive Summary

OpenRadar is the most complete keyless desktop radar workstation in the open-source field and, after this week, the only one that reads radar site health from the weather service, corrects rain totals against gauges, and draws flash flood guidance ratios. Its weakest point is unchanged and now three months of fixes deep: the published updater manifest still says 0.4.0 (redirect target `releases/download/v0.4.0/latest.json`, fetched 2026-09-03), so no installed copy has been offered anything since 2026-08-31, and only the owner can publish. After that, the product's gaps are no longer whole lanes but seams: the compare pane still steps the mosaic while a held site loops; a live-contract gate names a host the app never reaches; a native crash leaves no file behind; nothing starts the app with Windows, so the watch a reader set up is dead until they remember to launch it; and the SPC, MRMS and IEM services the app already reaches carry probabilistic outlooks, lightning grids, hail tracks and replay-time reports that nothing draws. The competitive floor moved this week too: HookEcho added power outages and placefile images, WeatherFront ships a desktop web app with a quad-pane view, WeatherWise made 1990s single-site archive free, and Storm Radar relaunched at $19.99 a year with an AI assistant.

Top opportunities, in order:

1. **Publish.** `gh release list` shows nothing newer than v0.4.0 (2026-08-31); the release gate itself is green through `f64b0ac`. Verified. Owner's act, tracked in `Roadmap_Blocked.md`.
2. **Close the loop's last seam**: `src/App.tsx:955-957` computes the compare frame from the mosaic series even when a held site is looping, so dual pane shows two cadences. Verified.
3. **Make the `spc` live contract honest**: `scripts/live-contracts-lib.mjs:177` names `www.spc.noaa.gov`, which is in neither `ALLOWED_HOSTS` nor the CSP; the app reads SPC through `mapservices.weather.noaa.gov` (`src/lib/overlays/spc.ts:13-20`). The gate can pass while the real service breaks. Verified.
4. **A file when the process dies.** `Roadmap_Blocked.md` documents a 202-byte file that ends the process with no message; `src-tauri/src/lib.rs:79` only logs panics. A local minidump (Embark `crash-handler` + `minidumper`) and a "last run ended abnormally" line on the next start cost nothing in privacy. Verified.
5. **Start with Windows and open to the tray.** `src-tauri/Cargo.toml` has no autostart plugin; `tray` and `closeToTray` exist (`src/lib/settings.ts:441-460`); `tauri-plugin-autostart` 2.5.1 is the stock answer. Verified.
6. **SPC probabilistic outlooks**: `SPC_wx_outlks/MapServer` layers 0-25 carry Day 1-2 tornado, hail and wind probabilities with conditional intensity, Day 3 probability and Day 4-8; the app draws layer 1 only. RadarScope 5.6 and MyRadar 7.124 both added these in 2026. Verified.
7. **Outlooks and storm reports at the replayed time** from IEM endpoints on a host already allowed (`/nws/spc_outlook`, `/nws/lsrs_by_point`, `/spc_watch_outline.geojson`); archived warnings already come from there. WeatherWise made 1990s archive free on 2026-09-03; Anvil's Past Event Viewer keys outlooks and reports to the replayed window. Verified.
8. **The lightning and hail grids on the bucket the app already decodes**: `LightningProbabilityNext30/60min`, `LtgJumpGrid`, `Reflectivity_-10C/-20C`, `MESH_Max_30..360min`, `EchoTop_30/50/60`, `VIL_Max`, and a 33-level `MergedReflectivityQC`/`MergedRhoHV`/`MergedZdr` cube. Verified from the CONUS prefix listing.
9. **Windows contrast themes**: `src/index.css` has `prefers-contrast: more` and no `forced-colors` rule, so a reader on a Windows contrast theme gets the UA's colours on the chrome and the map's own on the canvas. Verified.
10. **Keyless European radar is possible now**: MET Norway's radar API has no usage restrictions beyond a User-Agent, and EUMETNET's OPERA composites are served through MeteoGate with an anonymous tier under CC BY 4.0, which changes the `Roadmap_Blocked.md` verdict that ORD needs keys. Verified docs, Needs live validation for the anonymous rate limit.

## Product Map

- Core workflows: watch live radar over a place with a two-hour national loop and a nearest-site Level II view that loops across up to thirty volumes, with the office's own word on whether each radar is running; interrogate a storm (tilts, six moments, dealiased and storm-relative velocity, cells, classification, ProbSevere, cross-section, sounding); read the rain (radar-only and gauge-corrected totals, FFG ratios, unit streamflow); be told when a warning reaches one of ten watched places in the US, Canada or Germany; replay and export (bundles, PNG, GIF, WebM, CSV, GeoTIFF, per-volume provenance); plan (route, guidance, tides, surge, tropical). Evidence: `README.md`, `CHANGELOG.md` v0.9.0 section, commits `41fe9b0`, `7fc0c11`, `651a3af`, `e6aeff7`, `f64b0ac`.
- Personas: the subscription-refusing enthusiast, the chaser with palettes and placefiles, the anxious monitor (calm mode, quiet hours), the second-monitor ambient reader (tray, glance, wallpaper), the flood-prone reader (new this week), the winter-weather reader, the francophone Canadian, the screen-reader user (Nearby). Evidence: `CHANGELOG.md` 0.5.0 to 0.9.0.
- Platform and distribution: Windows x64 only, NSIS current-user installer, updater signed with the project's minisign key, no Authenticode; `scripts/release.mjs` checks version agreement, the published-lag gate, `cargo fmt`, clippy, `cargo test --lib`, e2e, signature and hashes; no Defender scan, no ARM64 target; `.github/` holds one issue template and no workflows. Verified.
- Data flow: every native request goes through `src-tauri/src/http.rs` (31 hosts, 16 MiB body cap, 30 s timeout, 4 rechecked redirects); the page CSP names 22 https hosts for `connect-src`; 23 live contracts in `scripts/live-contracts-lib.mjs`; 12 overlay adapters in `src/lib/overlays/`; MRMS table holds 17 products (`src-tauri/src/mrms.rs:533-725`); disk cache budget 768 MiB with one slot per exclusive switch group. Verified.

## Competitive Landscape

### Open source

- **HookEcho** (d4vid87, Rust wgpu, v0.12.0-beta.2 on 2026-08-31, 12 commits 2026-09-01 to 09-03). Added an ODIN county power-outage layer on by default (#271, #273, cross-hatched in #275), NHC tropical on by default with a Windy-style cone (#268-270), request deadlines and tile retry backoff (#278), and has PR #276 open for high-contrast colormaps plus placefile `Image:` with `Object:` nesting. Learn: the outage feed is keyless and CORS-open (`ornl.opendatasoft.com`); placefile images are table stakes now. Avoid: layers on by default that are not radar. Verified via `gh api`.
- **Anvil** (jhammon88219, C# WinUI 3, AGPL, created 2026-06-14, pushed 2026-09-02, 1 star). Client-side Level II with SAILS and split cuts, a Py-ART region dealiasing port, storm motion from a full-volume VAD, DOW mobile radar frames, offline PMTiles basemaps with user-editable style JSON, and a Past Event Viewer to the 1990s with outlooks and reports keyed to the replayed window. Learn: the replay pattern. Verified.
- **BowEcho / GenericRadar** (FahrenheitResearch, Rust). BowEcho unchanged since v0.35.0; GenericRadar (pushed 2026-08-25) reads ODIM_H5, DORADE, CfRadial, GR2Analyst `.msg31`, RVP8 I/Q and exports looping GIFs. Learn: nothing new for this app's lane; the format breadth is a research tool's. Verified.
- **Supercell Wx** (v0.6.1 unchanged). New since the last pass: PR #688 "File > Save NEXRAD Product", PR #689 hail/meso/TVS attribute overlays, issue #685 SPS support, PR #682 opacity control (merged 2026-08-26), PR #683 ARL/MSL beam height in the tooltip (merged 2026-08-14). Verified.
- **OpenStorm** (JordanSchlick, UE5, 137 stars, pushed 2026-05-06): volumetric ray-marching that samples the polar volume directly with temporal interpolation; VR. Reference if 3D is ever built. Verified.
- **azimuth** (rk234, Kotlin, 2026-08-25): four simultaneous radar panes, 50-frame scrub. **mesoview** (rvanasa, 2026-08-28): SPC mesoanalysis with composable overlays and URL-encoded views. **cwmac/mrms-viewer**: MRMS reflectivity at the -10 °C and -15 °C isotherms. **AtmosphericX** and **spc-bot**: NWWS-OI fast warning paths (need an NWS account). **weather-mcp** v1.26.0 (2026-09-03, 42 stars): keyless MCP server with radar, lightning, rivers. Verified.
- **LibreWXR**: dropped Carto for OpenFreeMap (#32, 2026-08-27) after Carto began requiring a key; issue #31 asks for cell data over REST. **jpettitt/weather-radar-card** (Home Assistant, 447 stars, v3.9.0 2026-08-26) broke the same way (#253, #257, #258). Learn: basemap independence is a live complaint; the app's OpenFreeMap plus incident packs already answer it, and a user-supplied PMTiles import (Anvil, StormDeck) would finish it. Verified.
- **danielway/nexrad**: no commits since 2026-07-21; the negative-elevation fix stays unreleased. **netcdf-reader / hdf5-reader**: 0.9.1 (2026-07-29) is still newest, and PR #81 (merged 2026-07-14, in 0.9.0) added an object-header cycle guard and a datatype recursion limit; OpenRadar's reproducer still takes the child process down under the pinned 0.9.1, so the limit does not cover this path, and the upstream report should say so. Verified.

### Commercial

- **RadarScope** 5.6 (2026-08-12) added probabilistic outlook categories; 5.6.1 (2026-09-02) optimised downloads on poor connections. Tier 1 $9.99/yr, Tier 2 $14.99/mo or $99.99/yr. Verified App Store.
- **WeatherFront** 1.23.0 (2026-08-06): GOES-West and Himawari-9, 24-hour satellite loops, smoke forecasts; 1.22.0 (2026-06-01): chaser positions and 45 TDWR sites; a desktop web app with web-only quad-pane "AWIPS-style" view, custom polygon formatting and a time-of-arrival tool; free tier plus $9.99/mo or $99.99/yr. Verified.
- **Storm Radar** (The Weather Channel) relaunched 2026-03-31 with a generative-AI assistant, single-site radar with "12+ storm parameters" and future radar to 72 h; $3.99/mo or $19.99/yr. Verified press release.
- **MyRadar** 7.122 (hail alerts and layer, Critical Alerts), 7.124 (Live Activities, SPC Day 3-8 probabilistic outlooks). Verified App Store.
- **WeatherWise** made archived single-site radar to the early 1990s free on the free tier (15 frames per window), Stormtrack 2026-09-03. Verified.
- **RadarOmega** 5.8.0 (2026-07-15) bug fixes only; a third-party report calls it maintenance mode with black screens in severe events. Likely.
- **Windy** retired the Radar+ layer and lost point precipitation readouts; Indonesia radar missing since 2026-01. Likely (forum).
- **Pivotal Weather** Hobbyist $9.99/mo; **WSV3** monthly only at $25 with a promised rewrite unshipped; **AllisonHouse** rebranded Weather Pulse at $14.99 and $29.99/mo. Verified or Likely as noted in Sources.
- **RainViewer** now says "free for personal or educational use", zoom capped at 7, 100 requests per IP per minute. Verified FAQ.

### Community signal

- Hacker News 2026-08-13 (17 points): the Windows 11 Weather app at 1.2 GB of RAM; replies say a native app should fit in 100 MB. The app's soak item (`AUD-166`) should end in a number the README can print. Verified.
- Slate 2026-08-21 (HN 2026-09-01): single-model weather apps criticised, CARROT praised for radar, NWS capacity cuts noted. Verified.
- Stormtrack: WeatherWise archive post (2026-09-03); the Supercell Wx thread still records one user switching from GRLevelX once placefiles and colour tables worked. Verified.
- Home Assistant forum (2026-09-02/03): the radar card's users want auto full-screen during events and hit the Carto key break. Verified.
- Reddit was unreachable from this machine (403 on every mirror); nothing new could be read there.

### Adjacent

- **ForeFlight** colours the radar age (white, yellow at 15 min, red at 20). The app already prints "not heard from for {age}" and a stale legend; a colour step on the timestamp is the remaining half. Likely.
- **Garmin Pilot Web** (2025-10-08) scrubs past and future radar on one bar; the app already does this with the HRRR tail. Verified.
- **Watch Duty** flood alerts (2026): per-gauge personal thresholds, county alerts that override quiet settings. The app's river gauges and watch rules are the parts; a per-place threshold on MESH or shear is the analogue. Likely.
- **Esri "up arrow"** and **Audiom** (GAADy 2025): arrow keys step a virtual cursor across features with announcements; the app's Nearby panel is the summary form of this, not the cursor form. Verified.
- **StormDeck** and **StormviewRadar** (the owner's own repos): undo on every destructive removal, a 30-day redacted provider incident history in diagnostics, settings search, a licensed PMTiles importer, and `avc1` codec detection strings for MP4 export (`C:\repos\StormviewRadar\src\animation-export.js:51-52`). Verified in the tree.

## Reported Issues

The tracker holds zero issues and zero pull requests (`gh issue list`, `gh pr list`, 2026-09-03; discussions disabled; 2 stars). The effective tracker is the drain's own refutation passes: `8e9dd29` (nine defects) and `e8d9a7a` (seven) in work shipped hours earlier. What they found is worth knowing before touching those modules: MapLibre's `idle` says nothing about whether a ten-megabyte volume arrived, so a loop export captured the previous volume under the next volume's caption; a status feed about somebody else's equipment must order candidates and never exclude them; the Level II timestamp must not be applied to terminal radars that never publish Level II; a `settings.ts` import from `lib/providers` emptied `DOMAINS` and dropped Alaska, Hawaii, Guam and Puerto Rico onto the worldwide fallback with only `coverage.test.ts` noticing; MRMS changed `RotationTrack60min` from 0.01° to 0.005° without notice and the product table is only exercised live (`cargo test mrms::tests::every_product_decodes -- --ignored`).

Seams found in this pass, with the code:

- Dual pane compares against the mosaic while a held site loops: `src/App.tsx:955-957` `compareFrame = frames[frameIndex - compareOffset]`. Verified.
- The `spc` live contract host mismatch: `scripts/live-contracts-lib.mjs:177` versus `src/lib/overlays/spc.ts:13-20`; `www.spc.noaa.gov` appears in the tree only as attribution links. Verified.
- No clear-cache action anywhere: no cache command in `src-tauri/src/lib.rs`, none in `src/lib/commands.ts`; cache state is visible only in Diagnostics. Verified.
- Settings export has a button (`src/panels/MapOptionsPanels.tsx:1289`); import only works by dropping a JSON on the Upload panel (`src/panels/UtilityPanels.tsx:63`, `src/hooks/useWorkspaceActions.ts:341`). Verified.
- Destructive actions without undo: incident pack delete (`IncidentPackManager.tsx:228-236`), palette remove, overlay file remove, custom sound and theme clear; settings reset, journal clear and place removal do have undo. Verified.
- `src/components/ErrorBoundary.tsx:34` offers reload only; no copy-diagnostics, no next step. Verified.
- No app-wide offline state: `src/lib/online.ts` is consumed only by `useRadarTimeline.ts`; the chrome says "Showing the last view · {age} old" and nothing else knows. Verified.
- Adjacent-tracker asks still unmet: Supercell Wx #14 counties (in progress in the parallel session), #383 VWP (`AUD-185`), #581 lightning near a place (`AUD-179`), #655 KML (`AUD-181`), #685 SPS (the WWA feed's significance `S` rows are already read, `src/lib/overlays/alerts.ts:290`; unverified whether the watch announces them), PR #688 save the product (no `.ar2v` in `src-tauri/src/exports.rs:24`). Verified.

## Security, Privacy, and Reliability

- **Dependency state, 2026-09-03.** `npm outdated`: only `typescript` 5.8.3 → 7.0.2, held by decision. `npm audit --omit=dev`: 0. `cargo audit` 0.22.2: 0 vulnerabilities, 17 warnings, one unsound (`lru 0.16.4`, RUSTSEC-2026-0253, analysis in `Roadmap_Blocked.md`; the fix exists only in `lru` 0.18.2+ and `hdf5-reader` still pins `^0.16.3`). `Cargo.lock` already carries hyper 1.11.1, h2 0.4.19 and flate2 1.1.10 (gzip extra-field and infinite-loop hardening, 2026-08-28). Verified.
- **New RustSec 2026-08-25 to 09-03** (stable-vec, wasmtime, suppaftp, rtrb, azure_core, zip-extract and others): none in this tree. No npm advisories for vite, vitest, esbuild, react, maplibre-gl, eslint, playwright or the Tauri packages in the window. No new supply-chain incident after arrayref (2026-08-20). Verified.
- **Chromium 152 (2026-09-01)** fixes a critical use-after-free in WebGL (CVE-2026-84352); Edge and WebView2 152.0.4191.62 (2026-09-02) carry it. The runtime is Evergreen so installed copies update themselves; the app records the renderer in diagnostics but not the WebView2 version (`grep webview2 src-tauri/src` finds nothing). Verified.
- **WebView2 152.0.4191.53 (2026-08-28)** fixed a startup crash and a cross-origin redirect failure when `WebResourceRequested` is attached; Edge 152 begins the `unload` ramp (handlers skipped on 60% of loads, 100% by 155). The tree has no `unload` listener. Verified.
- **Tauri**: core 2.11.5 still newest; the 2026-08-31 plugin set is already in the tree except `single-instance` 2.4.3 → 2.4.4. `tao` 0.37.0 (2026-08-21) fixes the `WM_ENDSESSION` "cannot move state from Destroyed" crash and drops Windows 7; `wry` 0.56.1 fixes a WebView2 teardown crash; neither is in `tauri-runtime-wry` 2.11.4 yet (pins tao ^0.35, wry ^0.55). Verified.
- **Service changes.** PNS26-63 (2026-09-01): SBN/NOAAPort and satellite NWWS retire as early as 2027-08-31; feedback to 2026-09-21. The app uses none of them, but this is the programme that ends NOMADS Level II on 2026-09-15 and the AWS buckets are the continuity path worth asking for by name. NEXRAD Build 24.2 deploys September 2026 (no Level II format change); Build 25.0 (LTR, SHC, RPG AzShear product) slips to mid-2027, so SCN26-54's 2027-02-15 date is optimistic. NESDIS retires the Legacy ABI RRQPE on 2026-11-02 (not read here). DWD's ICON URL scheme changes after 2026-11-30 (radar WMS/WFS untouched). KB5120998 (2026-08-27) has an open Windows regression that turns the desktop black; if a reader blames the wallpaper writer, the app restored what it recorded. Verified PDFs and pages.
- **MRMS**: NSSL's code-updates page still ends at v12.3.1 (2026-02-04) and the product tables at v12.2; the 0.005° `RotationTrack` regrid the app hit on 2026-09-02 is verified only from the live files, and no notice names it. Grid changes will keep arriving unannounced. Verified.
- **Terms that shape the roadmap.** Spotter Network TOU (2012-03-27): personal and non-commercial only, data retained at most 48 hours, no redistribution or derivative works. ODIN's Opendatasoft dataset has a null licence field (publisher ORNL, 1,160 county records on 2026-09-03). JMA warnings may not be reproduced without authorisation; BoM data is personal-use only; MeteoAlarm is CC BY 4.0 with no registration, Atom only since 2026-01-14; MET Norway radar has no usage restrictions and requires a User-Agent; MeteoGate serves OPERA composites as COG GeoTIFF with an anonymous tier under CC BY 4.0. Verified.
- **Privacy posture holds.** Nothing proposed here adds a listening socket, an account, or telemetry. The two ideas that would (an HA tile endpoint, an MCP server) are in Rejected.

## Architecture Assessment

- **Pressure points by size**: `src-tauri/src/level2.rs` 6,467 lines (+139 since 2026-09-02), `src/index.css` 5,539, `mrms.rs` 3,903 (+596), `src/App.tsx` 2,478, `level3.rs` 2,181, `incident_packs.rs` 2,019, `MapViewport.tsx` 1,976, `MapOptionsPanels.tsx` 1,953, `settings.ts` 1,721. Four roadmap items (`AUD-189` to `AUD-192`) all land in `level2.rs`; the split (decode, listing, render, derive, loop) should precede them and has no item. Verified.
- **MRMS ingest now has a fold path** (`reduction_for`, `reduced_geometry`, row-wise max, `mrms.rs:1055-1218`) so a 0.005° grid rides the same code as `RotationTrack60min`; `MergedAzShear` (`AUD-175`) is the same fold. The bucket's 33-level `MergedReflectivityQC` stack is the same discipline and template. Verified.
- **The timeline's two frame notions** are reconciled everywhere except dual pane. Verified.
- **The overlay adapter shape** (`ecccAlerts.ts`, `dwdWarnings.ts`) is ready for MeteoAlarm; the hazard vocabulary is per-country mapping. Verified.
- **No native crash capture.** `lib.rs:79` logs panics; a stack overflow or access violation writes nothing. Embark `crash-handler` and `minidumper` write local minidumps with no upload; WebView2 writes its own to `EBWebView\Crashpad\reports`. Verified.
- **Test and documentation gaps**: 155 vitest files, 36 e2e specs, coverage floors 63/56/57/64; twelve panels have no sibling test (CuriositySection, ExportPanel, GuidancePanel, IncidentPackManager, JournalSection, MapOptionsPanels, RecapSection, RoutePanel, SearchPanel, SoundingPanel, TidesPanel, UtilityPanels); the axe gate still scans panels in dark only (`AUD-162`); the README screenshot is from 2026-08-31 (`AUD-200`). Verified.

## Rejected Ideas

Carried, all still correct: cloud accounts, telemetry, sync; mobile clients; plugin marketplace; arbitrary remote placefile URLs without a trusted-host decision; RainViewer as primary; local or generative nowcasting beside observations; Windows 11 widget (needs MSIX); `.scr` screensaver; EAS/WEA/1050 Hz imitation; streaks and guilt notifications; a second live MapLibre map in a secondary surface; Chocolatey from this repo; CIRA SLIDER scraping; NWS gridpoint raster; a JS Skew-T dependency; headless snapshot HTTP server; `--enable-unsafe-swiftshader`; frame interpolation; SignPath (needs a trusted CI build); TypeScript 6/7 now; Open-Meteo modelled flood/air/marine over observed sources; Blitzortung; mPING; per-station ECCC/DWD volumes.

| Idea | Decision and evidence |
| --- | --- |
| Spotter Network positions | Still under consideration only after the owner contacts them, and now narrower: the TOU is personal and non-commercial, 48-hour retention, no redistribution. A free desktop app displaying positions for its own reader fits "personal" on its face, but the developer-contact ask stands. https://www.spotternetwork.org/tou.php |
| Webhooks / MQTT / Home Assistant | Under consideration, unchanged: needs the owner's decision on a `127.0.0.1` endpoint. The HA radar card consumes XYZ tiles, which would need a listening socket. |
| MCP server (weather-mcp, FahrenheitResearch/weather-mcp) | Reject. A local server process is the headless-server class already rejected; nothing about the app's data is unavailable to an agent through the exports. |
| NWWS-OI fast warning path (spc-bot, AtmosphericX) | Reject. It needs a per-user NWS XMPP account, which is an account. The WWA map service and `alerts/active` remain the keyless path. |
| ODIN county power outages (HookEcho #271) | Under consideration. Keyless, CORS `*`, official DOE/ORNL, county polygons embedded, but the dataset's licence field is null and participation is opt-in per utility. Roadmap-eligible once the owner accepts an unstated licence or ORNL states one. https://ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county |
| TorNet tornado probability (ONNX, `ort`) | Defer. An ML runtime adds tens of megabytes and a model whose single-site skill is unlabelled; `AUD-189` (AzShear, debris flag) is the deterministic version and comes first. https://github.com/mit-ll/tornet |
| Quad pane / AWIPS layout (WeatherFront web, azimuth) | Later. Dual pane exists; four panes is a MapLibre instance per pane, which the second-map rejection already covers unless panes share one context. |
| cmweather CVD palettes as built-ins | Reject as an item. `src-tauri/src/contrast.rs` already simulates protanopia and deuteranopia against every built-in ramp, and readers load their own `.pal` files. https://github.com/openradar/cmweather |
| Path-CVP transects (AMT 19:775, 2026) | Under consideration after `AUD-190`; the cross-section already draws a vertical slice along a line, and CVP is that slice with a Cressman gather. |
| DOW mobile radar frames (Anvil) | Reject. No public live feed; the archive is a research request. |
| Radar-age colour on the timestamp (ForeFlight) | Fold into existing behaviour: the legend already says "not heard from for {age}" and the chrome marks stale frames; a colour step alone is not an item. |
| WebView2 runtime floor prompt | Reject. The runtime is Evergreen and updates itself; recording its version in diagnostics is the useful half and is an item. |
| Windows 7 support line | Nothing to do: `tao` 0.37 drops it, but Tauri 2 never listed it. |

## Sources

### Repository and release state
- https://github.com/SysAdminDoc/OpenRadar/releases/latest/download/latest.json
- https://github.com/SysAdminDoc/OpenRadar/releases

### Competitors and community
- https://github.com/d4vid87/hookecho/commits/main
- https://github.com/d4vid87/hookecho/pull/271
- https://github.com/d4vid87/hookecho/pull/276
- https://github.com/jhammon88219/Anvil
- https://github.com/FahrenheitResearch/GenericRadar
- https://github.com/dpaulat/supercell-wx/pulls
- https://github.com/JordanSchlick/OpenStorm
- https://github.com/rk234/azimuth
- https://github.com/rvanasa/mesoview
- https://github.com/cwmac/mrms-viewer
- https://github.com/JoshuaKimsey/LibreWXR/issues
- https://github.com/jpettitt/weather-radar-card/issues/253
- https://github.com/weather-mcp/weather-mcp
- https://github.com/full-bars/spc-bot
- https://github.com/danielway/nexrad/commits/main
- https://github.com/roteiro-gis/netcdf-rust/pulls?q=is%3Apr+is%3Aclosed
- https://apps.apple.com/us/app/radarscope/id288419283
- https://apps.apple.com/us/app/weatherfront-radar-models/id6739154126
- https://www.weatherfront.com/
- https://apps.apple.com/us/app/myradar-accurate-weather-radar/id322439990
- https://www.weathercompany.com/news/enhanced-storm-radar-app-brings-expert-level-weather/
- https://stormtrack.org/threads/weatherwise-adds-free-archived-radar.33509/
- https://apps.apple.com/us/app/radaromega-doppler-radar-app/id1439881811
- https://home.pivotalweather.com/subscriptions
- https://wsv3.com/release.php
- https://www.rainviewer.com/api/transition-faq.html
- https://news.ycombinator.com/item?id=49290078
- https://news.ycombinator.com/item?id=49523442
- https://slate.com/technology/2026/08/weather-app-forecast-apple-android.html
- https://community.home-assistant.io/t/major-new-feature-release-of-the-weather-radar-card/1009431
- https://www.spotternetwork.org/tou.php
- https://www.spotternetwork.org/feeds/gr-all.txt
- https://placefilenation.com/index.php
- https://supercell-wx.readthedocs.io/en/stable/user-guide/placefile-specification.html

### Data sources verified live
- https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS/&delimiter=/
- https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer?f=pjson
- https://mesonet.agron.iastate.edu/api/1/openapi.json
- https://ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county
- https://api.met.no/weatherapi/radar/2.0/documentation
- https://api.met.no/doc/TermsOfService
- https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/
- https://feeds.meteoalarm.org/
- https://www.jma.go.jp/jma/en/copyright.html
- https://eccc-msc.github.io/open-data/licence/readme_en/
- https://www.weather.gov/disclaimer/
- https://weather-gov.github.io/api/general-faqs
- https://vlab.noaa.gov/web/wdtd/-/mesh-tracks

### Service change notices and platform status
- https://www.weather.gov/media/notification/pdf_2026/pns26-63_NOAAPort_retire_feedback.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-74_NBMv5.0.15.pdf
- https://www.weather.gov/notification/
- https://www.roc.noaa.gov/branches/engineering-branch/software-engineering.php
- https://www.roc.noaa.gov/build-status.php
- https://inside.nssl.noaa.gov/mrms/code-updates/
- https://www.nssl.noaa.gov/projects/mrms/operational/tables.php
- https://www.nesdis.noaa.gov/news/retirement-of-goes-r-rainfall-ratequantitative-precipitation-estimation-grrqpe
- https://www.ospo.noaa.gov/operations/goes/status.html
- https://www.dwd.de/DE/leistungen/opendata/neuigkeiten/opendata_september2026_1.html
- https://www.weather.gov/documentation/services-web-api
- https://learn.microsoft.com/en-us/windows/release-health/status-windows-11-25h2
- https://support.microsoft.com/help/5120998

### Algorithms and design research
- https://amt.copernicus.org/articles/14/2873/2021/
- https://amt.copernicus.org/articles/19/775/2026/amt-19-775-2026.html
- https://amt.copernicus.org/articles/18/793/2025/
- https://gmd.copernicus.org/articles/17/5309/2024/
- https://github.com/mit-ll/tornet
- https://github.com/openradar/cmweather
- https://repository.library.noaa.gov/view/noaa/67694
- https://www.weather.gov/media/notification/pdf_2025/scn25-46_Updated_MRMS_v12.3.pdf
- https://inside.nssl.noaa.gov/ewp/
- https://training.weather.gov/wdtd/buildTraining/build24/index.php
- https://gaad.foundation/what-we-do/gaadys/winners/audiom
- https://www.esri.com/about/newsroom/arcnews/pressing-the-up-arrow-big-step-forward-in-accessibility
- https://support.foreflight.com/hc/en-us/articles/203313109
- https://www.garmin.com/en-US/newsroom/press-release/aviation/garmin-announces-new-weather-features-for-garmin-pilot-web/
- https://support.watchduty.org/hc/en-us/articles/46400067603341-Flooding-Notifications-FAQs
- https://blogs.windows.com/msedgedev/2024/04/29/deprecating-ms-high-contrast/
- https://www.w3.org/TR/wcag-3.0/

### Dependencies, platform, security
- https://github.com/tauri-apps/plugins-workspace/releases/tag/updater-v2.11.0
- https://github.com/tauri-apps/tao/releases/tag/tao-v0.37.0
- https://github.com/tauri-apps/wry/releases/tag/wry-v0.56.1
- https://v2.tauri.app/plugin/autostart/
- https://crates.io/api/v1/crates/tauri-plugin-autostart
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.6.0
- https://github.com/jeromefroe/lru-rs/blob/master/CHANGELOG.md
- https://github.com/rust-lang/flate2-rs/releases/tag/1.1.10
- https://github.com/hyperium/hyper/releases/tag/v1.11.1
- https://github.com/rustsec/advisory-db/commits/main
- https://chromereleases.googleblog.com/2026/09/stable-channel-update-for-desktop.html
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnotes-security
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/runtime/152
- https://learn.microsoft.com/en-us/microsoft-edge/web-platform/release-notes/152
- https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/diagnostics/crash.md
- https://github.com/embarkstudios/crash-handling
- https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- https://signpath.org/terms

## Open Questions

1. Does the owner want to contact Spotter Network? The TOU now read (personal, non-commercial, 48-hour retention, no redistribution) narrows the question to whether a free app displaying positions to its own reader counts as personal use. Blocks that item only.
2. Is a user-configured local endpoint (`127.0.0.1` webhook or MQTT) acceptable under "nothing new leaves the machine"? Unchanged from 2026-09-02.
3. Will the owner accept ODIN's unstated licence for a power-outage layer, or ask ORNL to state one? Blocks that item only.
4. Does the owner want to send NWS the PNS26-63 feedback by 2026-09-21 naming the AWS buckets and `api.weather.gov` as continuity paths? A person's act under a person's identity.
5. Carried from `Roadmap_Blocked.md`: the publish of 0.5 through 0.9, the isolated desktop session, the clean VM, the Azure Artifact Signing purchase (now a paid pay-as-you-go subscription with no free tier, FAQ updated 2026-08-14), and who files the upstream `hdf5-reader` and `netcdf-reader` issues.
