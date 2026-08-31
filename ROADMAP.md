# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items `AUD-011` through `AUD-066` are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

## P0

- [ ] AUD-001: Synchronize release version metadata
      Why: The repository currently identifies itself as 0.1.0, 0.2.0, and 0.3.0 in different places, while the planned post-audit delivery is 0.4.0. A release proof cannot be trustworthy if the executable, lockfiles, settings metadata, badge, and notes disagree.
      Evidence: `package.json`; root `package-lock.json`; `src/lib/settings.ts`; `src-tauri/tauri.conf.json`; `src-tauri/Cargo.toml`; `src-tauri/Cargo.lock`; `README.md`; `CHANGELOG.md`; `scripts/release.mjs`
      Touches: Every version-bearing file listed above
      Acceptance: One version audit command finds only 0.4.0 in active release metadata; the README badge and checksum example match; the changelog has the matching heading; the release script's version preflight passes.
      Complexity: M

- [ ] AUD-067: Remove the transitive `lru 0.16.4` unsoundness
      Why: The native NetCDF chain contains a safe-Rust memory-unsoundness advisory. The patched line begins at 0.18.2.
      Evidence: `src-tauri/Cargo.lock`; `cargo tree -i lru@0.16.4`; https://rustsec.org/advisories/RUSTSEC-2026-0253.html
      Touches: `src-tauri/Cargo.toml`; `src-tauri/Cargo.lock`; NetCDF and HDF5 decoding tests
      Acceptance: `cargo tree` contains no affected `lru`; lightning and GFS fixtures still decode; native tests and `cargo audit` pass without this advisory; any temporary override has an upstream removal note.
      Complexity: M

- [ ] AUD-068: Introduce one provenance and freshness contract for weather data
      Why: Radar frames carry provider and time, while overlays, guidance, exports, and diagnostics use unrelated shapes. A reader cannot consistently answer who supplied a layer, when it was observed, when it is valid, whether it is derived, or why it is stale.
      Evidence: `src/lib/providers/types.ts`; `src/lib/guidance.ts`; `src/lib/overlays/index.ts`; `src/hooks/useRadarTimeline.ts`; `src/components/WorkspaceChrome.tsx`; https://github.com/danielway/nexrad-workbench/issues/180
      Touches: A shared provenance type; provider and overlay adapters; guidance; source display; diagnostics; export metadata
      Acceptance: Every visible weather layer can report source identity, attribution, observed time, valid time, fetched time, expiry or freshness rule, cache state, derivation, and model run when applicable; diagnostics and exports serialize the record; contract tests reject missing required fields and observation or forecast confusion.
      Complexity: L

- [ ] AUD-069: Add one local live-provider contract gate
      Why: Browser live checks require `OPENRADAR_LIVE=1`, Rust network checks are individually ignored, and the release command runs neither group. Provider schema or path drift can therefore reach a release unnoticed.
      Evidence: `src/lib/guidance.test.ts`; `src/lib/overlays/spc.test.ts`; `src/lib/providers/`; ignored tests in `src-tauri/src/`; `scripts/release.mjs`; https://www.weather.gov/documentation/services-web-api
      Touches: `package.json`; `scripts/`; provider fixtures; native ignored-test selection; release documentation
      Acceptance: One documented local command exercises each supported live provider with rate limits and timeouts, prints a machine-readable pass, fail, or skipped result per contract, exits nonzero for required failures, and never runs on GitHub infrastructure.
      Complexity: M

- [ ] AUD-002: Build and publish the post-audit release
      Why: The public v0.3.0 release predates the audit repairs on `main`. Users cannot install the reviewed tree until a clean local release is published.
      Evidence: https://github.com/SysAdminDoc/OpenRadar/releases/tag/v0.3.0 ; `git log`; `scripts/release.mjs`; `ROADMAP.md`
      Touches: Release artifacts; updater manifest; checksums; tag; GitHub release
      Acceptance: The clean release gate runs from a commit equal to `origin/main`; tests, build, artifact checks, updater signature verification, and commit proof pass; the tag and release point to that commit; the installer, signature, checksums, and manifest download successfully.
      Complexity: L

