# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority.

## P1

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

- [ ] AUD-106: P1. Carry high contrast into the grids, the hazard geometry, and the legends
      Why: This is the rest of `AUD-076`, which was decomposed on 2026-08-31 once the size of it was clear. The half that shipped is the measurement and the single-site radar: `src-tauri/src/contrast.rs` simulates a ramp under three kinds of colour blindness and measures how far apart it stays, and the Level II reflectivity and velocity ramps now have high-contrast versions held to it. Nothing else moved. The nine MRMS grids still draw on their ordinary ramps, warning outlines and storm tracks keep their normal widths, the legends do not follow, and an imported colour table is still silently drawn as it is.
      Evidence: `src-tauri/src/mrms.rs` (nine ramps); `src/lib/overlays/alerts.ts` line-width and fill expressions; `src/lib/cells.ts`; `src/lib/legend.ts`; `src/lib/mosaicLegend.ts`; `src/index.css` `prefers-contrast: more`; `e2e/accessibility.spec.ts`; `src-tauri/src/contrast.rs`
      Touches: MRMS ramp selection and the tile address that would have to carry it; alert and track geometry; legend rendering; a warning where a loaded palette is drawn unaltered; accessibility scenarios
      Acceptance: Every MRMS ramp passes the same neighbour-separation check the Level II ramps do, under all three colour-vision simulations; the tile address carries the contrast choice so a cached tile drawn one way is never served for the other; warning outlines and storm tracks are drawn heavier under high contrast while severity and threat keep their text labels; legends redraw from whichever ramp is in force; a reader whose imported colour table is being drawn as supplied is told so rather than having it altered; the accessibility scenarios cover dark, light, and high contrast over real map content.
      Complexity: L

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
      Note (2026-08-31): SCN 26-48 AAB (2026-07-06) reconfirms 2026-10-06 with the standard critical-weather-day slip clause; parallel feeds moved to NOMADS on 2026-08-11 and the old prototype AWS bucket stopped updating then, so do not fixture against the prototype paths.
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
      Note (2026-08-31): Upstream is active (pushed 2026-07-21, zero open issues) and holds an unreleased fix: `decode_angle` in the VCP decoder misreads negative elevations as roughly 360 degrees (danielway/nexrad issue 144, fixed on main 2026-07-21). OpenRadar is unaffected today because cut matching uses median radial angles (`src-tauri/src/level2.rs`), but pick up the fix when it ships and add a negative-elevation fixture.
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

## Character and personalization

These came out of a different question than the audit did: what makes somebody keep a weather app open on a second monitor for a year rather than opening it twice during a storm and forgetting it. None of it outranks a correctness, security, or release item, which is why it sits after P3 instead of being folded into the priority ladder.

Every item below obeys the same rules, and one that cannot obey them is not worth building.

- Data is never decoration. A theme, an effect, or a mode may restyle the interface around the map. It may not change a reflectivity ramp, a warning outline, a probability figure, or a timestamp. Anything that does change how hazard information reads has to say so where the reader turns it on.
- Nothing new leaves the machine. No account, no sync, no usage reporting, and no new host in the native allowlist unless the item names it and the ledger carries it.
- Everything is reversible in one action, and the workspace opens plain for a reader who wants it plain.
- `prefers-reduced-motion` removes the motion, not the feature.
- Nothing applies pressure. No streaks to break, no badges to chase, and no notification that is about the app rather than about the weather.
- Playful surfaces stand down during danger. While a warning is active at a watched place, themes stay quiet, effects stop, and nothing discoverable reveals itself; the map is a serious instrument for as long as the warning stands. (Added 2026-08-31; the safety precedent and the backlash record are in `RESEARCH.md`.)

- [ ] JOY-001: Separate interface styling from data styling and make the interface themeable
      Why: The workspace has exactly two looks, written as two blocks of custom properties in one stylesheet, and every accent in the app reads from them. There is no way to give the window any character without risking the colours that carry meaning. The boundary between chrome colour and data colour half exists already, since ramps and hazard styling live in their own modules, but nothing holds it, so any theming work done without this first is one careless commit away from restyling a warning polygon.
      Evidence: `src/index.css`; `src/lib/settings.ts`; `src/lib/legend.ts`; `src/lib/mosaicLegend.ts`; `src/lib/mapStyles.ts`; `src-tauri/src/palette.rs`
      Touches: The token contract; a theme record in settings and its migration; a small theme file format; the settings surface; a contract test; the accessibility scenarios
      Acceptance: A named theme can set surface, border, accent, shadow, and heading weight through tokens and nothing else; an enumerated test fails if a data colour becomes reachable from a theme; a theme loaded from a file is re-parsed from its own text rather than trusted as an object, the way a colour table already is; dark and light remain the built-ins and remain the default; `e2e/accessibility.spec.ts` passes for every shipped theme; a personal accent colour is one of the things a theme can carry, so somebody can have the app in their own colour without writing a file.
      Complexity: L

