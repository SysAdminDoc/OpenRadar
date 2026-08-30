# OpenRadar Roadmap

## v0.1.0 foundation

- [x] Finish the desktop shell and globe map camera.
- [x] Add the first live radar loop and product controls.
- [x] Add map type and layer surfaces, presets, and map tools.
- [x] Add forecast and settings panels.
- [x] Verify the browser build, native build, tests, and Windows installer.

## Next releases

- [ ] Add model guidance, lightning, tides, and surge. (Research 2026-08-30: lightning is GLM or MRMS NLDN density only; Blitzortung is rejected in RESEARCH.md.)
- [ ] Add an offline cache of the last view.

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

- [ ] P2: GRLevel3 `.pal` colour tables applied to the locally decoded products
  Why: this was blocked while every radar pixel arrived as a picture NOAA had already coloured. Level II and MRMS are now decoded here, so a palette finally has raw values to act on, and a shared palette is how radar people compare the same storm across tools.
  Evidence: the ramps are hard-coded in `src-tauri/src/level2.rs` and `src-tauri/src/mrms.rs` and mirrored in the legend; the Upload panel already reads placefiles and could read a `.pal` beside them; GRLevelX `.pal` is `Color: <value> <r> <g> <b> [<r2> <g2> <b2>]` with `Product:`, `Units:`, `Step:`, `RF:`, and `SolidColor:` directives.
  Touches: new `src/lib/palette.ts` parser with its own tests, the Upload panel, a palette passed to the two Rust renderers through their commands, and the legend built from the loaded palette rather than the built-in ramp.
  Acceptance: loading a `.pal` recolours the single-site sweep and the MRMS composite to match it, the legend shows the palette's own stops and units, a file with a directive OpenRadar does not read says which one it skipped, and clearing the palette returns the built-in ramp.
  Complexity: M

- [ ] P2: Lightning from MRMS NLDN density or GLM, never Blitzortung
  Why: `radar.lightning/flashes/markers` default on with no source; Blitzortung's terms require approval and a private relay and forbid warning use.
  Evidence: `noaa-mrms-pds` `NLDN_CG_005min_AvgDensity` (rotation-track cadence tables); StormDeck `src-tauri/src/lightning.rs` (GLM `GLM-L2-LCFA` from `noaa-goes19`, 2 MiB cap); blitzortung.org/en/contact.php; nowCOAST density explicitly "not for safety plans".
  Touches: crates/openradar-providers (reuse mrms_grib), src-tauri/src/lightning.rs (port), overlay + legend, settings copy (replace "flashes/markers" with "density" and "flashes" as GLM points).
  Acceptance: a 5-minute CG density raster renders with a legend and a "not a warning source" line; the GLM flash overlay updates every minute when enabled.
  Complexity: L

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
