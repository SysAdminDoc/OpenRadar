# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority. `AUD-206` through `AUD-232` were added by the 2026-09-03 research pass in their own section at the end.

## P1

## P2


## P3

## Character and personalization

These came out of a different question than the audit did: what makes somebody keep a weather app open on a second monitor for a year rather than opening it twice during a storm and forgetting it. None of it outranks a correctness, security, or release item, which is why it sits after P3 instead of being folded into the priority ladder.

Every item below obeys the same rules, and one that cannot obey them is not worth building.

- Data is never decoration. A theme, an effect, or a mode may restyle the interface around the map. It may not change a reflectivity ramp, a warning outline, a probability figure, or a timestamp. Anything that does change how hazard information reads has to say so where the reader turns it on.
- Nothing new leaves the machine. No account, no sync, no usage reporting, and no new host in the native allowlist unless the item names it and the ledger carries it.
- Everything is reversible in one action, and the workspace opens plain for a reader who wants it plain.
- `prefers-reduced-motion` removes the motion, not the feature.
- Nothing applies pressure. No streaks to break, no badges to chase, and no notification that is about the app rather than about the weather.
- Playful surfaces stand down during danger. While a warning is active at a watched place, themes stay quiet, effects stop, and nothing discoverable reveals itself; the map is a serious instrument for as long as the warning stands. (Added 2026-08-31; the safety precedent and the backlash record are in `RESEARCH.md`.)

## Audit Findings, 2026-09-02

Read-only audit of `d608d27` (v0.7.0). Baseline at that commit, all green: `npm run check` 146 files / 1282 passed / 19 skipped, lint clean, every bundle inside budget; `npx playwright test` 424 passed across chromium, compact and wide; `cargo test` 353 passed / 26 ignored; `npm run release` staged a signed `OpenRadar_0.7.0_x64-setup.exe`. GitHub issues are enabled but the tracker holds zero issues (open or closed) and zero pull requests, so there was nothing to take in from reporters. Every P1 below survived a fresh-context refutation pass. Items are numbered on from `AUD-126`.

Two things to know before draining. First, most of what follows lives where the e2e suite cannot see: inside the packaged Tauri window (the ACL, the opener plugin, the asset protocol) and in the light theme with a panel open. Second, the browser probe that found the light-theme items is not in the repo; the acceptance lines say what to assert instead.

### P1

### P2

### P3

### Unaudited, needs a pass

These could not be observed in this pass, which ran headless browser automation and read the packaged binary's configuration but did not drive the installed app on a screen. Each is a place where the e2e suite also cannot see.