- [ ] JOY-002: Ship seasonal and occasion theme packs that arrive on their own
      Why: An app that looks slightly different in late October than it does in March is an app people notice they live with. This is cheap to do and easy to do badly, so the constraints matter more than the packs: it is chrome only, it is a local date calculation, and it can be told to go away for good.
      Evidence: `src/hooks/useClock.ts`; `src/lib/settings.ts`; `src/i18n/en.ts`; JOY-001
      Touches: Theme pack definitions; a local occasion calendar; the one-line notice and its dismissal; settings and migration; fixed-clock tests
      Acceptance: Occasion windows are computed from the local clock with no network call and no bundled calendar service; each occasion can be declined once for that year or switched off for good, and the master switch returns the plain workspace immediately; nothing about hazard rendering, ramps, or legends changes in any pack; the notice is one line that is dismissed rather than a dialog; fixed-clock tests cover the first and last day of each window, a machine crossing midnight, a machine in a different time zone from its data, and 29 February.
      Complexity: M

- [ ] JOY-003: Add ambient weather effects to the chrome, driven by real conditions
      Why: Rain running down the edge of a panel while it is actually raining where you are watching is the sort of small thing people show other people. The catch is that it must be driven by observed conditions rather than invented, must never sit over the map, and must cost almost nothing, because a decorative animation that drops the radar loop below its frame budget is a bug wearing a costume.
      Evidence: `src/components/MapChrome.tsx`; `src/components/WorkspaceChrome.tsx`; `src/lib/weather.ts`; `src/hooks/useLightning.ts`; `src/index.css`
      Touches: A chrome effect layer outside the map canvas; the condition source and its staleness rule; a frame and CPU budget; the reduced-motion path; settings
      Acceptance: Effects are chosen from an observed condition with a named source and an age, and stop when that observation goes stale rather than continuing on the last thing they knew; nothing draws over the map canvas or over any legend, readout, or alert surface; a measured budget caps the cost and the effect drops itself if the radar loop misses frames; reduced motion leaves a still treatment or nothing at all; the feature is off until asked for, and one switch removes it everywhere.
      Complexity: M

- [ ] JOY-004: Give the single-site sweep optional phosphor persistence
      Why: A radar disc that shows where the beam is now, with the previous sweep fading behind it, is the picture everybody has in their head when they think of radar, and this app is one of the few that actually has the beam position to draw it honestly. The live volume path already composites a partial sweep over a finished one, so the geometry is in hand. It stays optional and it stays labelled, because a decayed picture is older than an undecayed one and the reader has to be able to tell.
      Evidence: `src-tauri/src/level2.rs`; `src-tauri/src/chunks.rs`; `src/hooks/useSingleSiteRadar.ts`; `src/components/MapViewport.tsx`
      Touches: Sweep compositing; a decay parameter and its bounds; the legend and its age text; settings; the fixture tests
      Acceptance: With persistence on, gate values are unchanged and only the drawn opacity decays with the age of the cut that produced it; the legend states the age of the oldest visible sweep, not just the newest; the picture is identical to today's when persistence is off, proved against the synthetic volume; reduced motion keeps the composite and drops the animated leading edge; a reader inspecting a gate gets the value and the time of the sweep it came from.
      Complexity: L

- [ ] JOY-005: Replace the welcome toast with a first-run reveal and one honest opening line
      Why: The current onboarding is a single toast pointing at the commands, and a first launch is otherwise a map with nothing to say. Two small things fix that. The radar disc drawing itself once, on the very first run, is a signature people remember. A one-line summary of what the weather is actually doing near the opening view is more useful than a hint and is the reason to open the app on a calm day.
      Evidence: `src/hooks/useWelcomeHint.ts`; `src/components/ToastHost.tsx`; `src/lib/weather.ts`; `src/lib/settings.ts`
      Touches: The first-run animation and its skip; the opening summary and its data source; the seen flag and its migration; translations
      Acceptance: The reveal plays once, can be skipped by any interaction, never delays the map becoming usable, and does not play at all under reduced motion; the opening line names a real observation with a source and a time and says plainly when it has nothing to report; it never invents a hazard or softens one; both strings live in the catalogue and pass the pseudolocale clipping test; a reader who has seen it once never sees it again, and a reader who wants it back can ask.
      Complexity: M

