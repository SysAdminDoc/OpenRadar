# OpenRadar Roadmap

## v0.1.0 foundation

- [x] Finish the desktop shell and globe map camera.
- [x] Add the first live radar loop and product controls.
- [x] Add map type and layer surfaces, presets, and map tools.
- [x] Add forecast and settings panels.
- [x] Verify the browser build, native build, tests, and Windows installer.

## Next releases

- [ ] Add NOAA MRMS radar products alongside the RIDGE II mosaic that now leads the provider chain.
- [ ] Add model guidance, satellite, lightning, tides, and surge. (Research 2026-08-30: lightning is GLM or MRMS NLDN density only; Blitzortung is rejected in RESEARCH.md.)
- [ ] Add HURDAT2 history with archived radar playback.
- [ ] Add accessible export, notifications, and an offline cache.

## Research-Driven Additions

### P0

- [x] P0: Make `npm run check` pass on Vite 8 and TypeScript
  Why: a release needs a repeatable local build gate.
  Evidence: build of a copy on 2026-08-30 (RESEARCH.md, Reported Issues); `vite.config.ts:30`; `src/lib/settings.ts:66,169-194`; `src/components/MapViewport.tsx:142`; `src/panels/ForecastPanel.tsx:18`; `src/panels/SearchPanel.tsx:21`; `src/panels/MapOptionsPanels.tsx:4`.
  Touches: vite.config.ts, src/lib/settings.ts (type `DEFAULT_SETTINGS` as `AppSettings` and cast the frozen object; type `radar`/`layers` as `Partial<...>`), src/components/MapViewport.tsx, src/panels/ForecastPanel.tsx, src/panels/SearchPanel.tsx, src/panels/MapOptionsPanels.tsx, all files under prettier.
  Acceptance: `npm run check` exits 0; `npm run tauri build -- --bundles nsis` produces `src-tauri/target/release/bundle/nsis/*.exe`.
  Complexity: S

- [x] P0: Initialize git, push to GitHub, and align docs with what is actually built
  Why: the first working release needs durable history and a public download location.
  Evidence: OpenRadar v0.1.0 was built and verified locally before the initial push.
  Touches: new .git, README.md, CLAUDE.md, CHANGELOG.md, docs/architecture.md.
  Acceptance: `git log` shows the initial commit with author SysAdminDoc; the remote serves README; branch protection enabled; README commands run as written.
  Complexity: S

- [x] P0: Fix `tauri dev` host mismatch between Vite (`127.0.0.1`) and `devUrl` (`localhost`)
  Why: on Windows 11 `localhost` resolves to `::1` first and Vite is bound to IPv4 only, so the dev window can load a blank page.
  Evidence: `vite.config.ts` `server.host: host || "127.0.0.1"`; `src-tauri/tauri.conf.json` `devUrl: "http://localhost:1420"`; needs live validation.
  Touches: src-tauri/tauri.conf.json (set `devUrl` to `http://127.0.0.1:1420`) or vite.config.ts.
  Acceptance: `npm run tauri dev` opens the map without editing hosts; documented in CLAUDE.md gotchas.
  Complexity: S

- [x] P0: Rename MyRadar-derived product and style names
  Why: "Hi Def Radar", "Pro Dark", "Pro Light", and the copied layer list are MyRadar's labels; `docs/asset-ledger.md` already marks the reference screenshots "AUTHORIZATION_NEEDED".
  Evidence: `src/components/MapChrome.tsx` RadarLegend; `src/panels/RadarProductPanel.tsx`; `src/panels/SettingsPanel` section title; `src/lib/mapStyles.ts` MAP_STYLE_OPTIONS; myradar.com feature names.
  Touches: those files plus src/lib/settings.ts `MapStyleId` (with migration of stored `pro-dark`/`pro-light` values), README.md, e2e/workspace.spec.ts selectors.
  Acceptance: no string in `src/` matches `Hi Def|Pro Dark|Pro Light`; stored settings with old style ids load without resetting the user's choice.
  Complexity: S

### P1

- [x] P1: Fix the "Presets" command button that toggles projection and honor reduced motion for autoplay
  Why: the button labeled Presets calls `onProjection`; users clicking Presets get a globe. Autoplay starts on launch regardless of `prefers-reduced-motion`.
  Evidence: `src/components/CommandBar.tsx:132-137`; `src/App.tsx` `playing` initial `true`; `src/index.css:1701` covers transitions only.
  Touches: src/components/CommandBar.tsx (label "Globe"/"Flat" with the projection icon, or move projection into the Map Type panel only), src/App.tsx (initial `playing` from `matchMedia("(prefers-reduced-motion: reduce)")`).
  Acceptance: the button text matches its action; with reduced motion enabled the loop opens paused and the play button is focused-visible.
  Complexity: S