- [ ] AUD-166: Long-session memory and the two-day-old cached view
      Category: perf
      Where: `src/hooks/useRadarTimeline.ts`, `src-tauri/src/cache.rs`, the map's tile sources
      Problem: The product is meant to be left open on a second monitor for days. Nothing in this pass ran longer than a few minutes; whether the webview's memory stays flat over a day of loops, palette changes and panel opens is unmeasured.
      Evidence: No soak test exists in `e2e/` or `scripts/`. (2026-09-03: a 17-point Hacker News thread on the Windows 11 Weather app using 1.2 GB of RAM, https://news.ycombinator.com/item?id=49290078, says a native app should fit in 100 MB; the measured number belongs in the README once this runs. Measure the `msedgewebview2` children, not the Rust process alone.)
      Fix: A soak script that opens the workspace, runs the loop at the slowed ambient cadence for eight hours with a stubbed radar host, and samples `performance.memory` and the Rust process RSS every ten minutes.
      Acceptance: A recorded run with flat memory, or a leak logged here with the sampler's trace.
      Confidence: Needs-repro
      Effort: M

## Research-Driven Additions

Added by the 2026-09-02 research pass (`RESEARCH.md` of the same date carries the evidence). Numbered `AUD-168` onward; `AUD-168` moved to `Roadmap_Blocked.md` behind the release gate and `AUD-169` through `AUD-172` shipped the same day, with `AUD-201` recording what the loop left unfinished. Every host named below is either already in `ALLOWED_HOSTS` or is named in the item, and any new one needs the ledger row, the CSP entry and a `check:live` contract like the rest. Nothing here outranks an open audit item of the same priority.

### P1

### P2

### P3
  Note 2026-09-04: Retention evidence: a Bluesky reader stays on RadarScope for being "the lightest running" (2026-08-26); Anvil's memory sampler (`0f5972d`) shows a 26-frame replay retaining 2,178 MB, which is the comparison the README number would sit against.
- [ ] AUD-187 (P3): Scan the staged installer with Defender in the release gate
  Why: HookEcho and BowEcho, both unsigned Rust desktop apps, were flagged `Win32/Wacapew.A!ml` and publish false-positive FAQs; nothing here would know before a reader did.
  Evidence: r/stormchasing HookEcho thread (2026-08); BowEcho README FAQ; `scripts/release.mjs` verifies the signature and hashes but never scans.
  Touches: `scripts/release.mjs` (`MpCmdRun.exe -Scan -ScanType 3 -File <installer>` when present), `release-metadata.json` (the verdict and engine version), README install section (what to do if Defender objects).
  Acceptance: A release run records the Defender verdict beside the hashes and refuses to publish on a detection; when Defender is absent the step is reported skipped, not passed.
  Complexity: S

- [ ] AUD-188 (P3): Use the chunk timing projection for the live sweep
  Why: `chunks.rs` treats the live stream as an eleven-second cadence and detects a stall by silence; the pinned `nexrad-data` release carries a physics-based projection of when each remaining chunk and the next volume will land.
  Evidence: docs.rs `nexrad_data::aws::realtime` (rc.7): `project_scan_timing`, `project_full_scan_timing`, `estimate_chunk_availability_time`, `ChunkTimingModel`, `ElevationChunkMapper`; `src-tauri/src/chunks.rs` has no reference to them.
  Touches: `src-tauri/src/chunks.rs`, the live legend in `WorkspaceChrome.tsx` ("next piece due in 8 s", "this volume finishes at 21:42"), diagnostics.
  Acceptance: The live legend states when the next chunk is expected and when the volume will complete, from the projection; a stall is declared when a chunk is late by more than the model's tolerance rather than by a fixed timeout; the ring-position logic is unchanged and its tests still pass.
  Complexity: S

- [ ] AUD-189 (P3): Azimuthal shear from the volume itself, with a rotation product and a debris flag
  Why: MRMS AzShear is a 2-minute national grid; the same LLSD method on the held site's own dealiased velocity gives rotation at gate resolution seconds after the sweep, which is what GR2Analyst's NROT is and what no open-source app ships; a tornado debris flag needs it.
  Evidence: Mahalik et al. 2019 (NOAA IR PDF): 2500 m azimuthal by 750 m radial kernel, radial count adapted per range, cap 51 radials, minimum 3x3, 3x3 median pre-filter, mask to reflectivity at or above 20 dBZ; WDTD thresholds; the RLX NROT deck (5x5 fit, range-normalised, above 1.0 significant, above 2.5 extreme); PyMeso as a reference implementation; TDS criteria (correlation coefficient below 0.8, ZDR below 0.5 dB, reflectivity above 30 dBZ, collocated with strong shear).
  Touches: new `src-tauri/src/shear.rs`, `level2.rs` product table (`azimuthal-shear`, `rotation`), ramps with the colour-vision test, `RadarProductPanel.tsx`, legends and catalogues, `data_export.rs` (`derivation` records the kernel).
  Acceptance: An azimuthal shear product draws for any Doppler cut with the kernel documented in the legend; a normalised rotation product follows the NROT range curve; a debris flag marks gates meeting the four criteria within two kilometres of shear at or above 0.006 s⁻¹ and is labelled as a signature, not a confirmation; a planted couplet in the fixture volume produces the expected shear magnitude in a test.
  Complexity: M

- [ ] AUD-190 (P3): Single-site vertical products: composite, echo tops, VIL and hail size from the volume
  Why: GR2Analyst ships ET, VIL, VILD, POSH and MEHS from the volume and readers compare them against MRMS; the app has the MRMS grids and the sounding heights the hail algorithm needs, but nothing derived from the site.
  Evidence: ROC algorithm descriptions (echo tops NX-DR-03-013, VIL NX-DR-03-006 with the 56 dBZ ice cap), WDTD SHI/POSH/MESH pages (Witt et al. 1998: ramp 40 to 50 dBZ, weights between the 0 °C and −20 °C heights, POSH = 29 ln(SHI/WT) + 50, MESH = 2.54·SHI^0.5), the Skew-T in `src/lib/sounding.ts` already supplying those heights.
  Touches: new `src-tauri/src/derive.rs`, `level2.rs` product table, `src/lib/sounding.ts` (expose the freezing levels to the native side), legends, ramps, catalogues, `data_export.rs`.
  Acceptance: Composite reflectivity, 18.5 dBZ echo top (interpolated between cuts), VIL, VIL density and MESH draw for a held site on a 1 km grid; MESH names the sounding it took its heights from and falls back to stated defaults when none is loaded; a fixture volume with a known column produces known values in tests.
  Complexity: M

- [ ] AUD-191 (P3): Specific differential phase from the volume's differential phase
  Why: KDP is the dual-pol field that locates heavy rain and the KDP foot, it exists only as a Level III product, and the raw differential phase is already in the decoded volume.
  Evidence: `src-tauri/src/level2.rs:326-345` has no KDP; Vulpiani et al. 2012 iterative finite-difference method (Py-ART `kdp_vulpiani`, wradlib `kdp_from_phidp`) with unfolding and a correlation-coefficient censor at 0.9.
  Touches: `src-tauri/src/level2.rs` (or `derive.rs`), product table, ramp, legend, catalogues, `data_export.rs` (`derivation` names the method and window).
  Acceptance: A KDP product draws in degrees per kilometre from the volume's PHI with the method in the legend; gates with correlation below 0.9 are censored; a synthetic ramp in PHI produces the expected constant KDP in a test.
  Complexity: M

- [ ] AUD-192 (P3): Continuity across tilts in the dealiaser
  Why: The region method fixes a sweep only up to a whole Nyquist interval and can flip a whole region in strong shear; UNRAVEL's 3D pass uses the cut above and below to settle the interval, at modest cost on top of the existing core.
  Evidence: `src-tauri/src/dealias.rs` (region growing, largest patch keeps its reading); Louf et al. 2020 (JTECH) and the MIT numba implementation at `vlouf/dealias`; the live multi-site test in `level2.rs` that measures refold recovery.
  Touches: `src-tauri/src/dealias.rs` (a pass that votes a cut's interval against its neighbours in elevation), `level2.rs` (hand adjacent cuts to the unfolder), the live aggregate test.
  Acceptance: The six-site refold test's aggregate recovery does not fall and the whole-sweep-out-by-one case is caught in a planted fixture; runtime per cut stays under the current half-second budget.
  Complexity: M

- [ ] AUD-193 (P3): Buoys and observed water levels beside the tides
  Why: Surge rides on the tide and the app shows predicted tide only; NDBC buoys and CO-OPS observed water levels are keyless and say what the water is doing now.
  Evidence: Verified live 2026-09-02: `https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt` (107 KB fixed-width, `max-age=600`, no CORS: native fetch), `activestations.xml` (1,353 stations); CO-OPS `datagetter?product=water_level&date=latest` (6-minute, CORS `*`) beside the predictions already used in `src/lib/tides.ts`; NDBC asks for minimal retrieval.
  Touches: new `src/lib/overlays/buoys.ts` (native, one national file per ten minutes), `src/lib/tides.ts` (observed against predicted), `src/panels/TidesPanel.tsx`, `src-tauri/src/http.rs` and CSP (`www.ndbc.noaa.gov`), ledger, live contract, catalogues.
  Acceptance: Buoys draw with wind, wave height and pressure in the popup; the Tides panel shows observed water level against the prediction with the difference named; the buoy file is fetched at most once per ten minutes for the whole country regardless of pans.
  Complexity: M

- [ ] AUD-194 (P3): Aviation hazards: SIGMETs, G-AIRMETs, centre weather advisories and pilot reports
  Why: MyRadar charges $59.99 a year for aviation charts; the AWC publishes the hazard polygons and PIREPs keyless on a host the app already reaches for METARs.
  Evidence: Verified live 2026-09-02: `aviationweather.gov/api/data/isigmet`, `airsigmet`, `gairmet?format=geojson`, `cwa?format=geojson`, `pirep?format=geojson&bbox=` (bbox required), all keyless, no CORS (native), 100 requests a minute, 400 entries per response.
  Touches: new `src/lib/overlays/aviation.ts`, `registry.ts`, legends, catalogues, live contract (host already allowed).
  Acceptance: Convective and non-convective SIGMETs, G-AIRMET turbulence, icing and IFR, and CWAs draw as polygons with their valid times; PIREPs draw as points with altitude and remark; the layer says it is not for flight planning; requests stay under one per minute per product.
  Complexity: M
  Note 2026-09-04: The same hazards are on `mapservices.weather.noaa.gov/vector/rest/services/aviation/awc_aviation_weather` (ArcGIS, `f=geojson`, CORS), a host already allowed, which avoids aviationweather.gov's no-CORS and 100 req/min.
- [ ] AUD-195 (P3): Snowfall analysis for the winter lane
  Why: Precipitation type shipped in 0.6.0 and nothing says how much fell; NOHRSC's national snowfall analysis is the official 24/48/72-hour answer and is keyless.
  Evidence: Verified live 2026-09-02: `https://www.nohrsc.noaa.gov/snowfall_v2/data/{YYYYMM}/sfav2_CONUS_{6h|24h|48h|72h}_{YYYYMMDDHH}.tif` (00Z and 12Z for 24/48/72 h, no CORS: native), or the rendered `raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export` on the allowed mapservices host (daily, not time-enabled).
  Touches: either `src-tauri/src/geotiff.rs` gains a reader for the sfav2 GeoTIFF and a new native tile lane, or a raster overlay adapter for the ArcGIS export; `http.rs`/CSP for `www.nohrsc.noaa.gov` if native; legends, ramps, catalogues, ledger, live contract.
  Acceptance: A snowfall layer draws 24, 48 or 72-hour totals with the analysis time in the legend and the NOHRSC credit; provenance says `observation` with a daily cadence; the winter lane's product entry names it beside precipitation type.
  Complexity: M
  Note 2026-09-04: `raster/rest/services/snow/NOHRSC_Snow_Analysis` (ImageServer) is on the allowed host; SCN26-75 makes the Probabilistic Precipitation Portal operational on 2026-10-01 as the PWPF successor (`ftp-wpc.ncep.noaa.gov/prob_precip_portal/`), which is the snow and ice probability source for this lane.
- [ ] AUD-196 (P3): CoCoRaHS daily precipitation, hail and significant weather reports
  Why: Storm reports are one feed; CoCoRaHS is the densest volunteer rain and hail network in North America, CC BY 4.0, keyless and CORS-open.
  Evidence: Verified live 2026-09-02: `https://data.cocorahs.org/export/exportreports.aspx?Format=json&ReportType=Daily&State=IA&Date=MM/DD/YYYY` (also `Hail`, `SigWx`, `MultiDay`; CORS `*`); licence CC BY 4.0 in the site footer.
  Touches: new `src/lib/overlays/cocorahs.ts` (by state within view), `registry.ts`, `http.rs`/CSP (`data.cocorahs.org`), ledger, legends, catalogues, live contract.
  Acceptance: Daily totals and hail reports draw as points with the observation time and the CoCoRaHS credit; a state is fetched once per hour while in view; the popup names the observer's station id and never a person.
  Complexity: S

- [ ] AUD-197 (P3): Observed air quality and active fire detections, keyless
  Why: HRRR smoke is a model; readers under a plume want the monitor reading, and the earlier rejection of AirNow was of its keyed REST API, not of its public file bucket; FIRMS detections give the fire behind the NIFC perimeter.
  Evidence: Verified live 2026-09-02: `https://files.airnowtech.org/airnow/today/HourlyData_{YYYYMMDDHH}.dat` and `reportingarea.dat` (public S3, CORS `*`, pipe-delimited, AQI with lat/lon); FIRMS `https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires/?LAYERS=fires_viirs_24` answers without a key (CORS `*`), CSV/KML 24-hour files keyless without CORS.
  Touches: new `src/lib/overlays/airnow.ts` and `firms.ts`, `registry.ts`, `http.rs`/CSP for both hosts, ledger, legends (EPA AQI colours), catalogues, live contracts.
  Acceptance: Monitor AQI draws as points with the EPA category and the hour; VIIRS detections draw as points with confidence and acquisition time; both are labelled observations distinct from the HRRR model layer; fetched at most hourly.
  Complexity: M

- [ ] AUD-198 (P3): German catalogue
  Why: The app draws the DWD composite and will draw DWD warnings; the i18n machinery was built for exactly this and French proved the workflow; German is the follow-on the 2026-08-31 pass sequenced.
  Evidence: `src/i18n/` (en, es, fr, pseudo; 1,404 keys typed against `en.ts`; lazy chunks; pseudolocale clipping test); DWD WarnWetter's 6M downloads as the market signal (2026-08-31 pass).
  Touches: `src/i18n/de.ts`, `src/i18n/index.ts` (`LanguageId`), `src/lib/units.ts` (metric defaults, comma decimals), `e2e/language.spec.ts`, settings language list, `docs/listings.json`.
  Acceptance: Every key in `en.ts` has a German string; the clipping test passes in German at 1024x720; a German reader gets km/h, °C and comma decimals by default; the README and listings name four languages.
  Complexity: L

- [ ] AUD-199 (P3): An ARM64 Windows build
  Why: Arm was 15.3% of client CPUs in Q2 2026 and Snapdragon X laptops are the second-monitor machines this app is meant to sit on; Tauri builds `aarch64-pc-windows-msvc` with NSIS today and BowEcho already ships it.
  Evidence: Tauri Windows installer docs (aarch64 NSIS supported, MSI not; needs the VS "C++ ARM64 build tools"); BowEcho README; Mercury Research via The Register (2026-08-21).
  Touches: `scripts/release.mjs` (a second target and asset name `OpenRadar_<version>_arm64-setup.exe`), `latest.json` platforms (`windows-aarch64`), `README.md` asset table, `docs/listings.json`, `SHA256SUMS`.
  Acceptance: The release stages an ARM64 installer with its own updater signature and `latest.json` entry; the asset-name promise in the README lists it; a Defender scan (AUD-187) covers both; a launch on ARM hardware is recorded in the working notes or the badge stays x64.
  Complexity: M
  Note 2026-09-04: Verified 2026-09-04 in the Tauri bundler source: NSIS maps `aarch64` to `arm64` and the updater accepts a `windows-aarch64` target, so `--target aarch64-pc-windows-msvc` works today without a Tauri change.
- [ ] AUD-200 (P3): Re-capture the README screenshot
  Why: `assets/screenshots/openradar-main.png` is from 2026-08-31 and predates the light-theme repairs, French, the rail rework, the dark form controls and the accent changes described in the 0.8.0 changelog; a stale picture misleads the first reader.
  Evidence: `git log -1 -- assets/screenshots` (2026-08-31, "Rebuild the weather workspace around the map"); `CHANGELOG.md` 0.8.0 visual entries.
  Touches: `assets/screenshots/openradar-main.png`, `README.md` alt text, `docs/listings.json` screenshot reference.
  Acceptance: A fresh 1487x1058 capture of the dark workspace with Alerts open, taken headless per `screenshots.md`, replaces the file in the same commit as the next visual change; the alt text names the state.
  Complexity: S

## Research-Driven Additions, 2026-09-03

Added by the 2026-09-03 research pass (`RESEARCH.md` of the same date carries the evidence). Numbered `AUD-206` onward. Every host named below is either already in `ALLOWED_HOSTS` or is named in the item, and any new one needs the ledger row, the CSP entry and a `check:live` contract like the rest. Nothing here outranks an open audit item of the same priority.

### P1

### P2

### P3
- [ ] AUD-233 (P3): The finer MRMS grids at their own resolution, on demand
  Why: `AUD-175` shipped merged azimuthal shear, which MRMS publishes at 0.005 degrees, and it draws folded by two to the 0.01 degree grid the rest of the app uses. That is a deliberate memory decision from commit `9fcfc11` and not an oversight: one unfolded grid is 196 MB against 49, the cache budget is 768 MB, and `CACHE_CAPACITY > LAYERS_AT_ONCE` stops holding. It also means the item's own acceptance line, "at full 0.005 degree resolution", was not met, and the detail is real: a shear couplet is a few hundred metres across.
  Evidence: `src-tauri/src/mrms.rs` `MAX_SOURCE_REDUCTION`, `GRID_BYTES`, `CACHE_BUDGET_BYTES` and the two const assertions beneath them; `mrms::tests::a_finer_grid_is_folded_and_costs_what_a_coarse_one_does` measures the fold and its cost (330 ms to decode, 3.9 ms a tile on 2026-09-03).
  Touches: `src-tauri/src/mrms.rs` (a per-product reduction rather than one for the table, and a cache that budgets by bytes held rather than by slots of a fixed size), the cache tests.
  Acceptance: With a reader zoomed past the point the fold is visible, the shear grids draw unfolded, and a screen with eight layers on still never evicts a grid it is about to want; the budget is measured in bytes and the const assertions still hold.
  Complexity: M

- [ ] AUD-234 (P3): A legend for the overlay layers
  Why: `AUD-176` asked for the excessive rainfall outlook to carry its issue and valid time "in the popup and legend". The popup does. There is no legend to put it in: the two legend surfaces in the app are the radar ramp (`MapChrome.tsx`) and the satellite chip (`MapStage.tsx`), and neither knows an overlay exists. Every overlay with bands the reader has to interpret has the same gap, the SPC outlook and the storm surge ramp included, and a reader with three of them on has three sets of colours and nothing naming any of them.
  Evidence: `grep -rn "legend" src/components` finds `radar-legend` and `satellite-chip__legend` only; `src/lib/legend.ts` is the radar ramp; the WPC popup lines are `wpc.validWindow` and `wpc.issued` in `src/lib/overlays/wpc.ts`.
  Touches: a legend surface fed from the overlay adapters (each already knows its own bands and colours), `src/lib/overlays/registry.ts` for what an adapter says about its own key, `src/components/MapChrome.tsx` or a surface of its own, `src/i18n/*`, the layer-stack and clipping tests.
  Acceptance: With an overlay on that has bands, the map carries a key naming them in the reader’s language and in the service’s own colours, with the issue and valid time for the ones that are forecasts; it is off the export unless the reader asked for it; the pseudolocale clipping test covers it.
  Complexity: M

- [ ] AUD-219 (P3): Split `level2.rs` before the derived products land
  Why: The file is 6,467 lines and four open items (`AUD-189`, `AUD-190`, `AUD-191`, `AUD-192`) all land in it; a split into listing, decode, render, loop and status modules costs nothing now and a great deal after.
  Evidence: `wc -l src-tauri/src/level2.rs` (6,467 on 2026-09-03, up from 6,328 on 2026-09-02); the 2026-09-02 research assessment said the split should precede the derived products and no item carried it.
  Touches: `src-tauri/src/level2/{mod,listing,decode,render,loop,status}.rs`, `src-tauri/src/lib.rs` paths, tests move with their code, the working notes' architecture line, `docs/architecture.md`.
  Acceptance: No file under `level2/` exceeds 2,000 lines; `cargo test` passes the same count; clippy is clean; the four derived-product items name their target module.
  Complexity: M
  Note 2026-09-04: `level2.rs` is 7,019 lines on 2026-09-04 (+552 in one day, with `level2_vwp` beside `level2_cross_section`); `mrms.rs` is 4,467. See also `AUD-272` for the four hottest frontend files, which have no split item.
- [ ] AUD-220 (P3): Tests for the twelve panels that have none
  Why: Coverage floors are 63/56/57/64 and the panels are most of what is missing; twelve panels have no sibling test, so their empty, loading and error states are held only by e2e specs that stub the world.
  Evidence: `src/panels/` listing against `*.test.tsx` on 2026-09-03: CuriositySection, ExportPanel, GuidancePanel, IncidentPackManager, JournalSection, MapOptionsPanels, RecapSection, RoutePanel, SearchPanel, SoundingPanel, TidesPanel, UtilityPanels; `vitest.config.ts:34-47`.
  Touches: one `*.test.tsx` per panel, `vitest.config.ts` floors.
  Acceptance: Each panel has a sibling test covering its empty, loading and error states with the catalogue's copy; every floor rises by at least two points and none falls.
  Complexity: M
  Note 2026-09-04: The list is stale: `IncidentPackManager.test.tsx` now exists, and `StorageSection.tsx` and `VwpPanel.tsx` have no test. Thirteen panels, different membership; derive the list from `src/panels/*.tsx` minus `*.test.tsx` rather than naming them.
- [ ] AUD-222 (P3): Save the volume on screen as the file it came from
  Why: A reader who found the sweep that matters can export a picture, a CSV or a GeoTIFF but not the Archive II object itself, so the case study cannot be reopened in the app or handed to another tool; Supercell Wx has a pull request for the same ask.
  Evidence: `src-tauri/src/exports.rs:24` (`png`, `webm`, `gif`, `json`, `jsonl`, `md` only); the app opens local Archive II files already (`src-tauri/src/level2.rs` local mode); https://github.com/dpaulat/supercell-wx/pull/688.
  Touches: `src-tauri/src/exports.rs` (allow the bucket object's own name and extension; bytes are the fetched object unmodified), `src-tauri/src/level2.rs` (hold or refetch the raw bytes of the drawn volume by key), `src/panels/ExportPanel.tsx`, provenance sidecar (the object's SHA-256), `src/i18n/*`, `every_file_this_app_writes_can_be_written`.
  Acceptance: The saved file's SHA-256 equals the bucket object's; reopening it through the Upload panel draws the same sweep; a terminal radar's Level III product saves the same way; the write allowlist test lists the extension.
  Complexity: S

- [ ] AUD-223 (P3): Hail and rotation thresholds per watched place
  Why: The watch answers warnings; a reader who wants "tell me when the radar estimates hail over an inch within ten miles of the ballfield" has MESH and rotation tracks on screen and no rule to set on them. MyRadar 7.122 added hail alerts and Watch Duty's flood alerts are personal gauge thresholds; the arrival (`AUD-178`) and lightning (`AUD-179`) rules give this its shape.
  Evidence: `src/lib/watch.ts` (warning rules only); `src-tauri/src/mrms.rs` (`MESH_00.50`, `RotationTrack60min_00.50` decoded); https://apps.apple.com/us/app/myradar-accurate-weather-radar/id322439990; https://support.watchduty.org/hc/en-us/articles/46400067603341-Flooding-Notifications-FAQs.
  Touches: `src/lib/watch.ts` (rules: MESH at or above a size within a radius, rotation track within a radius), `src/hooks/useAlertWatch.ts` (sample the decoded grid at the place, not a new fetch), `src/panels/MapOptionsPanels.tsx` watch settings, the `appendJournalRow` writers gate, `src/i18n/*`, e2e with planted grids.
  Acceptance: A place with a hail rule announces once when MESH within its radius first meets the size, labelled as a radar estimate, silent by default, standing down under quiet hours, and again only after the grid has been quiet for thirty minutes; the journal gate still lists exactly its documented writers.
  Complexity: M

- [ ] AUD-224 (P3): A lightning jump on each tracked cell
  Why: A sudden rise in a cell's flash rate precedes severe weather by minutes and the app has both halves, cells and GLM flashes, with nothing joining them; HookEcho ships a lightning proximity alarm and no open-source app ships the jump.
  Evidence: `src/lib/cells.ts` (cells with motion); `src-tauri/src/lightning.rs` (flash centroids with quality flags); Erdmann et al. 2023 (sigma level and minimum rate dominate skill on GLM) https://journals.ametsoc.org/view/journals/apme/62/11/JAMC-D-22-0144.1.xml; Tian et al. 2025 https://doi.org/10.1155/adme/4280862.
  Touches: new `src/lib/lightningJump.ts` (two-minute flash-rate series per cell within the cell's radius, rate of change against two sigma of the prior ten minutes, a minimum rate), the cell popup and a badge in `src/panels/RadarProductPanel.tsx`, `src/i18n/*`, tests with planted series.
  Acceptance: A planted flash series that doubles over two bins produces a jump badge on the cell with the time; a steady series does not; the badge says it is a signal, not a warning; the GLM "not a strike report" note is carried.
  Complexity: M
  Note 2026-09-04: Half overtaken: `lightning-jump` and `lightning-jump-max` grids shipped in `AUD-217` (`mrms.rs`), so "no open-source app ships the jump" no longer describes this one. The per-cell join of `cells.ts` to the flash feed is what remains; the FMI graph tracker (AMT 19:1853, MIT) is the reference if a cell must be followed through a merge.
- [ ] AUD-225 (P3): The melting layer from the volume's own top tilt
  Why: The hail size item (`AUD-190`) needs the freezing level and takes it from a sounding that may be hours old and far away; the volume's own high tilt carries the bright band, and a published method finds it without model data to about 250 m.
  Evidence: Giangrande-style automated detection, AMT 14:2873 (2021): normalised Z, ZDR and (1 − ρhv) product on the tilt at or above 9°, threshold 0.08, second-derivative weight 0.75 (https://amt.copernicus.org/articles/14/2873/2021/); `src-tauri/src/level2.rs` has no melting-layer product; `MRMS BrightBandTopHeight` exists on the bucket but is 17.9 MB per file.
  Touches: `src-tauri/src/level2.rs` (or the `derive` module after `AUD-219`): azimuth-average the top cut, normalise, threshold, expose top and bottom heights; a line in `src/panels/RadarProductPanel.tsx`; a ring on the sweep at the melting height; `AUD-190` consumes the height when it lands; `src/i18n/*`.
  Acceptance: A fixture volume with a planted bright band at 3 km yields 3.0 ± 0.25 km; the sweep legend names the height and its source; when no cut at or above 9° exists the product says why; the CSV export is unchanged.
  Complexity: M

- [ ] AUD-226 (P3): Keyless European radar from MET Norway and the OPERA composite
  Why: Outside NOAA, ECCC and DWD coverage the timeline falls to RainViewer, which now calls itself personal-use only and caps zoom at 7; MET Norway serves its radar with no usage restrictions and EUMETNET's OPERA composites are on MeteoGate with an anonymous tier under CC BY 4.0, which changes the `Roadmap_Blocked.md` verdict that European radar needs keys.
  Evidence: https://api.met.no/weatherapi/radar/2.0/documentation and https://api.met.no/doc/TermsOfService (User-Agent required, 20 requests a second, CC BY 4.0); https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/ (three composites as ODIM HDF5 and cloud-optimised GeoTIFF, anonymous tier with low rate limits, key optional); https://www.rainviewer.com/api/transition-faq.html. Needs live validation: the anonymous rate limit is undocumented as a number.
  Touches: `src/lib/providers/` (a MET Norway PNG provider by area; a MeteoGate GeoTIFF lane through `src-tauri/src/geotiff.rs`), `src-tauri/src/http.rs` and the CSP (`api.met.no`, `api.meteogate.eu`), `docs/asset-ledger.md`, `src/lib/providers/coverage.ts` (Norway, then OPERA members), two live contracts that measure the anonymous limit, `src/i18n/*`.
  Acceptance: Over Norway the timeline draws MET Norway radar with the CC BY credit; over OPERA members the composite draws with the EUMETNET credit and its cadence in the legend; the live contract records the anonymous limit and the provider budget stays under it; RainViewer remains only where neither reaches.
  Complexity: L
  Note 2026-09-04: FMI renames every radar layer in autumn 2026 (`Radar:suomi_dbz_eureffin` becomes `Radar:radar_finland_cappi_dbzh`, old names removed end of November 2026); KNMI rotated its anonymous key on 2026-06-30 (old key dead 2026-08-01); SMHI's old API docs page 404s. Use the new FMI names from the start if FMI is wired.
- [ ] AUD-227 (P3): MeteoAlarm warnings for the rest of Europe
  Why: Canadian and German warnings proved the adapter shape and MeteoAlarm publishes every other European service's warnings under CC BY 4.0 with no registration; HookEcho reads it, and a reader in France or Italy with the DWD composite on has no warnings at all.
  Evidence: https://feeds.meteoalarm.org/ (CC BY 4.0, attribution to EUMETNET members, Atom only since 2026-01-14); `src/lib/overlays/dwdWarnings.ts` and `ecccAlerts.ts`; the 2026-09-02 lesson that every ECCC alert shared one identity because the watch keyed on `url`.
  Touches: new `src/lib/overlays/meteoalarm.ts` (Atom per country, CAP links, awareness type and level mapped in `src/lib/alertTypes.ts`), `src-tauri/src/http.rs` and the CSP, ledger, `src/lib/watch.ts` (identity per CAP identifier), `src/i18n/*`, live contract, fixture e2e.
  Acceptance: Warnings for MeteoAlarm members draw on the alerts layer with the EUMETNET credit and the issuing service named; the watch announces one at a watched place in Europe; German warnings defer to the DWD adapter so nothing draws twice; a fixture with two countries asserts distinct identities.
  Complexity: L

- [ ] AUD-228 (P3): Import a PMTiles basemap of your own
  Why: Basemap dependence broke two open-source radar tools this fortnight when Carto began requiring a key; the app's incident packs already store verified PMTiles, but only USGS sets the app fetches itself, so a reader with a licensed regional archive cannot use it.
  Evidence: `src-tauri/src/incident_packs.rs` (fetch-only USGS sets); https://github.com/jpettitt/weather-radar-card/issues/253 and https://github.com/JoshuaKimsey/LibreWXR/issues (Carto breakage, 2026-08-26 to 08-29); https://github.com/jhammon88219/Anvil (offline PMTiles with editable style); `C:\repos\StormDeck` importer with validation and licence text.
  Touches: `src-tauri/src/incident_packs.rs` (accept a user file: header, tile type, bounds and size checks; copy into the store under the same hashing; an attribution string stored beside), `src/panels/IncidentPackManager.tsx`, `src/panels/UtilityPanels.tsx` accept list, `docs/asset-ledger.md`, `src/i18n/*`, tests with a small fixture archive.
  Acceptance: A valid PMTiles v3 raster or vector archive imports and is selectable as the offline basemap with its own attribution shown; a malformed or oversize file is refused with the reason; the quota and journaling tests cover an imported pack.
  Complexity: M

- [ ] AUD-229 (P3): A keyboard cursor that reads the sweep aloud
  Why: The Nearby panel gives a screen-reader user the summary; the map itself is a canvas they cannot enter, so "what is the radar showing ten miles north of me" has no answer; the arrow-key virtual cursor is the pattern the accessible-maps field settled on.
  Evidence: `src/components/MapViewport.tsx` (keyboard handling for the map, no cursor), `src/components/LiveRegion.tsx`; Esri's "Pressing the Up Arrow" pattern https://www.esri.com/about/newsroom/arcnews/pressing-the-up-arrow-big-step-forward-in-accessibility; Audiom, the only WCAG-conformant map viewer https://gaad.foundation/what-we-do/gaadys/winners/audiom.
  Touches: `src/components/MapViewport.tsx` (arrow keys step a cursor in map space by a reader-chosen distance when the map has focus; the readout sampling already used by the pointer), `src/components/LiveRegion.tsx`, `src/i18n/*`, `e2e/accessibility.spec.ts`.
  Acceptance: With the map focused, arrow keys move a visible cursor and the live region announces the reflectivity, the velocity and the nearest place with bearing and distance; Escape returns focus to the rail; the pseudolocale clipping test covers the announcement; the cursor is off the export.
  Complexity: M

- [ ] AUD-230 (P3): Day and night on the map
  Why: A globe with no terminator gives no sense of where it is dark, which matters to a reader watching an overnight line of storms; the shading needs no network and no data source, and the owner's StormScope already ships it below every data layer.
  Evidence: no terminator or solar code in `src/` (`grep -ri terminator src` matches only unrelated Rust); `C:\repos\StormScope\README.md` "Day/Night Orientation".
  Touches: new `src/lib/terminator.ts` (NOAA solar position equations), a vector layer under the overlays in `src/lib/layerStack.ts`, `src/panels/MapOptionsPanels.tsx` switch, `src/i18n/*`, the layer-stack and provenance tests.
  Acceptance: Day/night shading draws with no request, updates each minute, sits below every data layer, is off by default, and is listed in the provenance table as computed locally.
  Complexity: S

## Audit Findings, 2026-09-03 (evening)

Read-only audit of `168271b` (v0.9.0). Baseline at that commit, all green: `npm run check` 176 files / 1622 passed / 37 skipped, lint 0 errors 1 pre-existing warning, every bundle inside budget; `cargo test` 412 passed / 28 ignored; `cargo clippy --all-targets` clean; `cargo audit` 0 vulnerabilities with 17 documented allowances; `gitleaks` 344 commits clean; `npm audit --omit=dev` 0; `grype` one Medium in `glib`, already documented as unreachable in `src-tauri/.cargo/audit.toml`. The GitHub tracker holds zero issues and zero pull requests (open or closed), so there was nothing to take in from reporters. Every P1 below survived a fresh-context refutation pass. Items are numbered on from `AUD-236`.

Where this pass dug: the three items drained on 2026-09-03 after the last refutation pass (`AUD-182`, `AUD-183`, `AUD-184`) and the two before it that never had one (`AUD-179`, `AUD-181`), which is where the correctness findings are; then the seams between the newer watches and the feeds they read.

### P1

### P2

### P3


## Audit Findings, 2026-09-04
  Note 2026-09-04: `consecutiveFailures` moved to `src/lib/diagnostics.ts:295-296` and `src/lib/providers/health.ts:8,25,47,60`; the cited lines are stale. A Bluesky post (2026-09-03) of RadarScope and RadarOmega both losing their feed in a storm is the reader-facing reason for the history.
## Research-Driven Additions

Seventh pass, 2026-09-04. Evidence in RESEARCH.md of the same date.

### P1

### P2

### P3

- [ ] AUD-269 (P3): Keep the display awake while the second-monitor view is showing
      Why: README says the full-screen view "is meant to be left running on the screen you are not typing on"; Windows turns that screen off on its own timer, and the page cannot stop it: the Screen Wake Lock API is unsupported in WebView2. One Win32 call from the native side is.
      Evidence: https://caniwebview.com/features/web-feature-screen-wake-lock/ ; `grep -rn wakeLock src` empty; `SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED)`.
      Touches: `src-tauri/src/lib.rs` (a `display_awake(bool)` command), the ambient-view enter and leave path in `src/App.tsx`, Settings (off by default, beside the ambient options), `src/i18n/*`, a test that the command is asked on enter and released on leave and on window close.
      Acceptance: With the option on, entering the ambient view asks the native side to hold the display and leaving it releases; the hold is released when the app exits; the option is off by default and says what it does.
      Complexity: S

- [ ] AUD-270 (P3): Speak a warning at a watched place with the Windows voice, off by default
      Why: HookEcho made spoken warnings the default on 2026-09-03 (#298: county, towns in path, distance and bearing from a saved place, a tone then speech, a queue); Supercell Wx #581 asks for voice lightning alerts. The app's watched places already compose the sentence (which place, which warning, how many minutes); speaking it through the page's own `speechSynthesis` is offline and keyless, and is the one form a reader away from the screen can take in.
      Evidence: https://github.com/d4vid87/HookEcho/pull/298 ; https://github.com/dpaulat/supercell-wx/issues/581 ; `src/lib/notify.ts`, `src/hooks/useAlertWatch.ts`, `src/hooks/useApproachWatch.ts`.
      Touches: `src/lib/notify.ts` (a `speak` beside `announceOnDesktop`, queued, cancelled by a newer warning for the same place), the watch settings (per place, off by default, honouring quiet hours and calm mode), `src/i18n/*` (the spoken sentence in the reader's language), tests with a stubbed `speechSynthesis`.
      Acceptance: With voice on for a place, a warning reaching it is spoken once in the catalogue language after the tone; quiet hours and calm mode silence it exactly as they silence the sound; two warnings queue rather than overlap; nothing is spoken by default.
      Complexity: S

- [ ] AUD-271 (P3): A search box over the settings
      Why: `src/panels/MapOptionsPanels.tsx` is 2,847 lines of settings with no filter; `searchCommands` (`src/lib/commands.ts:619`) exists for the palette and nothing points it at settings. Every setting has a catalogue label already, which is the index.
      Evidence: `grep -rn 'searchSettings\|filterSettings' src` empty; the palette's own search as the pattern; StormDeck's settings search in the sibling repo.
      Touches: `src/panels/MapOptionsPanels.tsx` (each row carries its label key; a box at the top hides rows whose label and detail do not match), `src/lib/commands.ts` (share the matcher), `src/i18n/*`, `src/panels/LayersPanel.test.tsx`.
      Acceptance: Typing "lightning" leaves only the rows whose label or detail mention it, in every language; clearing the box restores everything; the box is reachable from the command palette.
      Complexity: M

- [ ] AUD-272 (P3): Split `App.tsx` and `MapOptionsPanels.tsx` along the seams the churn shows
      Why: Since 2026-08-25, `App.tsx` was touched by 143 commits and `MapOptionsPanels.tsx` by 85, and they are 2,814 and 2,847 lines: four of the six largest files are the four hottest, and only `level2.rs` has a split item. Every layer added this week edited both.
      Evidence: `git log --since=2026-08-25 --format=%H -- src/App.tsx | wc -l` and the same for the panel; `wc -l`; the ten-place list in `CLAUDE.md` for adding a switch group.
      Touches: `src/App.tsx` (the watches, the replay wiring, the panel props each into a hook or component), `src/panels/MapOptionsPanels.tsx` (one file per section: layers, radar, watches, appearance, storage), `src/components/PanelSurfaces.tsx`, the tests that import them.
      Acceptance: Neither file is above 1,500 lines; adding a switch group edits one panel section file rather than the panel; `npm run check` and the e2e suite unchanged.
      Complexity: M
      Note 2026-09-04: this is no longer only hygiene. `npm run check` exits 1 at `check:bundle`: the settings chunk is 72 kB against its 70 kB budget, and `scripts/bundle-budget.mjs` says in its own comment that reaching the budget means the settings panel has stopped being one panel. Verified pre-existing by building 9d27982. The three panels share one module, so opening Layers fetches Settings too; splitting them into a module each is what drops the chunk.

- [ ] AUD-273 (P3): Tauri 2.12 readiness, when it ships
      Why: The 2.12 milestone (32 closed, 14 open on 2026-09-04) carries tao 0.37 (the process exits on `WM_ENDSESSION` instead of the "cannot move state from Destroyed" crash, which the autostart path is most exposed to), wry 0.56 (a WebView2 teardown crash fix), MSRV 1.90, `noRedirectionBitmap`, `bundle.windows.bundleVCRuntime`, and exit codes propagated from `app_handle().exit(n)`. None reaches this tree until `tauri-runtime-wry` 2.12.
      Evidence: https://github.com/tauri-apps/tauri/milestones ; https://github.com/tauri-apps/tao/blob/dev/CHANGELOG.md ; `src-tauri/Cargo.toml:7` (`rust-version = "1.85"`).
      Touches: `src-tauri/Cargo.toml` (`rust-version` 1.90, the bump), `src-tauri/tauri.conf.json` (`noRedirectionBitmap`, tested against the MapLibre canvas), `src-tauri/src/lib.rs` (the crash handler's exit-code assumption), `tauri-plugin-single-instance` 2.4.4 now.
      Acceptance: On 2.12: `cargo test`, clippy and the release gate green; a shutdown while the app runs in the tray leaves no crash file; the single-instance bump lands ahead of it.
      Complexity: S

## Audit Findings, 2026-09-04 (afternoon)

Read-only audit of `4f9a18a` (v0.9.0 tree, v0.10.0 unreleased in the changelog). Baseline at that commit: `npm run check` 182 files / 1710 passed / 38 skipped, lint 0 errors 1 pre-existing warning, coverage 65.3 / 59.4 / 60.17 / 66.5 above every floor, and **exit 1 at `check:bundle`** (settings chunk 72 kB against 70 kB, pre-existing baseline, already carried on `AUD-272`); `npx playwright test` 622 passed across chromium, compact and wide in 14.6 minutes; `cargo test` 420 passed / 29 ignored; `cargo clippy --all-targets` clean; `gitleaks` 372 commits clean; `npm audit` 0 with and without dev; `cargo audit` 0 vulnerabilities, 17 default-allowed warnings (the `lru` one is in `Roadmap_Blocked.md`); `grype` one Medium in `glib`, the documented Linux-only case. The GitHub tracker holds zero issues and zero pull requests, open or closed, and discussions are disabled, so there was nothing to take in from reporters. Every P1 below survived a fresh-context refutation, and the two storm-report items were confirmed against the live service rather than by reading. Items are numbered on from `AUD-275`.

Where this pass dug: the eleven items drained on 2026-09-04 that had no refutation of their own (`AUD-263`, `AUD-265`, `AUD-267`, `AUD-268` and the `AUD-185` frontend), the seams between them and the chrome, the secondary panels' failure states, the light theme with panels open in a real browser, and the keyboard paths axe cannot see.

### P1

### P2

### P3

- [ ] AUD-295 (P3): Microcopy consistency sweep
      Category: ux
      Where: `src/i18n/en.ts` and the two translations
      Problem: Small things a reader notices without naming: (1) trailing periods on `*Detail` strings are a coin flip, 52 with and 62 without, with adjacent rows differing (`layers.countiesDetail` between `qpeDayDetail` and `precipTypeDetail`; `satellite.geocolorDetail` beside `redVisibleDetail`), while `*Body` is 42 of 42 with; (2) layer and panel names mix Title Case ("Storm Cells", "Map Type", "Wind Profile", 44 of them) with sentence case ("Rain, gauge corrected", "Storm history", "Nearby weather"); (3) `radar.archiveReading` is the only in-progress line ending in "..."; (4) "WDTD" appears twice (`layers.lightningJumpWindowDetail` L467, `azShearLevel.midNote` L1143) and is the one acronym no reader would know; (5) the isotherm labels use a hyphen and no degree sign (`-10 C`, L476-477, L486-487) where `satellite.cleanIrLegend` L880 uses `−92 to +57 °C`; (6) `layers.note` L1200 says the same thing twice; (7) `es.ts:698` says "Nivel II" where every other Spanish string keeps "Level II"; (8) the file header at L7-10 forbids positional placeholders and 21 `radar.error.*`, `bundle.error.*`, `dataExport.error.*` keys use `{0}`/`{1}`.
      Evidence: A pass over all 1,683 keys on 2026-09-04; es and fr mirror en exactly on periods (0 mismatches) so the rule chosen has to be applied three times.
      Fix: Decide "one-sentence fragment: no period; two or more sentences: periods", sweep the details; Title Case for `layer.*` and `panel.*` names, sentence case for everything else; drop the dots; "NWS training guidance" for WDTD; `−10 °C`; rewrite `layers.note`; "Level II" in es; named parameters for the 21 keys with the Rust `parts()` callers updated.
      Acceptance: A gate in `coverage.test.ts` that asserts the period rule over `*Detail` and refuses `{0}`-style placeholders; the es/fr parity test still passes.
      Confidence: Verified
      Effort: M

### Unaudited, needs a pass

- [ ] AUD-311 (P3): What this pass could not observe
      Category: testing
      Where: the packaged Tauri window (tray launch, `visibilitychange` on first show, the notification permission prompt, the opener, the updater); a real screen reader (the ARIA findings above are traced, not heard); the MP4 export (Playwright's Chromium has no H.264; Edge does, per the 2026-09-03 note); a long-running session (`AUD-166`); the live TDWR and Level II decode paths under real network conditions
      Problem: Each is a place where the e2e suite also cannot see, and each has an item or a `Roadmap_Blocked.md` entry already; this line exists so the next pass does not assume they were covered.
      Evidence: This audit ran headless browser automation, read the packaged configuration, and queried two live services; it did not drive the installed app on a display.
      Fix: The desktop-session checks in `Roadmap_Blocked.md`, plus a NVDA or Narrator pass over the rail, the settings panel and one popup once `AUD-299` to `AUD-302` land.
      Acceptance: Each named surface has a recorded observation or a reason it cannot be made.
      Confidence: Needs-repro
      Effort: M