- [ ] JOY-006: Let a reader name their home place and their radar
      Why: Every attachment this app can earn starts here. Right now the watched place is a coordinate pair with a radius, and the single-site radar is whichever station the view happens to be over. Somebody who can call a place Home and a station Ours, see the call sign on the legend, and get back to both in one action has a workspace rather than a viewer.
      Evidence: `src/lib/watch.ts`; `src/hooks/useAlertWatch.ts`; `src/hooks/useSingleSiteRadar.ts`; `src/lib/settings.ts`; `src/panels/MapOptionsPanels.tsx`; AUD-077
      Touches: Named place and station records; the home action; the legend and station badge; search and command entries; settings migration; workspace backup
      Acceptance: A place carries a name the reader chose and that name appears in the watch surface, in alert text, and in the journal; a held station shows its call sign, its distance from home, and whether it is currently publishing; one action returns the camera home from anywhere including the globe; names round-trip through workspace backup; nothing about naming changes what is polled or how often.
      Complexity: M

- [ ] JOY-007: Keep a bounded local log of observations and events at the reader's places
      Why: Almost everything below wants a memory the app does not have. There is a disk cache for tiles and frames, which is about not refetching, and there is nothing that records that it hailed here on the fourteenth. This is the foundation item for the journal, the recap, and any local climate context, and it needs designing once, carefully, because it is a file of somebody's whereabouts.
      Evidence: `src-tauri/src/cache.rs`; `src/lib/settings.ts`; `src/hooks/useAlertWatch.ts`; `src/lib/workspaceBackup.ts`; JOY-006
      Touches: A local log store and its schema; a retention and size budget; write points in the alert and observation paths; export and deletion; documentation of what is written
      Acceptance: The log records observation and event rows for named places only, each with source, observed time, and how it was obtained, and it never records anything about how the app was used; a stated retention period and a hard size ceiling both hold, with the oldest going first; the reader can see the whole file in plain form, export it, and delete all of it in one action; it never leaves the machine and never enters diagnostics output; corrupt or partial files are refused without losing the good rows; a documented note says exactly what is stored, because this is the one feature here that writes down where somebody lives.
      Complexity: L

- [ ] JOY-008: Add a storm journal that writes its own first draft
      Why: This is the item that earns a year of use. When a warning reaches a named place, when a cell passes within a few miles, or when the reader exports a picture, the app can open an entry with the time, the place, the hazard, and a thumbnail of the frame that was on screen, and leave room for a sentence in the reader's own words. Over a couple of seasons that becomes a personal weather history nothing else has, and it is the thing somebody would refuse to switch away from.
      Evidence: `src/hooks/useAlertWatch.ts`; `src/hooks/useExport.ts`; `src/lib/export.ts`; `src/hooks/useStormCells.ts`; JOY-007; AUD-083
      Touches: Journal entries and their storage; automatic draft triggers; a thumbnail budget; a journal surface with search by place, date, and hazard; export and deletion; workspace backup
      Acceptance: An entry is created automatically for a defined and documented set of events, is always editable and deletable, and is never created for anything the reader did rather than anything the weather did; each entry keeps the source and observed time of what it depicts, so a picture in the journal can still be dated years later; thumbnails obey a byte budget with the whole journal bounded; the journal exports as readable files rather than as an opaque blob; nothing about it is notified, counted, or scored.
      Complexity: XL

- [ ] JOY-009: Add an offline almanac card for the day
      Why: The best track archive back to 1851 is already bundled, sitting in the repository doing nothing on a calm afternoon. A card that says what happened on this date, with a way to fly the map to it and replay the radar where the archive reaches, gives somebody a reason to open the app on the three hundred days a year when the weather is boring. It costs one bundled data file and no network at all.
      Evidence: `src/lib/hurdat.ts`; `public/hurdat/`; `src/panels/HistoryPanel.tsx`; `scripts/build-hurdat.mjs`; https://www.nhc.noaa.gov/data/hurdat/ ; https://registry.opendata.aws/noaa-nexrad/
      Touches: A date index over the bundled track record; a small curated events file with sources; the card and its dismissal; the fly-to and replay handoff; the data rebuild script and its documentation
      Acceptance: The card is built entirely from bundled data and works with networking off; every entry names its source and its date and distinguishes a track record from a curated note; a curated entry carries a citation and no editorialising about casualties; the fly-to sets the camera and the date without disturbing live layers, and offers replay only where the archive actually covers it; the card can be switched off and it never appears while a warning is active for a watched place.
      Complexity: L