### P2

- [ ] P2: Zoom-tiered single-site Level II radar decoded in Rust
  Why: per-station radar with tilt and velocity is MyRadar's Premium and RadarScope's core; RadrView's z8+ handoff is the UX model; the decoders already exist under MIT.
  Evidence: `unidata-nexrad-level2` bucket (legacy `noaa-nexrad-level2` frozen 2025-09-01), `unidata-nexrad-level2-chunks` for real time; StormDeck `src-tauri/src/nexrad_level2/{source,cache,render}.rs` with `nexrad-data`/`nexrad-model` crates (MIT); RadrView README.
  Touches: new crates/openradar-providers (port from stormdeck-providers), src-tauri/src/nexrad_level2/, IPC command returning PNG tiles or a float32 polar texture, new custom WebGL2 layer in MapViewport using `defaultProjectionData.mainMatrix`, RadarProductPanel (site, tilt, REF/VEL/ZDR/CC), site picker from `api.weather.gov/radar/stations`.
  Acceptance: zooming past z8 over CONUS switches to the nearest site's latest 0.5° reflectivity within 5 s; velocity and tilt selection work; the ignored live-decode test passes against a KDMX archive file; memory stays under 512 MB with four volumes cached.
  Complexity: XL

- [ ] P2: MRMS national composite and rotation/MESH products from `noaa-mrms-pds`
  Why: MRMS is "generally much better than RIDGE" per HN and is Supercell's #78; rotation tracks and MESH are RadarScope Tier 2 paywalls.
  Evidence: registry.opendata.aws/noaa-mrms-pds (2-min cadence, PNG-packed GRIB2 template 5.41, grids now 14,000x7,000); StormDeck `src-tauri/src/mrms.rs` and `crates/stormdeck-providers/src/mrms_grib.rs`; gribberish 1.7.0 (MIT) with PNG packing.
  Touches: crates/openradar-providers/mrms_grib.rs (port), src-tauri/src/mrms.rs (bounded surface decode, never a full f32 grid), IPC tile command, product list (MergedReflectivityQCComposite, RotationTrack60min, MESH, PrecipFlag).
  Acceptance: the MRMS composite renders CONUS at z2-7 as the primary product with a 2-minute cadence; rotation tracks and MESH are toggles with legends; decode of a live file completes under 3 s on the dev PC.
  Complexity: L

- [ ] P2: Signed Windows installer, SHA256SUMS, and static-JSON updater
  Why: MyRadar's desktop weakness is update breakage; BowEcho and Supercell ship signed builds with checksums; an unsigned NSIS trips SmartScreen.
  Evidence: azure.microsoft.com/en-us/products/artifact-signing ($9.99/mo Basic, individuals admitted); v2.tauri.app/plugin/updater (`tauri signer generate`, `{{target}}/{{arch}}/{{current_version}}` endpoints); BowEcho release page.
  Touches: src-tauri/tauri.conf.json (`bundle.windows.signCommand`, `plugins.updater`), src-tauri/Cargo.toml (tauri-plugin-updater 2.10.1), a local release script producing SHA256SUMS and `latest.json` on GitHub Releases, README install section with the SmartScreen note.
  Acceptance: `gh release view` shows the `.exe`, `.sig`, `SHA256SUMS`, and `latest.json`; a v0.1.x install updates itself to v0.1.y from the manifest; open question on signing cost is answered first.
  Complexity: M

- [ ] P2: Route weather along an OSRM route with departure-time slices
  Why: RouteCast is MyRadar's Premium headline and Windy's Route Planner is Premium; no OSS desktop viewer has it; OSRM and Open-Meteo hourly are keyless.
  Evidence: business.myradar.com/capabilities/routecast-road-weather; StormDeck OSRM routing (`router.project-osrm.org`); Open-Meteo hourly forecast.
  Touches: new src/panels/RoutePanel.tsx (two geocoded points, departure time), new src/lib/route.ts (OSRM polyline, sample every 25 km, forecast at ETA per sample), MapViewport line layer colored by precipitation probability.
  Acceptance: entering two places draws the route with per-segment colors and a table of ETA, temperature, precipitation chance; changing departure time recolors within 2 s; OSRM demo-server fair-use (one request per route change) is respected.
  Complexity: M

