# OpenRadar Roadmap

## v0.1.0 foundation

- [x] Finish the desktop shell and globe map camera.
- [x] Add the first live radar loop and product controls.
- [x] Add map type and layer surfaces, presets, and map tools.
- [x] Add forecast and settings panels.
- [x] Verify the browser build, native build, tests, and Windows installer.

## Next releases

- [ ] Add model guidance, tides, and surge.
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

### P3

- [ ] P3: Wind particle layer on the globe from HRRR/GFS via `mapbox-exif-layer`
  Why: MyRadar and Windy ship animated winds; MapLibre has no native particle layer and exactly one MIT package supports globe.
  Evidence: github.com/zwang-geog/mapbox-exif-layer (1.3.4, `mapRuntime:'maplibre'`); maplibre discussion #5991; Open-Meteo OM S3 `data_spatial/<model>/latest.json` (GPL reader must not be bundled; write an own reader).
  Touches: new src-tauri command producing float32 GeoTIFF u/v from GFS 0.25 (Herbie-style `.idx` byte ranges), new overlay using ParticleMotion.
  Acceptance: winds animate on the globe at 60 fps on the dev GPU with a model/init banner; disabled automatically under reduced motion.
  Complexity: L

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