- [ ] JOY-010: Say what was missed since the last time the app was open
      Why: Opening a weather app after four days away and getting a live map is a small missed opportunity. The log knows what happened at the named places while nobody was looking, and a short, dismissible summary of it is the most natural reason to come back.
      Evidence: JOY-007; JOY-006; `src/hooks/useAlertWatch.ts`; `src/components/ToastHost.tsx`
      Touches: A last-seen marker; the catch-up summary and its bounds; the surface it appears on; settings
      Acceptance: The summary covers only named places, only since the recorded last close, and only events that were logged rather than events reconstructed from a fresh query; it is capped in length with the rest reachable in the journal; it never shows an expired warning as though it were live and every line carries its own time; one dismissal removes it for that session and one setting removes it for good; an absence of anything to report says so in one line rather than showing an empty panel.
      Complexity: M

- [ ] JOY-011: Build a local year in weather from what the app already recorded
      Why: A recap of the year at your own places, assembled on your machine from your own log, is the strongest loyalty feature in this list and the one most likely to be shared as a picture. It is also the one that would be most obviously wrong to build on top of collected data, which is exactly why it should be built here, where the log never leaves the machine.
      Evidence: JOY-007; JOY-008; `src/hooks/useExport.ts`; `src/lib/export.ts`
      Touches: Recap aggregation over the log; the recap surface; a composed image export; coverage and honesty rules; translations
      Acceptance: Every figure in the recap is derived only from the local log and states the period and the number of days actually covered, so a partial year cannot read as a full one; missing coverage is shown as missing rather than as zero; the exported picture carries the period, the place name only if the reader includes it, and the data credits; nothing is compared against other users, ranked, or scored; the recap is available on any date rather than only in December, because somebody who installed the app in March should not wait.
      Complexity: L

- [ ] JOY-012: Show honest usage and coverage figures without turning them into a game
      Why: People do like knowing they have tracked ninety storms and watched two hundred hours of radar. They do not like being nudged about a streak, and a weather app that manufactures engagement pressure around severe weather would be genuinely distasteful. The figures belong in the journal as facts, with no reward layer on top.
      Evidence: JOY-007; JOY-008; JOY-011
      Touches: Journal statistics; the presentation; an explicit exclusion list
      Acceptance: Figures are shown only where the reader has gone to look for them and are never notified, badged, or celebrated; there is no streak, no level, no comparison against a previous period framed as a target, and no prompt to return; every figure names the period it covers and the log it came from; turning the log off leaves the figures unavailable rather than estimated.
      Complexity: S

- [ ] JOY-013: Let a reader name a storm cell and keep the name as it moves
      Why: The tracking algorithm already decides which blobs are one storm across frames, and it labels them with identifiers that mean nothing to a person. Somebody watching a supercell for two hours will call it something. Letting the app carry that name across the loop, into the journal, and into an export is a very small change with a disproportionate hold on the person doing the watching.
      Evidence: `src/lib/cells.ts`; `src/hooks/useStormCells.ts`; `src/components/MapViewport.tsx`; JOY-008
      Touches: A name attached to a tracked cell identity; label rendering and collision; the journal handoff; expiry when the track ends
      Acceptance: A name follows the cell the algorithm says is the same storm and disappears when that track ends rather than jumping to a different cell; the algorithm's own identifier stays visible somewhere, because the name is the reader's and the identity is the data's; names never overlap warning text or obscure a polygon; a named cell can be carried into a journal entry; names are local, bounded in number and length, and cleared with the session unless saved deliberately.
      Complexity: M

- [ ] JOY-014: Answer a storm name in search with its track
      Why: Typing Katrina into the place search currently asks a geocoder about a town. The best track record is bundled and covers every Atlantic and eastern Pacific cyclone since 1851, so the app can answer with the storm instead, draw the track, and offer the archive replay where it reaches. It reads like an easter egg and it is actually the fastest path to a feature the app already has.
      Evidence: `src/panels/SearchPanel.tsx`; `src/lib/hurdat.ts`; `src/panels/HistoryPanel.tsx`; `public/hurdat/`
      Touches: Search result types; storm name matching and disambiguation; the handoff to history and replay; result copy and its translations
      Acceptance: A name that matches one or more storms returns them alongside place results, clearly distinguished, with year, basin, and peak intensity, and reused names return every storm that carried it; matching happens against the bundled index with no network; choosing a storm draws its track and offers replay only for the years the archive covers; a name that is also a place still returns the place; no result implies a storm is current.
      Complexity: M

