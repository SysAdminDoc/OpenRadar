# Research: OpenRadar

Date: 2026-09-02 (evening refresh). Replaces all prior research. Repository snapshot: `49a3604` on `main`, v0.8.0 in every manifest, unpublished. This refresh follows the same day's afternoon pass at `27b63be`: between the two, a parallel drain shipped four of that pass's P1 items (the office's own warning text, Canadian warnings, German warnings, and a single-site loop across recent volumes), moved the publish item to `Roadmap_Blocked.md` behind a release gate, and bumped to 0.8.0. The 2026-08-31 pass's opportunities (precipitation type, surface observations, archived warnings, Skew-T, smoke, the non-visual surface, fuzzing, Canadian French) had already shipped before that. Everything below was verified on 2026-09-02 unless labelled otherwise. Labels: Verified (fetched or read in the tree), Likely (documentation or search snippet only), Assumption, Needs live validation.

## Executive Summary

OpenRadar is the most complete keyless desktop radar workstation in the open-source field: it decodes Level II, Level III, TDWR, MRMS, GLM, GFS and HRRR natively, draws American, Canadian and German warnings on one alerts layer with the office's own text, loops a held site across its recent volumes, and carries ProbSevere, cells, classification, soundings, surface plots, smoke, rivers, tropical products, tides and surge over a MapLibre globe in English, Spanish and Canadian French with no account or telemetry. Its weakest point is not a missing lane but distribution: the published updater manifest still says 0.4.0 (fetched 2026-09-02), so no installed copy has been offered any of the 0.5 to 0.8 fixes, and only the owner can publish. After that, the highest-value work is finishing the loop (its length, export, provenance and browser test did not ship: `AUD-201`), reading radar site status from the NWS instead of inferring it, and the MRMS and WPC products that sit on hosts and decoders the app already has.

Top opportunities, in order:

1. **Publish.** `releases/latest/download/latest.json` returned `version: 0.4.0` on 2026-09-02; `gh release list` shows nothing newer than v0.4.0 (2026-08-31); the manifests say 0.8.0. `npm run release` now refuses to stage when the live manifest is more than one release behind, and `Roadmap_Blocked.md` carries the publish command. Verified.
2. **Finish the single-site loop** (`AUD-201`): the loop length is a constant (`DEFAULT_LOOP_VOLUMES`), a saved loop still follows the mosaic, provenance is one record for the sweep on screen, and no browser test scrubs a three-volume site. Verified in `src/hooks/useSingleSiteRadar.ts`, `src/lib/siteLoop.ts`, commit `9f29b7a`.
3. **Site status from `api.weather.gov/radar/stations`**: RDA status, operability, alarms, latency and the time Level II was last received for every WSR-88D and TDWR, CORS `*`; the app infers liveness from archive freshness (`level2.rs` `LIVENESS`). Verified.
4. **The rest of the MRMS bucket on a decoder that already reads it**: FLASH flood ratios and unit streamflow, gauge-corrected QPE, merged azimuthal shear at 0.005°, VIL density, SHI, POSH, VII, lightning probability, all template 5.41. Verified from the section-5 template of live files.
5. **WPC excessive rainfall and winter storm severity outlooks** on `mapservices.weather.noaa.gov` (host allowed, CORS echoes origin, `f=geojson`); RadarScope paywalls the ERO at Tier 2. Verified.
6. **GOES-West and Himawari** on the same GIBS endpoint as the two GOES-East layers shipped. Verified from WMTS capabilities.
7. **Arrival clocks are legally unblocked.** The Baron and Kavouras arrival-time patents (US 6,125,328; 6,278,947; 6,401,039; 6,252,539) all expired in 2018; the app computes minutes-to-arrival for home only. Verified on Google Patents.
8. **Cheap asks with named demand**: county boundaries (Supercell Wx #14), a VWP panel from the wind `vad.rs` already fits (#383), lightning near a watched place (#581), KML/KMZ (#655), placefile icons, MP4 export (RadarScope 5.6.1 moved to MP4 on 2026-09-02), a smoothing toggle. Verified.
9. **Locally derived rotation.** The LLSD azimuthal-shear method behind MRMS and GR2Analyst's NROT is fully specified (Mahalik et al. 2019) and no open-source app ships it; a tornado debris flag falls out of it. Verified.
10. **Dependency refresh**: MapLibre 6.7.0, five Tauri plugins one release behind, `pmtiles` 0.16 to 0.24 across five breaking releases. Verified `npm outdated` and changelogs.

## Product Map

- Core workflows: watch live radar over a place with a two-hour national loop and a nearest-site Level II view that now scrubs across recent volumes; interrogate a storm (tilts, six moments, dealiased and storm-relative velocity, cells, classification, ProbSevere, cross-section, sounding); be told when a warning reaches one of ten watched places in the US, Canada or Germany, with sounds, quiet hours, a tray icon and a glance window; replay and export an event (bundles, PNG, GIF, WebM, CSV, GeoTIFF, provenance sidecars); plan around weather (route, guidance, tides, surge, tropical). Evidence: `README.md`, `src/App.tsx`, `src/hooks/`, `src-tauri/src/lib.rs`, commits `7137123`, `13e3237`, `9f29b7a`, `5834da5`.
- Personas: the subscription-refusing enthusiast, the chaser with accumulated palettes and placefiles, the anxious monitor (calm mode, quiet hours), the second-monitor ambient reader (full-screen view, wallpaper, glance), the winter-weather reader (precipitation type), the francophone Canadian, and the screen-reader user (Nearby). Evidence: `CHANGELOG.md` 0.5.0 to 0.8.0.
- Platform and distribution: Windows x64 only, NSIS current-user installer, Tauri updater signed with the project key, no Authenticode. `tauri.conf.json` `bundle.targets: ["nsis"]`; zero `cfg(target_os)` in `src-tauri/src`.
- Data flow: every native request goes through `src-tauri/src/http.rs` (31 hosts after `api.weather.gc.ca`, 16 MiB body cap, 4 redirects); the page has a narrower CSP; decoded products reach the map as tiles over registered URI schemes; a disk cache gives the offline last view; incident packs and replay bundles are separate durable stores; twelve overlay adapters in `src/lib/overlays/` including `ecccAlerts.ts` and `dwdWarnings.ts`.

## Competitive Landscape

### Open source

- **HookEcho** (d4vid87, Rust wgpu, 53 stars, v0.12.0-beta.2 on 2026-08-31). The fastest-moving competitor and the closest feature superset. beta.2 added native DWD velocity and dual-pol, OPERA radars through a WMS bridge, ECCC GeoMet plus ECCC alerts, MeteoAlarm warnings, Himawari, SPC watch boxes, local cell tracking with extrapolation, MQTT with Home Assistant discovery, a headless server serving PNG and MP4, and a browser "Lite" viewer with offline chase packs. Learn: per-country warnings are table stakes in OSS now, which OpenRadar matched on 2026-09-02; a keyless European lane is possible through a WMS bridge rather than ORD keys. Avoid: the console-subsystem window and the unsigned-exe Defender flag it took on Reddit (`Win32/Wacapew.A!ml`); OpenRadar's `main.rs` already hides the console. Verified: releases page, ROADMAP.md, r/stormchasing thread.
- **BowEcho** (FahrenheitResearch, Rust, v0.35.0 on 2026-08-28) and its ~40 sibling repos (`rustdar` multi-radar synced loop, `GenericRadar` composited GIF export, `cursdar2` CUDA workstation, `bowecho-dealias`). Ships an AVX2 build, an ARM64 Windows build, Authenticode via Azure Trusted Signing, a Defender false-positive FAQ. Learn: ARM64 and the false-positive FAQ are cheap; user-defined sidebar tabs and a black-flash-free basemap swap are UX details worth copying. Verified.
- **Supercell Wx** (465 stars, v0.6.1 on 2026-07-19). Nothing user-facing since; the only issue since 2026-08-26 is #691 (free layer ordering). Open asks with demand OpenRadar has not met: #14 county boundaries, #383 VWP display, #581 lightning alert, #655 KML/KMZ, #616 cursor readout across panes, #611 reorderable toolbox. Already met by OpenRadar: #414 GIF export, #637 follow alerts, #617 upgrade-only sound (the watch announces new or escalated only, `watch.ts:294`), #78 MRMS mosaic, #491 OpenFreeMap, #433 alerts, #401 soundings, #403 cross-section. Verified via `gh api`.
- **NEXRAD Workbench / danielway/nexrad** (rc.7, 2026-04-03): the Rust crates OpenRadar depends on carry a physics-based chunk timing model (`project_scan_timing`, `estimate_chunk_availability_time`, `ChunkTimingModel`) that `chunks.rs` does not use. Verified on docs.rs.
- **LibreWXR** (76 stars, Python) is a self-hosted RainViewer-API replacement born of RainViewer's 2026-01-01 free-tier cut, with 14 palettes and composites for MRMS, OPERA, ECCC, JMA, Taiwan and Malaysia. Learn: a reference for blending ECCC and MRMS at the border. Verified.
- **AtticRadar** (47 stars) has an open "Project Abandoned?" issue dated 2026-08-31 and Mapbox-token breakage; its users are stranded, which is a listing opportunity. Verified.
- **QuadWeather** (closed web, free tier waits for full volumes; paid tier has per-elevation live, 3D, MESH) is what Stormtrack recommends as the free Windows option. Verified.

### Commercial

- **RadarScope** 5.6.1 (2026-09-02): saved video moved from MOV to MP4, new storm-attribute source. Tier 1 $9.99/yr (lightning, 30-frame super-res loops, dual pane, LSRs, SPS); Tier 2 $99.99/yr (soundings, GOES, MRMS, SPC fire and WPC ERO, 30-day archive, shear and hail contours); Windows app $29.99 one-time. Reviews: "aggressive paywall". Learn: MP4 is the sharing format; ERO and shear contours are what people pay for. Verified App Store; tier table Likely (Zendesk 403).
- **WeatherFront** (new since the 2026-08-31 pass): free core radar; Advanced $99.99/yr for hail swaths, rotation tracks, lightning density, echo tops, soundings, route planning. r/stormchasing: "quickly becoming my primary since spotter network support and weather stations were added, I think those were the last things RS had over WF". Learn: Spotter Network positions are the one thing that keeps chasers on RadarScope. Verified.
- **RadarOmega**: $49 to $119/yr by loop length (75/150/250 frames) plus RapidSweep $84.99/yr; complaints are load failures, 3D lag, tiny fonts. Verified pricing page.
- **MyRadar** 7.121 (2026-05) added Webhooks for alerts (Premium plus account) and PTZ cameras; Aviation Charts $59.99/yr. Likely (AppBrain).
- **WeatherWise** ($69.99 to $159.99/yr): synced side-by-side products, a smoothed-radar toggle, 200-scan history. Verified App Store.
- **Windy** raised Premium 35% on 2024-12-28 with no new features; forum asks for modular pricing. **Storm Radar** (TWC) shows forced video ads during severe alerts. Both are the grievance OpenRadar's README already positions against. Verified.
- **GR2Analyst 3**: no public changelog since March 2022; nothing to cite beyond its product pages (Volume Explorer 3D, NROT, VWP, smoothing, derived ET/VIL/POSH/MEHS). Verified site.

### Community signal

- r/weather (2026-08): "every app stopped providing future radar" after NWS cuts; replies push HRRR/RAP from Pivotal. OpenRadar's HRRR forecast tail already answers this and should say so where people look. Verified.
- r/stormchasing offline thread (22 upvotes): Starlink and boosters; "it's only the data you were last left with" is what incident packs and the cached last view solve, and no app was named for it. Verified.
- HN radar-API thread (53 points, 2025-08-16): minute-level rain-start notices and privacy. Verified.
- Stormtrack: RadarScope wins for chasing because "Spotter Network updates your location"; QuadWeather and Supercell Wx are the free recommendations. Verified.

### Adjacent

- **tar1090**: every view state is URL-addressable, an 8-hour track history and a heatmap mode. OpenRadar's `openradar://view` links already carry the camera; a rotation-track heat layer from its own cache is the analogue. Verified.
- **OpenCPN GRIB**: a data-at-cursor table showing a full time series at one point, a "Now" button on the loop. Verified.
- **Glance / Rainmeter**: most weather skins broke when scraped APIs locked down; HookEcho's snapshot endpoints feed them. OpenRadar's wallpaper writer is the local-only equivalent. Likely.

## Reported Issues

OpenRadar's tracker holds zero issues and zero pull requests (`gh issue list`, `gh pr list`, 2026-09-02; discussions disabled; 2 stars). That is an absence of field evidence, not evidence of defect-free use. The 2026-09-02 audit (AUD-126 to AUD-167) and the same day's refutation passes are the effective tracker; three audit items remain (`AUD-162`, `AUD-165`, `AUD-166`) plus `AUD-201`, the drain's own record of what the loop did not finish.

Defects the 2026-09-02 refutation passes found in work shipped hours earlier, worth knowing before touching those modules (commits `ad35d06`, `1fb7134`): ECCC keeps ENDED alerts in the same collection with a live expiry, so `status_en` has to be read; every Canadian alert shared one identity because the watch keys on `url` and ECCC has one national page; ECCC colour is how an office draws a warning, not its severity; WFS 2.0 reads EPSG:4326 boxes latitude first, so a longitude-first box quietly asks about the sea off Somalia; the site loop fetched a ten-megabyte volume about once a second while the timeline played; unwrapping the office's hard-wrapped text destroyed flood-warning lists and figures.

Adjacent-tracker asks that map onto remaining gaps, with the code they point at: Supercell Wx #14 county lines (no boundary layer in `src/lib/mapStyles.ts`), #383 VWP (`src-tauri/src/vad.rs` fits the wind and shows nobody), #581 lightning alert (`src/hooks/useLightning.ts` has no watch path), #655 KML/KMZ (`src/lib/workspaceOverlays.ts` accepts GeoJSON, placefile, `.pal`), #616 cursor readout in both panes.

## Security, Privacy, and Reliability

- **Dependency state, 2026-09-02.** `npm audit --omit=dev`: 0 vulnerabilities. `cargo audit`: 17 allowed warnings, one unsound (`lru 0.16.4`, RUSTSEC-2026-0253, unreachable here, analysis in `Roadmap_Blocked.md`; `hdf5-reader` 0.9.1 still pins `^0.16.3` and upstream has not committed since 2026-07-29), sixteen unmaintained (the Linux-only GTK3 chain, `proc-macro-error`, and the `unic-*` family under `urlpattern` inside `tauri-utils`, which only Tauri can move). Tauri is 2.11.5, past GHSA-7gmj-67g7-phm9 (fixed 2.11.1). New RustSec since the last pass affecting the stack: h2 RUSTSEC-2026-0258 (Low, unbounded empty DATA frames, fix 0.4.16); check `cargo tree -i h2`. Supply chain: the 2026-08-20 crates.io compromise (`arrayref 0.3.10`, `internment`, `append-only-vec`) and the 2026-08-04 npm ChainDrop worm (`keyv`, `flat-cache`) named none of OpenRadar's direct dependencies; `flat-cache` is an eslint transitive and worth pinning below the affected version. Verified.
- **Outdated:** maplibre-gl 6.6.0 → 6.7.0 (throws `GPUInitializationError` from the constructor when WebGL2 is missing, `font-faces`, `{validate:false}` for batch layer ops, no breaking changes since 6.3); `@tauri-apps/plugin-updater` 2.10.1 → 2.11.0, `plugin-notification` 2.3.3 → 2.4.0, `plugin-log`, `plugin-opener`, `plugin-deep-link` one patch each; `pmtiles` 0.16.0 → 0.24.0 crosses five breaking releases (TileId returns `Result`, TLS-root features removed). TypeScript 7.0.2 (Go compiler) and 6.0 flip `strict`, `module`, `target` and `types` defaults; stay on 5.8 until a deliberate migration. Verified `npm outdated` and changelogs.
- **Release trust gap.** Published `latest.json` is 0.4.0 (fetched 2026-09-02); the repo is 0.8.0. Installed copies report "up to date" while the 0.8.0 changelog records that every external link in the installed build was dead and a custom alert sound could never load. The gate that refuses to stage past a one-release lag shipped in `ad35d06`; the publish itself is the owner's act. Verified.
- **Service changes that touch the app.** SCN26-67 (Level II NOMADS URL ends 2026-09-15) does not affect the AWS paths the app uses. SCN26-54 (LTR message from Build 25.0, about 2027-02-15) is already covered by the 0-to-255 unknown-message sweep. SCN26-48 Updated (2026-08-24) reconfirms RRFS/REFS operational 2026-10-06 and retires NAM/SREF/HREF/HiresW; **HRRR and RAP are not retired**, REFS ingests two HRRR members, so the HRRR smoke and reflectivity lanes continue (the RRFS item stays in `Roadmap_Blocked.md`). PNS26-62 (2026-09-01): NWS proposes CAP as the primary WWA format and possibly discontinuing VTEC, comments to 2026-09-21; the app reads the WWA map service rather than raw VTEC, so the exposure is the `phenom`/`sig` fields it keys on. PNS26-64/SCN26-75: WPC's probabilistic winter products move to NBM-based PPP on 2026-10-01, so any winter-outlook adapter should target `wpc_wssi_p`, not PWPF. Verified PDFs.
- **Unpublished dependency fixes.** `nexrad-decode` rc.3 mis-decodes negative elevation angles (`decode_angle` sign bit, fixed on main 2026-07-21, unreleased); cut matching by median radial angle keeps OpenRadar unaffected as of 2026-09-02, as `Cargo.toml` records. Verified.
- **Missing guardrails.** No Defender scan of the staged installer (HookEcho and BowEcho both publish false-positive FAQs); `chunks.rs` detects a stalled live sweep from a fixed cadence rather than the crate's timing projection. Verified in tree.
- **Privacy posture holds.** Every candidate source in this pass is keyless; the ones without CORS (ECCC CAP datamart, DWD CAP, NDBC, AWC, NOHRSC, NSIDC, FIRMS files) fit the native allowlist pattern; the ones with CORS (`api.weather.gc.ca`, `maps.dwd.de` WFS, `api.weather.gov`, `files.airnowtech.org`, `data.cocorahs.org`) can be page fetches. Spotter Network feeds are keyless but carry names, phones and emails and the site asks developers to contact support: permission-required and PII-bearing, not for shipping unasked. mPING is licensed, not open. Verified.

## Architecture Assessment

- **Pressure points by size:** `src-tauri/src/level2.rs` 6,328 lines after the loop landed, `src/index.css` 5,485, `mrms.rs` 3,307, `src/App.tsx` 2,393, `level3.rs` 2,181, `MapViewport.tsx` 1,937, `MapOptionsPanels.tsx` 1,860, `settings.ts` 1,668, `useSingleSiteRadar.ts` 699. Locally derived products (shear, KDP, vertical products) all land in `level2.rs`; a `level2/` module split (decode, render, derive, cache, listing) should precede them.
- **The MRMS registry is still the cheapest growth surface.** `mrms.rs:418-540` holds eleven products; every candidate in this pass is the same discipline 209, template 3.0 grid, template 5.41 packing. Two need new machinery: the 0.005° AzShear and RotationTrack grids (14000×7000, 8-bit) and the 17.9 MB `BrightBandTopHeight` files.
- **Warnings abroad proved the adapter shape.** `ecccAlerts.ts` and `dwdWarnings.ts` fill every property an American polygon carries, so the watch, sounds, quiet hours, readout and popup needed no country logic. The next country (MeteoAlarm, which HookEcho reads) follows the same pattern; the hazard vocabulary in `alertTypes.ts` is per-country mapping, not a rewrite.
- **The timeline now has two frame notions.** The mosaic loop steps at two minutes; the site loop resolves each step to the volume at or before it (`src/lib/siteLoop.ts`) and follows the scrubber only while stopped. The export encoder, the compare pane and the provenance sidecar still consume the mosaic series, which is what `AUD-201` closes.
- **Test and documentation gaps:** vitest coverage floors are statements 63 / branches 56 / functions 57 / lines 64 over the whole tree, with the panels most of what is missing; the axe gate scans panels in dark only (`AUD-162`); the browser fixtures for the alert feed, ECCC and DWD answer nothing by default so no spec polls a public office; `assets/screenshots/openradar-main.png` is from 2026-08-31, before the light-theme repairs, French and the rail rework.

## Rejected Ideas

Carried, all still correct: cloud accounts, telemetry, sync; mobile clients; plugin marketplace; arbitrary remote placefile URLs without a trusted-host decision; RainViewer as primary; local or generative nowcasting presented beside observations (pysteps' own large-sample skill decorrelates at 25 minutes for one-hour events); EUMETNET ORD (needs keys); Windows 11 widget (needs MSIX); `.scr` screensaver; EAS/WEA/1050 Hz imitation; streaks and guilt notifications; a second live MapLibre map in a secondary surface; Chocolatey maintained from this repo; CIRA SLIDER scraping; NWS gridpoint raster; taking a JS Skew-T library as a dependency.

| Idea | Decision and evidence |
| --- | --- |
| Spotter Network positions | Under consideration only after the owner contacts Spotter Network. Feeds are keyless and CORS-open but carry names, phones and emails, and the site asks developers to make contact first. https://www.spotternetwork.org/feeds/ |
| Webhooks / MQTT for alerts (MyRadar 7.121, HookEcho) | Under consideration. It is a user-configured host receiving weather events, which the JOY rules forbid unless the item names the host and the ledger carries it; a local-only endpoint (127.0.0.1) would be the honest version. Not roadmap-eligible until that decision is made. |
| Headless snapshot HTTP server (HookEcho `/national.png`, tar1090) | Reject. A listening socket in a desktop app is new attack surface; the wallpaper writer and glance window already produce the still locally. |
| `--enable-unsafe-swiftshader` fallback | Reject. Chromium removed the automatic SwiftShader WebGL fallback (Intent to Remove, 2025-02-13); the flag is named unsafe for a reason and the app already explains a missing GPU (`src/components/NoGpu.tsx`). |
| Frame interpolation between radar scans (LiteRadar, Show HN 2026-07-22) | Reject. Optical-flow in-betweens are invented pictures on a timeline that promises observations. |
| SignPath Foundation free signing | Reject. Origin verification requires a trusted CI build system, which the repo's local-build rule forbids. Azure Artifact Signing ($9.99/month, US individuals admitted) remains the compatible route and stays a purchase in `Roadmap_Blocked.md`. https://signpath.org/terms.html |
| Microsoft Store listing | Under consideration. Individual accounts are free now and Win32 EXE submissions are accepted, but the installer must be code-signed first, so it follows the certificate. https://v2.tauri.app/distribute/microsoft-store/ |
| TypeScript 6/7 migration now | Defer. 6.0 flips `strict`, `module`, `target`, `types`; 7.0 has no compiler API until 7.1. Nothing in the app needs either yet. |
| Open-Meteo flood, air-quality and marine APIs | Defer, modeled data; AirNow's keyless S3 files and NDBC are the observed equivalents and are preferred. The earlier rejection of AirNow was of its keyed REST API; `files.airnowtech.org` is a public bucket with CORS `*`. |
| Blitzortung | Reject, still station-operators-only and non-commercial with no third-party API. https://www.blitzortung.org/en/cover_your_area.php |
| mPING reports | Reject. Licensed by tier, display restricted to the submitter or paid. https://mping.ou.edu/license.html |
| Full 3D volume rendering | Defer to after the derived products. GR2Analyst, QuadWeather and RadarOmega ship it, `danielway/nexrad-volumetric-renderer` is a Rust reference, but it is XL, the cross-section covers the case study need, and the only demand signal is one r/stormchasing post with 24 upvotes. |
| Per-station ECCC or DWD radar volumes | Reject for now; HookEcho decodes DWD velocity natively, but OpenRadar's DWD lane is the composite WMS and no reader has asked. |
| Fetching the alert text per alert on open | Superseded on 2026-09-02: `7137123` reads description, instruction and area off the `alerts/active` feed already polled for damage tags, so nothing is fetched per alert. |

## Sources

### Repository and release state
- https://github.com/SysAdminDoc/OpenRadar/releases/latest/download/latest.json
- https://github.com/SysAdminDoc/OpenRadar/releases

### Competitors and community
- https://github.com/d4vid87/hookecho/releases/tag/v0.12.0-beta.2
- https://github.com/d4vid87/hookecho/blob/main/ROADMAP.md
- https://github.com/FahrenheitResearch/bowecho/releases
- https://github.com/orgs/FahrenheitResearch/repositories
- https://github.com/dpaulat/supercell-wx/issues
- https://github.com/dpaulat/supercell-wx/releases
- https://github.com/danielway/nexrad/releases
- https://docs.rs/nexrad-data/1.0.0-rc.7/nexrad_data/aws/realtime/index.html
- https://github.com/JoshuaKimsey/LibreWXR
- https://github.com/SteepAtticStairs/AtticRadar/issues
- https://github.com/tsupinie/vad-plotter
- https://radar.quadweather.com/docs/
- https://apps.apple.com/us/app/radarscope/id288419283
- https://www.weatherfront.com/
- https://www.radaromega.com/
- https://www.reddit.com/r/stormchasing/comments/1sqbhov/
- https://www.reddit.com/r/stormchasing/comments/1v98y62/
- https://www.reddit.com/r/stormchasing/comments/1kp8gin/
- https://www.reddit.com/r/weather/comments/1vl1fil/
- https://stormtrack.org/threads/radaromega.32531/
- https://stormtrack.org/threads/best-free-radar-software.32006/
- https://stormtrack.org/threads/smoothing-of-radar-data.14895/
- https://news.ycombinator.com/item?id=44924031
- https://community.windy.com/topic/37725/
- https://github.com/wiedehopf/tar1090
- https://opencpn-manuals.github.io/main/grib/index.html

### Data sources verified live
- https://geo.weather.gc.ca/geomet?lang=en&service=WMS&version=1.3.0&request=GetCapabilities&layer=Current-Alerts
- https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=5
- https://eccc-msc.github.io/open-data/licence/readme_en/
- https://eccc-msc.github.io/open-data/usage-policy/readme_en/
- https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetCapabilities
- https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dwd:Warnungen_Landkreise&outputFormat=application/json&count=1
- https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html
- https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer
- https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer
- https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi_p/MapServer
- https://mapservices.weather.noaa.gov/vector/rest/services?f=pjson
- https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer
- https://www.nohrsc.noaa.gov/snowfall_v2/
- https://noaadata.apps.nsidc.org/NOAA/G02158/masked/
- https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt
- https://www.ndbc.noaa.gov/activestations.xml
- https://aviationweather.gov/data/api/
- https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS/&delimiter=/
- https://www.nssl.noaa.gov/projects/mrms/operational/tables.php
- https://www.weather.gov/idp/MRMS_v12.3_Supplemental
- https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
- https://api.weather.gov/radar/stations
- https://open-meteo.com/en/terms
- https://www.rainviewer.com/api.html
- https://mesonet.agron.iastate.edu/api/1/openapi.json
- https://www.spotternetwork.org/feeds/
- https://mping.ou.edu/license.html
- https://data.cocorahs.org/export/exportreports.aspx?Format=json&ReportType=Daily&State=IA
- https://files.airnowtech.org/airnow/today/reportingarea.dat
- https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires/
- https://www.blitzortung.org/en/cover_your_area.php
- https://www2.census.gov/geo/tiger/GENZ2024/shp/

### Service change notices
- https://www.weather.gov/media/notification/pdf_2026/scn26-48_RRFS_and_REFS_Implementation.aab.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-54_WSR-88D_Level2_Add_LTR.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-67_NEXRAD_Level_%202_radar_data_move_NOMADS_to_TGFTP.pdf
- https://www.weather.gov/media/notification/pdf_2026/PNS26-62_CAP_Transition.pdf
- https://www.roc.noaa.gov/public-documents/icds/2620002AA.pdf
- https://inside.nssl.noaa.gov/mrms/code-updates/

### Algorithms
- https://repository.library.noaa.gov/view/noaa/25111/noaa_25111_DS1.pdf
- https://vlab.noaa.gov/web/wdtd/-/azimuthal-shear
- https://vlab.noaa.gov/web/wdtd/-/rotation-tracks
- https://www.weather.gov/media/rlx/NROTpresentation.pdf
- https://github.com/jordanbrook/PyMeso
- https://www2.mmm.ucar.edu/episodes/ROC/WSR-88D_algorithms/pdfs/echo_tops.pdf
- https://www2.mmm.ucar.edu/episodes/ROC/WSR-88D_algorithms/pdfs/vertically_integrated_liquid_water.pdf
- https://vlab.noaa.gov/web/wdtd/-/severe-hail-index-shi-
- https://vlab.noaa.gov/web/wdtd/-/probability-of-severe-hail-posh-
- https://www2.mmm.ucar.edu/episodes/ROC/WSR-88D_algorithms/pdfs/storm_cell_centroids.pdf
- https://www2.mmm.ucar.edu/episodes/ROC/WSR-88D_algorithms/pdfs/tornado_detection.pdf
- https://arm-doe.github.io/pyart/_modules/pyart/retrieve/kdp_proc.html
- https://docs.wradlib.org/en/2.7.0/dp.html
- https://github.com/vlouf/dealias
- https://www.weather.gov/glossary/index.php?word=VAD+Wind+Profile
- https://vlab.noaa.gov/documents/96675/1417806/VWPReferenceGuide.pdf
- https://pysteps.readthedocs.io/en/stable/pysteps_reference/nowcasts.html

### Patents
- https://patents.google.com/patent/US6125328A/en
- https://patents.google.com/patent/US6278947B1/en
- https://patents.google.com/patent/US6401039B1/en
- https://patents.google.com/patent/US6252539B1/en
- https://patents.google.com/patent/US7917291B2/en

### Dependencies, platform, security
- https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/CHANGELOG.md
- https://v2.tauri.app/release/
- https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9
- https://v2.tauri.app/plugin/notification/
- https://raw.githubusercontent.com/stadiamaps/pmtiles-rs/main/CHANGELOG.md
- https://rustsec.org/advisories/RUSTSEC-2026-0253.html
- https://rustsec.org/advisories/RUSTSEC-2026-0258.html
- https://rustsec.org/advisories/RUSTSEC-2026-0260.html
- https://www.microsoft.com/en-us/security/blog/2026/08/04/chaindrop-supply-chain-compromise-anatomy-self-propagating-worm/
- https://github.com/danielway/nexrad/commits/main
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/runtime/
- https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM
- https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- https://signpath.org/terms.html
- https://v2.tauri.app/distribute/microsoft-store/
- https://v2.tauri.app/distribute/windows-installer/
- https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer
- https://www.theregister.com/systems/2026/08/21/amd-grabs-more-cpu-share-while-pricier-pcs-punish-desktop-demand/5291053
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://www.w3.org/TR/wcag-3.0/
- https://playwright.dev/docs/release-notes
- https://vitest.dev/blog/vitest-4

## Open Questions

1. Does the owner want to contact Spotter Network about carrying member positions? It is the one feature chasers name as keeping them on RadarScope; the feeds are keyless but PII-bearing and the site asks developers to make contact first. Blocks that item only.
2. Is a user-configured local endpoint (webhook or MQTT on `127.0.0.1`) acceptable under the "nothing new leaves the machine" rule? It decides whether the MyRadar/HookEcho integration lane is roadmap-eligible.
3. Carried from `Roadmap_Blocked.md`: the publish of 0.5 through 0.8, the isolated desktop session, the clean VM, the Authenticode purchase, and who files the upstream `hdf5-reader` issue for the `lru` bump.