## P1

- [ ] AUD-003: Observe an installed updater replacement end to end
      Why: Signature and manifest tests do not prove that Windows replaces an older installed build and restarts into the requested version.
      Evidence: `scripts/release.mjs`; `src/hooks/useUpdates.ts`; `src/panels/DiagnosticsPanel.tsx`
      Touches: Installed v0.3.0 and post-audit build in an isolated Windows desktop session
      Acceptance: An older installed build finds the update only when asked, downloads it, verifies it, replaces itself, restarts once, preserves settings, and reports the new version; failure and rollback evidence are captured.
      Complexity: M

- [ ] AUD-004: Exercise the real native desktop workflows
      Why: Unit and headless coverage exists, but deep links, single-instance reuse, Windows notifications, native save dialogs, log creation, and file reveal have not all been observed in a real installed window.
      Evidence: `src-tauri/src/lib.rs`; `src/hooks/useAlertWatch.ts`; `src/hooks/useExport.ts`; `src/lib/log.ts`; Playwright scenarios under `e2e/`
      Touches: Packaged desktop build; deep links; notification permission; export; logs; diagnostics
      Acceptance: An isolated desktop run verifies every named workflow, including denied permission and failed save paths; no extra window appears; every failure reaches a toast or panel and the log.
      Complexity: L

- [ ] AUD-005: Authenticode-sign the Windows installer
      Why: The updater payload is signed, but Windows SmartScreen still warns on first install because the NSIS executable has no Authenticode signature.
      Evidence: `README.md`; `scripts/release.mjs`; `src-tauri/tauri.conf.json`
      Touches: Certificate provisioning; local release signing; signature verification; release notes
      Acceptance: `Get-AuthenticodeSignature` reports a valid trusted signature on the installer, the release gate rejects an unsigned installer, and the certificate identity and timestamp are documented without committing secrets.
      Complexity: M

- [ ] AUD-006: Repeat clean Windows VM install and uninstall validation
      Why: The current machine cannot prove first-run behavior, per-user installation, uninstall cleanup, or absence of undeclared prerequisites.
      Evidence: `README.md`; `src-tauri/tauri.conf.json`; prior audit notes in `ROADMAP.md` history
      Touches: Clean Windows validation VM; NSIS installer; user data and cache directories
      Acceptance: A clean VM installs without administrator rights, starts, loads live radar, exports a file, uninstalls cleanly, and leaves only documented user data; the exact Windows build and evidence are recorded.
      Complexity: M

- [ ] AUD-070: Decide durable replacements or operating limits for OSRM and RainViewer
      Why: Route weather depends on a no-SLA demo service, while worldwide radar fallback uses terms meant for personal and small-community use. Existing throttling handles failure but does not settle long-term distribution.
      Evidence: `src/lib/route.ts`; `src/lib/providers/rainviewer.ts`; `docs/asset-ledger.md`; https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy ; https://www.rainviewer.com/api.html
      Touches: Route provider strategy; worldwide radar fallback; provider health; asset ledger; user-facing availability copy
      Acceptance: A written decision names the supported traffic model and fallback for each service; no core workflow silently depends on an unsuitable tier; terms and attribution are current; provider failure leaves a truthful reduced-capability state.
      Complexity: M