- [ ] JOY-015: Replace the single tone with a small sound kit
      Why: There is one synthesised note today, at one pitch, for every alert that reaches the watched place. A tornado warning and a special weather statement should not sound identical. A short set of tones by severity, still synthesised so nothing has to ship or be fetched, plus the option to point at your own audio file, is the difference between a sound somebody keeps on and a sound somebody switches off in the first week.
      Evidence: `src/lib/sound.ts`; `src/hooks/useAlertWatch.ts`; `src/lib/settings.ts`; AUD-075; 47 CFR 11.45
      Touches: Tone definitions by severity; volume and preview; optional local audio files and their validation; quiet hours; settings and migration
      Acceptance: Each severity has a distinguishable tone that a reader can hear before committing to it; a supplied audio file is size-capped, format-checked, refused rather than half-played when unreadable, and referenced by path so backups do not swallow it; the app never synthesises or plays anything resembling the Emergency Alert System attention signal or a SAME data burst, and a test holds that boundary along with a note saying why; everything stays off until asked for; quiet hours and the emergency override from AUD-075 apply to every sound here; a machine with no audio degrades to the notification alone without an error.
      Note (2026-08-31): The boundary is verified law, not caution: 47 CFR 11.45 prohibits transmitting the EAS attention signal or simulations, with a $1M consent decree on record for tones that tripped downstream receivers. Extend the tested ban to the WEA cadence (47 CFR 10.520(d)) and the NOAA Weather Radio 1050 Hz tone, and apply it to user-supplied files presented as defaults.
      Complexity: M

- [ ] JOY-016: Add a calm presentation for readers who find severe weather distressing
      Why: A significant number of people follow weather closely because it frightens them, and this app is currently tuned for the person who wants more detail rather than less. A calm mode that keeps every fact and removes the pressure, with muted hazard styling, no motion, no probability figures pushed at the reader, and plainer language, is a thoughtful thing to ship and costs very little once JOY-001 exists.
      Evidence: `src/index.css`; `src/lib/alertTypes.ts`; `src/hooks/useProbSevere.ts`; `src/panels/AlertsPanel.tsx`; `src/i18n/en.ts`; JOY-001
      Touches: The mode and its token set; hazard styling under the mode; which layers default off; alert copy variants; settings; accessibility scenarios
      Acceptance: The mode never hides or downgrades an active warning and never delays one, and the mode says so where it is turned on; muting applies to styling and to speculative guidance, not to the warning itself; probability and threat figures remain reachable rather than removed; alert copy in the mode states what to do rather than how bad it could get, and is written by hand in both languages instead of generated; every existing accessibility scenario passes in the mode; leaving the mode restores everything with no residue.
      Complexity: M

- [ ] JOY-017: Add an ambient mode for a second screen
      Why: The most loyal thing a desktop app can achieve is a permanent place on somebody's second monitor. That needs a view with no chrome, a legible clock, the current conditions, and a loop that keeps running, plus a slowly rotating globe for the times when nothing is happening anywhere near you.
      Evidence: `src/App.tsx`; `src/components/MapStage.tsx`; `src/hooks/useRadarTimeline.ts`; `src/hooks/useClock.ts`; `src/lib/providers/budget.ts`
      Touches: A chrome-free presentation; idle detection and entry; the clock and condition readout; the globe idle motion; provider budget under long unattended playback; exit
      Acceptance: The mode fills the window with the map, keeps time, place, source, and frame age visible, and leaves the workspace exactly as it was on exit; unattended playback respects the request budget and slows rather than hammering a provider overnight; a warning reaching a watched place interrupts the mode visibly; reduced motion stops the globe rotation and keeps the loop; the mode can be entered deliberately and, if idle entry is offered, only after a configured delay that defaults to off.
      Note (2026-08-31): Build it as in-app fullscreen, never a `.scr` (legacy format, fragile WebView2 bootstrap, no verified demand). Long-run display care goes in from the start: app-level pixel drift every few minutes, scheduled auto-dim, no pure-white static text, a frame-rate cap gated on radar cadence, and a docs note that mostly-static ambient displays belong on LCD rather than OLED. The nostalgia demand is real (WeatherStar 4000+ fork culture; The Weather Channel shipped an official emulator as its 2026-04-01 stunt).
      Complexity: L

