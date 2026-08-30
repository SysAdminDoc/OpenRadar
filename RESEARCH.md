# Research: OpenRadar
Date: 2026-08-30: replaces all prior research.

Tree state at time of writing (2026-08-30 01:45 EDT): another session was actively adding files to this directory during the pass (`src/index.css` 01:30, `src-tauri/` 01:31, `src/lib/*.test.ts` and `e2e/workspace.spec.ts` before 01:45). Code findings below were re-verified against the tree at 01:45. No git repository exists yet, so nothing here can cite a commit.

## Executive Summary

OpenRadar v0.1.0 is a Tauri 2 + React 19 + MapLibre GL 6 desktop shell (~2,900 lines TS/TSX, 1 Rust file) that renders a RainViewer loop over OpenFreeMap with a MyRadar-style command bar, flat/globe camera, four presets, draw/range/inspect tools, an Open-Meteo forecast panel, and JSON settings. Its strongest asset is not the code but the three sibling repos it can port from: StormDeck (Tauri, Rust decoders for NEXRAD L2/L3, MRMS GRIB2, GOES, GLM), StormScope (browser provider failover with RainViewer, nowCOAST MRMS, RIDGE) and StormviewRadar (IEM tiles, six-hour history, MESH, HRRR). The highest-value direction is to stop being a RainViewer viewer (the free tier became personal-use-only, zoom 7, 100 req/IP/min on 2026-01-01) and become the free, key-free, MIT desktop app that ships what MyRadar paywalls: per-station radar, hurricane tracker, historical radar, and road/route weather, on a globe nobody else in OSS offers.

Top opportunities, in order:
1. Make the repo buildable and honest: `npm run build` fails on Vite 8 (`minify: "esbuild"`), `tsc -b` reports 20 errors, and there is no git repo, so the CHANGELOG claim "v0.1.0 shipped" is not yet true.
2. Replace RainViewer as primary with NWS RIDGE II GeoServer WMS (`opengeo.ncep.noaa.gov`, ~2-min BREF_QCD, no fees) and nowCOAST fallback, keeping RainViewer only for outside-CONUS, with the provider-health and request-budget pattern from StormScope.
3. Wire the eleven persisted toggles that nothing reads (`layers.*`, `radar.stormCenters/lightning/flashes/markers/precipitationClassification/satelliteEnhancement`) to real sources or remove them from the UI; as of 2026-08-30 the Layers panel is a lie.
4. Fix the dual-pane camera desync, the forecast refetch on every `moveend`, the playhead jump on every 5-minute refresh, and the "Presets" button that actually toggles projection.
5. Rename MyRadar-derived product names ("Hi Def Radar", "Pro Dark", "Universal Blue" as a product label) to owned names before any public release.
6. NWS alerts polygons + NHC tropical cone/track from keyless ArcGIS/JSON feeds already proven in StormScope; both are top-reacted asks on Supercell Wx and top paywalls at MyRadar.
7. Zoom-tiered radar (MRMS/RIDGE composite at z2-7, single-site Level II at z8+, decoded in Rust from `unidata-nexrad-level2`), the RadrView/MyRadar "per-station" experience without a subscription.
8. HRRR "future radar" from IEM `hrrr::REFD` tiles on the timeline tail, since RainViewer nowcast is gone.
9. HURDAT2 archive replay with ACE, which no OSS desktop viewer ships (tropycal MIT gives the science).
10. Release engineering: signed NSIS via Azure Artifact Signing ($9.99/mo), SHA256SUMS, and a static-JSON Tauri updater, because MyRadar's Windows Store app is the one users say crashes after Windows updates.

## Product Map