- [ ] AUD-071: Cache bounded decoded Level II volumes for instant tilt and product changes
      Why: The existing four-volume cache keeps compressed bytes, then constructs and scans the same volume for every product or tilt request. Volume exploration pays repeated CPU and allocation cost.
      Evidence: `src-tauri/src/level2.rs`; `src/hooks/useSingleSiteRadar.ts`; https://github.com/FahrenheitResearch/bowecho ; https://github.com/danielway/nexrad-workbench
      Touches: Level II acquisition, decoded scan ownership, memory budget, invalidation, product rendering
      Acceptance: The first request decodes once per volume identity; later tilt or supported-product changes reuse the scan; live and finished generations cannot cross; a strict byte and entry budget evicts deterministically; fixture tests prove reuse and invalidation; repeated tilt changes remain responsive on the reference machine.
      Complexity: L

- [ ] AUD-072: Add local Archive II import and arbitrary site and date browsing
      Why: Local files and historical volume review are standard research and incident-analysis workflows in NEXRAD Workbench, RadarScope, and scientific tools. OpenRadar currently opens live or recent provider frames, not a user-selected Archive II volume.
      Evidence: `src-tauri/src/level2.rs`; `src/hooks/useSingleSiteRadar.ts`; https://github.com/danielway/nexrad-workbench ; https://registry.opendata.aws/noaa-nexrad/ ; https://www.ncei.noaa.gov/products/weather-climate-toolkit
      Touches: Native file picker; Level II decoder entry point; archive browser; timeline; history and source copy; workspace schema
      Acceptance: A user can open a local Archive II file fully offline or select a site and UTC time from the public archive; product and tilt controls work; the timeline displays volume time and source; current warnings or reports never masquerade as historical context; malformed files fail without changing the active view; fixtures cover compressed and uncompressed samples.
      Complexity: XL

- [ ] AUD-073: Add resumable offline incident packs with PMTiles
      Why: Storm work often happens with weak connectivity. HookEcho and Anvil prove that a prepared local basemap and incident bundle is useful on desktop.
      Evidence: `src/lib/mapStyles.ts`; `src-tauri/src/cache.rs`; https://github.com/d4vid87/hookecho ; https://github.com/jhammon88219/Anvil ; https://github.com/protomaps/PMTiles ; https://github.com/makinacorpus/maplibre-offline-pmtiles
      Touches: Region and zoom selector; PMTiles storage; download queue; disk budget; map style routing; pack management; workspace metadata
      Acceptance: A bounded region and zoom range downloads with an estimated size, pause and resume, byte and hash verification, attribution, and a configurable disk ceiling; cancelling or deleting leaves no orphaned bytes; the selected region renders with networking disabled; backup files reference packs without embedding large data by accident.
      Complexity: XL

- [ ] AUD-074: Add a two-point Level II cross-section
      Why: A height-versus-distance view answers the practical vertical-structure question without the GPU and interaction burden of full 3D. BowEcho and GR2Analyst validate the workflow.
      Evidence: `src-tauri/src/level2.rs`; `src/components/MapViewport.tsx`; https://github.com/FahrenheitResearch/bowecho ; https://www.grlevelx.com/gr2analyst_3/
      Touches: Decoded-volume cache; native sampling; two-point map tool; cross-section panel; legend and accessibility copy
      Acceptance: Two points inside radar range produce a height-versus-distance image for reflectivity or dealiased velocity; beam height, distance, elevation coverage, time, site, product, and units are labeled; missing coverage remains transparent; a synthetic-volume test validates geometry and values; reduced motion and keyboard map-tool behavior remain intact.
      Complexity: XL

- [ ] AUD-075: Add quiet hours, notification test, and alert rationale
      Why: The current watch has one place, radius, severity, event filters, and optional sound, but no quiet schedule, test action, or durable explanation of why a notification fired. Adjacent users report noisy retriggers when polygons change without a meaningful upgrade.
      Evidence: `src/lib/settings.ts`; `src/hooks/useAlertWatch.ts`; `src/panels/MapOptionsPanels.tsx`; https://github.com/dpaulat/supercell-wx/issues/617
      Touches: Watch settings and migration; alert comparison; notification and sound delivery; settings panel; diagnostics
      Acceptance: A user can set local quiet hours with an emergency override, send a harmless test notification and tone, and inspect the event type, severity threshold, location radius, and upgrade that caused each alert; polygon reductions do not retrigger by default; time-zone and midnight tests pass.
      Complexity: M