- [ ] JOY-018: Add a tray presence and a glance window
      Why: A radar app that has to be brought to the front to answer whether it is about to rain is a radar app that gets closed. The Tauri tray API is available and the window state plugin is already a dependency, so a small always-on-top window showing the home place, and a tray icon that carries the current hazard state, are both reachable without new infrastructure.
      Evidence: `src-tauri/src/lib.rs`; `src-tauri/Cargo.toml`; `src/hooks/useAlertWatch.ts`; JOY-006
      Touches: Tray icon and its menu; icon state driven by the watch; a small secondary window; single-instance interaction; close and minimise behaviour; settings
      Acceptance: Closing the window does what the reader chose, defaulting to actually closing, because an app that silently keeps running after a close is an app people uninstall; the tray icon reflects the current hazard state at named places and nothing else; the glance window is small, always-on-top only when asked, resizable, and shows source and frame age like every other surface; the single-instance path still reuses the existing window; the whole feature can be switched off and leaves no tray icon behind.
      Note (2026-08-31): Platform verdict is green with three named pitfalls: drop the tray icon explicitly on exit or Windows leaves a ghost until mouse-over; create the tray one way only (config or code, never both); and test always-on-top in the packaged build, which has a report of differing from dev. The glance window must consume pre-rendered frames, never a second live MapLibre map, whose renderer alone can run hundreds of megabytes.
      Complexity: L

- [ ] JOY-019: Write the current view to the desktop wallpaper on a schedule
      Why: This is the quiet showpiece. A composed radar picture of your own area, refreshed on the desktop every fifteen minutes, is something people notice and talk about, and it needs no new data path at all because the still export already exists.
      Evidence: `src/hooks/useExport.ts`; `src/lib/export.ts`; `src-tauri/src/exports.rs`; `src-tauri/src/lib.rs`
      Touches: A native wallpaper write on Windows; the schedule and its bounds; the composed frame including time, place, and credits; the previous wallpaper; failure reporting; settings
      Acceptance: The reader's previous wallpaper is recorded before the first write and restored when the feature is switched off; the schedule has a floor that keeps provider requests inside the budget, and it stops while the machine is offline rather than writing an empty map; every written picture carries its time, its source credits, and its own age; a failed write reaches a toast and the log instead of failing silently; the feature is Windows-only for now and says so; nothing is written anywhere except the configured wallpaper path.
      Note (2026-08-31): Use the `IDesktopWallpaper` COM interface from the `windows` crate (per-monitor, no elevation); `SystemParametersInfoW` is the single-monitor fallback. The cautionary tale is Microsoft's own Bing Wallpaper app, panned in November 2024 for bundling everything but wallpaper: this feature does one thing, opt-in, and restores what it found.
      Complexity: L

- [ ] JOY-020: Compose a shareable postcard rather than a bare screenshot
      Why: The export produces an accurate picture with credits burned in, which is right for evidence and slightly plain for the thing somebody wants to send a relative. A composed card with the place, the time, an optional line the reader writes, and sensible dimensions for sharing costs little and is how the app travels to people who have not heard of it.
      Evidence: `src/hooks/useExport.ts`; `src/panels/ExportPanel.tsx`; `src/lib/export.ts`; JOY-008
      Touches: Card layout and sizes; the caption field; attribution placement; the existing export path; translations
      Acceptance: The card carries observed time, source credits, and the app name in every variant, and the caption cannot displace any of them; the reader's location is included only when they choose to include it; the picture is never presented as an official product and carries the same not-a-warning-source position the app takes; sizes are documented and the layout holds at each of them in both languages; the plain export stays exactly as it is, because evidence and a postcard are different jobs.
      Complexity: M

The three worth starting with are JOY-007 and JOY-008 together, since the journal is what a year of use turns into, JOY-006, because naming a place is what makes the rest of it personal, and JOY-001, because every visual item here is unsafe to attempt before the token boundary is held by a test.

## Research-Driven Additions

Added 2026-08-31 from the second research pass of that day (see `RESEARCH.md`). IDs continue the existing schemes. Ordered by priority.