- Core workflows: (1) open app, see live radar over your saved camera within seconds; (2) scrub or play a loop, toggle products and opacity; (3) switch basemap and flat/globe, save and recall four presets; (4) inspect a point, measure range, draw a path, share a view link; (5) read a 7-day forecast for the map center.
- Personas: weather-curious desktop user who wants MyRadar without ads or upsell; hobbyist chaser who wants per-station radar and alerts without RadarScope Tier 2; the author's own fleet (StormDeck operator, StormScope web user) wanting a compact radar-first shell.
- Platforms: Windows first (NSIS installer, `installMode: currentUser`), macOS/Linux claimed by the README badge but unbuilt; Linux WebKitGTK WebGL2 is a known MapLibre 6 risk (software fallback, ~125 ms/tile per geolibre.app).
- Integrations as of 2026-08-30: RainViewer (`src/lib/radar.ts`), OpenFreeMap styles + Esri World Imagery + OpenTopoMap (`src/lib/mapStyles.ts`), Open-Meteo forecast and geocoding (`src/lib/weather.ts`), Tauri store/log/opener plugins (`src-tauri/src/lib.rs`). Everything is fetched from the WebView under the CSP in `src-tauri/tauri.conf.json`; no Rust command touches the network yet.

## Competitive Landscape