- [ ] AUD-076: Make high contrast apply to radar and hazard geometry
      Why: Browser high contrast currently strengthens interface chrome, but radar color tables, warning outlines, tracks, and overlay widths keep their normal values. The information itself needs an accessible treatment.
      Evidence: `src/index.css`; `src/lib/legend.ts`; `src-tauri/src/palette.rs`; `src/components/MapViewport.tsx`; https://github.com/d4vid87/hookecho/issues/12
      Touches: Built-in radar ramps; native palette selection; polygon and line styles; legends; accessibility scenarios
      Acceptance: High contrast selects tested reflectivity and velocity ramps, strengthens critical polygon and track geometry, and retains text labels for severity and threat; common color-vision simulations preserve distinctions; imported palettes receive a warning rather than being silently altered; screenshot and semantic tests cover dark, light, and high-contrast map content.
      Complexity: L

- [ ] AUD-087: Reconcile the asset ledger with actual files and network hosts
      Why: The ledger names nonexistent `public/hurdat.json`, omits active DWD and NEXRAD bucket hosts, and claims to match an allowlist it does not fully describe.
      Evidence: `docs/asset-ledger.md`; `public/hurdat/`; `src-tauri/src/http.rs`; `src-tauri/src/tauri.conf.json`; `src/lib/tileCache.ts`
      Touches: `docs/asset-ledger.md`; a local ledger consistency check if useful
      Acceptance: Every bundled data path and externally contacted host has source, license or terms, attribution placement, cache behavior, and privacy note; nonexistent paths are removed; a focused test or documented audit detects future divergence among the native allowlist, CSP, cache routing, and ledger.
      Complexity: S

- [ ] AUD-090: Publish a vulnerability reporting and supported-version policy
      Why: The public repository has no `SECURITY.md`, so researchers are not told how to report privately or which releases receive fixes.
      Evidence: Repository root; https://github.com/SysAdminDoc/OpenRadar
      Touches: `SECURITY.md`; README support link; release policy
      Acceptance: The policy names supported versions, a private reporting route controlled by the maintainer, expected acknowledgement windows, disclosure handling, and the local security checks; it contains no secret address or automation dependency.
      Complexity: S

## P2

- [ ] AUD-007: Decide whether macOS and Linux are supported targets
      Why: Tauri is portable, but only Windows x64 is built and tested. A platform claim without hardware evidence creates support and security expectations.
      Evidence: `README.md`; `src-tauri/tauri.conf.json`; https://github.com/d4vid87/hookecho/issues/9
      Touches: Product support statement; bundle configuration; platform-specific native behavior; installed acceptance matrix
      Acceptance: Either documentation keeps Windows as the explicit boundary, or each added operating system has a locally built installer, real-hardware launch and core-flow evidence, updater and file-dialog checks, and a documented support policy.
      Complexity: XL

- [ ] AUD-008: Reduce or isolate the initial map bundle
      Why: Lazy panel loading helped, but Vite still reports a roughly 1.4 MB minified main chunk and the MapLibre worker is about 630 kB. Startup cost will grow as archive and offline features arrive.
      Evidence: `src/App.tsx`; `vite.config.ts`; current production build output; `package.json`
      Touches: Map bootstrap; provider registration; heavy analysis modules; worker loading; bundle budget
      Acceptance: A documented bundle budget is enforced locally; optional analysis and archive code load on demand; the first interactive map path does not regress; cold-open and provider fallback scenarios pass; build output shows a material main-chunk reduction or a measured reason to retain it.
      Complexity: L