- [ ] P2: GOES GeoColor satellite layer synced to the radar timeline
  Why: `radar.satelliteEnhancement` defaults on with no source; satellite is free in Windy and RadarOmega's paywall; nowCOAST serves a time-enabled composite.
  Evidence: nowCOAST `sat_meteo_imagery_time/MapServer` (15-min GOES E/W), StormScope `js/context-layers.js:96-121` (exportImage, antimeridian split); NESDIS `MERGEDGC_current` XYZ tiles (StormviewRadar).
  Touches: new src/lib/overlays/satellite.ts, MapViewport raster layer below radar, timeline aligns satellite time to nearest 15-min frame, CSP.
  Acceptance: toggling Satellite shows GeoColor under the radar with its own age readout; scrubbing changes both layers; attribution reads NOAA/NESDIS.
  Complexity: M

- [ ] P2: Lightning from MRMS NLDN density or GLM, never Blitzortung
  Why: `radar.lightning/flashes/markers` default on with no source; Blitzortung's terms require approval and a private relay and forbid warning use.
  Evidence: `noaa-mrms-pds` `NLDN_CG_005min_AvgDensity` (rotation-track cadence tables); StormDeck `src-tauri/src/lightning.rs` (GLM `GLM-L2-LCFA` from `noaa-goes19`, 2 MiB cap); blitzortung.org/en/contact.php; nowCOAST density explicitly "not for safety plans".
  Touches: crates/openradar-providers (reuse mrms_grib), src-tauri/src/lightning.rs (port), overlay + legend, settings copy (replace "flashes/markers" with "density" and "flashes" as GLM points).
  Acceptance: a 5-minute CG density raster renders with a legend and a "not a warning source" line; the GLM flash overlay updates every minute when enabled.
  Complexity: L

- [ ] P2: Placefile and `.pal` color-table import
  Why: the chaser audience's interchange standard (GRLevelX, Supercell Wx); the Upload panel only takes GeoJSON.
  Evidence: saratoga-weather.org/grlevelx-placefiles.php; StormDeck `src-tauri/src/placefile.rs` (incl. Image triangles) and `crates/stormdeck-providers/src/palette.rs`; Supercell #614.
  Touches: src-tauri/src/placefile.rs (port), src/panels/UtilityPanels.tsx UploadPanel (URL with refresh interval, local file), palette selector in RadarProductPanel.
  Acceptance: an NWS-alerts placefile URL renders with its icons and tooltips and refreshes on its `Refresh:` interval; a GRLevel3 `.pal` applied to reflectivity changes the legend ramp.
  Complexity: M

- [ ] P2: HURDAT2 archive replay with ACE and per-storm track
  Why: historical radar is a MyRadar Premium; no OSS desktop viewer ships HURDAT2 replay; the science is MIT in tropycal.
  Evidence: `https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-02272026.txt` (6.8 MB, posted 2026-03-05), HurricaneMap `scripts/preprocess_hurdat2.py` gotchas (L marker CONUS-only, -1 = TS), tropycal ACE/SSHWS code, IEM `nexrad-n0q` archive since 2003 and `mrms::lcref` since 2015 for synced radar.
  Touches: build-time preprocessor to a compact JSON (bundled), new src/panels/HistoryPanel.tsx (search by name/year, ACE, peak), MapViewport track/points layer, timeline replay of IEM archive frames for storms after 2003.
  Acceptance: searching "Ian 2022" draws the track with 6-hourly intensity colors, shows ACE, and the timeline plays the IEM radar mosaic around landfall; Pacific file included.
  Complexity: L

- [ ] P2: Still and animated loop export
  Why: MyRadar Share and Weather & Radar video are table stakes; Supercell #414 asks for it; StormScope already burns provider/time into WebM frames locally.
  Evidence: StormScope README "Local Radar Loop Export"; `canvasContextAttributes: { preserveDrawingBuffer: true }` already set in MapViewport.
  Touches: new src/lib/export.ts (canvas capture per frame, WebM via `MediaRecorder` or PNG sequence to a local folder with `tauri-plugin-dialog`), Share panel.
  Acceptance: "Export loop" writes a WebM under 20 MB with source, time, and attribution burned in; "Export image" writes a PNG of the current view; nothing is uploaded.
  Complexity: M