- [ ] AUD-094: P2. Grow the single colour table into a palette library
      Why: The switching cost in this market is accumulated customization. A community of shared GRLevelX tables is active in 2026 (about 150 tables on the main hub, uploads this year), a competitor bug about tables failing to persist shows persistence is a felt stake, and OpenRadar currently holds exactly one palette at a time in settings.
      Evidence: https://grlevelxusers.com/grlevelx-goodies/categories/color-tables/ ; https://github.com/dpaulat/supercell-wx/issues/639 ; https://stormtrack.org/threads/open-source-weather-radar-software-supercell-wx.32393/page-2 ; `src/lib/settings.ts`; `src/lib/palette.ts`; `src-tauri/src/palette.rs`
      Touches: Settings schema and migration; palette storage and naming; per-product assignment; the radar product panel; generation invalidation; workspace backup
      Acceptance: Several named palettes import, persist across restart, and round-trip through workspace backup; each supported product can hold its own assignment; the legend rebuilds per assignment; every stored palette is still re-parsed from its own text on load; removing a palette in use falls back to the built-in ramp with a visible note rather than a blank layer.
      Complexity: L

- [ ] AUD-095: P2. Make local overlays a managed set rather than one switch
      Why: Users of the closest competitor ask for placefile renaming, quick toggles, and per-file icon scaling, and OpenRadar's imported shapes currently live behind a single custom-overlay switch. Local files only; remote placefile fetching stays blocked per `Roadmap_Blocked.md`.
      Evidence: https://github.com/dpaulat/supercell-wx/issues/614 ; https://placefiles.supercellwx.net/ ; `src/lib/placefile.ts`; `src/lib/workspaceBackup.ts`; `src/hooks/useWorkspaceOverlays.ts`
      Touches: Workspace schema and migration; the upload surface; per-file records with names and switches; overlay order integration; re-import
      Acceptance: A bounded number of imported placefiles and GeoJSON files coexist, each with its own name, switch, opacity, and place in the drawing order; re-importing a file replaces its previous shapes rather than duplicating them; backups carry the set; warnings still cannot be drawn under any imported shape.
      Complexity: M

- [ ] AUD-096: P2. Add a capture-friendly streamer surface
      Why: Weather streamers composite radar into OBS today through bolt-on dashboard projects and hand-built overlay kits, no radar application ships a capture mode, and a search of the leading competitor's tracker finds nobody has even asked it for one. Zero-competition surface with proven external demand.
      Evidence: https://github.com/AtmosphericX/AtmosphericX ; https://obsproject.com/forum/threads/weather-alert-notification-in-stream.155531/ ; https://github.com/dutchdronesquad/rh-stream-overlays ; `src/components/WorkspaceChrome.tsx`; `src/lib/commands.ts`
      Touches: A capture layout mode; chrome visibility choices; a high-legibility alert and place readout; credits placement; documentation
      Acceptance: One command switches to a layout built for capture at 1080p and 1440p: chrome the streamer did not ask for is gone, the pieces they did ask for (clock, place, alert banner, credits) are large enough to read in a compressed stream, and source credits remain visible; the mode is plain window content with no keyboard shortcut, no separate window type, and no change to data rendering; leaving the mode restores the previous layout exactly.
      Complexity: M

- [ ] AUD-097: P2. Move WebM export off the real-time recorder
      Why: Loop export currently drives the live timeline and records it through MediaRecorder, so exporting a loop costs its full wall-clock duration and occupies the workspace while it runs. WebCodecs VideoEncoder is present in every evergreen WebView2 and encodes as fast as frames can be produced.
      Evidence: `src/lib/export.ts`; `src/hooks/useExport.ts`; https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API ; https://blogs.windows.com/msedgedev/2026/08/24/webview2-is-moving-to-a-2-week-release-cadence/
      Touches: Frame production for export; a VideoEncoder path with VP9 then VP8 fallback chosen through isConfigSupported; a WebM muxer in a worker; the GIF path unchanged except frame sourcing; the browser-preview fallback
      Acceptance: A loop export completes faster than its playback duration on the reference machine and no longer needs to drive the visible timeline; output plays in standard players with correct timing and the burned-in credits; encoder absence or failure falls back to the current recorder path with a visible note; export tests cover both paths.
      Complexity: M

- [ ] AUD-098: P3. Offer to follow new warnings, off by default
      Why: A competitor request asks the map to fly to a warning as it is issued. As an opt-in behaviour with the camera returning control the moment the reader touches the map, it turns monitoring into something the app does with you rather than a thing you chase.
      Evidence: https://github.com/dpaulat/supercell-wx/issues/637 ; `src/hooks/useAlertWatch.ts`; `src/components/MapViewport.tsx`; `src/hooks/useClock.ts`
      Touches: An opt-in setting; camera handoff rules; interruption and reduced-motion behaviour; interaction with export and ambient states
      Acceptance: With the option on, a newly issued warning matching the reader's filters flies the camera once and says why; any user interaction cancels the follow instantly; it never fires during an export and respects reduced motion; with the option off nothing changes; alert copy for the flight lives in the catalogue in both languages.
      Complexity: S