- [ ] AUD-009: Remove the all-target `glib 0.18.5` advisory
      Why: The package is not in the Windows dependency tree, but all-target scanning remains noisy and the affected iterator range is unsound.
      Evidence: `src-tauri/Cargo.lock`; scanner output; https://rustsec.org/advisories/RUSTSEC-2024-0429.html
      Touches: Upstream Tauri or GTK dependency chain; lockfile; all-target scan policy
      Acceptance: The affected `glib` version is gone from supported-target graphs, or a dated upstream exception proves it cannot execute on shipped targets and names the dependency that must move; the scanner report is clean or narrowly documented.
      Complexity: M

- [ ] AUD-010: Capture and inspect a true wide desktop viewport
      Why: The in-app capture backend capped the earlier wide reference at 1248 pixels, so the 1916-pixel README layout has no current isolated evidence.
      Evidence: `assets/screenshots/`; `e2e/`; prior audit notes in Git history
      Touches: Isolated screenshot setup; wide layout scenarios; README image if the current capture changes
      Acceptance: A 1916-pixel or wider isolated capture covers default, open panels, dual pane, 130 percent text, and a long Spanish string; no clipped controls, dead space, or unreadable legends remain; current README imagery is recaptured if UI evidence changes.
      Complexity: S

- [ ] AUD-077: Support a bounded local list of watched places
      Why: One watch point cannot cover home, family, a destination, and a route endpoint. RadarOmega and adjacent tools treat saved locations as a core alert workflow, but OpenRadar can do this without accounts or sync.
      Evidence: `src/lib/settings.ts`; `src/hooks/useAlertWatch.ts`; `src/panels/MapOptionsPanels.tsx`; https://www.radaromega.com/
      Touches: Settings schema and migration; batched alert queries; watch management; notification copy; workspace backup
      Acceptance: Up to ten named local watch places can carry radius, severity, event filters, sound, and quiet policy; one alert is deduplicated across overlapping places while naming each affected place; polling batches bounds to avoid multiplying traffic; schema and backup round trips pass; no cloud storage is introduced.
      Complexity: L

- [ ] AUD-078: Add an official, clearly separated ECCC extrapolation lane
      Why: ECCC publishes North American extrapolation layers on the same operational WMS already used for observed Canadian radar. This offers a bounded nowcast without shipping a local single-flow algorithm first.
      Evidence: `src/lib/providers/geomet.ts`; `src/hooks/useRadarTimeline.ts`; https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/ ; https://community.windy.com/topic/31383/how-to-turn-off-forecasted-radar/5 ; https://github.com/JoshuaKimsey/LibreWXR/issues/24
      Touches: GeoMet provider; timeline segmentation; provenance; legend and source copy; archive controls
      Acceptance: Extrapolated frames appear only where the official layer covers and occupy a distinct dotted timeline segment labeled with method, source, issue time, valid time, and horizon; the last observation remains separately selectable; observations are never blended or relabeled; stale extrapolation disappears before fresh observations do.
      Complexity: M

- [ ] AUD-079: Compare exact and previous Open-Meteo model runs
      Why: Current guidance compares current model output but does not expose the initialization behind each series or how the forecast changed from the previous run.
      Evidence: `src/lib/guidance.ts`; https://open-meteo.com/en/docs/single-runs-api ; https://open-meteo.com/en/docs/previous-runs-api
      Touches: Guidance request and model types; run picker; delta view; provenance; caching
      Acceptance: Supported models show initialization UTC, age, and exact-run status; a user can compare the same valid hours against one previous run; missing archives are explicit; requests remain bounded; tests cover mismatched horizons, missing runs, and UTC alignment.
      Complexity: L

- [ ] AUD-080: Evaluate RRFS and REFS only after operational launch is verified
      Why: NOAA schedules v1 for 2026-10-06. Replacing HRRR before the bucket and product inventory stabilize would turn a forecast enhancement into a release risk.
      Evidence: `src/lib/providers/hrrr.ts`; https://registry.opendata.aws/noaa-rrfs-ops/
      Touches: Experimental forecast adapter; provider provenance; product inventory fixtures; fallback policy
      Acceptance: Work begins only after the operational service notice is confirmed; public bucket filenames and required reflectivity products have fixtures; RRFS is labeled experimental until live contract checks are stable; HRRR remains available as a fallback; no prototype path is presented as operational.
      Complexity: L