- [ ] P2: Windows notifications for new alerts in a watched radius
  Why: MyRadar's rain alerts and Rain Alarm are the retention feature; Supercell #352/#581 ask for it; the app already has a location fix flow.
  Evidence: tauri-plugin-notification 2.3.3; HookEcho home-radius rules; StormDeck ntfy relay (optional).
  Touches: Cargo.toml/capabilities (notification), settings (watched point, radius, severities), background poll in the alerts adapter, Settings panel.
  Acceptance: a new tornado warning polygon within the radius produces a Windows toast within 60 s while the app is minimized; toasts never fire for events outside the radius or already seen.
  Complexity: M

- [ ] P2: Light theme contrast audit and `prefers-contrast` support
  Why: the app is dark by default with a light option; HookEcho #12 and StormviewRadar's owned palettes show the audience wants high-contrast; nothing verifies the light theme as of 2026-08-30.
  Evidence: `src/index.css:27` light tokens; contrast memory "check every surface".
  Touches: src/index.css, ToastHost, PanelShell, radar legend ramp (add dBZ labels).
  Acceptance: axe reports no contrast violations in either theme at 1440x900 and 1024x720; the legend shows numeric dBZ stops; a `prefers-contrast: more` block increases border and text contrast.
  Complexity: S

### P3

- [ ] P3: Wind particle layer on the globe from HRRR/GFS via `mapbox-exif-layer`
  Why: MyRadar and Windy ship animated winds; MapLibre has no native particle layer and exactly one MIT package supports globe.
  Evidence: github.com/zwang-geog/mapbox-exif-layer (1.3.4, `mapRuntime:'maplibre'`); maplibre discussion #5991; Open-Meteo OM S3 `data_spatial/<model>/latest.json` (GPL reader must not be bundled; write an own reader).
  Touches: new src-tauri command producing float32 GeoTIFF u/v from GFS 0.25 (Herbie-style `.idx` byte ranges), new overlay using ParticleMotion.
  Acceptance: winds animate on the globe at 60 fps on the dev GPU with a model/init banner; disabled automatically under reduced motion.
  Complexity: L

- [ ] P3: Canada radar via ECCC GeoMet and outside-CONUS fallback policy
  Why: the README promises global navigation; RainViewer is now personal-use; GeoMet is keyless with a 6-minute 1 km composite.
  Evidence: `https://geo.weather.gc.ca/geomet` layer `RADAR_1KM_RRAI` (mm/h, 3 h retained, no batch retrieval) in StormviewRadar CHANGELOG 2026-08-12.
  Touches: src/lib/providers/geomet.ts, coverage bounds logic, legend in mm/h, CSP.
  Acceptance: viewports over Canada show GeoMet frames with the licence attribution and mm/h legend; only displayed frames are requested.
  Complexity: M

- [ ] P3: Offline last-view cache of the app shell, last radar frames, and alert polygons
  Why: StormviewRadar and HookEcho ship offline last view; a desktop app that opens to a blank map without network is worse than the Store app.
  Evidence: StormviewRadar README "Offline Last View"; StormDeck `persistent_http_cache.rs` (versioned atomic disk cache, 2,048 entries / 256 MiB).
  Touches: src-tauri/src/cache.rs (port), providers use it with explicit "cached, N min old" labeling.
  Acceptance: disconnecting the network and relaunching shows the last loop labeled as cached with its age; reconnecting resumes live within one refresh.
  Complexity: L

- [ ] P3: Spanish localization of the workspace
  Why: StormDeck ships English and Spanish with a pseudolocale gate; a free radar app for the US Gulf and Southwest benefits; all copy is currently inline strings.
  Evidence: StormDeck README "English and Spanish"; ESLint literal-string lint there.
  Touches: new src/i18n/, every panel, Settings language picker.
  Acceptance: switching language updates all panel titles and copy without restart; a pseudolocale run shows no clipped labels at 1024x720.
  Complexity: L

- [ ] P3: Mouse-driven command palette listing every layer and product
  Why: HookEcho's Ctrl+K palette is the fastest way to a product; the project rule forbids shortcuts, so surface it as a button.
  Evidence: HookEcho README; RadarScope "fast layer access" praise.
  Touches: new src/components/CommandPalette.tsx wired to the layer registry from the P1 refactor.
  Acceptance: typing "meso" in the palette toggles rotation tracks; the palette is reachable from the command bar and closes on selection.
  Complexity: S
