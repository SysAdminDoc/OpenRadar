# Research: OpenRadar

Date: 2026-09-07, evening. Replaces all prior research. Repository snapshot: `74cf9be` on `main`, manifests at v0.11.0 with an unreleased `v0.11.0` section in `CHANGELOG.md`, published release still v0.4.0 (2026-08-31). Ninth pass; the eighth ran the same day at 14:00 local at `eb4b1e5`. Seventeen commits landed between the two: the drain of `AUD-332`, `335`, `336`, `337`, `338`, `341`, `342`, `343`, `357` and `359`, the reconnected Level II live contract, the placement half of `AUD-360`, and three refutation rounds; then the read-only audit that logged `AUD-362` to `AUD-377`. This pass re-verified the eighth pass where the world had moved and dug where it had not: the dealiasing literature behind `AUD-362`, the crate table the radar picker is built on, what the advisory scanners can and cannot match, the platform the window runs in, and the adjacent-domain patterns nobody had looked at.

## Executive Summary

OpenRadar remains the most complete keyless desktop radar workstation in the open-source field: it decodes Level II, Level III, MRMS, GLM and the model grids itself, with no server, no account and no telemetry, and it explains its evidence on screen. Nothing found tonight changes that direction. What changed is the shape of the risk. The eighth pass thought the biggest correctness question was the dealiaser's blind spots, and the audit confirmed it (`AUD-362`). This pass found a second one of the same kind one layer down: the list of radars the picker offers is a static table inside the pinned `nexrad-model` crate, and that table is wrong today about five populated places. Both are the same lesson. A number that arrives from outside, whether a velocity or a site table, is remote input however long it has been cached.

Top opportunities, in order:

1. **The radar registry is stale and nothing checks it.** `src-tauri/src/level2/mod.rs:33` takes `registry` from `nexrad_model::meta`, whose table (157 entries) still carries `KLIX` (New Orleans, which `api.weather.gov/radar/stations/KLIX` answers 404 for and which has no objects on the bucket for 2026-09-07), lacks `KHDC` (Hammond, "Operate", objects today), `KBHX`, `KDOX`, `KLGX` and `PAPD`, lists `KCCX` twice (registry.rs lines 1081 and 1399), carries four obsolete Alaska aliases (`KABC`, `KACG`, `KAIH`, `KAKC`), and puts `KPBZ` at longitude -80.0183 against the NWS's -80.2179, seventeen kilometres east of the radar. Upstream issue #148 (2026-09-04) describes the fix and no crate has been published since 2026-04-03. Verified live, `AUD-378`.
2. **`AUD-362` has an operational answer in the literature, with the numbers.** 4DD brings a candidate to the nearest co-interval and accepts the wind's placement only when the residual is under `0.49 Vn`; on the audit's own example (Vn 25, wind +25, cell at -10) the residual is `0.60 Vn` and the cell is left alone. R2D2 moves a region only when every guidance source agrees on the interval and flags it otherwise. HookEcho's Rust dealiaser settles the whole graph with a maximum spanning tree and then re-votes every region against all its neighbours for up to ten passes. Py-ART never touches a region with no edge to the main body. Verified by reading the code; noted inline on `AUD-362` and `AUD-192`.
3. **The RPG's own dealiased velocity is on the bucket and is the oracle the refold test lacks.** `unidata-nexrad-level3` carries product 154 (`N0G`, super-resolution digital base velocity, 0.25 km by 0.5 degrees, the same geometry as the Level II cut) for every site, and the app already lists and decodes Level III radial products. Scoring the app's unfolded cut gate for gate against the RPG's is the per-gate truth measure that `broken_pairs`, `wrapped` and `invented` cannot be. Verified (listing), `AUD-379`.
4. **BowEcho is the dealiasing peer nobody had examined.** Apache-2.0, Rust, v0.35.0 on 2026-08-28, four engines including a Py-ART region port, and a bench crate whose own doc says of the boundary-pair measure: "NEVER read alone (a consistently wrong field scores ~0)". Its `--rewrap` mode scores per-gate branch correctness against a re-wrapped truth, which is the measure `AUD-362` asks for. Verified (read `crates/bench/src/dealias_eval.rs`).
5. **The advisory gates match crate names literally, and one advisory in the tree is spelled the other way.** GHSA-qwgh-2vcv-g2f7 (2026-08-19, medium, `< 0.12.1`) names `block_buffer` with an underscore; `Cargo.lock` carries `block-buffer 0.10.4` under `sha2 0.10.9`. `cargo audit` (no RustSec entry), `grype` (database built 2026-09-07) and `osv-scanner` all report clean. Reachability needs a caught panic inside a hash update, which nothing in the tree does, so this is a gate finding rather than an exploit. Verified, `AUD-380`.
6. **MapLibre 6.8.0 shipped today** with the two fixes the morning listed as unreleased (HTTP 204 tiles render transparent instead of erroring; a throwing render task no longer freezes the map) plus a `setTiles` stale-URL fix that lands on fourteen call sites. Drop-in; the worker path is unchanged. Verified; noted on `AUD-355`.
7. **WebView2 Evergreen 152.0.4191.66 (2026-09-04) carries the fix for CVE-2026-85046**, a V8 type confusion exploited in the wild and on CISA's KEV list with a 2026-09-18 due date. The app runs on the Evergreen runtime, so an installed copy is safe once Windows has updated it; the Diagnostics panel already shows the runtime version. Verified.
8. **Dates corrected from the morning:** the ROC expects Build 25.0 in mid-2027 (the 2027-02-15 date in SCN26-54 is the LTR product's), and RRFS has an operational bucket already (`noaa-rrfs-ops-pds`, `rrfs.`, `refs.` and `firewx.` days since 2026-08-12) where the morning said NOMADS only. `AUD-080` stays blocked on the 2026-10-06 notice, but fixtures can now be taken from the operational layout. Verified.
9. **Build 24.1 gave KBOX a 0.3 degree base tilt** with its own Level III product set (`NZG`, `NZH` and the rest, SCN26-20). The app matches cuts by angle, so the Level II path should already draw it; nothing asserts it, and the classification reads `N0H` where `NZH` is lower. Verified, `AUD-381`.
10. **Small, evidenced product gaps:** the watch rules carry radii that are never drawn (`AUD-382`); a crash at boot can loop with no plain-start path (`AUD-383`, the OBS sentinel pattern); the working notes are 182 KB against a 30 KB budget and are read at every session start (`AUD-384`).

## Product Map

- Core workflows: watch live radar over a place (a two-hour national loop, a nearest-site Level II view looping across up to thirty volumes, the office's own word on whether each radar is running, the next one offered when a held site stops); interrogate a storm (tilts, six moments, dealiased and storm-relative velocity, smoothing, a wind profile from the radar's own NVW product first, cross-sections, gate readout, beam height, cell tracks, hydrometeor class, ProbSevere, MRMS grids across five domains including rotation, shear, hail, lightning, FLASH, gauge-corrected rain and a chosen height of the 3D reflectivity); understand the day (the whole SPC outlook set with conditional intensity, WPC rain and winter outlooks, mesoscale discussions, warnings from three countries, reports from two sources, rivers, tides, surge, a key for every banded layer, day and night at the frame's own time); replay a past day with that day's warnings, outlook and reports, or from a `.orb` bundle offline; be told (ten watched places with arrival, lightning age and distance, warning radius, quiet hours, calm mode, a line saying when Windows refuses notifications); leave it running (tray, autostart, glance, wallpaper, a full-screen view that keeps the screen on and stands down for a warning); take it away (PNG, WebM, MP4, GIF, CSV, GeoTIFF with a provenance sidecar, incident packs, `.pal` colour tables).
- Personas: the subscription-refusing enthusiast, the chaser with palettes and placefiles, the anxious monitor, the second-monitor ambient reader, the flood-prone reader, the winter-weather reader, the streamer, the screen-reader user.
- Platform and distribution: Windows x64 only, NSIS current-user installer, minisign-signed updater with a daily check that downloads nothing on its own, no Authenticode; ARM64 blocked on a C compiler this account cannot install. Release gate in `scripts/release.mjs`; live contracts (`npm run check:live`, 26) are a documented check, not a gate.
- Data flow: every native request through `src-tauri/src/http.rs` (31 hosts), the page CSP for browser-side fetches, thirteen overlay adapters in `src/lib/overlays/registry.ts`, MRMS over `CONUS`, `ALASKA`, `HAWAII`, `GUAM` and `CARIB`, seven fuzz targets under `src-tauri/fuzz/fuzz_targets`. The radar site list is the pinned `nexrad-model` crate's registry, read through `src-tauri/src/level2/sites.rs`; the office's status for each site comes from `api.weather.gov/radar/stations` through `src-tauri/src/radar_status.rs`, which is the list the registry should be held against.
- Baseline at `74cf9be` (the audit's run, all green): `npm run check` 202 files / 1,999 passed / 39 skipped, one pre-existing lint warning; `cargo test --lib` 471 passed / 33 ignored; `npx playwright test` 712 passed / 2 skipped; `check:live` green at `04a9a49`; tonight `cargo audit` 0 vulnerabilities and the 17 documented allowances, `npm audit` 0, `grype` (database 2026-09-07) the one documented `glib` Medium, `osv-scanner` the same `glib` and `lru` plus sixteen unmaintained crates.

## Competitive Landscape

### Open source

- **HookEcho** (d4vid87, Rust, MIT). Five commits after the morning pass (2026-09-07 22:44 to 23:24 UTC), all on map-label placement (reserve interstate shields before place names, repeat shields at regional zoom). PR #313 (2026-09-07) fixes a kiosk tab that never navigates and so never re-reads a `#goto=` fragment. Its author posted a browser entry point, `hookecho.io`, on 2026-09-07. Its dealiaser (`crates/wxdata/src/dealias.rs`, 531 lines) is the counter-model to `AUD-362`: continuity flood fill at half a Nyquist, a mode vote per boundary with confidence, a Prim maximum spanning tree from the largest region, then up to ten re-vote passes of every solved region against all its neighbours; unconnected components keep zero offset and there is no wind vote at all. Learn: the re-vote loop. Avoid: the browser build (the fleet has StormviewRadar for that), the label work (the basemap styles here are the providers'), the hash-fragment class (Tauri delivers deep links as plugin events, not navigations). Verified.
- **BowEcho** (FahrenheitResearch, Rust, Apache-2.0, 17 stars, v0.35.0 on 2026-08-28). Four velocity engines: "optimized Region Global (the default Py-ART-style same-sweep network solve)", RIFT, Region Fast, and a v4 volume solve with an environmental-wind fixture and a temporal prior. `crates/bench/src/dealias_eval.rs` scores every engine on residual fold-boundary pairs (with the warning quoted above), reference RMS against the environmental profile and against a Browning and Wexler (1968) per-range-band fit of the engine's own output, per cent of gates branch-modified, isolated speck count, spot probes, best-of-N runtime and byte-identical determinism, and `--rewrap N` scores per-gate branch correctness against a re-wrapped truth. Learn: the metric set and the parity discipline (`AUD-379`, and inline on `AUD-362`). Avoid: the CUDA simulator crates. Verified.
- **Supercell Wx** (dpaulat): no commit and no issue activity since 2026-09-06, no release since v0.6.1 (2026-07-19). The open asks recorded on 2026-09-07 morning stand. Verified.
- **Anvil** (jhammon88219, C#, AGPL): the theme commit was force-pushed three times to 2026-09-07 01:06 UTC; still no release of any kind. Verified. **FX-Net-NextGen**: three commits on 2026-09-07 consolidating serverless feed bundles; nothing transferable. **pi-weather-station** 2.6.x: holds the last clean frame rather than flashing a bloom when the classifier mask fails, and the legend says when the mask did not run (`AUD-348`). **Omastorm**: first releases on 2026-09-07 and four issues within hours, the first of them "set my latitude and longitude", which is a first-run location complaint the audits here never raised because the app asks for a place. **LibreWXR**, **ZWeather**, **nexrad-workbench**: quiet. Verified.
- **The `nexrad` crates** (danielway): `nexrad-data` 1.0.0-rc.7 (2026-04-03), `nexrad-decode` 1.0.0-rc.3 and `nexrad-model` 1.0.0-rc.2 (both 2026-02-28) are the newest artefacts and are what the tree pins; the `decode_angle` sign fix (#146) and the live-decode resilience fix (#147) merged on 2026-07-21 and have never been released. `Cargo.toml`'s comment says "last release 2026-07", which is the fix date, not a release. Issue #148 (2026-09-04, open) restores the 156-site registry and adds a NOAA-snapshot audit; nothing has merged. Verified (crates.io versions API, `gh api`).
- **New this pass**, all Verified from the repository unless marked: **RadrView** (cwdaniel, MIT) draws biological scatter (birds, insects, bats) from the correlation coefficient with a palette of its own rather than masking it, the alternative shape for `AUD-348`. **arw** (stevo399, Python, 2026-09-07) speaks scene summaries for blind readers ("57 rain objects detected. Strongest: severe core, 31 miles E of the radar, moving SE at 8 mph. Note: 11 storms merged in the last scan"), which is the sentence `AUD-229` should end up able to say. **ClassicRadar** (JS) renders a 3D volume with several radars merged to fill each cone of silence; carried rejection here (3D before the cross-section is fast). **MRMS-browser** decodes the GRIB2's embedded PNG in a worker behind a three-tier cache; the app already does this in Rust. **WxLens** (C++/Qt) ships Windows, both macOS and an AppImage in two weeks; Windows-only is a rule here. **project-meridian** keeps GFS fields numeric in the browser by byte-range reads of the `.idx`, which is what `gfs.rs` does natively. **firestorm-lightning-data** shipped a layer of forty random points with no sign it was synthetic and says so in its README; the e2e stand-ins here never reach a reader. **radar-ng** (MIT) is a self-hosted tile pipeline with NAQFC air quality and Blitzortung; both are the server class. **WxAlerts-HA** pushes alerts over MQTT; a listening service. **open-meteo/weather-map-layer** (48 stars, GPL-2.0) is reference-only for an MIT tree. **Nembo** reads Italian DPC radar with a 30-minute nowcast; whether the DPC API is keyless Needs live validation, noted on `AUD-226`. **crystal-ball** is a Tauri 2 plus Cesium globe with 185 panels; nothing to borrow.
- Table stakes across the field are unchanged from the morning (keyless Level II and III, an explicit age on screen, dealiasing, the chunk bucket, GRLevelX placefiles, outlooks with reports, cell tracking, loop export, themes that hold the data ramps out); the app has all nine. Struck once and new tonight: a scored dealiasing bench (BowEcho), spoken scene summaries (arw), a bio-scatter palette (RadrView).

### Commercial

- **AllisonHouse is now Weather Pulse**: `allisonhouse.com` answers 301 to `weatherpulse.com`, Storm Chaser $14.99 a month or $164.89 a year, with maps $29.99 or $329.89. Nothing in this tree names AllisonHouse. Verified (redirect chain, pricing page).
- **RadarScope**'s public version history ends at v3.9 (June 2019); **GRLevelX** serves static product pages with no changelog and the user forum blocks automated reads (CleanTalk 403); a third-party report calling RadarOmega "maintenance mode at 5.7.1" contradicts the 5.8.0 verified on the App Store this morning, so it is not used. **MyRadar, Baron, Carrot, Windy, WeatherWise, WSV3**: no September announcement found. Verified negative.
- The morning's pricing table stands: RadarScope Windows $29.99, Tier 2 $99.99 a year; GRLevel3 $79.95; GR2Analyst $250; WSV3 $25 a month; WeatherWise Pro $159.99 a year.

### Community signal

- **Patrick Marsh, 2026-09-06**: "I'm looking for better color palettes for MESH in GR/Radarscope. What do you use?" The app writes `.pal` files since `0f990a9` and ships no MESH table of its own; `AUD-349` is the winter pair of this ask. Verified (Bluesky).
- **Feed loss, again**: "Weatherfront worked the whole time idk what causes radarscope to lose data feed so much. Omega also had no data either" (2026-09-03). Per-row freshness is `AUD-345`. Verified.
- **"Real ones use RadarScope pro"** (2026-09-02): the loyalty wall at the paid tier. Verified.
- **PlacefileNation launched MesoPulse on 2026-09-01**: an hourly, ML-post-processed hazard placefile for GRLevelX, GR2Analyst, WSV3 and Supercell Wx, free, and the catalogue now holds 54 placefiles in eleven families. It is a remote host the app cannot reach under the fixed CSP, which is the standing placefile-URL decision in `Roadmap_Blocked.md`; it is the strongest single argument yet for a trusted-host list, and it stays the owner's call. Verified.
- Hacker News: nothing radar-related since 2026-09-01 (Algolia). `public.api.bsky.app` 403s and `api.bsky.app` answers; Reddit, Stormtrack, wxforum, grlevelxusers.com and the ROC's low-elevation page all refuse automated reads from this machine.

### Adjacent

- **Always-on displays**: tar1090's `?kiosk`, persistence heatmaps and range rings; MagicMirror's `MMM-RAIN-RADAR` hides the radar unless a warning is active for the configured state. The app's full-screen view does the opposite on purpose ("It gets out of the way of a warning", `src/lib/ambientScreen.ts:24`), which is the better reading for an app whose workspace is the thing worth seeing when a warning lands; recorded so the next pass does not re-propose the inversion. Verified.
- **Earthquake early warning** (MyShake, Yurekuru): a ticking countdown to arrival and a minimum-intensity floor per place. The approach watch re-runs every minute (`src/hooks/useApproachWatch.ts:65`), which is the cadence the radar's own data supports; a countdown that ticks faster than the observation would be theatre. Not filed. Verified.
- **OBS Safe Mode** (obs-studio #8455): a zero-byte sentinel written at launch and deleted on clean shutdown; finding it next launch offers a start without third-party plugins. **Firefox Troubleshoot Mode** disables customisations temporarily and restores them on exit. **Firefox crash reports** are never sent on their own and sit locally until the reader submits one. The app has `crash_last_dump` and a crash screen but no plain-start path (`AUD-383`). Verified.
- **Accessible maps**: Audiom's neighbour traversal (arrow keys between adjacent regions, each announced with name and value), Chartability's audit questions (the checklist axe cannot be), Esri's keyboard measurement and location shortcuts (Fall 2025). Noted on `AUD-229`. Verified.
- **QGIS, OBS projectors, Sunshine, PowerToys, Windows notification docs, Breezy Weather, Earth Networks, Grafana kiosk**: carried from the morning, unchanged.

### Techniques and literature

- **Dealiasing, read at the source**: Py-ART `dealias_region_based` cuts the interval into three bands and labels components per band (the fixed-band scheme this repo's own comment says shatters a sweep, and it is Py-ART's default); edges are a mean not a mode; combining is greedy max-weight contraction with the larger node as base; **a region with no edge to the main body is never touched**; its `ref_vel_field` pass is broken as written (an index compared to a velocity at `region_dealias.py:506`, the last region skipped, the shift applied with the wrong labels). 4DD (James and Houze 2001, `dealias_fourdd.c`, defaults `compthresh 0.25`, `compthresh2 0.49`, `thresh 0.4`, `ckval 1.0`, `maxcount 10`): seeds only where the previous volume and the sweep above agree within `0.25 Vn`, grows on `0.4 Vn`, windows on an 11 by 11 mean with a three-way outcome (accept, accept but never seed, delete), and its sounding fallback accepts a shift only when some whole-interval move lands within `0.49 Vn` of the VAD, else leaves the gate alone. UNRAVEL (Louf et al. 2020, `vlouf/dealias`): reference radial is the weakest-wind radial, passes in a fixed order with `alpha` 0.6 to 0.8, and its 3D check maps each gate to the sweep above by azimuth and ground range `r cos(elev)` with a four-branch cascade that leaves a gate alone rather than forcing it. R2D2 (Feldmann et al. 2020, MeteoSwiss, replaced 4DD): shear buffers at `0.8 Vn` dilated 5 by 5 and excluded from region placement, a per-region standard-deviation check against guidance before any shift, **a region moved only when every guidance source (sweep above, previous volume, first guess) picks the same interval**, top-down through the elevations, and its own warning that the VAD "assumes spatial homogeneity, which can lead to large regions being dealiased incorrectly" and "requires high data coverage", which is the `fit.trusted()` guard arrived at independently. 2DVDA (Jing and Wiener 1993; Zittel and Jing, ROC): an internally generated environmental wind table places small isolated regions, with the Witt, Brown and Jing 2009 weight that goes to zero as a difference approaches `Vn`; Irene error rates 0.85 per cent against 11.98 for the legacy VDA. Xu et al. 2011: the VAD seeds, it does not override. wradlib and MetPy do not dealias velocity. No public hand-labelled benchmark exists; truth sources in use are ORPG output (Veillette et al. 2023), an NWP forward operator (R2D2) and manual correction (Samos et al. 2025). All Verified except the paywalled papers, marked Likely in the Sources.
- **Tracking and QC**: SCIT's seven reflectivity thresholds (30 to 60 dBZ, 50 km² components, two consecutive scans); TINT's defaults (`FIELD_THRESH 32`, `MIN_SIZE 8`, `SEARCH_MARGIN 4000 m`, `FLOW_MARGIN 10000 m`, `MAX_FLOW_MAG 50`, `MAX_SHIFT_DISP 15`); Ritvanen et al. 2026's cell graph (VIL threshold 1.0 kg/m², 10 km² minimum, link on 10 per cent overlap after advection; splits and merges in 7.2 per cent of 735,163 cells). Py-ART's texture gate filter defaults (`wind_size 7`, `max_textrhv 0.3`, `min_rhv 0.6`, `max_textrefl 8.0`), wradlib's Gabella filter (`wsize 5`, `tr1 6`, `n_p 6`, `tr2 1.3`, no dual-pol needed, so it works on a TDWR), and the NSSL finding that dense insect layers reach RhoHV 0.96 and defeat a plain CC gate, which is why depolarisation ratio is used. Noted on `AUD-224` and `AUD-348`. Verified.
- **Rendering**: MapLibre #7029 ("apply color-relief styling to any raster") was closed as a duplicate of style-spec #1490, which proposes a declarative `encoding` expression; nothing shipped in 6.7 or 6.8, so the `raster-dem` custom encoding under `color-relief` remains the only in-engine route (`AUD-340`). 6.7.0 switched `color-relief` to `texelFetch` for exact stops. `maplibre-contour` derives contour vector tiles client-side from a value-encoded raster through `addProtocol`, which is the isopleth follow-on once `AUD-340` lands. deck.gl-raster and WeatherLayers GL prove value-in-texture plus ramp-in-shader beside MapLibre, at the cost of a second renderer. MapLibre's WebGPU backend is a proof-of-concept PR (#7411) with the luma.gl evaluation closed on 2026-08-29; WebGL2-only for the foreseeable term. Verified.

## Reported Issues

The tracker holds zero issues, zero pull requests and no discussions (`gh`, 2026-09-07 evening; two stars, no forks). The effective tracker is the live contracts (green at `04a9a49`), the refutation commits (twenty titled "what a refutation found" since 2026-08-25), the audit register, and the trackers of the projects this one depends on or competes with.

- **A bug reported upstream that this app has**: danielway/nexrad #148 (2026-09-04), the registry defects listed in the summary. Traced to `src-tauri/src/level2/mod.rs:33` (`use nexrad_model::meta::registry`), `sites.rs:36` (`registry::sites()` behind `sites_in_reach`), `sites.rs:26` (`registry::site_by_id` behind `wsr88d_only`). Reproduced against the NWS list on 2026-09-07: 157 entries, 156 unique, `KCCX` twice; five ids the NWS no longer lists, eight it lists that the table lacks (`KBHX`, `KDOX`, `KHDC`, `KLGX`, `PAPD`, `RKJK`, `RKSG`, `RODN`); `KPBZ` 0.2 degrees of longitude off. `AUD-378`.
- **Live contracts**: all green at the last run; nothing to add.
- **Adjacent-tracker asks still unmet here**: Supercell Wx #480 filled placefile polygons and #617 sound only on a real upgrade (both unverified in this app), #691 free layer order (rejected for warnings); Omastorm #1 first-run location (this app asks for a place; not reproduced).
- **Judged stale or not actionable**: the `radar3pub.ncep.noaa.gov` per-site latency page (the app already reads `latency.levelTwoLastReceivedTime` from `api.weather.gov`, `radar_status.rs:201`); the AllisonHouse rename (not referenced in the tree); HookEcho's `hashchange` class (deep links arrive as plugin events here); StormDesk's glibc pin (Linux only); the RadarOmega "maintenance mode" report (contradicted by the verified 5.8.0); the ExplorerPatcher report of toasts dropping on 25H2 build 26200.8655 (unverified, single report).

## Security, Privacy, and Reliability

- **Dependency state, 2026-09-07 evening.** `npm outdated`: `maplibre-gl` 6.7.0 to 6.8.0 (2026-09-07), `@playwright/test` 1.62.1 to 1.63.0, `eslint` 10.9.1 to 10.10.0, `typescript-eslint` 8.69.0 to 8.70.0, `lucide-react` 1.41.0 to 1.42.0, `@types/node` 26.4.1 to 26.5.0, `typescript` 5.8.3 held (5.9.3 is the last 5.x and the only move available; `typescript-eslint` still caps at `<6.1.0`, and its TypeScript 7 parser PR #12803 describes itself as a prototype). Cargo: everything at latest except `image` 0.25.8 (0.25.10, no security content) and `sha2` 0.10.9 (0.11.0, the lever for `block-buffer`). `cargo audit` 0 vulnerabilities, 17 allowed warnings; `npm audit` 0. Verified.
- **The `block_buffer` advisory.** GHSA-qwgh-2vcv-g2f7 (RustCrypto/utils, 2026-08-19, medium): "A caught panic may leave the cursor position of `EagerBuffer` or `ReadBuffer` in a corrupted state; this in turn allows out-of-bounds reads/writes." OSV records the package as `block_buffer` with the range introduced 0, fixed 0.12.1 (0.12.1 published 2026-06-11); RustSec has no entry. `Cargo.lock` carries `block-buffer 0.10.4` through `sha2 0.10.9`, which the app pins directly and which `nexrad-decode`, `nexrad-model` and `tauri-codegen` also require. Three scanners report clean because they match the lockfile's hyphenated name against the advisory's underscored one. Reachability: a panic caught inside a hash update; the only `catch_unwind` in the tree wraps the NetCDF read in `lightning.rs`, which hashes nothing, so the corrupted buffer is never reused. A gate finding: `AUD-380`. Verified.
- **`lru`**: unchanged. 0.18.4 on 2026-09-03; `hdf5-reader` 0.9.1 still requires `^0.16.3`; roteiro-gis/netcdf-rust has zero open issues. The blocked note's reasoning stands. Verified.
- **New advisories 2026-09-05 to 09-07**: RUSTSEC-2026-0279 (rojo), 0280 and 0281 (greentic-setup malware); none in the tree. 56 npm advisories published since 2026-09-01; one touches the tree (`@humanfs/node < 0.16.8`) and the lock has 0.16.8. No Tauri advisory since GHSA-7gmj-67g7-phm9; wry has never had one; MapLibre's only advisory (CVE-2026-85061, `<= 6.4.0`) is behind the tree. Verified.
- **Chromium and WebView2.** Chromium stable stays 152.0.7977.82/.83 (2026-09-03); CVE-2026-85046 is exploited in the wild and on CISA's KEV list (added 2026-09-04, due 2026-09-18). Edge and WebView2 stable shipped 152.0.4191.62 (2026-09-02, "contains a fix for it") and .66 (2026-09-04); 153 is preview only. An Evergreen runtime is patched on Microsoft's schedule, not the app's, which `src-tauri/src/host.rs` already reports in Diagnostics. Verified. WebView2Feedback #5695 (composition hosting loses input on 152) still argues against `noRedirectionBitmap` on first availability.
- **Tauri 2.12** is still unreleased with no release candidate: milestone 10 at 14 open and 32 closed, 76 pending change files (60 this morning), `fix-unlisten-guard-missing-entry` merged to `dev` on 2026-09-07, `noRedirectionBitmap` landed at all three layers, MSRV 1.90, a breaking bundler API change. Stranded in wry 0.56.1 and tao 0.37.0 ahead of what 2.11.5 pins: the focus error on a minimised host at creation (wry #1799), a teardown re-entry crash (wry #1795), exiting on `WM_ENDSESSION` (tao #1157), a hidden-window maximise flash (tao #1306); tao 0.37 drops Windows 7. Verified; noted on the blocked entry.
- **The window's platform, verified against Microsoft's documents**: Chromium's background throttling in WebView2 keys on the host's `IsVisible`, not on minimise, and intensive throttling (one aligned wake a minute) begins after five hidden minutes; `requestAnimationFrame` throttles with no opt-out (WebView2Feedback #1172); `PreferredBackgroundTimerWakeInterval` is prerelease-only. The app's watches poll at minute cadence and the CLAUDE.md gotcha already says the hidden page keeps its feeds, so this bounds a delay at about a minute rather than breaking anything. WebGPU is on by default (Chrome 113 onward) and MapLibre cannot use it. `speechSynthesis` works but returns local SAPI voices only, because Microsoft disabled its cloud Natural voices in WebView2 by design (#2660); noted on `AUD-270`. `navigator.wakeLock` works with no permission kind and drops when the view is hidden; the Win32 path in `display.rs` is the right one. Web `Notification` is non-persistent only (`NotificationReceived`, Runtime 128), and for native toasts Microsoft's `AppNotificationManager.Register()` on an unpackaged app now sets up COM activation itself with no AUMID or shortcut plumbing (doc dated 2026-04-08), while an elevated app's `Show` fails silently; noted on the blocked rich-toast entry. Verified or Likely per Sources.
- **Service changes.** ROC: Build 24.1 is security patches plus the KBOX 0.3 degree base tilt (SCN26-20: `NZQ`, `NZB`, `NZU`, `NZG`, `NZF`, `NZX`, `NZC`, `NZK`, `NZH`, `NZM`; base-tilt state in GSM bit 7; the lower angle is what SAILS and MRLE repeat), Build 24.2 expected September 2026, Build 25.0 in formal system test for mid-2027; no 2026 change to Level II super-resolution; TDWR SPG 16.1 is security only. NWS: no SCN or PNS in the window touches a source the app reads (PNS26-61 OPC, PNS26-58 TC wind-field graphic, SCN26-74 NBM, SCN26-73, SCN26-72 KMRH, SCN26-71, SCN26-69 G-AIRMET BUFR); SCN26-48 was re-issued on 2026-08-24 and 08-27. NCEP dataflow outages on 2026-09-05 (18:47 to 20:29 UTC) and 2026-09-07 (04:29 to 06:16 UTC) thinned LSRs and METARs for those hours. RRFS: `noaa-rrfs-ops-pds` is live with `rrfs.YYYYMMDD/HH`, `refs.` and `firewx.` prefixes since 2026-08-12; the prototype `noaa-rrfs-pds` froze the same day. GOES: ABI Band 2 anomaly 2026-09-03 15:21 UTC; all products to GRB only 2026-09-05 19:16 to 20:54 UTC; `goes-r.gov` retires 2026-09-30 (not linked here); no GLM product change in 2026; MTG-LI is operational and behind an EUMETSAT account (rejected below); Himawari-10 carries no lightning imager. `api.weather.gov`: last changelog entries 2026-03-17 and 2026-01-07, nothing on `/alerts`; its watches do not carry SPC's SEL text. Hazard Simplification: advisories retire "not before 2026", no date; `alertTypes.ts` will need a migration when it lands. Federal Register 2026-07-31 (FCC/FEMA) discusses Threats-in-Motion, which would churn warning polygons far more often than today's dedupe expects. SPC conditional intensity replaced the hatched area on 2026-03-03 and the app already reads it. ECCC's open-data repo last moved 2026-07-28; DWD published no dated change. Open-Meteo: `best_match` refused in ensemble (2026-09-04, the app names its models), a units correction (2026-08-31), sunrise and sunset fixes (2026-08-24). NWPS at v2.8.0 with no 2026 change. Verified.
- **Privacy posture holds**: nothing proposed adds a socket, an account or telemetry. `AUD-379` reads a bucket already in the ledger; `AUD-380` queries OSV from a developer's machine at gate time, not from the app.

## Architecture Assessment

- **Pressure points by size** (2026-09-07): `mrms.rs` 6,329 lines (`AUD-330`), `index.css` 6,139, `App.tsx` 3,138 (`AUD-272`), `level3.rs` 2,763, `incident_packs.rs` 2,597, `MapViewport.tsx` 2,522, `settings.ts` 2,121, `LayersPanel.tsx` 1,440. **By churn since 2026-09-04** (63 commits): the three catalogues 20 touches each, `App.tsx` 18, `index.css` 10, `SettingsPanel.tsx`, `settings.ts`, `PanelSurfaces.tsx` and `mrms.rs` 7 each. Verified.
- **A boundary the tree does not treat as one.** The radar registry is the only piece of geographic truth that arrives as a compiled table from a dependency, and it is consumed as fact by `sites_in_reach`, `wsr88d_only` and the picker while `radar_status.rs` fetches the live list from the same office for a different purpose. The two never meet. The fix shape is a table of the app's own held to the NWS list by a live contract, with the crate's registry as a fallback and a dedupe by id (`AUD-378`). The same shape would have caught `KLIX` the day it went dark.
- **The dealiaser's measures**: the audit found the recorder blind to a whole patch moving; the literature says every operational method scores per gate against a reference (ORPG output, a forward operator, manual truth). The RPG's own product is on a bucket the app already reads (`AUD-379`), and BowEcho's bench is the template for the metric set.
- **The advisory gates**: `cargo audit`, `grype` and `osv-scanner` all match the lockfile's crate name as written; the OSV record for the one unlisted advisory spells it with an underscore. Whatever gate is added has to query both spellings (`AUD-380`).
- **Tests**: 199 vitest files, 41 browser specs across three projects, 471 native tests of which nine talk to the network, seven fuzz targets (the `.orb` reader gained one in `ee7eaa1`). Missing after this pass: a fixture whose lowest cut is 0.3 degrees (`AUD-381`), a scan of the site table against the live list (`AUD-378`), a per-gate oracle for unfolding (`AUD-379`).
- **Documentation**: `docs/architecture.md` is current to the module split. `README.md` is 8,829 words with the install section at line 140 of 450, which the first visitor has to scroll past the feature list to reach; a split of the data-source and export-record reference into `docs/` is under consideration below. The gitignored working notes are 182 KB (30,355 words) against the 30 KB session budget the machine's own health check enforces, and they are read at the start of every session in this repo (`AUD-384`).

## Rejected Ideas

Carried, all still correct: cloud accounts, telemetry, sync; mobile clients; plugin marketplace; arbitrary remote placefile URLs without a trusted-host decision (MesoPulse and PlacefileNation's 54-file catalogue fall here, and the decision is the owner's); RainViewer as primary; generative nowcasting; commercial feed scraping; a headless or hosted server; MCP servers; NWWS-OI; Blitzortung; 3D volume before the cross-section is fast; a second MapLibre instance per pane; Spotter Network before the owner contacts them; optical-flow frames; a tracker of its own; ML tornado detection before `AUD-189`; TypeScript 7; `noRedirectionBitmap` on first availability; more than two panes; Windows Widgets; NEXRAD SNS over a websocket; MQTT and headless render; a portable zip; multi-user.

| Idea | Decision and evidence |
| --- | --- |
| A browser entry point beside the installer (HookEcho's `hookecho.io`, 2026-09-07) | Reject. The fleet's browser build is StormviewRadar; a second one splits the work, and the native decoders are the reason this app exists. |
| Pin `nexrad-decode` to git rev `7544576` for the `decode_angle` fix | Hold. The app matches cuts by median radial angle and is not affected today (`Cargo.toml` comment); take the git pin only if `AUD-378` chooses the crate route for the registry, since the same rev is where a registry fix would land. |
| Push alerts over MQTT (WxAlerts-HA) | Reject. A listening service on the machine, the class the roadmap rules out. |
| MTG Lightning Imager as a European GLM | Reject. Operational since 2024-10-31 but behind an EUMETSAT Data Store account and key; the keyless rule. Himawari has no lightning imager at all. |
| Icechunk Zarr mirrors of MRMS and HRRR (`dynamical-noaa-mrms`, `dynamical-noaa-hrrr`) | Reject. Third-party mirrors, not NOAA's own publication; the app reads sources under their publisher's name. |
| `unidata-nexrad-level2-zarr` | Does not exist (NoSuchBucket, 2026-09-07). Recorded so nobody looks again. |
| Reserve label space for road shields (HookEcho's four commits of 2026-09-07) | Not applicable. The basemap styles are OpenFreeMap's and USGS's; the app adds no place-name layers of its own. |
| Re-read the URL hash on `hashchange` (HookEcho #313) | Not applicable. Deep links reach a running window through the deep-link plugin's event, not a navigation. |
| A site-health strip from `radar3pub.ncep.noaa.gov` | Already has it. `radar_status.rs` reads the same latency from `api.weather.gov`, and the picker shows it. |
| A ticking countdown to arrival (Yurekuru, MyShake) | Reject. The approach watch already re-runs every minute; the observation cadence is minutes, and a faster tick would invent precision. |
| Bring up the full-screen view when a warning is active (MagicMirror `updateOnWarning`) | Reject. `ambientScreen.ts` stands the view down for a warning on purpose, because the workspace is the thing worth seeing then. |
| deck.gl-raster or WeatherLayers GL for GPU colour ramps | Reject. A second renderer beside MapLibre; `AUD-340`'s `color-relief` route stays in the engine the map already uses. |
| WebGPU rendering | Hold. On by default in WebView2, but MapLibre's backend is a proof of concept (#7411) and the luma.gl route was closed on 2026-08-29. |
| A swipe divider between the two panes (`maplibre-gl-compare`), a minimap, a colour-bar widget, saved-view bookmarks, a print-size export | Under consideration. Each is a listed MapLibre plugin's feature with no ask behind it here; the dual pane, the legends and the share link cover the need. |
| Contours from the MRMS grids (`maplibre-contour`) | Later, L. Needs the value-encoded tiles `AUD-340` builds; then it is a worker and a protocol. |
| A local cell graph through merges and splits (Ritvanen et al. 2026), field-wide motion from optical flow (pySTEPS) | Later. The RPG's own cell products carry identity today; the graph is the shape for `AUD-224`'s per-cell join and is noted there. |
| A list of stored crash reports with reveal-in-folder (Firefox `about:crashes`) | Under consideration, S. `crash_last_dump` returns the newest; older dumps sit on disk unlisted. Nothing has asked for it. |
| Splitting the README's reference tables into `docs/` | Under consideration. 8,829 words with Install at line 140 is measurable; harm to a reader is not, and the long form is the fleet's house style. |
| A Chartability audit of the map key and legends | Under consideration, docs. A checklist instrument rather than a linter; worth a pass when `AUD-229` lands. |
| Draw a range ring only for the held radar's 230 km reach | Folded into `AUD-382`, which draws the radii the watch rules already carry, since those are the circles a reader has actually set. |
| A winget manifest or a Microsoft Store listing for distribution | Reject, standing rule. The owner does not publish winget packages, and a Store listing needs MSIX packaging, which changes the notification and tray model this unpackaged NSIS build is written for. The distribution gap that matters is the seven unpublished releases in `Roadmap_Blocked.md`. |

## Sources

### Repository, upstream and release state
- https://github.com/SysAdminDoc/OpenRadar/releases
- https://github.com/danielway/nexrad/issues/148
- https://github.com/danielway/nexrad/issues/144
- https://crates.io/api/v1/crates/nexrad-model/versions
- https://crates.io/api/v1/crates/nexrad-data/versions
- https://api.weather.gov/radar/stations?stationType=WSR-88D
- https://api.weather.gov/radar/stations/KLIX
- https://api.weather.gov/radar/stations/KHDC
- https://unidata-nexrad-level2.s3.amazonaws.com/?list-type=2&prefix=2026/09/07/KHDC/
- https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=TLX_&delimiter=_
- https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=TLX_N0G_2026_09_07

### Dealiasing
- https://github.com/ARM-DOE/pyart/blob/main/pyart/correct/region_dealias.py
- https://github.com/ARM-DOE/pyart/blob/main/pyart/correct/src/dealias_fourdd.c
- https://github.com/NCAR/lrose-core/tree/master/codebase/apps/radar/src/RadxDealias
- https://github.com/vlouf/dealias (unravel/continuity.py, dealias.py)
- https://doi.org/10.1175/JTECH-D-19-0020.1 (Louf et al. 2020)
- https://infoscience.epfl.ch/server/api/core/bitstreams/01c76533-83fa-4779-a5e3-8df03a8ee143/content (Feldmann et al. 2020, R2D2)
- https://www.roc.noaa.gov/public-documents/engineering-branch/new-technology/misc/tdvdia/Comp_2-D_Vel_Dealias_Alg.pdf (Zittel and Jing)
- https://doi.org/10.1175/JTECH1910.1 (Zhang and Wang 2006, Likely)
- https://doi.org/10.1155/2020/6157636 (Yuan et al. 2020, Likely)
- https://arxiv.org/abs/2211.13181 (Veillette et al. 2023, Likely)
- https://doi.org/10.3390/rs17244063 (Samos et al. 2025, Likely)
- https://github.com/d4vid87/hookecho/blob/main/crates/wxdata/src/dealias.rs
- https://github.com/FahrenheitResearch/bowecho (crates/bench/src/dealias_eval.rs, releases/tag/v0.35.0)

### Competitors and community
- https://github.com/d4vid87/hookecho/pull/313 and /commits/main
- https://github.com/d4vid87/stormdesk/pull/81
- https://github.com/dpaulat/supercell-wx
- https://github.com/jhammon88219/Anvil/commits/main
- https://github.com/Cuevman81/FX-Net-NextGen/commits/main
- https://github.com/Aryeh95/pi-weather-station/commits/main
- https://github.com/wesleygrimes/omastorm/issues
- https://github.com/cwdaniel/RadrView
- https://github.com/stevo399/arw
- https://github.com/extrosy-sys/ClassicRadar
- https://github.com/ra397/MRMS-browser
- https://github.com/WxLens/WxLens
- https://github.com/gbsamirahmed/project-meridian
- https://github.com/Deasus/firestorm-lightning-data
- https://github.com/mitchross/radar-ng
- https://github.com/wxalerts/WxAlerts-HA
- https://github.com/open-meteo/weather-map-layer
- https://github.com/fabioscarparo/Nembo
- https://github.com/bradleybond512/crystal-ball
- https://www.weatherpulse.com/ (301 from https://www.allisonhouse.com/)
- https://www.radarscope.com.au/guide/version-history
- https://placefilenation.com/
- https://bsky.app/profile/pmarshwx.com/post/3muum2aigec2a
- https://bsky.app/profile/ontariowedges.bsky.social/post/3mul7suzxzc23
- https://bsky.app/profile/7thsphere.com/post/3mukzxbtwfc23
- https://bsky.app/profile/d4vid87.bsky.social/post/3muxjv4dqxc2g
- https://hn.algolia.com/api/v1/search_by_date?query=weather%20radar&tags=story

### Data services and notices
- https://www.weather.gov/notification/
- https://www.weather.gov/media/notification/pdf_2026/scn26-20_WSR-88D_BaseTilt_Level-III_KBOX.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-48_updated_RRFS_and_REFS_Implementation_aac.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-11_SPC_conditional-intensity.pdf
- https://www.roc.noaa.gov/branches/engineering-branch/software-engineering.php
- https://www.roc.noaa.gov/branches/engineering-branch/radar-product-improvement.php
- https://www.roc.noaa.gov/spg-documents.php
- https://www.nco.ncep.noaa.gov/status/messages/
- https://www.ospo.noaa.gov/operations/messages.html
- https://www.nesdis.noaa.gov/about/documents-reports/notice-of-changes
- https://user.eumetsat.int/news-events/news/mtg-lightning-imager-li-level-2-data-available
- https://www.weather.gov/documentation/services-web-api
- https://www.weather.gov/hazardsimplification/
- https://www.noaa.gov/news-release/national-hurricane-center-to-issue-new-forecast-cone-graphics-for-2026-hurricane-season
- https://www.federalregister.gov/documents/2026/07/31/2026-15600/
- https://github.com/eccc-msc/open-data
- https://github.com/open-meteo/open-meteo/commits/main
- https://noaa-rrfs-ops-pds.s3.amazonaws.com/?list-type=2&delimiter=/
- https://github.com/awslabs/open-data-registry/blob/main/datasets/noaa-rrfs-ops.yaml
- https://registry.opendata.aws/dynamical-noaa-mrms/
- https://water.noaa.gov/about/release-notes

### Dependencies, platform, security
- https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md and /releases
- https://registry.npmjs.org/maplibre-gl
- https://github.com/maplibre/maplibre-style-spec/releases
- https://github.com/maplibre/maplibre-gl-js/issues/7029 and https://github.com/maplibre/maplibre-style-spec/issues/1490
- https://github.com/maplibre/maplibre-gl-js/pull/7411
- https://github.com/onthegomap/maplibre-contour
- https://github.com/advisories/GHSA-qwgh-2vcv-g2f7 and https://api.osv.dev/v1/vulns/GHSA-qwgh-2vcv-g2f7
- https://crates.io/api/v1/crates/block-buffer/versions
- https://github.com/rustsec/advisory-db/commits/main
- https://raw.githubusercontent.com/rustsec/advisory-db/main/crates/lru/RUSTSEC-2026-0253.md
- https://github.com/tauri-apps/tauri/milestone/10 and /tree/dev/.changes
- https://github.com/tauri-apps/wry/releases and https://github.com/tauri-apps/tao/releases
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnotes-security
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/runtime
- https://www.cisa.gov/known-exploited-vulnerabilities-catalog
- https://github.com/MicrosoftEdge/WebView2Feedback/issues/1172, /2660, /5695
- https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controller.isvisible
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags
- https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-console
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/sdk/1-0-2739-15
- https://github.com/typescript-eslint/typescript-eslint/pull/12803
- https://github.com/microsoft/playwright/releases/tag/v1.63.0
- https://github.com/vitest-dev/vitest/releases/tag/v5.0.0
- https://github.com/nodejs/Release

### Techniques and adjacent products
- https://github.com/openradar/TINT (tint/tracks.py)
- https://journals.ametsoc.org/view/journals/wefo/13/2/1520-0434_1998_013_0263_tsciat_2_0_co_2.xml (Johnson et al. 1998, SCIT)
- https://doi.org/10.5194/amt-19-1853-2026 (Ritvanen et al. 2026)
- https://arm-doe.github.io/pyart/API/generated/pyart.filters.moment_and_texture_based_gate_filter.html
- https://docs.wradlib.org/en/2.2.0/generated/wradlib.classify.filter_gabella.html
- https://vlab.noaa.gov/web/wdtd/-/dual-pol-quality-control
- https://www.nssl.noaa.gov/publications/wsr88d_reports/BirdDetectionAlgorithm_2018.pdf
- https://doi.org/10.3390/rs16142509
- https://github.com/obsproject/obs-studio/pull/8455
- https://support.mozilla.org/en-US/kb/diagnose-firefox-issues-using-troubleshoot-mode
- https://support.mozilla.org/en-US/kb/unsent-crash-reports-in-firefox
- https://github.com/wiedehopf/tar1090
- https://github.com/jojoduquartier/MMM-RAIN-RADAR
- https://myshake.berkeley.edu/faq.html
- https://www.highcharts.com/blog/tutorials/introducing-audiom-for-highcharts-maps/
- https://chartability.fizz.studio/
- https://community.esri.com/t5/accessibility-blog/what-s-new-in-accessibility-fall-2025/ba-p/1670965
- https://github.com/maplibre/awesome-maplibre
- https://github.com/tauri-apps/awesome-tauri
- https://github.com/MeteoAI/awesome-atmos

## Open Questions

1. Which route for the registry: the app's own table generated from `api.weather.gov/radar/stations` and held to it by a live contract (recommended, since `radar_status.rs` already reads that list), or a git pin of `nexrad-model` at a rev that carries a registry fix once #148 merges (which would also bring the `decode_angle` fix)? The first is the one that catches the next decommissioning on its own.
2. Does the owner want the trusted placefile-host decision reopened now that MesoPulse exists? Every other reading of the placefile ecosystem says the same thing, and it remains a person's call.
3. Carried unchanged: comments on PNS26-62 and PNS26-63 close 2026-09-21; `tgftp.nws.noaa.gov` in the ledger; Spotter Network contact; the upstream `hdf5-reader` issue for `lru` (still unfiled by anyone); the publish of 0.5 through 0.11, the isolated desktop session, the clean VM and the code-signing purchase, all in `Roadmap_Blocked.md`.