- [ ] AUD-081: Add TDWR Level III coverage behind a radar capability descriptor
      Why: TDWR can improve low-level airport coverage, but its sites, range, and product details differ from WSR-88D. Hard-coded product strings would make those differences unsafe.
      Evidence: `src-tauri/src/level3.rs`; `src/lib/level2.ts`; https://www.weather.gov/tg/rpccds ; https://www.weather.gov/gsp/tdwr_specs ; https://www.weather.gov/media/tg/rpccds_radar_products.pdf
      Touches: Site registry; Level III acquisition and decoding; radar capability metadata; selector; legends; coverage
      Acceptance: A curated TDWR site and product set is identified from official documentation; unsupported products cannot be selected; radar type, range, time, units, and source are visible; fixtures cover representative messages and unknown blocks; WSR-88D behavior is unchanged.
      Complexity: XL

- [ ] AUD-082: Validate a sustainable EUMETNET ORD path for European radar
      Why: ORD exposes European volumes and composites with useful archives, but anonymous users have low query limits and member licenses can differ.
      Evidence: `src/lib/providers/dwd.ts`; https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/
      Touches: Provider feasibility note; credentials strategy; license metadata; OPERA composite adapter; cache and traffic budget
      Acceptance: The item may close with a documented no-go if a desktop redistribution quota is unavailable; any shipped adapter embeds no secret, names product-level license and attribution, respects rate limits, distinguishes OPERA composite from national products, and has 24-hour cache and schema fixtures.
      Complexity: XL

- [ ] AUD-083: Add deterministic incident replay bundles
      Why: Workspace backups preserve settings, not the exact external bytes and source identities that produced a past analysis. A portable local bundle would make review reproducible after providers change.
      Evidence: `src/lib/workspace.ts`; `src/hooks/useRadarTimeline.ts`; `src/lib/providers/types.ts`; https://github.com/d4vid87/hookecho ; https://github.com/jhammon88219/Anvil
      Touches: Bundle schema; selected radar and overlay bytes; hashes; source manifest; import; storage budget; redaction
      Acceptance: A bounded time window exports selected data, source and valid-time metadata, settings, and hashes into one documented local bundle; import reproduces the same frames offline; missing optional layers stay explicit; personal coordinates and routes require an opt-in; corrupt or newer bundles fail without changing the workspace.
      Complexity: XL

- [ ] AUD-086: Split MapViewport lifecycle ownership behind tested adapters
      Why: `MapViewport.tsx` is 1,793 lines, owns most source and layer lifecycles, and contains 15 hook dependency suppressions. This makes source generation, cleanup, and layer ordering changes risky.
      Evidence: `src/components/MapViewport.tsx`; `src/lib/overlays/`; `git log -- src/components/MapViewport.tsx`
      Touches: Radar image adapter; native image adapter; vector overlay adapter; map generation owner; layer ordering tests
      Acceptance: The component becomes a coordinator instead of owning each layer implementation; adapter lifecycles have pure or MapLibre-mocked tests; final ordering still has one owner; dependency suppressions are removed or justified at the boundary; all existing headless scenarios pass with no visual change.
      Complexity: XL

- [ ] AUD-088: Remove or recapture the stale pre-current screenshot
      Why: `assets/screenshots/openradar-main.png` shows the removed Videos control, lacks Commands, and is not the current README image. A stale visual asset can be reused by mistake.
      Evidence: `assets/screenshots/openradar-main.png`; `README.md`; current interface under `src/components/CommandBar.tsx`
      Touches: Screenshot assets; README reference if needed
      Acceptance: The stale file is removed if unused, or replaced from the current isolated build at the documented viewport and DPI; `rg` finds no references to removed controls; every retained screenshot has a clear use.
      Complexity: S