- [ ] JOY-021: P3. Hide a small set of map curiosities worth finding
      Why: Collectible secret locations are a proven loyalty mechanic in exactly one weather app, which built a business partly on people hunting them. OpenRadar's version is truthful rather than fictional: a curated set of places where the weather made history, each telling its story when found, with the bundled track archive already able to draw many of them.
      Evidence: https://forums.macrumors.com/threads/carrot-weather-secret-locations.1862623/ ; https://developer.apple.com/news/?id=kf623ldf ; `src/lib/hurdat.ts`; `public/hurdat/`; JOY-009; JOY-014
      Touches: A curated locations file with citations; discovery detection from the camera; the reveal card; a found-so-far list in the journal; translations
      Acceptance: Each curiosity has a real, cited story and appears only when the reader explores to it; finding one is quiet (a card, never a toast or sound); the found list lives with the journal and carries no count toward anything; discovery detection costs nothing measurable during normal panning; the whole system honours the standing suppression rule during active warnings; the set ships with the app and works offline.
      Complexity: M

- [ ] AUD-101: P2. Make the radar record report cache state and freshness
      Why: The radar layer's record is built with `fetchedAt: Date.now()` and neither a cache age nor a freshness rule, so it always prints "cache live" and can never be stale. The timeline already knows better: `RadarTimelineState.cached` says the frames on screen are the last ones that arrived rather than fresh, which is the single most useful thing a report about a wrong-looking picture could carry.
      Evidence: `src/App.tsx` diagnostics wiring; `src/hooks/useRadarTimeline.ts` `cached`; `src/lib/tileCache.ts` `CacheReport`; `src/lib/provenance.ts` `provenanceStale`
      Touches: Threading the cache report and frame cadence into the radar record; diagnostics
      Acceptance: A frame served from disk reports its age rather than "cache live"; a loop older than its own cadence reports stale; a test drives both states through the diagnostics block.
      Complexity: M

- [ ] AUD-102: P2. Serialize the whole provenance record into an export
      Why: `AUD-068` asked exports to serialize the record. The caption reads three fields from it and burns a fixed credit line, so an archive replay of a 2005 hurricane still says "OpenRadar · OpenStreetMap · NOAA" rather than who actually served the frames, and nothing in the file carries the observed time, the source id, or the cache state.
      Evidence: `src/hooks/useExport.ts`; `src/lib/export.ts` `ExportCaption`; `src/lib/provenance.ts` `provenanceLines`; AUD-084
      Touches: Export caption and credit; a provenance sidecar or embedded metadata; export tests
      Acceptance: The credit line comes from the record rather than a constant; the full record travels with an exported file in a documented form; a replayed archive frame exports the archive's own attribution and observed time; tests cover a live frame, a forecast frame, and a replay.
      Complexity: M

- [ ] AUD-103: P2. Validate provenance records where they are produced
      Why: `provenanceProblems` is called only by its own tests. Nothing checks a record on the way into diagnostics or an export, so a malformed one reaches a bug report as confident nonsense rather than being caught.
      Evidence: `src/lib/provenance.ts` `provenanceProblems`, `provenanceValid`; `src/App.tsx`; `src/hooks/useExport.ts`
      Touches: The diagnostics layer list; the export path; a development-time warning route
      Acceptance: A record failing the contract is reported rather than drawn or written, is visible in development, and never throws out of the surface that was formatting it; a test proves a malformed record cannot silently reach a pasted report.
      Complexity: S

- [ ] AUD-104: P2. Cover the rest of the live providers with contracts
      Why: The gate added by `AUD-069` holds 12 contracts against roughly 25 live hosts. The uncovered ones include the highest-consequence layer in the app: NWS watches and warnings. Earthquakes, wildfires, tropical, satellite, and the RIDGE, nowCOAST, GeoMet, DWD, HRRR and RainViewer radar providers are all unasked, and the native `tiles::tests` ignored test matches no filter.
      Evidence: `scripts/live-contracts-lib.mjs` `LIVE_CONTRACTS`; `docs/asset-ledger.md` runtime host table; `src/lib/providers/`; `src/lib/overlays/`; `src-tauri/src/tiles.rs`
      Touches: New contracts and the live tests some of them need; the contract list; documentation
      Acceptance: Every host in the ledger's runtime table is reachable by at least one contract, or is listed with a written reason it is not; alerts are a required contract; a test compares the contract hosts against the ledger and fails when a host has no contract and no exemption.
      Complexity: M