- **MyRadar** (the target). Free: 2-hr composite loop, rain alerts, winds, fronts, quakes, wildfires, SPC outlooks. Paywalled ($9.99/yr Premium): Hurricane Tracker, Per-Station Radar with tilt and velocity, Historical Radar, CONUS Road Weather, RouteCast; Aviation Charts $24.99/yr. Windows Store app (v26.1804.200.0, 2026-08-08) is the only desktop radar app most users know and its top complaints are startup crashes after Windows updates, scam-redirecting ads, distant-town alerts, and re-buy prompts. Learn: the command-bar layout (already copied), rain-arrival timeline, route weather. Avoid: the product names (see Security section), ads/telemetry, the "power outages" layer that no source found evidence for.
- **RadarScope** ($9.99 + Tier 1 $9.99/yr + Tier 2 $99.99/yr; Tier 2 not purchasable on Windows). Learn: fast product switching, UTC toggle, raw bulletin text, alert filtering. Avoid: moving free features behind tiers, account coupling.
- **RadarOmega** (per-platform purchase, tiers to $119/yr, free native Win/mac/Linux client). Learn: multi-monitor desktop client, METARs, model suite. Avoid: 3D lag, tiny fonts, constant refresh flicker.
- **Windy** (no native desktop app ever; Premium $34.99/yr for 1-hr steps, tides, 3D globe). Learn: unambiguous time/source banner, plugin model (npm-published JS). Avoid: silently removing layers (Radar+ backlash), cloud-synced favorites.
- **Supercell Wx** (MIT, C++/Qt, v0.6.1 2026-07-19, 464 stars). The OSS benchmark for chasers: L2/L3, 1-9 linked panes, placefiles, `.pal` tables, drawing tools, SignPath-signed builds. Its most-reacted open issues are the cheapest wins in this stack: MRMS mosaic (#78), api.weather.gov alerts (#433), county lines (#14), key-free basemaps (#491), GIF export (#414). Avoid: requiring a Mapbox/MapTiler key (its #1 forum complaint).
- **HookEcho** (MIT, Rust/wgpu/egui, v0.12.0-beta.1 2026-08-26). Closest feature superset to this roadmap: all L2 moments, MRMS rotation/MESH/FLASH, GLM via its own `hdf5lite`, HRRR future radar, storm-motion ETAs, verification lab. Learn: alert rules with home radius, replay bundles. Reuse: its vendored gribberish fork with MRMS parameter fixes.
- **BowEcho** (Apache-2.0, v0.35.0 2026-08-28). Learn: release engineering (Authenticode + notarized, `.sha256` per asset, in-app updater, AV false-positive docs).
- **RadrView** (MIT, Node). Learn: the zoom-tiered MRMS (z2-7) to L2 (z8+) handoff and palette JSON.
- **LibreWXR** (AGPL server, api.librewxr.net, RainViewer drop-in, zoom 12, CAP polygons). Use as a global data backend over the network only; never link.
- **StormDeck / StormScope / StormviewRadar** (author's own, MIT). Port, don't rewrite: `crates/stormdeck-providers` (L2/L3/GRIB2/NetCDF decoders, palettes), `src-tauri/src/http.rs` host allowlist, StormScope `js/radar-providers.js` failover and 90 req/60 s budget, StormviewRadar `src/radar-history.js` IEM archive frames.
- **GRLevelX** ($79-$250, Windows only). Learn: placefile ecosystem and `.pal` format are the interchange standard for this audience.
- **Storm Radar (TWC)** rebuilt 2026-05-02 with 72-hr US future radar and AI presenter behind $19.99/yr. Signal that "future radar" is now table stakes.

## Reported Issues

No tracker: the directory is not a git repository and has no GitHub remote, no KNOWN_ISSUES.md, and the README has no troubleshooting section. Findings below come from building and reading the code, not from users.

Verified by building a copy on 2026-08-30 (`npm install` resolved maplibre-gl 6.6.0, @tauri-apps/api 2.11.1, vite 8.2.2, react 19.2.8):
- `npm run build` fails: Vite 8 removed esbuild; `build.minify: "esbuild"` in `vite.config.ts:30` throws "Failed to load transformWithEsbuild". Setting `minify: true` builds in ~1 s (1.2 MB JS, 480 KB worker).
- `tsc -b` reports 20 errors: `DEFAULT_SETTINGS` is `Object.freeze`d so `camera.center` widens to `number[]` (`src/lib/settings.ts:66`), `radar`/`layers` narrow to `{}` (`settings.ts:169-194`), and `emptyTools()` returns a readonly tuple MapLibre rejects (`src/components/MapViewport.tsx:142`).
- `npm run lint` fails with 3 errors: `react-hooks/set-state-in-effect` in `ForecastPanel.tsx:18` and `SearchPanel.tsx:21`, unused `CloudLightning` import in `MapOptionsPanels.tsx:4`. `prettier --check` flags 22 files. So `npm run check` cannot pass.
- `npm run tauri dev` will likely fail to connect: Vite binds `127.0.0.1:1420` (`vite.config.ts`) while `tauri.conf.json` `devUrl` is `http://localhost:1420`, which resolves to `::1` first on Windows 11. Needs live validation.

Behavioral defects (code-traced, current tree):
- Dual pane never syncs: the second `MapViewport` receives `camera` only at mount and has no `onCameraChange` (`src/App.tsx:482-492`), so the panes drift apart immediately.
- Eleven persisted toggles are read by nothing outside the settings panel: every `LayerSettings` key except `customOverlay`, and `radar.stormCenters/satelliteEnhancement/lightning/flashes/markers/precipitationClassification` (`grep` shows only `settings.ts`, `settings.test.ts`, `MapOptionsPanels.tsx`). The Layers panel copy "Data adapters activate as each source is added" admits it.
- `ForecastPanel` refetches Open-Meteo on every `moveend` because `point` derives from `settings.camera.center` (`App.tsx:442`, `ForecastPanel.tsx:14-27`); a pan burst can exceed Open-Meteo's 600/min.
- The 5-minute refresh resets the playhead to the newest frame (`App.tsx:177`) even while the user is scrubbing; `loopMinutes` is applied only at fetch time (`App.tsx:174`), so changing it does nothing for up to 5 minutes.
- The command-bar button labeled "Presets" toggles projection (`src/components/CommandBar.tsx:132-137`); the icon is Globe/Radar, the label is wrong.
- `handleShare` builds the link from `window.location.href` (`App.tsx:356`), which inside Tauri is `http://tauri.localhost/...`; no deep-link scheme is registered, so shared links open nothing.
- Autoplay starts on launch with no `prefers-reduced-motion` check in `App.tsx`; `index.css:1701` only reduces CSS transitions.
- `radar.futureRadar` is forced `false` in `normalizeSettings` and RainViewer now returns `nowcast: []`, so the concept has no source.
- `map.setStyle` on basemap change drops radar/tool/overlay layers; the `style.load` handler re-adds them, which works but flashes; MapLibre's `setStyle(..., { diff: true })` cannot diff between a URL style and a raster `StyleSpecification`.
- `handleLocate` relies on WebView geolocation; on Windows WebView2 this prompts through the OS location service and needs live validation (Tauri offers `tauri-plugin-geolocation` 2.3.2 for desktop).

## Security, Privacy, and Reliability

- **Trade dress / naming risk**: "Hi Def Radar" (`RadarLegend`, `RadarProductPanel`, `SettingsPanel`), "Pro Dark"/"Pro Light" map types, and the exact MyRadar layer list (Power Outages, Earthquakes, Wildfires, Avalanche, Droughts) are copied labels; `docs/asset-ledger.md` records reference screenshots as "AUTHORIZATION_NEEDED". Rename before publishing. Confidence: Verified (labels), Assumption (legal exposure).
- **RainViewer terms**: since 2026-01-01 the public API is "personal or educational use only", zoom 7, 100 req/IP/min, Universal Blue only (rainviewer.com/api/transition-faq.html; live `weather-maps.json` verified 2026-08-30 shows 13 past frames, empty nowcast/satellite). Shipping it as the default layer of a distributed app is outside those terms. `src/lib/radar.ts` has no request budget.
- **Esri World Imagery** (`mapStyles.ts:64`): outside Esri software requires an ArcGIS Location Platform account (free 2M tiles/month, then paid). No key is configured; CSP allows it. Replace with a keyed opt-in or drop.
- **OpenTopoMap** (`mapStyles.ts:70`): volunteer server, CC-BY-SA credit string required, "notify for app use", no bulk. Acceptable only as an opt-in style with the exact attribution.
- **Tauri**: `Cargo.toml` pins `tauri = "2"`; the lockfile must resolve >= 2.11.1 for GHSA-7gmj-67g7-phm9 (Windows `is_local_url` origin confusion, fixed 2026-05-06). Verify with `cargo tree -p tauri`.
- **CSP** (`tauri.conf.json`) is a good host allowlist but uses `style-src 'unsafe-inline'` (needed by MapLibre) and permits `http://asset.localhost`. Fine for now; every new source must be added here explicitly.
- **No network boundary in Rust**: all fetches happen in the WebView. StormDeck's `http.rs` (host allowlist, 16 MiB cap, 30 s timeout, NWS-shaped User-Agent) is the pattern to port before any Rust command downloads S3 objects.
- **Settings**: `normalizeSettings` degrades any malformed `settings.json` to defaults silently (good) but `schemaVersion: 1` has no migration hook and `saveSettings` is not atomic (plugin-store writes whole file). Presets and camera are the only user data as of 2026-08-30.
- **Crash handling**: `ErrorBoundary.tsx` shows a fallback; `lib.rs` installs a panic hook to the log dir (2 MB x3 rotation). No frontend error is forwarded to `tauri-plugin-log`, so WebView crashes leave no file.
- **Logging/diagnostics**: `console.warn` on map source errors only (`MapViewport.tsx:294`). No provider-health readout, no request counters, nothing for a bug report.
- **Geolocation**: coordinates are used once and never stored (good). Share links include only camera state.
- **Privacy**: no telemetry, no accounts. Keep it that way; it is the differentiator against MyRadar/Clime.
- **Supply chain**: `package.json` carets allow `@tauri-apps/api` 2.11.x (safe), `react` ^19.1.0 resolves 19.2.8 (past React2Shell CVE-2025-55182, server-only anyway), `vite` ^8.2.1 is past the 2026 `server.fs.deny` CVEs (dev-only). maplibre-gl has no advisories.

## Architecture Assessment

- `src/App.tsx` (684 lines) owns settings, radar timeline, tools, toasts, dual pane, share, upload. Split into `useRadarTimeline` (frames, playhead, refresh, budget), `useSettings` (load/normalize/persist/debounce), and a `PaneController` before adding providers; otherwise every new layer lands in one file.
- Provider abstraction is absent: `radar.ts` is RainViewer-specific (`FRAME_PATH_PATTERN`, host check). Introduce `src/lib/providers/{types,rainviewer,ridge,nowcoast,iem}.ts` with the StormScope descriptor shape (`id, coverage, cadenceMinutes, staleAfter, failAfter, frames(), tile(frame)`), a health record, and ordered failover. Port `createRollingRequestBudget` from `StormScope/js/radar-providers.js:351`.
- Layer registry: `LayerSettings` should map to `src/lib/overlays/*.ts` adapters (StormScope `js/context-layers.js`, `earthquakes.js`, `nws-alerts.js` and StormDeck `src/lib/overlays/*.ts` are direct ports) with a single `syncOverlays(map, settings)` in `MapViewport`.
- Rust side: `src-tauri/src/lib.rs` is plugin wiring only. Plan a workspace with `crates/openradar-providers` mirroring `stormdeck-providers` (nexrad, mrms_grib, palette) and `src-tauri/src/{http,cache,nexrad_level2,mrms}.rs`; expose bounded PNG tiles or float32 textures over IPC rather than raw GRIB.
- Rendering: MapLibre 6 has no `raster-array`/particle layer. Wind needs `mapbox-exif-layer` (MIT, the only package with globe support) or a custom WebGL2 layer using `defaultProjectionData.mainMatrix` (StormDeck gotcha). Radar raster stays as XYZ/WMS raster sources; L2 polar data renders through a custom layer.
- Styles: `mapStyleDefinition` returns URL strings for OpenFreeMap and inline specs for rasters; "dark" and "pro-dark" and "grayscale"/"pro-light" are duplicates. Collapse to five real styles.
- Tests: three unit files (110 lines) cover `geo`, `radar` parsing, `settings` normalization; one e2e (`e2e/workspace.spec.ts`, 63 lines) drives `?testMode`. Missing: timeline reducer tests, provider failover tests with fixture JSON, dual-pane sync e2e, a Rust test target (`cargo test` has nothing to run), and an axe pass. StormDeck's `e2e/support/tauriMock.ts` and `mapTileFixture.ts` (real decodable PNGs) are the fixtures to copy.
- Docs: README promises macOS/Linux and "NOAA sources planned"; CLAUDE.md lists `cargo test` and `npm run check` as build commands although both fail on the 2026-08-30 tree. Both need the human-voice retrofit (README currently has no dashes issue but the CHANGELOG/ROADMAP are fine).

## Rejected Ideas

- Blitzortung real-time strikes via the public websocket (ZeusWatch/StormScope research; blitzortung.org/en/contact.php): requires written approval and your own relay, forbids warning use. Only GLM (native S3) or MRMS `NLDN_CG_*_AvgDensity` are keyless.
- Power outages layer (MyRadar label): PowerOutage.us is paid, EAGLE-I restricted; ORNL ODIN county feed exists but covers utilities partially. Under consideration only as an explicitly partial county choropleth, not a "Power Outages" toggle.
- RainViewer nowcast / "Future Radar" from RainViewer: removed from the free tier 2026-01-01.
- `@openmeteo/weather-map-layer` for model tiles: GPL-2.0, incompatible with MIT (StormDeck F-009). Consume the OM S3 JSON with an own reader instead.
- weatherlayers-gl: MPL-2.0 plus commercial terms and cloud tie-in; mapbox-exif-layer covers the need under MIT.
- LibreWXR / AtticRadar / OpenStorm / wX code reuse: AGPL, unlicensed, GPL-2, GPL-3 respectively. Ideas only.
- Custom ML nowcasting, automatic tornado declarations (StormDeck 2026-07-29): calibration and safety-claim risk.
- Cloud accounts, sync, telemetry: contradicts the "private by default" copy in `MorePanel` and the reason users leave MyRadar.
- Electron/WPF/Avalonia/Qt rewrite: settled in `docs/architecture.md`.
- Mobile or Wear builds (Tauri 2 supports iOS/Android): the 1024x680 minimum window and command-bar layout are desktop-only by design; ZeusWatch and the Android ecosystem note (2026-08-29) already cover that lane.
- Keyboard shortcuts (HookEcho Ctrl+K, Supercell F11): global project rule forbids them; a mouse-driven command palette is fine.
- GitHub Actions builds, winget manifests, Dependabot: global rules.
- Esri World Imagery as a free default: needs an ArcGIS account; keep only as user-keyed opt-in.

## Sources

Sibling repos (local): C:\repos\StormDeck (RESEARCH.md 2026-07-29, src-tauri/src/http.rs, crates/stormdeck-providers), C:\repos\StormScope (RESEARCH.md 2026-07-15, js/radar-providers.js, js/nws-alerts.js, js/tropical-cyclones.js, js/context-layers.js), C:\repos\StormviewRadar (RESEARCH.md 2026-07-29, src/radar-history.js, src/mesh-worker.js), C:\repos\HurricaneMap (scripts/preprocess_hurdat2.py)

Competitors (commercial):
- https://myradar.com/ ; https://apps.apple.com/us/app/myradar-accurate-weather-radar/id322439990 ; https://acmeaom.freshdesk.com/support/solutions/articles/44001261755-upgrades-available-for-ios ; https://business.myradar.com/capabilities/routecast-road-weather/ ; https://apps.microsoft.com/detail/9wzdncrfhzn6 ; https://myradar.en.uptodown.com/windows ; https://forums.justuseapp.com/en/post/ZLW103RMO5/windows-app-not-working-noted-today-windows-10-22h2 ; https://justuseapp.com/en/app/322439990/myradar-weather-radar/reviews
- https://www.radarscope.com.au/guide/what-is-radarscope-pro ; https://www.radarscope.com.au/guide/windows-managing-your-radarscope-pro-subscription ; https://apps.apple.com/us/app/radarscope/id288419283
- https://www.radaromega.com/ ; https://apps.apple.com/us/app/radaromega/id1439881811
- https://community.windy.com/topic/36488/windy-application-for-windows-desktop ; https://community.windy.com/topic/41756/radar-feature-gone ; https://docs.windy-plugins.com/getting-started/
- https://weather.com/safety/news/2026-05-02-new-storm-radar-the-weather-channel ; https://www.rainviewer.com/premium-features.html ; https://support.meetcarrot.com/weather/subscription-mobile.html ; https://grlevelxusers.com/hrf_faq/what-are-the-latest-versions-of-the-software-and-how-much-do-they-cost/ ; https://saratoga-weather.org/grlevelx-placefiles.php

Competitors (OSS):
- https://github.com/dpaulat/supercell-wx (issues #14 #17 #78 #414 #433 #491 #590) ; https://stormtrack.org/threads/open-source-weather-radar-software-supercell-wx.32393/ ; https://alternativeto.net/software/supercell-wx/about/
- https://github.com/d4vid87/hookecho ; https://github.com/FahrenheitResearch/bowecho ; https://github.com/cwdaniel/RadrView ; https://github.com/JoshuaKimsey/LibreWXR ; https://github.com/SteepAtticStairs/AtticRadar ; https://github.com/JordanSchlick/OpenStorm ; https://literadar.com
- https://github.com/netbymatt/nexrad-level-2-data ; https://github.com/danielway/nexrad ; https://github.com/mpiannucci/gribberish ; https://github.com/tropycal/tropycal ; https://github.com/openradar/TINT ; https://github.com/zwang-geog/mapbox-exif-layer ; https://github.com/maplibre/maplibre-gl-js/discussions/5991

Data services:
- https://opengeo.ncep.noaa.gov/geoserver/conus/ows?service=wms&version=1.3.0&request=GetCapabilities ; https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms?SERVICE=WMS&REQUEST=GetCapabilities ; https://nowcoast.noaa.gov/arcgis/rest/services/nowcoast/radar_meteo_imagery_nexrad_time/MapServer ; https://mesonet.agron.iastate.edu/ogc/ ; https://mesonet.agron.iastate.edu/GIS/ridge.phtml ; https://mesonet.agron.iastate.edu/GIS/model.phtml ; https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/
- https://registry.opendata.aws/noaa-mrms-pds/ ; https://www.nssl.noaa.gov/projects/mrms/operational/tables.php ; https://www.unidata.ucar.edu/blogs/news/entry/important-changes-to-noaa-nexrad ; https://github.com/awslabs/open-data-docs/blob/main/docs/noaa/noaa-nexrad/README.md
- https://weather-gov.github.io/api/general-faqs ; https://github.com/weather-gov/api/discussions/752 ; https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer ; https://www.weather.gov/media/documentation/docs/NWS_Geolocation.pdf
- https://www.nhc.noaa.gov/CurrentStorms.json ; https://www.nhc.noaa.gov/gis/ ; https://www.nhc.noaa.gov/data/hurdat/ ; https://ftp.nhc.noaa.gov/atcf/
- https://www.spc.noaa.gov/gis/ ; https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson ; https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php ; https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters/about ; https://openenergyhub.ornl.gov/explore/dataset/odin-real-time-outages-county/ ; https://api.tidesandcurrents.noaa.gov/api/prod/ ; https://api.water.noaa.gov/nwps/v1/docs/
- https://nowcoast.noaa.gov/arcgis/rest/services/nowcoast/sat_meteo_imagery_time/MapServer ; https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/ ; https://www.blitzortung.org/en/contact.php
- https://www.rainviewer.com/api/transition-faq.html ; https://www.rainviewer.com/api.html ; https://openfreemap.org/tos/ ; https://opentopomap.org/about ; https://location.arcgis.com/pricing/ ; https://open-meteo.com/en/terms

Dependencies, security, standards:
- https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/ ; https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md ; https://maplibre.org/maplibre-style-spec/projection/ ; https://vite.dev/blog/announcing-vite8 ; https://react.dev/blog/2025/10/01/react-19-2
- https://tauri.app/release/log/ ; https://v2.tauri.app/security/csp/ ; https://v2.tauri.app/plugin/updater/ ; https://v2.tauri.app/develop/debug/linux-graphics/ ; https://geolibre.app/architecture/
- https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9 ; https://github.com/advisories/GHSA-v2wj-q39q-566r ; https://github.com/advisories/GHSA-fx2h-pf6j-xcff ; https://www.microsoft.com/en-us/security/blog/2025/12/15/defending-against-the-cve-2025-55182-react2shell-vulnerability-in-react-server-components/
- https://azure.microsoft.com/en-us/products/artifact-signing ; https://weblog.west-wind.com/posts/2025/Jul/20/Fighting-through-Setting-up-Microsoft-Trusted-Signing
- https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html ; https://www.ogc.org/standards/wms/ ; https://codes.wmo.int/grib2

Community:
- https://news.ycombinator.com/item?id=44924031 ; https://news.ycombinator.com/item?id=41370187 ; https://news.ycombinator.com/item?id=47300102

## Open Questions

- Will the project accept a $9.99/month Azure Artifact Signing subscription for SmartScreen-clean installers, or ship unsigned with SHA256SUMS like StormDeck (repo no-signing rule there)? This decides whether the Tauri updater lane is viable.
- Is the MyRadar-derived naming ("Hi Def Radar", the layer list) something the author wants to keep as a deliberate homage, or should the rename land before the first public push? The roadmap assumes rename.
- Should OpenRadar depend on the LibreWXR public instance for outside-CONUS radar (network use of an AGPL service, CC-BY-4.0 data, no uptime promise), or stay CONUS + Canada (GeoMet) only until a self-hosted option exists?