- [ ] AUD-089: Give toast and preset camera timers explicit ownership
      Why: Toast dismissal timers are not recorded or cleared, and delayed preset camera movement has no cancellation or generation check. Unmounted or superseded work can still fire later.
      Evidence: `src/hooks/useToasts.ts`; `src/hooks/useWorkspaceActions.ts`
      Touches: Timer refs; hook cleanup; preset generation ownership; focused tests
      Acceptance: Every created timeout has one owner and cleanup path; replacing or unmounting a toast cannot invoke its stale dismissal; opening two presets quickly leaves the newest camera active; fake-timer tests prove both cases.
      Complexity: S

- [ ] AUD-091: Add a privacy-reviewed field report path
      Why: The tracker contains no field reports, while native flows and provider behavior vary by machine and time. Copy Diagnostics exists, but there is no structured report template or redaction contract.
      Evidence: `src/panels/DiagnosticsPanel.tsx`; `src/lib/diagnostics.ts`; https://github.com/SysAdminDoc/OpenRadar/issues
      Touches: Diagnostics redaction; bug report template; README support instructions
      Acceptance: A user can copy a bounded report with app version, platform, provider health, cache state, and recent categorized errors; watched coordinates, routes, usernames, and full local paths are excluded unless explicitly added; a repository template asks for reproduction and report text; redaction tests use representative Windows paths and locations.
      Complexity: S

- [ ] AUD-092: Stabilize the NEXRAD crate boundary
      Why: `nexrad-data`, `nexrad-decode`, and `nexrad-model` are release candidates. Decoder behavior should not depend on floating pre-release assumptions without a compatibility plan.
      Evidence: `src-tauri/Cargo.toml`; `src-tauri/Cargo.lock`; Level II fixtures in `src-tauri/src/level2.rs`
      Touches: NEXRAD dependencies; fixture corpus; compatibility notes; decoder error mapping
      Acceptance: Move to stable compatible releases when available, or pin exact pre-release versions with upstream references and a review date; a curated fixture corpus covers supported message families, malformed inputs, and unknown types; dependency updates cannot change decoded geometry or units without an intentional golden update.
      Complexity: L

## P3

- [ ] AUD-084: Export scientific radar data with provenance
      Why: PNG, GIF, and WebM communicate a picture but do not support GIS or scientific reuse. NOAA's Weather and Climate Toolkit validates value-preserving exports.
      Evidence: `src/hooks/useExport.ts`; `src-tauri/src/level2.rs`; `src-tauri/src/mrms.rs`; https://www.ncei.noaa.gov/products/weather-climate-toolkit
      Touches: Native Level II and grid export; CSV, GeoTIFF, or NetCDF format selection; file dialogs; provenance sidecar; limits
      Acceptance: At least one polar product and one gridded product export raw values, coordinates, units, missing-value rules, source, observed time, and derivation without using screen colors; output opens in an independent standard tool; large exports stream or remain bounded; golden fixtures verify values and metadata.
      Complexity: L

- [ ] AUD-085: Add a focused NWPS stream and flood context layer
      Why: Official stream forecasts and flood information can explain a hazard that radar alone cannot, especially for tropical and heavy-rain events. It should arrive as a focused incident layer, not a general hydrology workstation.
      Evidence: `src/lib/overlays/`; `src/lib/surge.ts`; https://water.noaa.gov/about/api
      Touches: NWPS adapter; station selection; map symbols; detail panel; provenance and stale state; traffic budget
      Acceptance: The layer shows only relevant nearby flood or forecast points at a bounded zoom, names observation and forecast times, distinguishes measured from forecast values, exposes the official source link, respects API caching guidance, and fails with a visible layer note; parser fixtures cover missing and changed fields.
      Complexity: L
